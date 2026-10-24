/* Estrae i tre PDF di prova con pdf.js e verifica che il risultato coincida
   con i dati di riferimento (dati/turni-esempio.json).
   Uso: node test/run-pdf.cjs
   I PDF di prova stanno in test/pdf; se mancano, il test viene saltato. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const radice = path.join(__dirname, "..");
const cartellaPdf = path.join(__dirname, "pdf");
const nomi = { lunven: "lunven.pdf", sabato: "sabato.pdf", festivo: "festivo.pdf" };

const mancanti = Object.values(nomi).filter((n) => !fs.existsSync(path.join(cartellaPdf, n)));
if (mancanti.length) {
  console.log("test PDF saltato: mancano " + mancanti.join(", ") + " in test/pdf");
  process.exit(0);
}

const avvisoOriginale = console.warn;
console.warn = function () {};
global.pdfjsLib = require(path.join(radice, "js", "vendor", "pdf.min.js"));
global.pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(radice, "js", "vendor", "pdf.worker.min.js");
console.warn = avvisoOriginale;

for (const file of ["js/core.js", "js/pdf-reader.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(radice, file), "utf8"), { filename: file });
}
const T = globalThis.Turni;

function bufferDi(file) {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

(async () => {
  const letti = {};
  for (const [tipo, nome] of Object.entries(nomi)) {
    const esito = await T.Pdf.estrai({
      arrayBuffer: async () => bufferDi(path.join(cartellaPdf, nome)),
    });
    letti[tipo] = esito.turni;
    console.log(tipo.padEnd(8), esito.pagine + " pagine,", esito.turni.length + " cartellini");
  }

  const dati = T.componiDati({
    lunven: letti.lunven,
    sabato: letti.sabato,
    festivo: letti.festivo,
    generato: "2026-10-20T00:00:00.000Z",
  });

  const riferimento = JSON.parse(
    fs.readFileSync(path.join(radice, "dati", "turni-esempio.json"), "utf8")
  );

  let errori = 0;
  function controlla(condizione, messaggio) {
    if (!condizione) {
      console.log("ERRORE:", messaggio);
      errori++;
    }
  }

  controlla(dati.avvisi.length === 0, "avvisi inattesi: " + JSON.stringify(dati.avvisi));
  controlla(dati.depositi.length === riferimento.depositi.length, "numero depositi diverso");
  controlla(
    dati.jolly.map((t) => t.n).join(",") === riferimento.jolly.map((t) => t.n).join(","),
    "jolly diversi"
  );

  for (const dep of dati.depositi) {
    const rif = riferimento.depositi.find((d) => d.codice === dep.codice);
    controlla(!!rif, "deposito mancante nel riferimento: " + dep.codice);
    if (!rif) continue;
    controlla(
      JSON.stringify(dep.fasce) === JSON.stringify(rif.fasce),
      dep.nome + ": fasce diverse"
    );
    controlla(
      JSON.stringify(dep.disponibili) === JSON.stringify(rif.disponibili),
      dep.nome + ": disponibili diversi"
    );
    controlla(dep.turni.length === rif.turni.length, dep.nome + ": numero turni diverso");
    for (const t of rif.turni) {
      const trovato = dep.turni.find((x) => x.n === t.n);
      controlla(!!trovato, dep.nome + ": manca D" + t.n);
      if (!trovato) continue;
      controlla(trovato.cat === t.cat, dep.nome + ": categoria diversa per D" + t.n);
      for (const campo of ["origine", "ore", "monta", "lv", "sb", "fs"]) {
        controlla(
          JSON.stringify(trovato[campo]) === JSON.stringify(t[campo]),
          dep.nome + ": " + campo + " diverso per D" + t.n
        );
      }
    }
  }

  console.log(
    errori === 0
      ? "estrazione PDF: OK (" +
          dati.depositi.reduce((s, d) => s + d.turni.length, 0) +
          " turni, " +
          dati.jolly.length +
          " jolly)"
      : "estrazione PDF: " + errori + " errori"
  );
  process.exit(errori === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRORE:", e);
  process.exit(1);
});
