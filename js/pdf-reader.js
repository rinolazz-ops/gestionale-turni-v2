/* ==========================================================================
   Gestione Turni ACTV - lettura dei PDF nel browser
   Usa pdf.js (incluso in js/vendor) e ricostruisce le righe di testo tenendo
   conto delle coordinate, cosi' il parser dei cartellini trova le stesse righe
   che si vedono nel PDF.

   I cartellini ACTV sono stampati due per pagina (colonna sinistra e destra)
   e alcuni PDF sono ruotati di 90 gradi. Per questo:
   - ogni elemento viene trasformato nelle coordinate del viewport (gestisce
     la rotazione della pagina);
   - la pagina viene divisa in colonne usando le etichette "Monta";
   - le righe vengono ricostruite dentro ogni singolo cartellino.
   ========================================================================== */
(function (root) {
  "use strict";

  const T = (root.Turni = root.Turni || {});

  /* Le righe della tabella distano circa 11pt; "Orario" e gli orari sono
     disegnati a 4pt di distanza, quindi la tolleranza deve superare i 4pt. */
  const TolleranzaY = 5;
  const TolleranzaColonna = 20;
  const MargineColonna = 6;

  function configura() {
    if (!root.pdfjsLib) {
      throw new Error("pdf.js non caricato: controlla js/vendor/pdf.min.js");
    }
    if (root.pdfjsLib.GlobalWorkerOptions) {
      const opzioni = root.pdfjsLib.GlobalWorkerOptions;
      /* In Node (test) il percorso assoluto e' gia' impostato: non va
         sovrascritto con il percorso relativo usato dal browser. */
      if (!opzioni.workerSrc || !/^(https?:|file:|\/|[A-Za-z]:)/.test(opzioni.workerSrc)) {
        opzioni.workerSrc = "js/vendor/pdf.worker.min.js";
      }
    }
  }

  function trasformaPunto(trasformazione, x, y) {
    if (!trasformazione) return [x, y];
    return [
      trasformazione[0] * x + trasformazione[2] * y + trasformazione[4],
      trasformazione[1] * x + trasformazione[3] * y + trasformazione[5],
    ];
  }

  function creaElementi(items, viewportTransform) {
    const elementi = [];
    (items || []).forEach(function (it) {
      if (!it || typeof it.str !== "string" || !it.str.trim()) return;
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      let x;
      let y;
      if (viewportTransform && root.pdfjsLib && root.pdfjsLib.Util) {
        const m = root.pdfjsLib.Util.transform(viewportTransform, tr);
        x = m[4];
        y = m[5];
      } else {
        x = tr[4];
        y = tr[5];
      }
      elementi.push({
        testo: it.str,
        x: x,
        y: y,
        larghezza: it.width || 0,
        altezza: it.height || Math.abs(tr[3]) || 8,
      });
    });
    return elementi;
  }

  function uniciOrdinati(valori, tolleranza) {
    const out = [];
    (valori || [])
      .slice()
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (v) {
        if (!out.length || Math.abs(v - out[out.length - 1]) > tolleranza) out.push(v);
      });
    return out;
  }

  function eIntestazione(el) {
    return /^D\d{3}$/.test(el.testo);
  }

  function partenzeColonne(elementi, espressione) {
    return uniciOrdinati(
      elementi.filter(function (e) {
        return espressione.test(e.testo);
      }).map(function (e) {
        return e.x;
      }),
      TolleranzaColonna
    );
  }

  /* Divide gli elementi della pagina in colonne (cartellini affiancati). */
  function dividiColonne(elementi) {
    let partenze = partenzeColonne(elementi, /^Monta(\s|$)/);

    /* Se "Monta" e' stato estratto insieme al codice deposito (o manca),
       usiamo le etichette "Orario", anch'esse all'inizio di ogni colonna. */
    if (partenze.length < 2) {
      const daOrario = partenzeColonne(elementi, /^Orario(\s|$)/);
      if (daOrario.length > partenze.length) partenze = daOrario;
    }

    if (partenze.length < 2) {
      /* Un solo cartellino per pagina (o layout non riconosciuto):
         si tiene tutto, eventualmente dividendo per righe piu' avanti. */
      return [elementi];
    }

    return partenze.map(function (partenza, i) {
      const minimo = i === 0 ? -Infinity : partenza - MargineColonna;
      const massimo =
        i === partenze.length - 1 ? Infinity : partenze[i + 1] - MargineColonna;
      return elementi.filter(function (e) {
        return e.x >= minimo && e.x < massimo;
      });
    });
  }

  /* Se in una colonna ci sono piu' cartellini impilati, li separa per y. */
  function dividiBlocchi(colonna) {
    const intestazioni = colonna
      .filter(eIntestazione)
      .slice()
      .sort(function (a, b) {
        return a.y - b.y;
      });

    if (intestazioni.length < 2) return [colonna];

    const confini = [];
    for (let i = 1; i < intestazioni.length; i++) {
      confini.push((intestazioni[i - 1].y + intestazioni[i].y) / 2);
    }

    return intestazioni.map(function (_, i) {
      const minimo = i === 0 ? -Infinity : confini[i - 1];
      const massimo = i === intestazioni.length - 1 ? Infinity : confini[i];
      return colonna.filter(function (e) {
        return e.y >= minimo && e.y < massimo;
      });
    });
  }

  function raggruppaRighe(items, viewportTransform) {
    const elementi = creaElementi(items, viewportTransform);
    if (!elementi.length) return [];

    const righe = [];

    dividiColonne(elementi).forEach(function (colonna) {
      dividiBlocchi(colonna).forEach(function (blocco) {
        if (!blocco.length) return;

        blocco.sort(function (a, b) {
          if (a.y !== b.y) return a.y - b.y;
          return a.x - b.x;
        });

        const gruppi = [];
        blocco.forEach(function (el) {
          const ultimo = gruppi[gruppi.length - 1];
          if (!ultimo || Math.abs(ultimo.y - el.y) > TolleranzaY) {
            gruppi.push({ y: el.y, elementi: [el] });
          } else {
            ultimo.elementi.push(el);
            ultimo.y = (ultimo.y * (ultimo.elementi.length - 1) + el.y) / ultimo.elementi.length;
          }
        });

        gruppi.forEach(function (gruppo) {
          const lista = gruppo.elementi.slice().sort(function (a, b) {
            return a.x - b.x;
          });

          /* Il numero del cartellino (D001, ...) e' scritto in grande sopra
             il resto della riga: va messo all'inizio per il parser. */
          const intestazione = lista.find(eIntestazione);
          if (intestazione) {
            lista.splice(lista.indexOf(intestazione), 1);
            lista.unshift(intestazione);
          }

          let testo = "";
          let finePrecedente = null;
          lista.forEach(function (el) {
            if (!testo) {
              testo = el.testo;
            } else {
              const distanza = el.x - finePrecedente;
              const separatore = distanza > 1.6 ? " " : "";
              testo += separatore + el.testo;
            }
            finePrecedente = el.x + el.larghezza;
          });
          const normalizzata = T.normalizzaRiga(testo);
          if (normalizzata) righe.push(normalizzata);
        });
      });
    });

    return righe;
  }

  async function estrai(file, onProgress) {
    configura();
    const buffer = await file.arrayBuffer();
    const pdf = await root.pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useWorkerFetch: false,
    }).promise;

    const righe = [];
    const totale = pdf.numPages;
    try {
      for (let p = 1; p <= totale; p++) {
        const pagina = await pdf.getPage(p);
        const contenuto = await pagina.getTextContent();
        const viewport = pagina.getViewport({ scale: 1 });
        righe.push("--- pagina " + p + " ---");
        raggruppaRighe(contenuto.items, viewport.transform).forEach(function (r) {
          righe.push(r);
        });
        pagina.cleanup();
        if (onProgress) onProgress(p, totale);
      }
    } finally {
      try {
        await pdf.destroy();
      } catch (e) {
        /* ignore */
      }
    }

    const testo = righe.join("\n");
    return {
      testo: testo,
      pagine: totale,
      turni: T.leggiCartellini(testo),
    };
  }

  T.Pdf = {
    configura: configura,
    estrai: estrai,
    raggruppaRighe: raggruppaRighe,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
