const fs = require("fs");
const path = require("path");
const vm = require("vm");

const radice = path.join(__dirname, "..");
for (const file of ["js/core.js", "js/optimizer.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(radice, file), "utf8"), { filename: file });
}
const T = globalThis.Turni;
const dati = T.normalizzaDati(JSON.parse(fs.readFileSync(path.join(radice, "dati", "turni-esempio.json"), "utf8")));

const pesi = T.PESI_PREDEFINITI;
let totali = 0;
for (const dep of dati.depositi) {
  const att = T.statistiche(dep, T.seqOriginale(dep), { pesi });
  const inizio = Date.now();
  const r = T.ottimizzaDeposito(dep, { pesi, modoDisp: "auto" });
  totali += Date.now() - inizio;
  const p = r.metrica;
  console.log(
    dep.nome.padEnd(10),
    "KO", att.pauseKO, "->", p.pauseKO,
    "| der", att.pauseDer, "->", p.pauseDer,
    "| rip", att.ripetizioni, "->", p.ripetizioni,
    "| SP>P", att.dopoSpezzato, "->", p.dopoSpezzato,
    "| inv", att.inversioni, "->", p.inversioni,
    "| maxSerie", att.maxSerie, "->", p.maxSerie,
    "| minGap", att.minGapDisp, "->", p.minGapDisp,
    "| sottoTarget", att.dispSottoTarget, "->", p.dispSottoTarget,
    "| score", att.punteggio, "->", p.punteggio,
    "|", Math.round(r.tempo) + "ms"
  );
  if (p.pauseKO > 0) {
    console.log("  PAUSE KO:", JSON.stringify(p.pauseKOdettaglio));
  }
}
console.log("tempo totale", totali, "ms");
