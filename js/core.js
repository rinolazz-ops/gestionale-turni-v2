/* ==========================================================================
   Gestione Turni ACTV - motore dati
   Classificazione dei cartellini, costruzione dei depositi, calcolo delle
   pause di riposo e delle statistiche di una sequenza.
   Nessuna dipendenza esterna: funziona anche da file://.
   ========================================================================== */
(function (root) {
  "use strict";

  const T = (root.Turni = root.Turni || {});

  /* ------------------------------------------------------------------ tipi */

  T.CAT = Object.freeze({
    PRIMO: "PRIMO",
    SPEZZATO: "SPEZZATO",
    SECONDO: "SECONDO",
    TERZO: "TERZO",
    DISP: "DISP",
    JOLLY: "JOLLY",
  });

  T.CAT_ORDINE = ["PRIMO", "SPEZZATO", "SECONDO", "TERZO"];

  T.CODICE_CAT = {
    PRIMO: "P",
    SPEZZATO: "SP",
    SECONDO: "S",
    TERZO: "T",
    DISP: "D",
    JOLLY: "J",
  };

  T.FASCIA = {
    PRIMO: "A",
    SPEZZATO: "A",
    SECONDO: "B",
    TERZO: "C",
    DISP: "N",
    JOLLY: "N",
  };

  T.COLORE_CAT = {
    PRIMO: "#f59e0b",
    SPEZZATO: "#10b981",
    SECONDO: "#3b82f6",
    TERZO: "#8b5cf6",
    DISP: "#cbd5e1",
    JOLLY: "#94a3b8",
  };

  /* -------------------------------------------------------------- depositi */

  const DEPOSITI = [
    {
      codice: "dolo",
      nome: "Dolo",
      gruppi: [0],
      sigle: ["DEP.DOLO", "DOLO.DEP", "DOLO"],
    },
    {
      codice: "cavarzere",
      nome: "Cavarzere",
      gruppi: [1],
      sigle: ["DEP.CAV", "DEP.CAVARZERE", "CAVARZERE"],
    },
    {
      codice: "bojon",
      nome: "Bojon",
      gruppi: [2],
      sigle: ["BOJON"],
    },
    {
      codice: "padova",
      nome: "Padova",
      gruppi: [3],
      sigle: ["PD PARCH", "PARCH", "PADOVA"],
    },
    {
      codice: "fosso",
      nome: "Fossò",
      gruppi: [5],
      sigle: ["FOSSO", "FOS PK"],
    },
  ];

  T.DEPOSITI = DEPOSITI;
  T.DEPOSITO_PER_GRUPPO = (function () {
    const m = {};
    DEPOSITI.forEach((d) => d.gruppi.forEach((g) => (m[g] = d)));
    return m;
  })();

  T.SOGLIE_PREDEFINITE = Object.freeze({
    oreJolly: 4,          // sotto queste ore il turno e' un jolly
    primoInizio: 660,     // 11:00 - un primo comincia prima
    primoFine: 840,       // 14:00 - ...e finisce entro
    terzoInizio: 840,     // 14:00 - un terzo comincia da qui
    terzoFine: 1260,      // 21:00 - ...oppure finisce dopo
  });

  T.PESI_PREDEFINITI = Object.freeze({
    ripetizione: 100,
    stessaFascia: 35,
    dopoSpezzato: 60,
    inversione: 18,
    salto: 28,
    ciclo: 8,
    neutro: 0,
    disponibiliVicini: 40,
    pausaForte: 400,
    pausaDeroga: 60,
    dispDisp: 20,
  });

  T.PAUSA_MIN = 600;      // 10 ore
  T.PAUSA_DEROGA = 580;   // 9h40
  T.DISP_MIN = 4;         // turni normali desiderati fra due disponibili

  T.VERSIONE_DATI = 2;
  T.VERSIONE_MOTORE = 3;

  /* --------------------------------------------------------------- utility */

  T.hm = function (minuti) {
    let m = Math.round(minuti) % 1440;
    if (m < 0) m += 1440;
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  };

  T.aMinuti = function (testo) {
    const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(testo || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

  T.oreMin = function (minuti) {
    if (minuti == null || !isFinite(minuti) || minuti === Infinity) return "—";
    const m = Math.max(0, Math.round(minuti));
    return Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0");
  };

  T.fmtOre = function (ore) {
    if (ore == null || !isFinite(ore)) return "—";
    return String(ore).replace(".", ",") + " h";
  };

  T.fmtNumero = function (n) {
    return "D" + String(n).padStart(3, "0");
  };

  T.clona = function (x) {
    return x == null ? x : JSON.parse(JSON.stringify(x));
  };

  T.somma = function (a) {
    return a.reduce((s, x) => s + x, 0);
  };

  T.media = function (a) {
    return a.length ? T.somma(a) / a.length : 0;
  };

  /* generatore pseudo-casuale deterministico (mulberry32) */
  T.rng = function (seme) {
    let a = seme >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* interi in [0, n) */
  T.intero = function (rnd, n) {
    return Math.floor(rnd() * n) % n;
  };

  T.hashStringa = function (s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  /* Firma stabile del contenuto di un deposito: serve a rendere riproducibile
     l'ottimizzazione anche se i PDF vengono ricaricati in un altro momento. */
  T.firmaDeposito = function (dep) {
    const tratti = function (voce) {
      if (!voce || !voce.tratti) return "";
      return voce.tratti.map(function (t) {
        return t.join("-");
      }).join("+");
    };
    return JSON.stringify((dep && dep.fasce) || []) + "#" +
      ((dep && dep.disponibili) || []).join(",") + "#" +
      ((dep && dep.turni) || []).map(function (t) {
        return [
          t.n, t.cat, t.ore, t.monta,
          tratti(t.lv), tratti(t.sb), tratti(t.fs),
        ].join(":");
      }).join("|");
  };

  /* -------------------------------------------------------- ora / cartellini */

  /* Coppie di orari: [[inizio, fine], ...] in minuti; la fine dopo mezzanotte
     viene portata oltre le 24:00 (es. 17:35 -> 01:05 diventa 25:05). */
  T.coppie = function (minuti) {
    const out = [];
    for (let i = 0; i + 1 < minuti.length; i += 2) {
      let a = minuti[i];
      let b = minuti[i + 1];
      if (b <= a) b += 1440;
      out.push([a, b]);
    }
    return out;
  };

  T.trattiMin = function (voce) {
    if (!voce || !voce.tratti || !voce.tratti.length) return null;
    const out = [];
    voce.tratti.forEach(function (t) {
      let a = T.aMinuti(t[0]);
      let b = T.aMinuti(t[1]);
      if (a == null || b == null) return;
      if (b <= a) b += 1440;
      out.push([a, b]);
    });
    return out.length ? out : null;
  };

  T.trattiTesto = function (voce) {
    if (!voce || !voce.tratti || !voce.tratti.length) return "—";
    return voce.tratti.map((t) => t[0] + "-" + t[1]).join(" + ");
  };

  /* --------------------------------------------------------- classificazione */

  T.classifica = function (ore, minuti, soglie) {
    const s = Object.assign({}, T.SOGLIE_PREDEFINITE, soglie || {});
    if (ore != null && ore < s.oreJolly) return T.CAT.JOLLY;
    if (!minuti || minuti.length < 2) return null;
    const tr = T.coppie(minuti);
    if (!tr.length) return null;
    if (tr.length >= 2) return T.CAT.SPEZZATO;
    const inizio = tr[0][0];
    let fine = tr[0][1];
    if (fine <= inizio) fine += 1440;
    if (inizio < s.primoInizio && fine <= s.primoFine) return T.CAT.PRIMO;
    if (inizio >= s.terzoInizio || fine > s.terzoFine) return T.CAT.TERZO;
    return T.CAT.SECONDO;
  };

  /* --------------------------------------------------------- lettura del testo */

  const RE_TURNO = /^D\s*(\d{3})\s*(.*)$/;
  const RE_ORARIO = /^Orario\b(.*)$/;
  const RE_DECIMALE = /(-?\d+[.,]\d{1,2})/;
  const RE_ORA = /(\d{1,2}):(\d{2})/g;
  const RE_MONTA = /^Monta\s+(.*?)\s+Smonta\s+(.*)$/;
  const RE_DATA = /Data:\s*(\d{2}\/\d{2}\/\d{4})/;

  T.normalizzaRiga = function (riga) {
    return String(riga || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^D\s+(\d{3})/, "D$1")
      .replace(/(\d{1,2})\s*:\s*(\d{2})/g, "$1:$2")
      .trim();
  };

  /* Trasforma il testo estratto (una riga per elemento) nei cartellini grezzi. */
  T.leggiCartellini = function (testo) {
    const righe = String(testo || "").split(/\r?\n/);
    const out = [];
    let corrente = null;
    let pagina = 1;

    function chiudi() {
      if (corrente && (corrente.minuti.length || corrente.monta)) out.push(corrente);
      corrente = null;
    }

    for (let i = 0; i < righe.length; i++) {
      let riga = T.normalizzaRiga(righe[i]);
      if (!riga) continue;
      if (/^---\s*pagina\s+\d+/i.test(riga)) {
        pagina++;
        continue;
      }

      const mt = RE_TURNO.exec(riga);
      if (mt) {
        chiudi();
        corrente = {
          numero: Number(mt[1]),
          tipo: (mt[2] || "").replace(/[^A-Za-zÀ-ÿ]/g, "").slice(0, 20),
          ore: null,
          minuti: [],
          monta: "",
          data: null,
          pagina: pagina,
        };
        continue;
      }
      if (!corrente) continue;

      const mo = RE_ORARIO.exec(riga);
      if (mo) {
        const resto = mo[1] || "";
        const senzaOrari = resto.replace(RE_ORA, " ");
        const dec = RE_DECIMALE.exec(senzaOrari);
        if (dec) corrente.ore = Number(dec[1].replace(",", "."));

        let m;
        RE_ORA.lastIndex = 0;
        while ((m = RE_ORA.exec(resto))) {
          corrente.minuti.push(Number(m[1]) * 60 + Number(m[2]));
        }

        /* Se il PDF separa le ore dagli orari, il valore numerico puo'
           mancare: si ricava dalla durata dei tratti. */
        if (corrente.ore == null && corrente.minuti.length >= 2) {
          let totale = 0;
          for (let k = 0; k + 1 < corrente.minuti.length; k += 2) {
            let fine = corrente.minuti[k + 1];
            if (fine <= corrente.minuti[k]) fine += 1440;
            totale += fine - corrente.minuti[k];
          }
          corrente.ore = Math.round((totale / 60) * 100) / 100;
        }
        continue;
      }

      const mm = RE_MONTA.exec(riga);
      if (mm && !corrente.monta) {
        corrente.monta = mm[1].trim();
        continue;
      }

      const md = RE_DATA.exec(riga);
      if (md && !corrente.data) corrente.data = md[1];
    }
    chiudi();
    return out;
  };

  /* Unisce eventuali doppioni dello stesso numero (tenendo la copia con orario). */
  T.unisciCartellini = function (lista) {
    const mappa = new Map();
    (lista || []).forEach(function (t) {
      const vecchio = mappa.get(t.numero);
      if (!vecchio) {
        mappa.set(t.numero, Object.assign({}, t));
        return;
      }
      const nuovoBuono = t.minuti && t.minuti.length;
      const vecchioBuono = vecchio.minuti && vecchio.minuti.length;
      if (nuovoBuono && !vecchioBuono) {
        mappa.set(t.numero, Object.assign({}, t));
      } else if (nuovoBuono && vecchioBuono) {
        /* stesso numero due volte: si tiene il cartellino con piu' informazioni */
        if (!vecchio.monta && t.monta) vecchio.monta = t.monta;
        if (!vecchio.data && t.data) vecchio.data = t.data;
      }
    });
    return Array.from(mappa.values()).sort((a, b) => a.numero - b.numero);
  };

  T.tipoDaNome = function (nome) {
    const n = String(nome || "").toUpperCase();
    if (n.includes("SABATO")) return "sabato";
    if (n.includes("FESTIVO")) return "festivo";
    if (n.includes("LUN") || n.includes("VEN")) return "lunven";
    return null;
  };

  T.nomeTipo = function (tipo) {
    return tipo === "sabato" ? "Sabato" : tipo === "festivo" ? "Festivo" : "Lun-Ven";
  };

  T.rilevaTipo = function (nome, testo) {
    const daNome = T.tipoDaNome(nome);
    if (daNome) return daNome;
    const t = String(testo || "");
    if (/\bFestivo\b/i.test(t) && !/\bInverno\b/i.test(t)) return "festivo";
    return "lunven";
  };

  /* --------------------------------------------------------------- fasce */

  /* Raggruppa numeri consecutivi; uno stacco > 10 apre una nuova fascia. */
  T.intervalli = function (numeri) {
    const ns = Array.from(new Set(numeri || [])).sort((a, b) => a - b);
    if (!ns.length) return [];
    const out = [];
    let start = ns[0];
    let prev = ns[0];
    for (let i = 1; i < ns.length; i++) {
      if (ns[i] - prev > 10) {
        out.push([start, prev]);
        start = ns[i];
      }
      prev = ns[i];
    }
    out.push([start, prev]);
    return out;
  };

  T.slotDaFasce = function (fasce) {
    const out = [];
    (fasce || []).forEach(function (f) {
      for (let n = f[0]; n <= f[1]; n++) out.push(n);
    });
    return out;
  };

  T.gapDisponibili = function (slots, disponibili) {
    const set = new Set(disponibili || []);
    const idx = [];
    slots.forEach((n, i) => {
      if (set.has(n)) idx.push(i);
    });
    if (!idx.length) return [];
    const L = slots.length;
    return idx.map((p, k) => {
      const q = idx[(k + 1) % idx.length];
      return ((q - p - 1) + L) % L;
    });
  };

  /* Massimo numero di turni normali ottenibile fra due disponibili. */
  T.targetGap = function (nTurni, nDisponibili) {
    if (!nDisponibili) return 0;
    return Math.max(0, Math.min(T.DISP_MIN, Math.floor(nTurni / nDisponibili)));
  };

  T.targetGapDeposito = function (dep) {
    return T.targetGap((dep.turni || []).length, (dep.disponibili || []).length);
  };

  /* ------------------------------------------------------------ costruzione */

  function cartellino(v) {
    if (!v) return null;
    return {
      ore: v.ore == null ? null : v.ore,
      tratti: T.coppie(v.minuti || []).map((p) => [T.hm(p[0]), T.hm(p[1])]),
    };
  }

  T.componiDati = function (opzioni) {
    const o = opzioni || {};
    const soglie = Object.assign({}, T.SOGLIE_PREDEFINITE, o.soglie || {});
    const set = {
      lunven: T.unisciCartellini(o.lunven || []),
      sabato: T.unisciCartellini(o.sabato || []),
      festivo: T.unisciCartellini(o.festivo || []),
    };
    const mappe = {
      lunven: new Map(set.lunven.map((t) => [t.numero, t])),
      sabato: new Map(set.sabato.map((t) => [t.numero, t])),
      festivo: new Map(set.festivo.map((t) => [t.numero, t])),
    };
    const numeri = Array.from(
      new Set(
        [].concat(
          set.lunven.map((t) => t.numero),
          set.sabato.map((t) => t.numero),
          set.festivo.map((t) => t.numero)
        )
      )
    ).sort((a, b) => a - b);

    const turni = [];
    const jolly = [];
    const avvisi = [];

    numeri.forEach(function (n) {
      const lv = mappe.lunven.get(n) || null;
      const sb = mappe.sabato.get(n) || null;
      const fs = mappe.festivo.get(n) || null;
      const gruppo = Math.floor(n / 100);
      const dep = T.DEPOSITO_PER_GRUPPO[gruppo];
      const soglieVoce = dep && o.sogliePerDep && o.sogliePerDep[dep.codice]
        ? Object.assign({}, soglie, o.sogliePerDep[dep.codice])
        : soglie;

      let base = null;
      let origine = null;
      let cat = null;
      const fonti = [
        [lv, "lunven"],
        [sb, "sabato"],
        [fs, "festivo"],
      ];
      for (let i = 0; i < fonti.length; i++) {
        const fonte = fonti[i][0];
        if (!fonte) continue;
        const c = T.classifica(fonte.ore, fonte.minuti, soglieVoce);
        if (c) {
          base = fonte;
          origine = fonti[i][1];
          cat = c;
          break;
        }
      }
      if (!base) {
        avvisi.push("D" + String(n).padStart(3, "0") + ": nessun orario leggibile, turno ignorato");
        return;
      }

      const voce = {
        n: n,
        cat: cat,
        origine: origine,
        ore: base.ore == null ? null : base.ore,
        monta: base.monta || "",
        lv: cartellino(lv),
        sb: cartellino(sb),
        fs: cartellino(fs),
        nota: "",
      };

      const fuoriTurnazione = gruppo === 9 || !dep;

      if (cat === T.CAT.JOLLY || fuoriTurnazione) {
        voce.motivo = cat === T.CAT.JOLLY ? "turno breve (jolly)" : "numero fuori dalle fasce dei depositi";
        jolly.push(voce);
        return;
      }

      if (origine !== "lunven") {
        voce.nota = "nessun cartellino lun-ven: categoria presa dal " + T.nomeTipo(origine).toLowerCase();
      }

      if (voce.monta && dep.sigle && dep.sigle.length) {
        const m = voce.monta.toUpperCase();
        const ok = dep.sigle.some((s) => m.includes(s));
        if (!ok) {
          avvisi.push(
            "D" + String(n).padStart(3, "0") + ': monta "' + voce.monta + '" non sembra ' + dep.nome
          );
        }
      }

      voce.deposito = dep.codice;
      turni.push(voce);
    });

    const depositi = [];
    DEPOSITI.forEach(function (dep) {
      const propri = turni.filter((t) => t.deposito === dep.codice);
      if (!propri.length) return;
      const ns = propri.map((t) => t.n).sort((a, b) => a - b);
      const fasce = T.intervalli(ns);
      const insiemeTurni = new Set(ns);
      const insiemeJolly = new Set(jolly.map((t) => t.n));
      const disponibili = [];
      fasce.forEach(function (f) {
        for (let n = f[0]; n <= f[1]; n++) {
          if (!insiemeTurni.has(n)) disponibili.push(n);
        }
      });
      const jollyInterni = disponibili.filter((n) => insiemeJolly.has(n));
      if (jollyInterni.length) {
        avvisi.push(
          dep.nome + ": i numeri " + jollyInterni.map((n) => "D" + String(n).padStart(3, "0")).join(", ") +
          " sono jolly dentro la fascia: restano posizioni disponibile"
        );
      }
      depositi.push({
        codice: dep.codice,
        nome: dep.nome,
        fasce: fasce,
        disponibili: disponibili,
        turni: propri.sort((a, b) => a.n - b.n),
      });
    });

    const conteggi = {};
    depositi.forEach((d) => {
      const c = {};
      d.turni.forEach((t) => (c[t.cat] = (c[t.cat] || 0) + 1));
      conteggi[d.codice] = c;
    });

    return {
      versione: T.VERSIONE_DATI,
      motore: T.VERSIONE_MOTORE,
      generato: o.generato || new Date().toISOString(),
      soglie: soglie,
      sorgenti: o.sorgenti || [],
      depositi: depositi,
      jolly: jolly.sort((a, b) => a.n - b.n),
      conteggi: conteggi,
      avvisi: avvisi,
    };
  };

  /* Ricalcola le categorie (e l'appartenenza ai jolly) partendo dai cartellini
     gia' estratti. Serve quando si cambiano le soglie di un deposito: i dati
     conservano lv/sb/fs, quindi non e' necessario rileggere i PDF. */
  T.riclassificaDati = function (dati, sogliePerDep) {
    if (!dati || !dati.depositi) throw new Error("File dati non riconosciuto");
    const gruppi = { lunven: [], sabato: [], festivo: [] };
    const voci = [];
    (dati.depositi || []).forEach(function (d) {
      (d.turni || []).forEach((t) => voci.push(t));
    });
    (dati.jolly || []).forEach((t) => voci.push(t));

    function aggiungi(voce, tipo, cartellino) {
      if (!cartellino) return;
      const minuti = [];
      (cartellino.tratti || []).forEach(function (tr) {
        if (!tr || tr.length < 2) return;
        const a = typeof tr[0] === "number" ? tr[0] : T.aMinuti(tr[0]);
        const b = typeof tr[1] === "number" ? tr[1] : T.aMinuti(tr[1]);
        if (a == null || b == null) return;
        minuti.push(a, b);
      });
      gruppi[tipo].push({
        numero: voce.n,
        ore: cartellino.ore == null ? null : cartellino.ore,
        minuti: minuti,
        monta: voce.monta || "",
        data: null,
        pagina: null,
      });
    }

    voci.forEach(function (voce) {
      aggiungi(voce, "lunven", voce.lv);
      aggiungi(voce, "sabato", voce.sb);
      aggiungi(voce, "festivo", voce.fs);
    });

    return T.componiDati({
      lunven: gruppi.lunven,
      sabato: gruppi.sabato,
      festivo: gruppi.festivo,
      soglie: dati.soglie || T.SOGLIE_PREDEFINITE,
      sogliePerDep: sogliePerDep || {},
      generato: dati.generato,
      sorgenti: dati.sorgenti || [],
    });
  };

  /* Accetta anche il vecchio formato (soglie.ore_ridotto, cat gia' calcolata). */
  T.normalizzaDati = function (dati) {
    if (!dati || !dati.depositi) throw new Error("File dati non riconosciuto");
    if (dati.versione === T.VERSIONE_DATI) return dati;

    const vecchie = dati.soglie || {};
    const soglie = {
      oreJolly: vecchie.oreJolly != null ? vecchie.oreJolly : vecchie.ore_ridotto != null ? vecchie.ore_ridotto : 4,
      primoInizio: vecchie.primoInizio != null ? vecchie.primoInizio : vecchie.fine_primo != null ? vecchie.fine_primo : 660,
      primoFine: vecchie.primoFine != null ? vecchie.primoFine : vecchie.max_primo != null ? vecchie.max_primo : 840,
      terzoInizio: vecchie.terzoInizio != null ? vecchie.terzoInizio : vecchie.inizio_terzo != null ? vecchie.inizio_terzo : 840,
      terzoFine: vecchie.terzoFine != null ? vecchie.terzoFine : vecchie.fine_terzo != null ? vecchie.fine_terzo : 1260,
    };

    const depositi = dati.depositi.map((d) => ({
      codice: d.codice,
      nome: d.nome,
      fasce: d.fasce || [],
      disponibili: d.disponibili || [],
      turni: (d.turni || []).map((t) => ({
        n: t.n,
        cat: t.cat,
        origine: t.origine || "lunven",
        ore: t.ore == null ? null : t.ore,
        monta: t.monta || "",
        lv: t.lv || null,
        sb: t.sb || null,
        fs: t.fs || null,
        nota: t.nota || "",
        deposito: d.codice,
      })),
    }));
    return {
      versione: T.VERSIONE_DATI,
      motore: T.VERSIONE_MOTORE,
      generato: dati.generato || new Date().toISOString(),
      soglie: soglie,
      sorgenti: dati.sorgenti || [],
      depositi: depositi,
      jolly: (dati.jolly || []).map((t) => ({
        n: t.n,
        cat: T.CAT.JOLLY,
        origine: t.origine || "lunven",
        ore: t.ore == null ? null : t.ore,
        monta: t.monta || "",
        lv: t.lv || null,
        sb: t.sb || null,
        fs: t.fs || null,
        motivo: "turno breve (jolly)",
      })),
      avvisi: dati.avvisi || [],
    };
  };

  /* ------------------------------------------------------------- pause */

  T.inizioServizio = function (voce, giorno) {
    const tr = T.trattiMin(voce);
    return tr ? giorno * 1440 + tr[0][0] : null;
  };

  T.fineServizio = function (voce, giorno) {
    const tr = T.trattiMin(voce);
    return tr ? giorno * 1440 + tr[tr.length - 1][1] : null;
  };

  T.ultimaFine = function (turno, conFestivo) {
    const v = [T.fineServizio(turno.lv, 4), T.fineServizio(turno.sb, 5)];
    if (conFestivo) v.push(T.fineServizio(turno.fs, 6));
    const n = v.filter((x) => x != null);
    return n.length ? Math.max.apply(null, n) : null;
  };

  T.primaPartenza = function (turno) {
    const v = [
      T.inizioServizio(turno.lv, 7),
      T.inizioServizio(turno.sb, 12),
      T.inizioServizio(turno.fs, 13),
    ].filter((x) => x != null);
    return v.length ? Math.min.apply(null, v) : null;
  };

  const cachePause = new Map();

  /* Pausa minima garantita fra la settimana del turno A e quella del turno B.
     Infinity quando uno dei due e' un disponibile (orario non noto). */
  T.pausaMin = function (a, b) {
    if (!a || !b) return Infinity;
    const chiave = a.n + ">" + b.n;
    if (cachePause.has(chiave)) return cachePause.get(chiave);
    let min = Infinity;
    const partenza = T.primaPartenza(b);
    if (partenza != null) {
      const fineSenzaFestivo = T.ultimaFine(a, false);
      const fineConFestivo = T.ultimaFine(a, true);
      if (fineSenzaFestivo != null) min = Math.min(min, partenza - fineSenzaFestivo);
      if (fineConFestivo != null) min = Math.min(min, partenza - fineConFestivo);
    }
    cachePause.set(chiave, min);
    return min;
  };

  T.svuotaCachePause = function () {
    cachePause.clear();
  };

  /* Pause interne allo stesso turno: venerdi' -> sabato, sabato -> festivo. */
  T.pauseInterne = function (turno) {
    const out = [];
    const fineLv = T.fineServizio(turno.lv, 4);
    const inizioSb = T.inizioServizio(turno.sb, 5);
    const fineSb = T.fineServizio(turno.sb, 5);
    const inizioFs = T.inizioServizio(turno.fs, 6);
    if (fineLv != null && inizioSb != null && inizioSb - fineLv < 720) {
      const tr = T.trattiMin(turno.lv);
      out.push({
        etichetta: "lun-ven → sabato",
        minuti: inizioSb - fineLv,
        prima: "lun-ven fino alle " + (tr ? T.hm(tr[tr.length - 1][1]) : ""),
        dopo: "sabato dalle " + T.hm(inizioSb % 1440),
      });
    }
    if (fineSb != null && inizioFs != null && inizioFs - fineSb < 720) {
      const tr = T.trattiMin(turno.sb);
      out.push({
        etichetta: "sabato → festivo",
        minuti: inizioFs - fineSb,
        prima: "sabato fino alle " + (tr ? T.hm(tr[tr.length - 1][1]) : ""),
        dopo: "festivo dalle " + T.hm(inizioFs % 1440),
      });
    }
    return out;
  };

  /* -------------------------------------------------------- costi / metriche */

  T.costoCategoria = function (a, b, pesi) {
    const p = Object.assign({}, T.PESI_PREDEFINITI, pesi || {});
    if (a === b) {
      if (a === T.CAT.DISP || a === T.CAT.JOLLY) return p.dispDisp;
      return p.ripetizione;
    }
    const fa = T.FASCIA[a];
    const fb = T.FASCIA[b];
    if (fa === "N" || fb === "N") return p.neutro;
    if (a === T.CAT.SPEZZATO && b === T.CAT.PRIMO) return p.dopoSpezzato;
    if (fa === "A" && fb === "A") return p.stessaFascia;
    if (fa === "A" && fb === "B") return 0;
    if (fa === "B" && fb === "C") return 0;
    if (fa === "C" && fb === "A") return p.ciclo;
    if (fa === "B" && fb === "A") return p.inversione;
    if (fa === "C" && fb === "B") return p.inversione;
    if (fa === "A" && fb === "C") return p.salto;
    return 0;
  };

  T.statistiche = function (dep, seq, opzioni) {
    const o = opzioni || {};
    const pesi = Object.assign({}, T.PESI_PREDEFINITI, o.pesi || {});
    const target = o.target != null ? o.target : T.targetGapDeposito(dep);
    const byNum = o.byNum || dep._byNum || new Map((dep.turni || []).map((t) => [t.n, t]));
    const L = seq.length;
    const risultato = {
      ripetizioni: 0,
      stessaFascia: 0,
      dopoSpezzato: 0,
      inversioni: 0,
      salti: 0,
      cicli: 0,
      pauseKO: 0,
      pauseDer: 0,
      pausaMinima: null,
      maxSerie: 0,
      minGapDisp: null,
      dispSottoTarget: 0,
      punteggio: 0,
      categoriaPunteggio: 0,
      dispPunteggio: 0,
      conteggi: {},
      serie: [],
      pauseKOdettaglio: [],
    };
    if (!L) return risultato;

    let cat = 0;
    for (let i = 0; i < L; i++) {
      const cur = seq[i];
      const prec = seq[(i - 1 + L) % L];
      const c = cur.cat;
      const p = prec.cat;
      risultato.conteggi[c] = (risultato.conteggi[c] || 0) + 1;
      const costa = T.costoCategoria(p, c, pesi);
      cat += costa;

      if (c === p) {
        if (T.FASCIA[c] !== "N" || c === T.CAT.DISP) {
          risultato.ripetizioni++;
          risultato.serie.push(i);
        }
      } else if (p === T.CAT.SPEZZATO && c === T.CAT.PRIMO) {
        risultato.dopoSpezzato++;
      } else if (T.FASCIA[p] === "A" && T.FASCIA[c] === "A") {
        risultato.stessaFascia++;
      } else if (T.FASCIA[p] === "B" && T.FASCIA[c] === "A") {
        risultato.inversioni++;
      } else if (T.FASCIA[p] === "C" && T.FASCIA[c] === "B") {
        risultato.inversioni++;
      } else if (T.FASCIA[p] === "A" && T.FASCIA[c] === "C") {
        risultato.salti++;
      } else if (T.FASCIA[p] === "C" && T.FASCIA[c] === "A") {
        risultato.cicli++;
      }

      if (cur.n != null && prec.n != null) {
        const t1 = byNum.get(prec.n);
        const t2 = byNum.get(cur.n);
        const pmin = T.pausaMin(t1, t2);
        if (isFinite(pmin) && (risultato.pausaMinima == null || pmin < risultato.pausaMinima)) {
          risultato.pausaMinima = pmin;
        }
        if (pmin < T.PAUSA_DEROGA) {
          risultato.pauseKO++;
          risultato.pauseKOdettaglio.push({ posizione: i, da: prec.n, a: cur.n, minuti: pmin });
        } else if (pmin < T.PAUSA_MIN) {
          risultato.pauseDer++;
        }
      }
    }

    let run = 1;
    for (let i = 1; i <= L; i++) {
      const c = seq[i % L].cat;
      const p = seq[(i - 1) % L].cat;
      if (c === p && T.FASCIA[c] !== "N") run++;
      else {
        risultato.maxSerie = Math.max(risultato.maxSerie, run);
        run = 1;
      }
    }
    risultato.maxSerie = Math.max(risultato.maxSerie, run);

    const idxDisp = [];
    seq.forEach((v, i) => {
      if (v.cat === T.CAT.DISP) idxDisp.push(i);
    });
    if (idxDisp.length) {
      let min = Infinity;
      for (let k = 0; k < idxDisp.length; k++) {
        const p = idxDisp[k];
        const q = idxDisp[(k + 1) % idxDisp.length];
        const gap = ((q - p - 1) + L) % L;
        if (gap < min) min = gap;
        if (gap < target) {
          risultato.dispSottoTarget++;
          risultato.dispPunteggio += (target - gap) * pesi.disponibiliVicini;
        }
      }
      risultato.minGapDisp = isFinite(min) ? min : null;
    }

    risultato.categoriaPunteggio = cat;
    risultato.punteggio = cat + risultato.dispPunteggio;
    return risultato;
  };

  T.seqOriginale = function (dep, catDi) {
    const slots = T.slotDaFasce(dep.fasce);
    const disp = new Set(dep.disponibili || []);
    const by = new Map((dep.turni || []).map((t) => [t.n, t]));
    return slots.map(function (n) {
      if (disp.has(n) || !by.has(n)) return { n: null, cat: T.CAT.DISP };
      const t = by.get(n);
      return { n: n, cat: catDi ? catDi(t) : t.cat };
    });
  };

  T.indiceDeposito = function (dati, codice) {
    return (dati.depositi || []).findIndex((d) => d.codice === codice);
  };

  T.etichettaDisp = function (nTurni, nDisp, target) {
    if (!nDisp) return "";
    if (target >= T.DISP_MIN) return "";
    return (
      "Con " + nDisp + " settimane disponibile e " + nTurni +
      " turni normali il massimo possibile è " + target +
      " turni normali fra un disponibile e l'altro (la regola dei 4 non è raggiungibile)."
    );
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
