/* ==========================================================================
   Gestione Turni ACTV - ottimizzatore
   Cerca la numerazione che, girando di settimana in settimana, alterna meglio
   le tipologie, rispetta la pausa di 10 ore (9h40 in deroga) e distribuisce
   le settimane "disponibile".

   Strategia:
     1. costruisce un "disegno" di categorie ben distanziate sul ciclo;
     2. assegna i turni veri alle posizioni della stessa categoria ottimizzando
        le pause (2-opt);
     3. migliora il tutto con ricerca locale + simulated annealing, partendo da
        piu' disegni diversi (multi-start deterministico).
   ========================================================================== */
(function (root) {
  "use strict";

  const T = (root.Turni = root.Turni || {});

  const P = 0;   // primo
  const SP = 1;  // spezzato
  const B = 2;   // secondo
  const C = 3;   // terzo
  const N = 4;   // disponibile

  const CAT_INDEX = { PRIMO: P, SPEZZATO: SP, SECONDO: B, TERZO: C, DISP: N };
  const INDEX_CAT = ["PRIMO", "SPEZZATO", "SECONDO", "TERZO", "DISP"];

  const PESO_KO = 1e9;    // una pausa sotto 9h40 vale piu' di tutto il resto
  const PESO_DER = 1e6;   // una pausa fra 9h40 e 10h viene subito dopo

  function catIdx(cat) {
    return CAT_INDEX[cat] != null ? CAT_INDEX[cat] : N;
  }

  function creaMatriceCategorie(pesi) {
    const m = new Float64Array(5 * 5);
    for (let a = 0; a < 5; a++) {
      for (let b = 0; b < 5; b++) {
        m[a * 5 + b] = T.costoCategoria(INDEX_CAT[a], INDEX_CAT[b], pesi);
      }
    }
    return m;
  }

  function creaModello(dep, opzioni) {
    const o = opzioni || {};
    const pesi = Object.assign({}, T.PESI_PREDEFINITI, o.pesi || {});
    const catDi = o.catDi || function (t) { return t.cat; };
    const slots = T.slotDaFasce(dep.fasce);
    const byNum = new Map((dep.turni || []).map((t) => [t.n, t]));
    const turni = (dep.turni || [])
      .map(function (t) {
        return Object.assign({}, t, { cat: catDi(t), catIdx: catIdx(catDi(t)) });
      })
      .sort((a, b) => a.n - b.n);
    const dispSet = new Set(dep.disponibili || []);
    const dispCount = (dep.disponibili || []).length;
    const target = T.targetGap(turni.length, dispCount);

    let fixedDisp = o.modoDisp === "fisso";
    if (o.modoDisp === "auto" || o.modoDisp == null) {
      const gaps = T.gapDisponibili(slots, dep.disponibili || []);
      fixedDisp = gaps.every((g) => g >= target);
    }

    const n = turni.length;
    const rest = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        rest[i * n + j] = T.pausaMin(turni[i], turni[j]);
      }
    }

    const turniPerCat = [[], [], [], []];
    turni.forEach(function (t, i) {
      if (t.catIdx < 4) turniPerCat[t.catIdx].push(i);
    });

    /* posizioni fisse dei disponibili (modo fisso / auto gia' conforme) */
    const dispPosizioniFisse = [];
    if (fixedDisp) {
      slots.forEach(function (num, i) {
        if (dispSet.has(num)) dispPosizioniFisse.push(i);
      });
    }

    const info = {
      slots: slots,
      turni: turni,
      byNum: byNum,
      dispSet: dispSet,
      dispCount: dispCount,
      target: target,
      fixedDisp: fixedDisp,
      dispPosizioniFisse: dispPosizioniFisse,
      pesi: pesi,
      turniPerCat: turniPerCat,
      catCost: creaMatriceCategorie(pesi),
      rest: rest,
      n: n,
      lunghezza: slots.length,
    };
    return info;
  }

  /* ------------------------------------------------------- disegno categorie */

  function costruisciPattern(m, rnd, giro, giriTotali) {
    const L = m.lunghezza;
    const pattern = new Uint8Array(L).fill(255);
    const faseBase = (giro / Math.max(1, giriTotali) + rnd() * 0.08) % 1;

    if (m.fixedDisp) {
      m.dispPosizioniFisse.forEach((pos) => (pattern[pos] = N));
    } else if (m.dispCount) {
      /* disponibili distanziati il piu' possibile */
      for (let k = 0; k < m.dispCount; k++) {
        let pos = Math.floor((((k + faseBase) * L) / m.dispCount)) % L;
        let guardia = 0;
        while (pattern[pos] !== 255 && guardia++ < L) pos = (pos + 1) % L;
        pattern[pos] = N;
      }
    }

    const liberi = [];
    for (let i = 0; i < L; i++) if (pattern[i] === 255) liberi.push(i);

    const pesiCat = [0, 0, 0, 0];
    m.turniPerCat.forEach((a, i) => (pesiCat[i] = a.length));

    const gettoni = [];
    for (let c = 0; c < 4; c++) {
      const quanti = pesiCat[c];
      if (!quanti) continue;
      const fase = (faseBase + c * 0.23 + rnd() * 0.04) % 1;
      for (let k = 0; k < quanti; k++) {
        gettoni.push({ c: c, u: ((k + 0.5) / quanti + fase) % 1, k: k });
      }
    }
    gettoni.sort((a, b) => (a.u - b.u) || (a.k - b.k));
    liberi.forEach((pos, k) => {
      if (k < gettoni.length) pattern[pos] = gettoni[k].c;
    });

    /* eventuali posizioni residue: categoria piu' frequente */
    for (let i = 0; i < L; i++) {
      if (pattern[i] === 255) pattern[i] = P;
    }
    return pattern;
  }

  /* ------------------------------------------------------- assegnazione turni */

  function inizio(t) {
    return T.inizioServizio(t.lv, 0) != null
      ? T.inizioServizio(t.lv, 0)
      : T.inizioServizio(t.sb, 0) != null
      ? T.inizioServizio(t.sb, 0)
      : T.inizioServizio(t.fs, 0) != null
      ? T.inizioServizio(t.fs, 0)
      : 99999;
  }

  function fine(t) {
    return T.ultimaFine(t, true) != null ? T.ultimaFine(t, true) : -1;
  }

  function mescola(a, rnd) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = T.intero(rnd, i + 1);
      const x = a[i];
      a[i] = a[j];
      a[j] = x;
    }
    return a;
  }

  function assegnaTurni(pattern, m, rnd, giro) {
    const L = m.lunghezza;
    const seq = new Int32Array(L).fill(-1);
    const posPerCat = [[], [], [], []];

    for (let i = 0; i < L; i++) {
      const c = pattern[i];
      if (c < 4) posPerCat[c].push(i);
    }

    for (let c = 0; c < 4; c++) {
      const posizioni = posPerCat[c];
      if (!posizioni.length) continue;
      const lista = m.turniPerCat[c].slice();
      const modo = giro % 4;
      if (modo === 0) {
        lista.sort((a, b) => m.turni[a].n - m.turni[b].n);
      } else if (modo === 1) {
        lista.sort((a, b) => inizio(m.turni[a]) - inizio(m.turni[b]) || m.turni[a].n - m.turni[b].n);
      } else if (modo === 2) {
        lista.sort((a, b) => fine(m.turni[a]) - fine(m.turni[b]) || m.turni[a].n - m.turni[b].n);
      } else {
        mescola(lista, rnd);
      }
      posizioni.forEach((pos, k) => {
        if (k < lista.length) seq[pos] = lista[k];
      });
    }
    return seq;
  }

  /* --------------------------------------------------------------- punteggi */

  function punteggioScalare(seq, m) {
    const L = m.lunghezza;
    let cat = 0;
    let ko = 0;
    let der = 0;
    for (let i = 0; i < L; i++) {
      const a = seq[i];
      const b = seq[(i + 1) % L];
      const ca = a < 0 ? N : m.turni[a].catIdx;
      const cb = b < 0 ? N : m.turni[b].catIdx;
      cat += m.catCost[ca * 5 + cb];
      if (a >= 0 && b >= 0) {
        const p = m.rest[a * m.n + b];
        if (p < T.PAUSA_DEROGA) ko++;
        else if (p < T.PAUSA_MIN) der++;
      }
    }

    let disp = 0;
    if (m.target > 0) {
      let ultimo = -1;
      let primo = -1;
      for (let i = 0; i < L; i++) {
        if (seq[i] < 0) {
          if (primo < 0) primo = i;
          if (ultimo >= 0) {
            const gap = i - ultimo - 1;
            if (gap < m.target) disp += (m.target - gap) * m.pesi.disponibiliVicini;
          }
          ultimo = i;
        }
      }
      if (primo >= 0 && ultimo >= 0) {
        const gap = ((primo - ultimo - 1) + L) % L;
        if (gap < m.target) disp += (m.target - gap) * m.pesi.disponibiliVicini;
      }
    }
    return ko * PESO_KO + der * PESO_DER + cat + disp;
  }

  function dettaglio(seq, m) {
    const L = m.lunghezza;
    let cat = 0;
    let ko = 0;
    let der = 0;
    for (let i = 0; i < L; i++) {
      const a = seq[i];
      const b = seq[(i + 1) % L];
      const ca = a < 0 ? N : m.turni[a].catIdx;
      const cb = b < 0 ? N : m.turni[b].catIdx;
      cat += m.catCost[ca * 5 + cb];
      if (a >= 0 && b >= 0) {
        const p = m.rest[a * m.n + b];
        if (p < T.PAUSA_DEROGA) ko++;
        else if (p < T.PAUSA_MIN) der++;
      }
    }
    let disp = 0;
    const gaps = [];
    if (m.target > 0) {
      let ultimo = -1;
      let primo = -1;
      for (let i = 0; i < L; i++) {
        if (seq[i] < 0) {
          if (primo < 0) primo = i;
          if (ultimo >= 0) {
            const gap = i - ultimo - 1;
            gaps.push(gap);
            if (gap < m.target) disp += (m.target - gap) * m.pesi.disponibiliVicini;
          }
          ultimo = i;
        }
      }
      if (primo >= 0 && ultimo >= 0) {
        const gap = ((primo - ultimo - 1) + L) % L;
        gaps.push(gap);
        if (gap < m.target) disp += (m.target - gap) * m.pesi.disponibiliVicini;
      }
    }

    /* Serie piu' lunga della stessa categoria (con chiusura del ciclo). */
    let serieMassima = 0;
    let serie = 0;
    let precedente = -1;
    for (let k = 0; k < L * 2; k++) {
      const v = seq[k % L];
      if (v < 0) {
        serie = 0;
        precedente = -1;
        continue;
      }
      const c = m.turni[v].catIdx;
      if (c === precedente) serie++;
      else {
        serie = 1;
        precedente = c;
      }
      if (serie > serieMassima) serieMassima = serie > L ? L : serie;
    }

    return {
      ko: ko,
      der: der,
      categoria: cat,
      disponibili: disp,
      punteggio: cat + disp,
      gaps: gaps,
      serie: serieMassima,
      scalare: ko * PESO_KO + der * PESO_DER + cat + disp,
    };
  }

  function meglio(a, b) {
    if (!b) return true;
    if (a.ko !== b.ko) return a.ko < b.ko;
    if (a.der !== b.der) return a.der < b.der;
    if (a.punteggio !== b.punteggio) return a.punteggio < b.punteggio;
    if (a.serie !== b.serie) return a.serie < b.serie;
    return false;
  }

  function scambiabile(seq, i, j, m) {
    if (i === j) return false;
    if (seq[i] === seq[j]) return false;
    if (m.fixedDisp && (seq[i] < 0 || seq[j] < 0)) return false;
    return true;
  }

  /* --------------------------------------------------------- ricerca locale */

  function miglioraDentroCategoria(seq, m) {
    const L = m.lunghezza;
    let cur = punteggioScalare(seq, m);
    let giri = 0;
    let migliorato = true;
    while (migliorato && giri++ < 8) {
      migliorato = false;
      for (let c = 0; c < 4; c++) {
        const pos = [];
        for (let i = 0; i < L; i++) {
          const v = seq[i];
          if (v >= 0 && m.turni[v].catIdx === c) pos.push(i);
        }
        for (let a = 0; a < pos.length; a++) {
          for (let b = a + 1; b < pos.length; b++) {
            const i = pos[a];
            const j = pos[b];
            const x = seq[i];
            const y = seq[j];
            seq[i] = y;
            seq[j] = x;
            const s = punteggioScalare(seq, m);
            if (s < cur - 1e-9) {
              cur = s;
              migliorato = true;
            } else {
              seq[i] = x;
              seq[j] = y;
            }
          }
        }
      }
    }
    return cur;
  }

  function salita(seq, m, maxGiri) {
    const L = m.lunghezza;
    let cur = punteggioScalare(seq, m);
    let giri = 0;
    let migliorato = true;
    const massimo = maxGiri || 10;
    while (migliorato && giri++ < massimo) {
      migliorato = false;
      for (let i = 0; i < L; i++) {
        for (let j = i + 1; j < L; j++) {
          if (!scambiabile(seq, i, j, m)) continue;
          const x = seq[i];
          const y = seq[j];
          seq[i] = y;
          seq[j] = x;
          const s = punteggioScalare(seq, m);
          if (s < cur - 1e-9) {
            cur = s;
            migliorato = true;
          } else {
            seq[i] = x;
            seq[j] = y;
          }
        }
      }
    }
    return cur;
  }

  function anneal(seq, m, rnd, passi) {
    const L = m.lunghezza;
    let cur = punteggioScalare(seq, m);
    let best = cur;
    let bestSeq = seq.slice();
    const T0 = 120;
    const T1 = 0.4;

    for (let s = 0; s < passi; s++) {
      const i = T.intero(rnd, L);
      const j = T.intero(rnd, L);
      if (!scambiabile(seq, i, j, m)) continue;
      const x = seq[i];
      const y = seq[j];
      seq[i] = y;
      seq[j] = x;
      const nuovo = punteggioScalare(seq, m);
      const delta = nuovo - cur;
      const temp = T0 * Math.pow(T1 / T0, s / passi);
      if (delta <= 0 || rnd() < Math.exp(-delta / temp)) {
        cur = nuovo;
        if (nuovo < best - 1e-9) {
          best = nuovo;
          bestSeq = seq.slice();
        }
      } else {
        seq[i] = x;
        seq[j] = y;
      }
    }
    seq.set(bestSeq);
    return best;
  }

  /* ------------------------------------------------------------- risultato */

  function sequenzaOggetti(seq, m) {
    const out = [];
    for (let i = 0; i < seq.length; i++) {
      const v = seq[i];
      if (v < 0) out.push({ n: null, cat: T.CAT.DISP });
      else out.push({ n: m.turni[v].n, cat: m.turni[v].cat });
    }
    return out;
  }

  T.creaModello = creaModello;
  T.punteggioScalare = punteggioScalare;

  T.ottimizzaDeposito = function (dep, opzioni) {
    const o = opzioni || {};
    const inizioTempo = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const m = creaModello(dep, o);
    const L = m.lunghezza;
    if (!L) {
      return { seq: [], metrica: T.statistiche(dep, [], o), modello: m, tempo: 0, giri: 0 };
    }

    const semi = o.seed != null ? o.seed : T.hashStringa(dep.codice + "|" + (o.semeDati || T.firmaDeposito(dep)));
    const rnd = T.rng(semi);
    const giri = L <= 15 ? 16 : 12;
    const passi = Math.max(3500, L * 140);

    let migliore = null;
    let metricaMigliore = null;

    for (let g = 0; g < giri; g++) {
      const pattern = costruisciPattern(m, rnd, g, giri);
      const seq = assegnaTurni(pattern, m, rnd, g);
      miglioraDentroCategoria(seq, m);
      salita(seq, m, 6);
      anneal(seq, m, rnd, passi);
      salita(seq, m, 8);

      const det = dettaglio(seq, m);
      if (!metricaMigliore || meglio(det, metricaMigliore)) {
        metricaMigliore = det;
        migliore = seq.slice();
      }
    }

    const seqObj = sequenzaOggetti(migliore, m);
    const metrica = T.statistiche(dep, seqObj, {
      pesi: m.pesi,
      target: m.target,
      byNum: m.byNum,
    });
    const fineTempo = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

    return {
      seq: seqObj,
      metrica: metrica,
      modello: m,
      tempo: Math.max(0, fineTempo - inizioTempo),
      giri: giri,
      seed: semi,
    };
  };

  /* Confronta due sequenze sullo stesso deposito. */
  T.confronta = function (dep, attuale, proposta, pesi) {
    const byNum = new Map((dep.turni || []).map((t) => [t.n, t]));
    const target = T.targetGapDeposito(dep);
    return {
      attuale: T.statistiche(dep, attuale, { pesi: pesi, target: target, byNum: byNum }),
      proposta: T.statistiche(dep, proposta, { pesi: pesi, target: target, byNum: byNum }),
      target: target,
    };
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
