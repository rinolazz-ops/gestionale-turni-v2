const fs = require("fs");
const path = require("path");
const vm = require("vm");

const radice = path.join(__dirname, "..");
for (const file of ["js/core.js", "js/optimizer.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(radice, file), "utf8"), { filename: file });
}

const T = globalThis.Turni;
const leggi = (nome) => fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8");

const lunven = T.leggiCartellini(leggi("lunven.txt"));
const sabato = T.leggiCartellini(leggi("sabato.txt"));
const festivo = T.leggiCartellini(leggi("festivo.txt"));
console.log("cartellini:", { lunven: lunven.length, sabato: sabato.length, festivo: festivo.length });

const dati = T.componiDati({ lunven, sabato, festivo, generato: "2026-10-20T00:00:00.000Z" });
console.log("avvisi:", dati.avvisi);
for (const d of dati.depositi) {
  const c = {};
  d.turni.forEach((t) => (c[t.cat] = (c[t.cat] || 0) + 1));
  console.log(
    d.nome.padEnd(10),
    "turni", String(d.turni.length).padStart(2),
    "fasce", JSON.stringify(d.fasce),
    "disp", JSON.stringify(d.disponibili),
    JSON.stringify(c)
  );
}
console.log("jolly", dati.jolly.map((t) => t.n).join(","));

const vecchio = JSON.parse(fs.readFileSync(path.join(radice, "dati", "turni-esempio.json"), "utf8"));
let errori = 0;
for (const d of dati.depositi) {
  const v = vecchio.depositi.find((x) => x.codice === d.codice);
  if (!v) { console.log("MANCA", d.codice); errori++; continue; }
  if (JSON.stringify(d.fasce) !== JSON.stringify(v.fasce)) {
    console.log("FASCE DIVERSE", d.nome, d.fasce, v.fasce); errori++;
  }
  if (JSON.stringify(d.disponibili) !== JSON.stringify(v.disponibili)) {
    console.log("DISP DIVERSI", d.nome, d.disponibili, v.disponibili); errori++;
  }
  if (d.turni.length !== v.turni.length) {
    console.log("NUMERO TURNI DIVERSO", d.nome, d.turni.length, v.turni.length); errori++;
  }
  for (const t of v.turni) {
    const nt = d.turni.find((x) => x.n === t.n);
    if (!nt) { console.log("TURNO MANCANTE", d.nome, t.n); errori++; continue; }
    if (nt.cat !== t.cat) { console.log("CAT DIVERSA", d.nome, t.n, nt.cat, t.cat); errori++; }
  }
}
console.log("confronto col vecchio estrattore:", errori === 0 ? "OK" : errori + " differenze");
