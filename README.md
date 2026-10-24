# Gestione Turni – ACTV Extraurbano Sud (v2)

Strumento locale per riordinare la **numerazione dei turni**, deposito per deposito, in modo che
chi segue la sequenza (14 → 15 → 16 …) non resti per più settimane nella stessa tipologia e non
abbia mai una **pausa di riposo insufficiente** tra una settimana e la successiva.

La differenza principale rispetto alla versione precedente: **i PDF si caricano direttamente nella
pagina**. Non serve Python, non serve un server, non serve ricostruire i dati a mano.

## Avvio rapido

1. Fai doppio clic su **`index.html`** (Chrome, Edge o Firefox).
2. Trascina nella pagina i tre PDF dei cartellini:
   - **Lun-Ven**
   - **Sabato**
   - **Festivo**
3. Controlla il riepilogo dei 5 depositi.
4. Premi **“Calcola tutti i depositi”**.
5. Usa **“Scarica proposta (CSV)”** o **“Stampa”** per condividere la numerazione.

I PDF vengono letti **solo nel browser**: nessun file viene inviato da nessuna parte. I dati
elaborati, le impostazioni e le proposte restano nel `localStorage` del browser.

> Se il browser blocca il `localStorage` aprendo il file con doppio clic, apri la cartella con un
> piccolo server locale (es. `python -m http.server`) e visita `http://localhost:8000`.

## Cosa contiene

| File | A cosa serve |
|---|---|
| `index.html` | la pagina dell’applicazione |
| `css/style.css` | stile, stampa e layout mobile |
| `js/core.js` | lettura dei cartellini, classificazione, depositi, pause, statistiche |
| `js/optimizer.js` | ricerca della numerazione migliore |
| `js/pdf-reader.js` | estrazione del testo dai PDF con pdf.js e ricostruzione delle righe |
| `js/ui.js` | rendering e interazioni |
| `js/app.js` | stato, salvataggio, import/export, orchestrazione |
| `js/vendor/pdf.min.js` | pdf.js 3.11.174 (UMD, funziona anche da `file://`) |
| `js/vendor/pdf.worker.min.js` | worker di pdf.js, precaricato per il funzionamento offline |
| `dati/esempio.js` | dati di esempio incorporati, usati al primo avvio |
| `dati/turni-esempio.json` | dataset di riferimento leggibile e riesportabile |
| `test/` | test automatici e PDF di prova |

## I depositi

Il numero del turno indica il deposito (verificato dalla riga “Monta …” del cartellino):

| Numerazione | Deposito | Sigle nei cartellini |
|---|---|---|
| 1 – 54 | **Dolo** | `DEP.DOLO` / `DOLO.DEP` |
| 101 – 130 | **Cavarzere** | `DEP.CAV` |
| 201 – 225 | **Bojon** | `BOJON` |
| 301 – 311, 350 | **Padova** | `PD PARCH` |
| 501 – 508 | **Fossò** | `FOSSO` / `FOS PK` |
| 901, 902, 904 | **Jolly** (fuori turnazione) | `DEP.DOLO` |

Ogni deposito ha una **rotazione indipendente**: Dolo 1→54→1, Cavarzere 101→130→101, ecc.
Le posizioni “disponibile” sono i numeri **senza cartellino predeterminato**: non sono settimane di
riposo, è l’ufficio turni a decidere il turno in base alle esigenze.

## Classificazione

| Categoria | Regola |
|---|---|
| **SPEZZATO** | due tratti orari (es. 07:00–09:30 + 14:02–18:48) |
| **PRIMO** (mattina) | inizia prima delle 11:00 **e** finisce entro le 14:00 |
| **TERZO** | inizia dalle 14:00 **oppure** finisce dopo le 21:00 |
| **SECONDO** | tutto il resto |
| **DISPONIBILE** | numero senza cartellino predeterminato |
| **JOLLY** | turno sotto le 4 ore: non entra nella rotazione |

Uno **spezzato viene trattato come una mattina**: dopo uno spezzato è preferibile un secondo o un
terzo, non un altro primo. Le soglie sono modificabili per deposito e le categorie possono essere
corrette a mano cliccando sulla tabella. Quando cambi una soglia, l’app ricalcola subito categorie e
jolly dai cartellini già letti, invalida solo le proposte dei depositi toccati e mantiene le
correzioni manuali; le impostazioni restano salvate anche dopo il ricaricamento.

## Regole dell’ottimizzazione

La sequenza desiderata è:

