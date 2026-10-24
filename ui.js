/* ==========================================================================
   Gestione Turni ACTV - interfaccia
   ========================================================================== */
(function (root) {
  "use strict";

  const T = (root.Turni = root.Turni || {});
  const UI = (T.UI = {});
  let App = null;

  const $ = (id) => document.getElementById(id);

  const ORDINE_PESI = [
    "pRipetizione", "pStessaFascia", "pDopoSpezzato", "pInversione",
    "pSalto", "pCiclo", "pDisponibili", "pPausaForte", "pPausaDeroga",
  ];

  const CHIAVI_PESI = {
    pRipetizione: "ripetizione",
    pStessaFascia: "stessaFascia",
    pDopoSpezzato: "dopoSpezzato",
    pInversione: "inversione",
    pSalto: "salto",
    pCiclo: "ciclo",
    pDisponibili: "disponibiliVicini",
    pPausaForte: "pausaForte",
    pPausaDeroga: "pausaDeroga",
  };

  /* ------------------------------------------------------------- utilita' */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function dataIt(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function tag(cat) {
    const colore = T.COLORE_CAT[cat] || "#94a3b8";
    return '<span class="tag ' + esc(cat) + '" style="background:' + colore + '">' + esc(cat) + "</span>";
  }

  function valore(v) {
    return v == null || v === "" ? "—" : v;
  }

  function gapPrimaDisp(seq, i) {
    const L = seq.length;
    let c = 0;
    for (let k = (i - 1 + L) % L; k !== i; k = (k - 1 + L) % L) {
      if (seq[k].cat === T.CAT.DISP) return c;
      c++;
    }
    return c;
  }

  function pauseHtml(p) {
    if (!isFinite(p)) return '<span class="tenue">—</span>';
    const cls = p < T.PAUSA_DEROGA ? "ko" : p < T.PAUSA_MIN ? "der" : "";
    return '<span class="' + cls + '">' + T.oreMin(p) + "</span>";
  }

  function ordinePesoDaId(id) {
    return CHIAVI_PESI[id];
  }

  /* --------------------------------------------------------------- init */

  UI.init = function (app) {
    App = app;

    document.addEventListener("click", function (e) {
      const azione = e.target.closest("[data-azione]");
      if (azione) {
        e.preventDefault();
        eseguiAzione(azione.getAttribute("data-azione"));
        return;
      }

      const dep = e.target.closest("[data-dep]");
      if (dep) {
        e.preventDefault();
        App.scegliDep(dep.getAttribute("data-dep"));
        return;
      }

      const cat = e.target.closest("[data-cat-n]");
      if (cat) {
        e.preventDefault();
        App.cambiaCategoria(Number(cat.getAttribute("data-cat-n")));
        return;
      }

      const rim = e.target.closest("[data-rimuovi-file]");
      if (rim) {
        e.preventDefault();
        App.rimuoviFile(rim.getAttribute("data-rimuovi-file"));
      }
    });

    document.addEventListener("change", function (e) {
      const t = e.target;
      if (t.id === "modoDisp") {
        App.impostaModoDisp(t.value);
        return;
      }
      if (t.hasAttribute && t.hasAttribute("data-tipo-file")) {
        App.cambiaTipoFile(t.getAttribute("data-tipo-file"), t.value);
        return;
      }
      if (t.id === "filtroCat") {
        renderTurni();
        return;
      }
      if (t.id === "simSettimane") {
        aggiornaSimulazione();
        return;
      }
      if (t.id === "simPartenza") {
        aggiornaSimulazione();
        return;
      }
      if (t.id === "filePdf") {
        const files = Array.from(t.files || []);
        t.value = "";
        if (files.length) App.aggiungiFile(files);
        return;
      }
      if (t.id === "fileJson") {
        const f = t.files && t.files[0];
        t.value = "";
        if (f) App.importaJSON(f);
        return;
      }
      if (ORDINE_PESI.indexOf(t.id) >= 0) {
        App.impostaPesi(leggiPesi());
      }
    });

    document.addEventListener("input", function (e) {
      if (e.target.id === "filtroRicerca") renderTurni();
    });

    const drop = $("dropzone");
    if (drop) {
      drop.addEventListener("click", function () {
        App.apriPdf();
      });
      drop.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          App.apriPdf();
        }
      });
      ["dragenter", "dragover"].forEach(function (nome) {
        drop.addEventListener(nome, function (e) {
          e.preventDefault();
          e.stopPropagation();
          drop.classList.add("sopra");
        });
      });
      ["dragleave", "drop"].forEach(function (nome) {
        drop.addEventListener(nome, function (e) {
          e.preventDefault();
          e.stopPropagation();
          drop.classList.remove("sopra");
        });
      });
      drop.addEventListener("drop", function (e) {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) App.aggiungiFile(files);
      });
    }
  };

  function eseguiAzione(azione) {
    switch (azione) {
      case "apri-pdf": App.apriPdf(); break;
      case "carica-esempio": App.caricaEsempio(); break;
      case "esporta-json": App.esportaJSON(); break;
      case "importa-json": {
        const input = $("fileJson");
        if (input) input.click();
        break;
      }
      case "ricalcola-pdf": App.ricalcolaPdf(); break;
      case "calcola": App.calcolaQuesto(); break;
      case "calcola-tutti": App.calcolaTutti(); break;
      case "ripristina": App.ripristina(); break;
      case "esporta-csv": App.esportaCSV(); break;
      case "stampa": root.print(); break;
      case "simula": aggiornaSimulazione(); break;
      case "azzera-override": App.azzeraOverride(); break;
      case "applica-soglie": App.riclassifica(false); break;
      case "applica-soglie-tutti": App.riclassifica(true); break;
      case "reset-soglie": App.resetSoglie(false); break;
      case "reset-soglie-tutti": App.resetSoglie(true); break;
      case "reset-pesi": App.resetPesi(); break;
      default: break;
    }
  }

  /* --------------------------------------------------------------- render */

  UI.render = function () {
    if (!App) return;
    renderTabs();
    renderUpload();
    renderRiepilogo();
    renderProposta();
    if ($("simPartenza")) $("simPartenza").value = App.stato.sim.partenza || 1;
    if ($("simSettimane")) $("simSettimane").value = String(App.stato.sim.settimane || 26);
    renderSimulazione();
    renderTurni();
    renderRegole();
  };

  function renderTabs() {
    const barra = document.querySelector(".barra-depositi");
    const tabs = $("tabs");
    if (!tabs) return;
    const dati = App.stato.dati;
    if (!dati || !dati.depositi.length) {
      if (barra) barra.style.display = "none";
      tabs.innerHTML = "";
      return;
    }
    if (barra) barra.style.display = "";
    tabs.innerHTML = dati.depositi.map(function (d) {
      const attivo = d.codice === (App.dep() || {}).codice;
      return '<button type="button" class="' + (attivo ? "attivo" : "") +
        '" data-dep="' + esc(d.codice) + '">' + esc(d.nome) + " · " + d.turni.length + "</button>";
    }).join("");
  }

  /* --------------------------------------------------------------- upload */

  function renderUpload() {
    const dati = App.stato.dati;
    const banner = $("bannerDati");
    if (banner) {
      let html = "";
      if (!dati) {
        html = '<div class="avviso-box errore">Nessun dato caricato. Aggiungi i PDF dei cartellini per iniziare.</div>';
      } else if (App.stato.sorgente && App.stato.sorgente.tipo === "esempio") {
        html = '<div class="avviso-box">Stai vedendo i <b>dati di esempio</b> del ' +
          dataIt(dati.generato) + '. Carica i PDF della settimana per lavorare sui dati reali. ' +
          '<button class="piccolo secondario" data-azione="apri-pdf">Carica i tuoi PDF</button></div>';
      } else if (App.stato.sorgente && App.stato.sorgente.tipo === "pdf") {
        html = '<div class="avviso-box ok"><b>Dati attivi:</b> ' + esc(App.stato.sorgente.etichetta) +
          ' · aggiornati il ' + dataIt(App.stato.sorgente.quando || dati.generato) +
          '. Puoi aggiungere altri PDF o rielaborare quelli caricati.</div>';
      } else if (App.stato.sorgente) {
        html = '<div class="avviso-box"><b>Dati attivi:</b> ' + esc(App.stato.sorgente.etichetta) +
          ' · ' + dataIt(App.stato.sorgente.quando || dati.generato) + '.</div>';
      }
      banner.innerHTML = html;
    }

    const lista = $("fileLista");
    if (lista) {
      if (!App.stato.files.length) {
        lista.innerHTML = "";
      } else {
        lista.innerHTML = App.stato.files.map(function (f) {
          const stato = f.errore
            ? '<span class="stato-file"><span class="ko">' + esc(f.errore) + "</span></span>"
            : f.letto
            ? '<span class="stato-file"><span class="ok">✓</span> ' + (f.pagine || 0) + " pag. · " +
              ((f.turni && f.turni.length) || 0) + " turni</span>"
            : '<span class="stato-file">in attesa…</span>';
          return '<div class="file-riga">' +
            '<div class="nome" title="' + esc(f.nome) + '">' + esc(f.nome) +
            '<span class="dettagli">' + Math.round(f.dimensione / 1024) + " KB</span></div>" +
            '<select data-tipo-file="' + esc(f.id) + '" aria-label="Tipo di cartellino">' +
            ["lunven", "sabato", "festivo"].map(function (tipo) {
              return '<option value="' + tipo + '"' + (f.tipo === tipo ? " selected" : "") + ">" +
                T.nomeTipo(tipo) + "</option>";
            }).join("") + "</select>" +
            stato +
            '<button type="button" class="rimuovi" data-rimuovi-file="' + esc(f.id) +
            '" title="Rimuovi" aria-label="Rimuovi">×</button></div>';
        }).join("");
      }
    }

    const nota = $("notaUpload");
    if (nota) {
      if (App.stato.files.length) {
        const letti = App.stato.files.filter((f) => f.letto && !f.errore).length;
        nota.textContent = letti + " file letti su " + App.stato.files.length +
          ". Il tipo viene dedotto dal nome: correggilo se necessario.";
      } else if (dati) {
        nota.textContent = "I PDF caricati restano solo in questa sessione; i dati elaborati vengono salvati nel browser.";
      } else {
        nota.textContent = "Consiglio: carica insieme i cartellini Lun-Ven, Sabato e Festivo.";
      }
    }

    const btn = $("btnRicalcolaPdf");
    if (btn) btn.disabled = !App.stato.files.length;

    const avvisi = $("avvisiDati");
    if (avvisi) {
      const tutti = []
        .concat((dati && dati.avvisi) || [])
        .concat(App.stato.avvisiCaricamento || []);
      const visti = {};
      const unici = tutti.filter(function (a) {
        if (visti[a]) return false;
        visti[a] = true;
        return true;
      });
      avvisi.innerHTML = unici.length
        ? '<div class="avviso-box"><b>Avvisi sui dati</b><ul>' +
          unici.map((a) => "<li>" + esc(a) + "</li>").join("") + "</ul></div>"
        : "";
    }
  }

  UI.setProgressoUpload = function (testo) {
    const el = $("progressoUpload");
    if (el) el.textContent = testo || "";
  };

  UI.setProgressoCalcolo = function (testo) {
    const el = $("progressoCalcolo");
    if (el) el.textContent = testo || "";
  };

  /* -------------------------------------------------------------- riepilogo */

  function renderRiepilogo() {
    const el = $("riepilogo");
    const info = $("infoDati");
    const dati = App.stato.dati;
    if (!el) return;
    if (!dati || !dati.depositi.length) {
      el.innerHTML = '<div class="card speciale"><div class="val">—</div><div class="lbl">Nessun dato disponibile</div></div>';
      if (info) info.textContent = "";
      return;
    }

    el.innerHTML = dati.depositi.map(function (d) {
      const conteggi = {};
      d.turni.forEach(function (t) {
        const c = App.catDi(d, t);
        conteggi[c] = (conteggi[c] || 0) + 1;
      });
      const posizioni = T.slotDaFasce(d.fasce).length;
      const target = App.target(d);
      const gaps = T.gapDisponibili(T.slotDaFasce(d.fasce), d.disponibili || []);
      const minGap = gaps.length ? Math.min.apply(null, gaps) : null;
      const proposta = App.proposta(d);
      return '<div class="card ' + (d.codice === (App.dep() || {}).codice ? "sel" : "") +
        '" data-dep="' + esc(d.codice) + '">' +
        '<div class="val">' + d.turni.length + "</div>" +
        '<div class="lbl"><b>' + esc(d.nome) + "</b><br>" + posizioni + " posizioni · " +
        (d.disponibili || []).length + " disponibili</div>" +
        '<div class="mini">P ' + (conteggi.PRIMO || 0) + " · SP " + (conteggi.SPEZZATO || 0) +
        " · S " + (conteggi.SECONDO || 0) + " · T " + (conteggi.TERZO || 0) + "</div>" +
        '<div class="mini">' +
        (minGap == null ? "senza disponibili" : "min " + minGap + " turni prima di un disponibile" +
          (minGap < target ? ' <span class="avviso">⚠</span>' : "")) +
        (proposta ? ' · <span class="ok">proposta ✓</span>' : "") + "</div></div>";
    }).join("") +
      '<div class="card speciale"><div class="val">' + (dati.jolly || []).length + "</div>" +
      '<div class="lbl">Jolly (turni brevi)<br>fuori dalla turnazione</div>' +
      '<div class="mini">assegnati dall’ufficio</div></div>';

    if (info) {
      const quanti = dati.depositi.reduce((s, d) => s + d.turni.length, 0);
      const fonte = App.stato.sorgente ? App.stato.sorgente.etichetta : "dati locali";
      info.textContent = fonte + " · " + dati.depositi.length + " depositi · " + quanti +
        " turni · aggiornato il " + dataIt(dati.generato);
    }
  }

  /* --------------------------------------------------------------- proposta */

  function renderProposta() {
    const dep = App.dep();
    const titolo = $("titoloDeposito");
    if (!dep) {
      if (titolo) titolo.textContent = "";
      $("stats").innerHTML = "";
      $("notaProposta").textContent = "Carica i PDF per vedere la proposta.";
      $("msgDisp").innerHTML = "";
      $("strip").innerHTML = "";
      document.querySelector("#tabSeq tbody").innerHTML = "";
      return;
    }

    if (titolo) titolo.textContent = "· " + dep.nome;
    const modo = $("modoDisp");
    if (modo) modo.value = App.stato.modoDisp;

    const seq = App.seqMostrata(dep);
    const att = App.statistiche(dep, App.seqAttuale(dep));
    const proposta = App.proposta(dep);
    const pro = proposta ? App.statistiche(dep, proposta.seq) : null;
    const target = App.target(dep);

    renderStats(att, pro, target, dep);
    renderNotaProposta(dep, proposta, pro, target);
    renderStrip(dep, seq);
    renderTabSeq(dep, seq, target);
  }

  function renderStats(att, pro, target, dep) {
    const el = $("stats");
    if (!el) return;

    function card(titolo, chiave, opzioni) {
      const o = opzioni || {};
      const a = att[chiave];
      const b = pro ? pro[chiave] : null;
      const fa = o.formato ? o.formato(a) : valore(a);
      const fb = o.formato ? o.formato(b) : valore(b);
      let confronto = "";
      if (pro && a != null && b != null && typeof a === "number" && typeof b === "number") {
        const inverso = !!o.inverso;
        const meglio = inverso ? b > a : b < a;
        const peggio = inverso ? b < a : b > a;
        const cls = meglio ? "migliora" : peggio ? "peggiora" : "";
        confronto = ' <span class="confronto">→ <span class="' + cls + '">' + fb + "</span></span>";
      } else if (pro) {
        confronto = ' <span class="confronto">→ ' + fb + "</span>";
      }
      return '<div class="stat"><b>' + fa + confronto + "</b>" +
        '<span class="lbl">' + esc(titolo) + "</span></div>";
    }

    const freccia = function (v) {
      if (v == null) return "—";
      return v;
    };

    el.innerHTML =
      card("Pause sotto 9h40", "pauseKO") +
      card("Pause 9h40–10h", "pauseDer") +
      card("Pausa minima garantita", "pausaMinima", { formato: (v) => T.oreMin(v), inverso: true }) +
      card("Ripetizioni stessa categoria", "ripetizioni") +
      card("Spezzato → primo", "dopoSpezzato") +
      card("Inversioni", "inversioni") +
      card("Serie massima uguale", "maxSerie") +
      card("Min turni prima di un disponibile", "minGapDisp", {
        formato: freccia,
        inverso: true,
      }) +
      card("Disponibili sotto target", "dispSottoTarget") +
      card("Punteggio (più basso = meglio)", "punteggio");

    if (target) {
      el.innerHTML += '<div class="stat"><b>' + target + '</b><span class="lbl">Target turni normali fra due disponibili</span></div>';
    }
  }

  function renderNotaProposta(dep, proposta, pro, target) {
    const nota = $("notaProposta");
    const msg = $("msgDisp");
    if (!nota || !msg) return;

    if (proposta) {
      const ms = Math.max(0, Math.round(proposta.tempo || 0));
      nota.innerHTML = "Proposta per <b>" + esc(dep.nome) + "</b>: i " + dep.turni.length +
        " turni sono stati riassegnati alle " + T.slotDaFasce(dep.fasce).length +
        " posizioni. Calcolo in " + ms + " ms · " + (proposta.giri || "?") + " strategie provate. " +
        "Chi è alla posizione <b>x</b> questa settimana passa alla <b>x+1</b> la settimana dopo.";
    } else {
      nota.innerHTML = "Stai vedendo la <b>numerazione attuale</b> di " + esc(dep.nome) +
        ". Premi “Calcola questo deposito” per ottenere la proposta ottimizzata.";
    }

    const nDisp = (dep.disponibili || []).length;
    if (nDisp && target < T.DISP_MIN) {
      msg.innerHTML = '<div class="avviso-box">' +
        esc(T.etichettaDisp(dep.turni.length, nDisp, target)) +
        "</div>";
    } else {
      msg.innerHTML = "";
    }
  }

  function renderStrip(dep, seq) {
    const el = $("strip");
    if (!el) return;
    const by = App.byNum(dep);
    const slots = T.slotDaFasce(dep.fasce);
    el.innerHTML = seq.map(function (v, i) {
      const pos = slots[i];
      const cat = v.cat;
      const codice = T.CODICE_CAT[cat] || "?";
      const classe = cat === T.CAT.DISP ? "disp" : cat;
      let titolo = "Posizione " + pos + ": " + cat;
      if (v.n != null) {
        const t = by.get(v.n);
        titolo += " · turno " + T.fmtNumero(v.n);
        if (t) {
          const orario = T.trattiTesto(t.lv) !== "—" ? T.trattiTesto(t.lv) :
            T.trattiTesto(t.sb) !== "—" ? "Sabato " + T.trattiTesto(t.sb) : T.trattiTesto(t.fs);
          titolo += " · " + orario;
        }
      } else {
        titolo += " · turno assegnato dall'ufficio";
      }
      return '<div class="blk ' + classe + '" title="' + esc(titolo) + '">' + codice +
        "<small>" + pos + "</small></div>";
    }).join("");
  }

  function renderTabSeq(dep, seq, target) {
    const tb = document.querySelector("#tabSeq tbody");
    if (!tb) return;
    const by = App.byNum(dep);
    const slots = T.slotDaFasce(dep.fasce);
    const override = App.stato.override[dep.codice] || {};

    tb.innerHTML = seq.map(function (v, i) {
      const pos = slots[i];
      if (v.n == null) {
        const gap = gapPrimaDisp(seq, i);
        const ok = gap >= target;
        return "<tr>" +
          "<td><b>" + pos + "</b></td>" +
          "<td>—</td>" +
          "<td>" + tag(T.CAT.DISP) + "</td>" +
          "<td>—</td>" +
          '<td colspan="5">Turno non predeterminato: lo assegna l’ufficio · ' +
          '<b class="' + (ok ? "ok" : "ko") + '">' + gap + " turni normali prima</b>" +
          (ok ? "" : " (mancano " + (target - gap) + " per il target " + target + ")") +
          "</td></tr>";
      }

      const t = by.get(v.n);
      const next = seq[(i + 1) % seq.length];
      const prossimo = next.n != null ? by.get(next.n) : null;
      const p = t && prossimo ? T.pausaMin(t, prossimo) : Infinity;
      const note = [];
      if (override[v.n]) note.push("correzione manuale");
      if (t && t.nota) note.push(t.nota);
      if (t && t.origine && t.origine !== "lunven" && !t.nota) {
        note.push("categoria dal " + T.nomeTipo(t.origine).toLowerCase());
      }

      return "<tr>" +
        "<td><b>" + pos + "</b></td>" +
        "<td>" + T.fmtNumero(v.n) + "</td>" +
        "<td>" + tag(v.cat) + "</td>" +
        "<td>" + pauseHtml(p) + "</td>" +
        "<td>" + T.trattiTesto(t && t.lv) + "</td>" +
        "<td>" + T.trattiTesto(t && t.sb) + "</td>" +
        "<td>" + T.trattiTesto(t && t.fs) + "</td>" +
        "<td>" + T.fmtOre(t && t.ore) + "</td>" +
        "<td>" + (note.length ? esc(note.join(" · ")) : "—") + "</td></tr>";
    }).join("");
  }

  /* ------------------------------------------------------------ simulazione */

  function renderSimulazione() {
    const dep = App.dep();
    const cal = $("calendario");
    const tb = document.querySelector("#tabSim tbody");
    if (!cal || !tb) return;
    if (!dep) {
      cal.innerHTML = "";
      tb.innerHTML = "";
      return;
    }

    const seq = App.seqMostrata(dep);
    const slots = T.slotDaFasce(dep.fasce);
    const by = App.byNum(dep);
    const settimane = Number($("simSettimane") && $("simSettimane").value) || 26;
    let partenza = Number($("simPartenza") && $("simPartenza").value) || 1;
    partenza = Math.max(1, Math.min(slots[slots.length - 1], partenza));

    let i0 = slots.indexOf(partenza);
    if (i0 < 0) {
      i0 = 0;
      for (let k = 0; k < slots.length; k++) {
        if (slots[k] >= partenza) {
          i0 = k;
          break;
        }
      }
    }

    const righe = [];
    const blocchi = [];
    let precedente = null;

    for (let k = 0; k < settimane; k++) {
      const i = (i0 + k) % seq.length;
      const v = seq[i];
      const pos = slots[i];
      const t = v.n != null ? by.get(v.n) : null;
      let p = Infinity;
      if (precedente && t) p = T.pausaMin(precedente, t);
      const clsPausa = p < T.PAUSA_DEROGA ? "ko" : p < T.PAUSA_MIN ? "der" : "";
      const orario = t
        ? (T.trattiTesto(t.lv) !== "—" ? T.trattiTesto(t.lv)
          : T.trattiTesto(t.sb) !== "—" ? "Sabato: " + T.trattiTesto(t.sb)
          : T.trattiTesto(t.fs))
        : "—";
      const nota = v.cat === T.CAT.DISP
        ? "turno da assegnare (ufficio)"
        : t && !t.lv
        ? "cartellino solo " + T.nomeTipo(t.origine).toLowerCase()
        : "";

      blocchi.push('<div class="c ' + (v.cat === T.CAT.DISP ? "disp" : v.cat) +
        " " + (clsPausa === "ko" ? "ko" : clsPausa === "der" ? "der" : "") + '">' +
        "<b>" + (k + 1) + "ª</b><small>n° " + pos + " · " + (T.CODICE_CAT[v.cat] || "?") +
        "</small></div>");

      righe.push("<tr>" +
        "<td>" + (k + 1) + "</td>" +
        "<td><b>" + pos + "</b></td>" +
        "<td>" + tag(v.cat) + "</td>" +
        "<td>" + (v.n != null ? T.fmtNumero(v.n) : "—") + "</td>" +
        "<td>" + orario + "</td>" +
        '<td class="' + clsPausa + '">' + (precedente && isFinite(p) ? T.oreMin(p) : "—") + "</td>" +
        "<td>" + esc(nota) + "</td></tr>");

      precedente = t;
    }

    cal.innerHTML = blocchi.join("");
    tb.innerHTML = righe.join("");
  }

  function aggiornaSimulazione() {
    if (!App) return;
    const partenza = Number($("simPartenza") && $("simPartenza").value) || 1;
    const settimane = Number($("simSettimane") && $("simSettimane").value) || 26;
    App.impostaSimulazione(partenza, settimane);
    renderSimulazione();
  }

  /* ---------------------------------------------------------------- turni */

  function renderTurni() {
    const dep = App.dep();
    const tb = document.querySelector("#tabTurni tbody");
    const tbJ = document.querySelector("#tabJolly tbody");
    const tbP = document.querySelector("#tabPause tbody");
    if (!tb || !tbJ || !tbP) return;
    if (!dep) {
      tb.innerHTML = "";
      tbJ.innerHTML = "";
      tbP.innerHTML = "";
      return;
    }

    const q = (($("filtroRicerca") && $("filtroRicerca").value) || "").trim().toLowerCase();
    const f = ($("filtroCat") && $("filtroCat").value) || "";
    const by = App.byNum(dep);
    const override = App.stato.override[dep.codice] || {};

    const righe = dep.turni.slice().sort((a, b) => a.n - b.n).filter(function (t) {
      const cat = App.catDi(dep, t);
      if (f && cat !== f) return false;
      if (!q) return true;
      const testo = [
        t.n, T.fmtNumero(t.n), cat,
        T.trattiTesto(t.lv), T.trattiTesto(t.sb), T.trattiTesto(t.fs), t.ore, t.nota, t.monta,
      ].join(" ").toLowerCase();
      return testo.indexOf(q) >= 0;
    }).map(function (t) {
      const cat = App.catDi(dep, t);
      const pause = T.pauseInterne(t);
      const pauseTxt = pause.length
        ? pause.map(function (x) {
            const cls = x.minuti < T.PAUSA_DEROGA ? "ko" : x.minuti < T.PAUSA_MIN ? "der" : "";
            return '<span class="' + cls + '">' + esc(x.etichetta) + " " + T.oreMin(x.minuti) + "</span>";
          }).join("<br>")
        : "—";
      const note = [];
      if (override[t.n]) note.push("correzione manuale");
      if (t.nota) note.push(t.nota);
      if (t.monta) note.push(t.monta);
      return "<tr>" +
        "<td><b>" + T.fmtNumero(t.n) + "</b></td>" +
        '<td class="mie" data-cat-n="' + t.n + '" title="Clicca per cambiare categoria">' + tag(cat) + "</td>" +
        "<td>" + T.trattiTesto(t.lv) + "</td>" +
        "<td>" + T.trattiTesto(t.sb) + "</td>" +
        "<td>" + T.trattiTesto(t.fs) + "</td>" +
        "<td>" + pauseTxt + "</td>" +
        "<td>" + T.fmtOre(t.ore) + "</td>" +
        "<td>" + esc(note.join(" · ") || "—") + "</td></tr>";
    }).join("");

    tb.innerHTML = righe || '<tr><td colspan="8" class="tenue">Nessun turno trovato.</td></tr>';

    const jolly = (App.stato.dati && App.stato.dati.jolly) || [];
    tbJ.innerHTML = jolly.length
      ? jolly.map(function (t) {
          return "<tr><td><b>" + T.fmtNumero(t.n) + "</b></td>" +
            "<td>" + T.trattiTesto(t.lv) + "</td>" +
            "<td>" + T.trattiTesto(t.sb) + "</td>" +
            "<td>" + T.trattiTesto(t.fs) + "</td>" +
            "<td>" + T.fmtOre(t.ore) + "</td>" +
            "<td>" + esc(t.motivo || "turno breve") + "</td></tr>";
        }).join("")
      : '<tr><td colspan="6" class="tenue">Nessun jolly nei dati caricati.</td></tr>';

    const pause = [];
    dep.turni.forEach(function (t) {
      T.pauseInterne(t).forEach(function (x) {
        pause.push({ t: t, x: x });
      });
    });
    tbP.innerHTML = pause.length
      ? pause.map(function (r) {
          const cls = r.x.minuti < T.PAUSA_DEROGA ? "ko" : "der";
          return "<tr><td><b>" + T.fmtNumero(r.t.n) + "</b></td>" +
            "<td>" + esc(r.x.etichetta) + "</td>" +
            "<td>" + esc(r.x.prima) + "</td>" +
            "<td>" + esc(r.x.dopo) + "</td>" +
            '<td class="' + cls + '">' + T.oreMin(r.x.minuti) +
            (r.x.minuti < T.PAUSA_DEROGA ? " (sotto 9h40)" : "") + "</td></tr>";
        }).join("")
      : '<tr><td colspan="5" class="tenue">Nessuna pausa interna sotto le 12 ore.</td></tr>';

    const titoloTurni = $("titoloTurni");
    if (titoloTurni) titoloTurni.textContent = "· " + dep.nome;
    const titoloPause = $("titoloPause");
    if (titoloPause) titoloPause.textContent = "· " + dep.nome;
  }

  /* ---------------------------------------------------------------- regole */

  function renderRegole() {
    const dep = App.dep();
    const s = dep ? App.soglie(dep) : T.SOGLIE_PREDEFINITE;
    if ($("sOreJolly")) $("sOreJolly").value = s.oreJolly;
    if ($("sPrimoInizio")) $("sPrimoInizio").value = T.hm(s.primoInizio);
    if ($("sPrimoFine")) $("sPrimoFine").value = T.hm(s.primoFine);
    if ($("sTerzoInizio")) $("sTerzoInizio").value = T.hm(s.terzoInizio);
    if ($("sTerzoFine")) $("sTerzoFine").value = T.hm(s.terzoFine);

    Object.keys(CHIAVI_PESI).forEach(function (id) {
      const el = $(id);
      if (el) el.value = App.stato.pesi[CHIAVI_PESI[id]];
    });
  }

  UI.leggiSoglie = function () {
    const d = T.SOGLIE_PREDEFINITE;
    const ore = Number($("sOreJolly") && $("sOreJolly").value);
    return {
      oreJolly: isFinite(ore) && ore >= 0 ? ore : d.oreJolly,
      primoInizio: T.aMinuti($("sPrimoInizio") && $("sPrimoInizio").value) ?? d.primoInizio,
      primoFine: T.aMinuti($("sPrimoFine") && $("sPrimoFine").value) ?? d.primoFine,
      terzoInizio: T.aMinuti($("sTerzoInizio") && $("sTerzoInizio").value) ?? d.terzoInizio,
      terzoFine: T.aMinuti($("sTerzoFine") && $("sTerzoFine").value) ?? d.terzoFine,
    };
  };

  function leggiPesi() {
    const out = {};
    Object.keys(CHIAVI_PESI).forEach(function (id) {
      const el = $(id);
      const n = el ? Number(el.value) : NaN;
      out[CHIAVI_PESI[id]] = isFinite(n) && n >= 0 ? n : T.PESI_PREDEFINITI[CHIAVI_PESI[id]];
    });
    return out;
  }

  UI.leggiPesi = leggiPesi;

  /* ----------------------------------------------------------------- toast */

  UI.toast = function (messaggio, tipo) {
    let el = $("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      document.body.appendChild(el);
    }
    el.className = "toast " + (tipo || "");
    el.textContent = messaggio;
    el.classList.add("visibile");
    clearTimeout(el._timer);
    el._timer = setTimeout(function () {
      el.classList.remove("visibile");
    }, 4200);
  };

  /* rende disponibili le funzioni usate da app.js */
  UI.aggiornaSimulazione = aggiornaSimulazione;
  UI.renderUpload = renderUpload;
})(typeof globalThis !== "undefined" ? globalThis : window);
