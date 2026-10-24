/* ==========================================================================
   Gestione Turni ACTV - stato, azioni e persistenza
   ========================================================================== */
(function (root) {
  "use strict";

  const T = (root.Turni = root.Turni || {});
  const App = (T.App = {});
  const CHIAVE = "gestione-turni-actv-v2";
  const VERSIONE_SALVATAGGIO = 2;

  const stato = (App.stato = {
    dati: null,
    depIdx: 0,
    proposte: {},
    override: {},
    sogliePerDep: {},
    pesi: Object.assign({}, T.PESI_PREDEFINITI),
    modoDisp: "auto",
    sim: { partenza: 1, settimane: 26 },
    files: [],
    sorgente: null,
    calcoloTutti: false,
    lettura: null,
    avvisiCaricamento: [],
  });

  let contatoreFile = 0;

  /* ------------------------------------------------------------- getters */

  App.dep = function () {
    if (!stato.dati || !stato.dati.depositi.length) return null;
    return stato.dati.depositi[stato.depIdx] || stato.dati.depositi[0];
  };

  App.depDaCodice = function (codice) {
    return (stato.dati ? stato.dati.depositi : []).find((d) => d.codice === codice) || null;
  };

  App.byNum = function (dep) {
    if (!dep) return new Map();
    if (!dep._mappaTurni) dep._mappaTurni = new Map(dep.turni.map((t) => [t.n, t]));
    return dep._mappaTurni;
  };

  App.soglie = function (dep) {
    if (!dep) return Object.assign({}, T.SOGLIE_PREDEFINITE);
    return stato.sogliePerDep[dep.codice] || (stato.dati && stato.dati.soglie) || T.SOGLIE_PREDEFINITE;
  };

  App.catDi = function (dep, turno) {
    if (!dep || !turno) return T.CAT.DISP;
    const o = stato.override[dep.codice];
    return (o && o[turno.n]) || turno.cat;
  };

  App.target = function (dep) {
    return dep ? T.targetGapDeposito(dep) : 0;
  };

  App.seqAttuale = function (dep) {
    return T.seqOriginale(dep, (t) => App.catDi(dep, t));
  };

  App.proposta = function (dep) {
    if (!dep) return null;
    const p = stato.proposte[dep.codice];
    if (!p || p.motore !== T.VERSIONE_MOTORE) return null;
    return p;
  };

  App.seqMostrata = function (dep) {
    const p = App.proposta(dep);
    return p ? p.seq : App.seqAttuale(dep);
  };

  App.statistiche = function (dep, seq) {
    return T.statistiche(dep, seq, {
      pesi: stato.pesi,
      target: App.target(dep),
      byNum: App.byNum(dep),
    });
  };

  /* ---------------------------------------------------------------- salva */

  App.salva = function () {
    try {
      const payload = {
        versione: VERSIONE_SALVATAGGIO,
        motore: T.VERSIONE_MOTORE,
        dati: stato.dati,
        proposte: stato.proposte,
        override: stato.override,
        sogliePerDep: stato.sogliePerDep,
        pesi: stato.pesi,
        modoDisp: stato.modoDisp,
        sim: stato.sim,
        depIdx: stato.depIdx,
        sorgente: stato.sorgente,
      };
      localStorage.setItem(CHIAVE, JSON.stringify(payload));
    } catch (e) {
      /* localStorage puo' essere pieno o disabilitato: non bloccare l'app */
    }
  };

  function carica() {
    let raw;
    try {
      raw = localStorage.getItem(CHIAVE);
    } catch (e) {
      return false;
    }
    if (!raw) return false;
    try {
      const s = JSON.parse(raw);
      if (!s || !s.dati) return false;
      stato.dati = T.normalizzaDati(s.dati);
      stato.proposte = s.proposte || {};
      stato.override = s.override || {};
      stato.sogliePerDep = s.sogliePerDep || {};
      stato.pesi = Object.assign({}, T.PESI_PREDEFINITI, s.pesi || {});
      stato.modoDisp = s.modoDisp || "auto";
      stato.sim = Object.assign({ partenza: 1, settimane: 26 }, s.sim || {});
      stato.depIdx = s.depIdx || 0;
      stato.sorgente = s.sorgente || { tipo: "salvato", etichetta: "dati salvati" };
      preparaDati({ resetSoglie: false, resetProposte: false, resetOverride: false });
      return true;
    } catch (e) {
      try {
        localStorage.removeItem(CHIAVE);
      } catch (e2) {
        /* ignore */
      }
      return false;
    }
  }

  function firmePerDeposito(dati) {
    const out = {};
    ((dati && dati.depositi) || []).forEach(function (d) {
      out[d.codice] = JSON.stringify([
        d.fasce || [],
        d.disponibili || [],
        (d.turni || []).map((t) => [t.n, t.cat]),
      ]);
    });
    return out;
  }

  function preparaDati(opzioni) {
    const o = opzioni || {};
    if (!stato.dati) return;
    stato.dati = T.normalizzaDati(stato.dati);

    if (o.resetSoglie) stato.sogliePerDep = {};
    if (!stato.sogliePerDep) stato.sogliePerDep = {};
    stato.dati.depositi.forEach(function (d) {
      if (!stato.sogliePerDep[d.codice]) {
        stato.sogliePerDep[d.codice] = T.clona(stato.dati.soglie || T.SOGLIE_PREDEFINITE);
      }
    });

    /* Allinea sempre le categorie alle soglie salvate: cosi' anche i dati
       ripresi dal localStorage o importati rispettano le modifiche fatte. */
    const firmePrima = firmePerDeposito(stato.dati);
    stato.dati = T.riclassificaDati(stato.dati, stato.sogliePerDep);
    const firmeDopo = firmePerDeposito(stato.dati);
    const cambiati = new Set(Object.keys(firmePrima).concat(Object.keys(firmeDopo)));
    Array.from(cambiati).forEach(function (codice) {
      if (firmePrima[codice] === firmeDopo[codice]) cambiati.delete(codice);
    });
    T.svuotaCachePause();

    if (o.resetOverride) stato.override = {};
    if (!stato.override) stato.override = {};

    if (o.resetProposte) {
      stato.proposte = {};
    } else {
      const valide = {};
      Object.keys(stato.proposte || {}).forEach(function (codice) {
        if (cambiati.has(codice)) return;
        const p = stato.proposte[codice];
        const dep = App.depDaCodice(codice);
        if (!dep || !p || p.motore !== T.VERSIONE_MOTORE) return;
        if (!Array.isArray(p.seq) || p.seq.length !== T.slotDaFasce(dep.fasce).length) return;
        valide[codice] = p;
      });
      stato.proposte = valide;
    }

    if (!stato.dati.depositi.length) {
      stato.depIdx = 0;
    } else if (stato.depIdx >= stato.dati.depositi.length) {
      stato.depIdx = 0;
    }
    stato.dati.depositi.forEach((d) => delete d._mappaTurni);
  }

  App.applicaDati = function (dati, sorgente, opzioni) {
    const o = opzioni || {};
    stato.dati = T.normalizzaDati(dati);
    stato.sorgente = sorgente || { tipo: "importato", etichetta: "dati importati" };
    stato.depIdx = 0;
    preparaDati({
      resetSoglie: !!o.resetSoglie,
      resetProposte: true,
      resetOverride: o.resetOverride !== false,
    });
    App.salva();
  };

  /* ------------------------------------------------------------ deposito */

  App.scegliDep = function (codice) {
    const idx = (stato.dati ? stato.dati.depositi : []).findIndex((d) => d.codice === codice);
    if (idx < 0) return;
    stato.depIdx = idx;
    App.salva();
    if (T.UI) T.UI.render();
  };

  App.invalidaProposte = function (codice) {
    if (codice) delete stato.proposte[codice];
    else stato.proposte = {};
  };

  /* --------------------------------------------------------------- calcolo */

  App.calcola = function (codice, opzioni) {
    const o = opzioni || {};
    const dep = App.depDaCodice(codice);
    if (!dep) return null;
    const catDi = (t) => App.catDi(dep, t);
    const seed = T.hashStringa(
      dep.codice + "|" + T.firmaDeposito(dep) + "|" + JSON.stringify(stato.pesi) +
      "|" + stato.modoDisp + "|" + JSON.stringify(stato.override[dep.codice] || {})
    );
    const risultato = T.ottimizzaDeposito(dep, {
      pesi: stato.pesi,
      modoDisp: stato.modoDisp,
      catDi: catDi,
      seed: seed,
    });
    stato.proposte[dep.codice] = {
      seq: risultato.seq,
      metrica: risultato.metrica,
      tempo: risultato.tempo,
      giri: risultato.giri,
      seed: risultato.seed,
      motore: T.VERSIONE_MOTORE,
      quando: Date.now(),
    };
    App.salva();
    if (!o.silenzioso && T.UI) T.UI.render();
    return risultato;
  };

  App.calcolaTutti = async function () {
    if (!stato.dati || stato.calcoloTutti) return;
    stato.calcoloTutti = true;
    const depositi = stato.dati.depositi.slice();
    let minTempo = 0;
    try {
      for (let i = 0; i < depositi.length; i++) {
        const d = depositi[i];
        if (T.UI) T.UI.setProgressoCalcolo("Calcolo " + d.nome + " · " + (i + 1) + "/" + depositi.length + "…");
        await new Promise((r) => setTimeout(r, 15));
        const r = App.calcola(d.codice, { silenzioso: true });
        if (r) minTempo += r.tempo;
      }
      App.salva();
      if (T.UI) {
        T.UI.setProgressoCalcolo("");
        T.UI.render();
        T.UI.toast(
          "Proposta pronta per " + depositi.length + " depositi (" + Math.round(minTempo) + " ms).",
          "ok"
        );
      }
    } catch (e) {
      if (T.UI) T.UI.toast("Errore durante il calcolo: " + e.message, "errore");
    } finally {
      stato.calcoloTutti = false;
      if (T.UI) T.UI.setProgressoCalcolo("");
    }
  };

  App.calcolaQuesto = async function () {
    const dep = App.dep();
    if (!dep) return;
    if (T.UI) T.UI.setProgressoCalcolo("Calcolo " + dep.nome + "…");
    await new Promise((r) => setTimeout(r, 15));
    try {
      const r = App.calcola(dep.codice);
      if (T.UI) {
        T.UI.setProgressoCalcolo("");
        T.UI.toast("Proposta calcolata per " + dep.nome + " (" + Math.round(r.tempo) + " ms).", "ok");
      }
    } catch (e) {
      if (T.UI) T.UI.toast("Errore durante il calcolo: " + e.message, "errore");
    }
  };

  App.ripristina = function () {
    const dep = App.dep();
    if (!dep) return;
    delete stato.proposte[dep.codice];
    App.salva();
    if (T.UI) T.UI.render();
  };

  /* ------------------------------------------------------ modifiche manuali */

  App.cambiaCategoria = function (n) {
    const dep = App.dep();
    if (!dep) return;
    const t = App.byNum(dep).get(n);
    if (!t) return;
    const attuale = App.catDi(dep, t);
    const i = T.CAT_ORDINE.indexOf(attuale);
    const nuova = i < 0 ? T.CAT_ORDINE[0] : T.CAT_ORDINE[(i + 1) % T.CAT_ORDINE.length];
    stato.override[dep.codice] = stato.override[dep.codice] || {};
    stato.override[dep.codice][n] = nuova;
    App.invalidaProposte(dep.codice);
    App.salva();
    if (T.UI) T.UI.render();
  };

  App.azzeraOverride = function () {
    const dep = App.dep();
    if (!dep) return;
    delete stato.override[dep.codice];
    App.invalidaProposte(dep.codice);
    App.salva();
    if (T.UI) T.UI.render();
  };

  /* ------------------------------------------------------------- regole */

  App.impostaSoglie = function (soglie, tutti) {
    const dep = App.dep();
    if (!dep) return;
    const pulite = {
      oreJolly: Number(soglie.oreJolly),
      primoInizio: Number(soglie.primoInizio),
      primoFine: Number(soglie.primoFine),
      terzoInizio: Number(soglie.terzoInizio),
      terzoFine: Number(soglie.terzoFine),
    };
    if (tutti) {
      const codici = new Set(Object.keys(stato.sogliePerDep || {}));
      stato.dati.depositi.forEach((d) => codici.add(d.codice));
      T.DEPOSITI.forEach((d) => codici.add(d.codice));
      codici.forEach((codice) => (stato.sogliePerDep[codice] = Object.assign({}, pulite)));
      App.invalidaProposte();
    } else {
      stato.sogliePerDep[dep.codice] = pulite;
      App.invalidaProposte(dep.codice);
    }
    preparaDati({ resetSoglie: false, resetProposte: false, resetOverride: false });
    App.salva();
    if (T.UI) T.UI.render();
  };

  App.riclassifica = function (tutti) {
    App.impostaSoglie(T.UI.leggiSoglie(), tutti);
  };

  App.resetSoglie = function (tutti) {
    App.impostaSoglie(T.clona(T.SOGLIE_PREDEFINITE), tutti);
  };

  App.impostaPesi = function (pesi) {
    stato.pesi = Object.assign({}, T.PESI_PREDEFINITI, pesi);
    App.invalidaProposte();
    App.salva();
    if (T.UI) T.UI.render();
  };

  App.resetPesi = function () {
    stato.pesi = Object.assign({}, T.PESI_PREDEFINITI);
    App.invalidaProposte();
    App.salva();
    if (T.UI) T.UI.render();
  };

  App.impostaModoDisp = function (modo) {
    stato.modoDisp = modo;
    App.invalidaProposte();
    App.salva();
    if (T.UI) T.UI.render();
  };

  /* ------------------------------------------------------------- upload */

  function idFile() {
    contatoreFile++;
    return "f" + Date.now().toString(36) + "_" + contatoreFile;
  }

  App.apriPdf = function () {
    const input = document.getElementById("filePdf");
    if (input) input.click();
  };

  App.aggiungiFile = async function (listaFile) {
    const files = Array.from(listaFile || []).filter(function (f) {
      return /\.pdf$/i.test(f.name) || f.type === "application/pdf";
    });
    if (!files.length) {
      if (T.UI) T.UI.toast("Nessun PDF riconosciuto tra i file selezionati.", "errore");
      return;
    }
    files.forEach(function (file) {
      stato.files.push({
        id: idFile(),
        file: file,
        nome: file.name,
        dimensione: file.size,
        tipo: T.tipoDaNome(file.name) || "lunven",
        tipoAuto: !!T.tipoDaNome(file.name),
        pagine: null,
        turni: null,
        errore: null,
        letto: false,
      });
    });
    if (T.UI) T.UI.renderUpload();
    await leggiFiles();
  };

  async function leggiFiles() {
    const daLeggere = stato.files.filter((f) => !f.letto && !f.errore);
    if (!daLeggere.length) {
      ricostruisci();
      return;
    }
    stato.lettura = { fatti: 0, totale: daLeggere.length };
    for (let i = 0; i < daLeggere.length; i++) {
      const f = daLeggere[i];
      if (T.UI) {
        T.UI.setProgressoUpload(
          "Lettura " + f.nome + " · " + (i + 1) + "/" + daLeggere.length + "…"
        );
      }
      try {
        const esito = await T.Pdf.estrai(f.file, function (p, tot) {
          if (T.UI) T.UI.setProgressoUpload("Lettura " + f.nome + " · pagina " + p + "/" + tot + "…");
        });
        f.pagine = esito.pagine;
        f.turni = esito.turni;
        f.letto = true;
        f.errore = null;
        if (!esito.turni.length) {
          f.errore = "Nessun cartellino riconosciuto nel PDF.";
        }
      } catch (e) {
        f.errore = e && e.message ? e.message : "Errore di lettura del PDF.";
        f.letto = true;
      }
      if (T.UI) T.UI.renderUpload();
    }
    stato.lettura = null;
    if (T.UI) T.UI.setProgressoUpload("");
    ricostruisci();
  }

  App.ricalcolaPdf = async function () {
    if (!stato.files.length) {
      if (T.UI) T.UI.toast("Non ci sono PDF caricati in questa sessione.", "errore");
      return;
    }
    stato.files.forEach(function (f) {
      f.letto = false;
      f.turni = null;
      f.pagine = null;
      f.errore = null;
    });
    if (T.UI) T.UI.renderUpload();
    await leggiFiles();
  };

  App.rimuoviFile = function (id) {
    const i = stato.files.findIndex((f) => f.id === id);
    if (i < 0) return;
    stato.files.splice(i, 1);
    if (T.UI) T.UI.renderUpload();
    if (stato.files.some((f) => f.letto && !f.errore)) ricostruisci();
    else if (T.UI) T.UI.render();
  };

  App.cambiaTipoFile = function (id, tipo) {
    const f = stato.files.find((x) => x.id === id);
    if (!f) return;
    f.tipo = tipo;
    f.tipoAuto = false;
    if (f.letto && !f.errore) ricostruisci();
  };

  function ricostruisci() {
    const pronti = stato.files.filter((f) => f.letto && !f.errore && f.turni && f.turni.length);
    if (!pronti.length) {
      stato.avvisiCaricamento = ["Nessun cartellino leggibile nei PDF caricati."];
      if (T.UI) T.UI.render();
      return;
    }

    const gruppi = { lunven: [], sabato: [], festivo: [] };
    pronti.forEach(function (f) {
      (gruppi[f.tipo] || gruppi.lunven).push.apply(gruppi[f.tipo] || gruppi.lunven, f.turni);
    });

    const mancanti = [];
    ["lunven", "sabato", "festivo"].forEach(function (tipo) {
      const quanti = pronti.filter((f) => f.tipo === tipo).length;
      if (!quanti) mancanti.push(T.nomeTipo(tipo));
    });

    const dati = T.componiDati({
      lunven: gruppi.lunven,
      sabato: gruppi.sabato,
      festivo: gruppi.festivo,
      soglie: (stato.dati && stato.dati.soglie) || T.SOGLIE_PREDEFINITE,
      generato: new Date().toISOString(),
      sorgenti: pronti.map((f) => f.nome + " [" + T.nomeTipo(f.tipo) + "]"),
    });

    if (mancanti.length) {
      dati.avvisi.push(
        "Nessun PDF " + mancanti.join(" / ") +
        ": le categorie e le pause di quei giorni non sono disponibili per i turni che non hanno il cartellino lun-ven."
      );
    }
    const senzaTurni = stato.files.filter((f) => f.errore);
    senzaTurni.forEach((f) => dati.avvisi.push(f.nome + ": " + f.errore));

    stato.avvisiCaricamento = dati.avvisi.slice();
    App.applicaDati(
      dati,
      {
        tipo: "pdf",
        etichetta: "PDF caricati",
        dettaglio: pronti.length + " file · " + dati.sorgenti.length + " sorgenti",
        quando: new Date().toISOString(),
      },
      { resetOverride: true }
    );
    if (T.UI) {
      T.UI.toast(
        "Dati pronti: " + dati.depositi.length + " depositi, " +
        dati.depositi.reduce((s, d) => s + d.turni.length, 0) + " turni.",
        "ok"
      );
      T.UI.render();
    }
  }

  /* ------------------------------------------------------------- esempio */

  App.caricaEsempio = function () {
    if (!root.TURNI_ESEMPIO) {
      if (T.UI) T.UI.toast("Dati di esempio non disponibili.", "errore");
      return;
    }
    if (stato.sorgente && stato.sorgente.tipo !== "esempio") {
      const ok = root.confirm("Sostituire i dati attuali con i dati di esempio? Le proposte calcolate andranno perse.");
      if (!ok) return;
    }
    const dati = T.normalizzaDati(root.TURNI_ESEMPIO);
    App.applicaDati(
      dati,
      {
        tipo: "esempio",
        etichetta: "dati di esempio",
        dettaglio: (dati.sorgenti || []).join(", "),
        quando: dati.generato,
      },
      { resetOverride: true, resetSoglie: true }
    );
    if (T.UI) {
      T.UI.render();
      T.UI.toast("Caricati i dati di esempio: puoi provare subito il calcolo.", "ok");
    }
  };

  /* --------------------------------------------------------------- export */

  function scarica(nome, contenuto, mime) {
    const blob = new Blob([contenuto], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  App.scarica = scarica;

  App.esportaJSON = function () {
    if (!stato.dati) {
      if (T.UI) T.UI.toast("Non ci sono dati da esportare.", "errore");
      return;
    }
    const payload = {
      applicazione: "gestione-turni-actv",
      versione: VERSIONE_SALVATAGGIO,
      esportato: new Date().toISOString(),
      dati: stato.dati,
      impostazioni: {
        sogliePerDep: stato.sogliePerDep,
        pesi: stato.pesi,
        modoDisp: stato.modoDisp,
        override: stato.override,
      },
      proposte: stato.proposte,
    };
    const data = new Date().toISOString().slice(0, 10);
    scarica("turni-actv-" + data + ".json", JSON.stringify(payload, null, 1), "application/json;charset=utf-8");
    if (T.UI) T.UI.toast("Dati esportati in JSON.", "ok");
  };

  App.importaJSON = async function (file) {
    if (!file) return;
    try {
      const testo = await file.text();
      const payload = JSON.parse(testo);
      const dati = payload.dati || payload;
      const normalizzati = T.normalizzaDati(dati);
      App.applicaDati(
        normalizzati,
        {
          tipo: "importato",
          etichetta: "file " + file.name,
          dettaglio: normalizzati.sorgenti ? normalizzati.sorgenti.join(", ") : "",
          quando: new Date().toISOString(),
        },
        { resetOverride: true }
      );
      if (payload.impostazioni) {
        if (payload.impostazioni.sogliePerDep) stato.sogliePerDep = payload.impostazioni.sogliePerDep;
        if (payload.impostazioni.pesi) stato.pesi = Object.assign({}, T.PESI_PREDEFINITI, payload.impostazioni.pesi);
        if (payload.impostazioni.modoDisp) stato.modoDisp = payload.impostazioni.modoDisp;
        if (payload.impostazioni.override) stato.override = payload.impostazioni.override;
      }
      if (payload.proposte) {
        Object.keys(payload.proposte).forEach(function (codice) {
          const p = payload.proposte[codice];
          if (p && p.motore === T.VERSIONE_MOTORE) stato.proposte[codice] = p;
        });
      }
      preparaDati({ resetSoglie: false, resetProposte: false, resetOverride: false });
      App.salva();
      if (T.UI) {
        T.UI.render();
        T.UI.toast("Dati importati correttamente.", "ok");
      }
    } catch (e) {
      if (T.UI) T.UI.toast("File JSON non valido: " + e.message, "errore");
    }
  };

  function csvCampo(x) {
    return '"' + String(x == null ? "" : x).replace(/"/g, '""') + '"';
  }

  App.esportaCSV = function () {
    if (!stato.dati) {
      if (T.UI) T.UI.toast("Non ci sono dati da esportare.", "errore");
      return;
    }
    const righe = [[
      "Deposito", "NuovaPosizione", "TurnoAttuale", "Categoria", "PausaVersoIlSeguente",
      "LunVen", "Sabato", "Festivo", "Ore", "Note",
    ]];
    stato.dati.depositi.forEach(function (dep) {
      const seq = App.seqMostrata(dep);
      const slots = T.slotDaFasce(dep.fasce);
      const by = App.byNum(dep);
      seq.forEach(function (v, i) {
        if (v.n == null) {
          righe.push([dep.nome, slots[i], "", "DISPONIBILE", "", "", "", "", "", "turno assegnato dall'ufficio"]);
          return;
        }
        const t = by.get(v.n);
        const next = seq[(i + 1) % seq.length];
        const p = next.n != null ? T.pausaMin(t, by.get(next.n)) : Infinity;
        righe.push([
          dep.nome, slots[i], T.fmtNumero(v.n), v.cat,
          isFinite(p) ? T.oreMin(p) : "",
          T.trattiTesto(t.lv), T.trattiTesto(t.sb), T.trattiTesto(t.fs),
          t.ore == null ? "" : String(t.ore).replace(".", ","),
          appuntiTurno(dep, t, v.cat),
        ]);
      });
    });
    const csv = "\uFEFF" + righe.map((r) => r.map(csvCampo).join(";")).join("\r\n");
    const data = new Date().toISOString().slice(0, 10);
    scarica("proposta-turni-actv-" + data + ".csv", csv, "text/csv;charset=utf-8");
    if (T.UI) T.UI.toast("CSV scaricato.", "ok");
  };

  function appuntiTurno(dep, t, cat) {
    const note = [];
    if (stato.override[dep.codice] && stato.override[dep.codice][t.n]) note.push("categoria corretta a mano");
    if (t.nota) note.push(t.nota);
    if (cat === T.CAT.DISP) note.push("disponibile");
    return note.join(" · ");
  }

  App.appuntiTurno = appuntiTurno;

  /* ------------------------------------------------------- simulazione */

  App.impostaSimulazione = function (partenza, settimane) {
    stato.sim.partenza = Number(partenza) || 1;
    stato.sim.settimane = Number(settimane) || 26;
    App.salva();
  };

  /* ------------------------------------------------------------- avvio */

  App.inizializza = function () {
    const salvato = carica();
    if (!salvato) {
      if (root.TURNI_ESEMPIO) {
        const dati = T.normalizzaDati(root.TURNI_ESEMPIO);
        stato.dati = dati;
        stato.sorgente = {
          tipo: "esempio",
          etichetta: "dati di esempio",
          dettaglio: (dati.sorgenti || []).join(", "),
          quando: dati.generato,
        };
        preparaDati({ resetSoglie: true, resetProposte: true, resetOverride: true });
      }
    }
    if (!stato.dati) {
      stato.sorgente = null;
    }
    T.UI.init(App);
    T.UI.render();
  };

  /* avvio quando il DOM e' pronto (gli script sono in fondo al body) */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", App.inizializza);
  } else {
    App.inizializza();
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