```
mattina/spezzato → secondo → terzo → (si ricomincia) mattina/spezzato …
```

L’ottimizzatore è **lessicografico**:

1. elimina le pause sotto **9h40**;
2. elimina le pause tra **9h40 e 10h** (deroga);
3. minimizza il punteggio pesato dell’alternanza.

Per farlo usa una soluzione costruttiva per categorie, ricerca locale 2-opt, ricerca locale mirata
e **simulated annealing deterministico** con più ripartenze. Il seed dipende dal **contenuto dei
cartellini**, dai pesi e dalle correzioni manuali: gli stessi PDF producono sempre la stessa
proposta, anche se vengono ricaricati in un altro momento.

### Disponibili: target dinamico

Il target non è sempre 4: è `min(4, floor(turni_normali / disponibili))`. Per esempio Padova ha
8 turni e 4 disponibili, quindi il massimo matematicamente raggiungibile è 2 turni normali in mezzo.
In modalità **automatica** i disponibili restano dove sono se già rispettano il target; altrimenti
vengono ridistribuiti. Le modalità **fisse** e **sempre libere** sono disponibili nel menu.

### Pause

Tra la fine dell’ultimo servizio di una settimana e l’inizio del turno successivo devono passare
almeno **10 ore** (deroga a **9h40**). Il calcolo considera Lun-Ven, Sabato e l’eventuale Festivo
della domenica. Le pause interne allo stesso turno (Lun-Ven → Sabato o Sabato → Festivo) non
dipendono dalla numerazione e vengono elencate nella sezione “Controlli pause interne”.

## Risultati con i PDF di riferimento

Dati: 107 turni, 3 jolly, 5 depositi. Confronto tra numerazione attuale e proposta
(`node test/run-optimizer.cjs`):

| Indicatore | Attuale | Proposta |
|---|---:|---:|
| Pause sotto 9h40 | 2 | **0** |
| Pause 9h40–10h | 0 | **0** |
| Ripetizioni della stessa categoria | 18 | **4** |
| Spezzato → primo | 20 | **14** |
| Inversioni | 16 | **13** |
| Disponibili sotto target | 3 | **0** |
| Punteggio totale | 4195 | **2620** |

Dettaglio: **Dolo** 0 ripetizioni e 0 pause; **Cavarzere** 1 ripetizione; **Bojon** 1 ripetizione
e disponibili riportati al target 4; **Padova** 0 ripetizioni, con 2 turni normali fra i disponibili
(massimo possibile); **Fossò** 2 ripetizioni, inevitabili perché ha 5 spezzati su 7 turni.

I numeri possono variare leggermente tra browser e Node perché il browser include nel seed anche
pesi e modalità dei disponibili, mentre il test usa i valori predefiniti; i vincoli (0 pause KO,
disponibili al target) restano stabili.

## Test

```bash
node test/run-core.cjs        # parser dei fixture + confronto con il dataset di riferimento
node test/run-soglie.cjs      # ricalcolo di categorie e jolly al cambiare delle soglie
node test/run-optimizer.cjs   # metriche prima/dopo per tutti i depositi
node test/run-pdf.cjs         # estrazione dei 3 PDF reali in test/pdf e confronto completo
```

`run-pdf.cjs` verifica pagine, cartellini, categorie, orari, depositi, disponibili e jolly contro
`dati/turni-esempio.json`. Se i PDF di prova non sono presenti, il test viene saltato.

## Note tecniche

- **Nessun modulo ES**: tutti gli script sono classici, così funzionano anche con `file://`.
- **pdf.js UMD** è incluso in `js/vendor`; il worker viene precaricato come script per aggirare i
  limiti dei Web Worker su `file://`.
- I PDF ACTV hanno **due cartellini affiancati per pagina** e alcuni sono **ruotati di 90°**.
  `pdf-reader.js` trasforma le coordinate nel viewport, divide la pagina in colonne usando le
  etichette “Monta” e ricostruisce le righe dentro ogni cartellino.
- Il formato dei cartellini è tollerante: l’ordine tra ore decimali e orari `HH:MM` sulla riga
  “Orario” non è più vincolante.
- I dati di esempio sono incorporati in `dati/esempio.js`; i PDF caricati non vengono salvati, ma i
  dati estratti sì.

## Compatibilità

Testato con Chrome/Edge recenti. Richiede un browser con `File`, `Blob`, `localStorage` e pdf.js.
Funziona offline dopo il primo caricamento della cartella.
