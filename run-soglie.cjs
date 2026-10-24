const fs = require("fs");
const path = require("path");
const vm = require("vm");

const radice = path.join(__dirname, "..");
for (const file of ["js/core.js", "js/optimizer.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(radice, file), "utf8"), { filename: file });
}
const T = globalThis.Turni;
const base = T.normalizzaDati(
  JSON.parse(fs.readFileSync(path.join(radice, "dati", "turni-esempio.json"), "utf8"))
);

let errori = 0;
function verifica(condizione, messaggio) {
  if (!condizione) {
    console.log("ERRORE:", messaggio);
    errori++;
  }
}

function sogliePerTutti(override) {
  const out = {};
  for (const dep of base.depositi) {
    out[dep.codice] = Object.assign({}, base.soglie, (override || {})[dep.codice] || {});
  }
  return out;
}

function mappaCategorie(dati) {
  const out = {};
  for (const dep of dati.depositi) {
    out[dep.codice] = {};
    for (const t of dep.turni) out[dep.codice][t.n] = t.cat;
  }
  return out;
}

function numeri(dati) {
  const turni = [];
  const jolly = [];
  for (const dep of dati.depositi) {
    for (const t of dep.turni) turni.push(t.n);
  }
  for (const t of dati.jolly) jolly.push(t.n);
  return { turni, jolly };
}

/* 1. Ricalcolare con le stesse soglie non cambia nulla. */
const identico = T.riclassificaDati(base, sogliePerTutti());
verifica(
  JSON.stringify(mappaCategorie(identico)) === JSON.stringify(mappaCategorie(base)),
  "le categorie cambiano anche con le stesse soglie"
);
verifica(
  JSON.stringify(numeri(identico)) === JSON.stringify(numeri(base)),
  "turni o jolly cambiano anche con le stesse soglie"
);
for (const dep of base.depositi) {
  const altro = identico.depositi.find((d) => d.codice === dep.codice);
  verifica(!!altro, "deposito perso: " + dep.nome);
  if (!altro) continue;
  verifica(
    JSON.stringify(altro.fasce) === JSON.stringify(dep.fasce) &&
      JSON.stringify(altro.disponibili) === JSON.stringify(dep.disponibili),
    "fasce o disponibili cambiano con le stesse soglie: " + dep.nome
  );
}

/* 2. Le soglie di un deposito non toccano gli altri. */
const soloDolo = sogliePerTutti({ dolo: { primoInizio: 0, terzoInizio: 0 } });
const conTerzoDolo = T.riclassificaDati(base, soloDolo);
const doloBase = base.depositi.find((d) => d.codice === "dolo");
const doloTerzo = conTerzoDolo.depositi.find((d) => d.codice === "dolo");
verifica(!!doloTerzo, "Dolo scompare cambiando terzoInizio");
if (doloTerzo) {
  doloTerzo.turni.forEach(function (t) {
    const atteso = /\+/.test(T.trattiTesto(t.lv)) ? T.CAT.SPEZZATO : T.CAT.TERZO;
    verifica(t.cat === atteso, "D" + t.n + " dovrebbe essere " + atteso + ", e' " + t.cat);
  });
}
for (const dep of base.depositi) {
  if (dep.codice === "dolo") continue;
  const dopo = conTerzoDolo.depositi.find((d) => d.codice === dep.codice);
  verifica(
    dopo && JSON.stringify(mappaCategorie({ depositi: [dep] })) ===
      JSON.stringify(mappaCategorie({ depositi: [dopo] })),
    "cambiano le categorie di un altro deposito: " + dep.nome
  );
}

/* 3. Alzando oreJolly i turni passano nei jolly; abbassandola tornano. */
const soglieJolly = sogliePerTutti({ dolo: { oreJolly: 20 } });
const soloJolly = T.riclassificaDati(base, soglieJolly);
const doloJolly = soloJolly.depositi.find((d) => d.codice === "dolo");
verifica(!doloJolly || doloJolly.turni.length === 0, "Dolo dovrebbe essere tutta jolly con soglia 20");
const jollyAttesi = numeri(base).jolly.length + doloBase.turni.length;
verifica(
  soloJolly.jolly.length === jollyAttesi,
  "numero jolly dopo soglia alta: " + soloJolly.jolly.length + " invece di " + jollyAttesi
);

const tornato = T.riclassificaDati(soloJolly, sogliePerTutti());
verifica(
  JSON.stringify(mappaCategorie(tornato)) === JSON.stringify(mappaCategorie(base)),
  "le categorie non tornano abbassando oreJolly"
);
verifica(
  JSON.stringify(numeri(tornato)) === JSON.stringify(numeri(base)),
  "turni o jolly non tornano abbassando oreJolly"
);

/* 4. Nessun numero puo' stare contemporaneamente in un deposito e nei jolly. */
for (const dati of [identico, conTerzoDolo, soloJolly, tornato]) {
  const n = numeri(dati);
  const insieme = new Set(n.turni);
  verifica(insieme.size === n.turni.length, "turno duplicato nei depositi");
  n.jolly.forEach(function (x) {
    verifica(!insieme.has(x), "D" + x + " e' sia turno sia jolly");
  });
}

console.log(errori === 0 ? "test soglie: OK" : "test soglie: " + errori + " errori");
process.exitCode = errori === 0 ? 0 : 1;
