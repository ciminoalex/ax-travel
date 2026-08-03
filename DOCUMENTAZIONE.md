# AX.Travel

Web app mobile per organizzare un viaggio a Londra. Apri l'app, lei guarda dove sei
e ti dice **qual è il prossimo posto da vedere** e **come arrivarci coi mezzi**, con
un tap per aprire Google Maps.

**URL**: <https://ciminoalex.github.io/ax-travel/>

---

## 1. Obiettivi

### Il requisito originale

> Inserire dove alloggio e quali sono i punti di interesse che voglio visitare;
> l'app organizza il giro e, ogni volta che la apro, in base alla posizione
> geografica mi indica la strada comprensiva di mezzi da prendere per arrivare al
> punto di interesse più vicino che non ho marcato come già visitato.

Da cui tre proprietà non negoziabili:

1. **La schermata iniziale risponde a una domanda sola** — *dove vado adesso?* — e
   la risposta include i mezzi, non solo la distanza.
2. **Un tap apre Google Maps** in modalità mezzi pubblici.
3. **L'AI capisce cosa stai inserendo**: scrivi in italiano, in modo approssimativo,
   e ne esce un posto reale con coordinate vere.

### I vincoli che hanno deciso l'architettura

| Vincolo | Conseguenza |
|---|---|
| «Sono a Londra senza PC, solo col telefono» | **Nessun backend, nessuna configurazione lato utente.** Tutte le chiamate partono dal browser verso servizi che non richiedono registrazione. |
| «Limitare al minimo le API key» | Photon e TfL sono senza chiave. L'unica chiave (Anthropic) è opzionale: senza, l'app funziona lo stesso. |
| «Velocità e pochi spostamenti a piedi. Niente auto, solo mezzi pubblici» | Il **costo composito** (§3), applicato ovunque si confrontino due tragitti. |
| Il viaggio iniziava il giorno dopo | Consegna incrementale, deploy automatico a ogni push, correzioni pubblicate in minuti. |

### I requisiti nati sul campo

Aggiunti mentre l'app era già in uso a Londra:

- **Multi-giorno** con distribuzione delle tappe per zona.
- **Disponibilità**: «oggi il museo è pieno» → sposta a domani e bloccalo lì.
- **Prenotazioni vincolanti**: una volta prenotata una fascia oraria sul portale del
  museo, quell'ora è *scolpita* e nessuna riorganizzazione può spostarla.
- **Ripianifica da adesso**: rifà il programma di tutti i giorni tenendo conto
  dell'ora attuale, dei ritardi, di cosa hai già visto.
- **Compressione con avviso**: se il viaggio è sovraccarico, accorcia le visite
  invece di lasciare tappe fuori — dicendolo.
- **Torna in albergo** dalla posizione attuale.

---

## 2. Architettura

### Stack

**Vite 7 + React 19 + TypeScript + Tailwind 3**, build statica in `dist/`,
pubblicata su GitHub Pages tramite GitHub Actions.

- **Niente router**: quattro tab con stato locale. Su GitHub Pages un router con
  path richiede il trucco del `404.html`, complessità non giustificata da quattro
  schermate.
- **Niente backend**: non esiste un server da configurare, quindi non esiste un
  server che possa cadere mentre sei per strada.
- **`localStorage` per i dati**, con auto-save a ogni modifica. In viaggio non deve
  esistere un bottone "salva".

### Servizi esterni

| Servizio | A cosa serve | Chiave | Note |
|---|---|---|---|
| **TfL Unified API** | Tempi e mezzi | Nessuna | ~50 req/min senza app key; CORS aperto |
| **Photon (Komoot)** | Ricerca luoghi | Nessuna | Indicizza OpenStreetMap; CORS aperto |
| **Google Maps** | Navigazione | Nessuna | Solo deep link, nessuna API |
| **Anthropic** | Funzioni AI | La tua, in `localStorage` | Opzionale |

Photon e TfL hanno CORS aperto: è questo che rende possibile eliminare il server.

### Struttura dei file

```
src/
├── App.tsx                 stato del viaggio + tutte le mutazioni + tab bar
├── screens/
│   ├── Now.tsx             "Ora" — la schermata principale
│   ├── DayPlan.tsx         "Giornata" — itinerario, prenotazioni, ottimizzazione
│   ├── AddPoi.tsx          "Aggiungi" — ricerca per nome o testo libero con AI
│   └── Setup.tsx           "Setup" — hotel, criterio, chiave, backup, diagnostica
└── lib/
    ├── types.ts            il modello dati: tutto il resto ne discende
    ├── store.ts            persistenza localStorage, export/import
    ├── geo.ts              haversine, deep link Maps, geolocalizzazione
    ├── tfl.ts              client TfL, normalizzazione risposta, withTimeout
    ├── journeyCost.ts      IL CRITERIO — costo composito, bestJourney, alternative
    ├── nextStop.ts         prossima tappa: pre-filtro, TfL, cache, fallback
    ├── optimize.ts         ordinamento della giornata: nearest-neighbour + 2-opt
    ├── dayOrder.ts         orari, capacità della giornata, prenotazioni, trabocco
    ├── split.ts            distribuzione su N giorni: asse principale + DP
    ├── compress.ts         accorcia le visite quando il programma non ci sta
    ├── photon.ts           ricerca luoghi, ranking, deduplica
    ├── italian.ts          traduzione italiano → inglese per OpenStreetMap
    ├── kinds.ts            etichette leggibili dei tipi OSM
    ├── ai.ts               client Anthropic + schemi Zod
    ├── resolve.ts          verifica sulla mappa dei posti proposti dall'AI
    └── diagnostics.ts      autodiagnosi eseguita sul telefono dell'utente
```

---

## 3. Il criterio: costo composito

È il cuore concettuale dell'app, e vive in **una riga sola** ([journeyCost.ts](src/lib/journeyCost.ts)):

```ts
export function journeyCost(j: Journey, walkPenalty: number): number {
  return j.durationMin + j.walkingMin * walkPenalty
}
```

**Perché funziona.** I minuti a piedi sono *già dentro* `durationMin`: risommarli li
conta due volte. Con `walkPenalty = 1` un minuto a piedi pesa quindi il doppio di un
minuto seduto in metro — esattamente il compromesso richiesto fra velocità e poca
camminata.

```
25 min con  4 a piedi → costo 29   ← vince
22 min con 14 a piedi → costo 36
```

**Dove viene applicato.** Ovunque si confrontino due tragitti: prossima tappa,
matrice dei costi per l'ordinamento della giornata, rientro in albergo. Un solo
criterio, un solo posto in cui vive.

**Regolabile.** Lo slider in Setup muove `walkPenalty` da 0 a 2:
- `0` — conta solo il tempo totale, anche con lunghe camminate
- `1` — equilibrio (default)
- `2` — evita la camminata quasi a ogni costo

**Il secondo parere.** Se il miglior tragitto cammina più di 15 minuti, `bestJourney`
rilancia una volta con `journeyPreference=leastWalking`: TfL a quel punto propone
percorsi che non aveva considerato ottimali a tempo. Sostituisce solo se il costo
composito migliora.

**Solo mezzi pubblici.** Ogni chiamata TfL fissa i modi ammessi ed esclude auto,
taxi e bici:

```
mode=tube,dlr,overground,elizabeth-line,national-rail,bus,walking
```

`walking` resta perché serve per i collegamenti fermata-destinazione.

---

## 4. Modello dati

```ts
type Poi = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  durationMin: number       // quanto ci resto. Default 60

  fullDurationMin?: number  // durata piena, prima della compressione
  visitedAt?: string        // ISO. Se c'è, è visitato — e dà la cronologia gratis
  pinnedDate?: string       // giornata a cui la tappa è legata
  pinnedTime?: string       // PRENOTAZIONE CONFERMATA — vincolo assoluto
  suggestedTime?: string    // proposta dell'app, ricalcolata a ogni ottimizzazione

  category?: string         // campi riempiti dall'AI: l'app funziona senza
  openingHours?: string     // sempre con badge "da verificare"
  bestTimeOfDay?: 'mattina' | 'pomeriggio' | 'sera'
  note?: string
}

type Trip = {
  hotel: Poi | null
  days: { date: string; poiIds: string[] }[]
  pois: Record<string, Poi>   // indicizzati per id
  walkPenalty: number
}
```

### Le decisioni di modellazione che contano

**`visitedAt` come timestamp invece di un booleano.** Gratis si ottiene anche la
cronologia di cosa hai visto e quando.

**POI in una mappa per id, i giorni referenziano gli id.** Spostare un posto da un
giorno all'altro diventa un'operazione banale, e l'AI può arricchire un POI senza
toccare gli itinerari.

**`pinnedTime` vs `suggestedTime`** — la distinzione centrale del sistema
prenotazioni:

| Campo | Significato | Chi lo scrive | Chi può cambiarlo |
|---|---|---|---|
| `suggestedTime` | «arriveresti verso le 14:30» | Ogni ottimizzazione | Riscritto ogni volta |
| `pinnedTime` | «ho prenotato per le 14:30» | Solo tu, confermando | **Nessuno** |

Il flusso è: l'app propone un orario → lo porti al portale del museo → prenoti →
confermi in app → da quel momento è un vincolo che ogni riorganizzazione rispetta.

**`fullDurationMin` rende la compressione reversibile.** Se togli una tappa e
ripianifichi, le altre si riprendono il loro tempo invece di restare compresse per
sempre.

---

## 5. Le schermate

### 5.1 «Ora» — [Now.tsx](src/screens/Now.tsx)

La schermata che guardi per il 90% del tempo. Risponde a una domanda: *dove vado
adesso?*

**Macchina a stati** — quattro fasi distinte, ognuna con il proprio messaggio:

```ts
type State =
  | { phase: 'locating' }   // 📍 "Cerco dove sei…"
  | { phase: 'routing' }    // 🚇 "Calcolo i tempi coi mezzi…"
  | { phase: 'error'; message: string }
  | { phase: 'ready'; pos; stops; degraded; reason?; fromHotel }
```

Le due fasi di caricamento hanno messaggi diversi di proposito: quando la schermata
restava bloccata, un messaggio unico rendeva impossibile capire *quale* dei due
passi non stesse tornando.

#### Componenti

**`BestCard`** — la card grande della prossima tappa. Mostra nome, indirizzo, e i due
numeri con lo stesso peso visivo:

```
   49              🚶 11
MINUTI IN TUTTO   MINUTI A PIEDI
```

I minuti a piedi stanno accanto al totale perché sono il numero che decide se ti
muovi adesso o dopo. Sotto, i mezzi in fila (`🚶 a piedi 9′ → 🚌 bus 15 38′`), e due
bottoni grossi: **Apri in Maps** e **Visitato ✓**.

**`Legs`** — i mezzi in fila con i minuti di ogni tratta. Estratto perché usato in
tre punti diversi.

**`Alternatives`** — *le altre strade possibili*. Si carica su richiesta (è un
secondo giro di chiamate) e mostra l'elenco completo dei percorsi ordinati per costo
composito, con evidenziato quello scelto e i costi agli estremi.

> Esiste perché il criterio composito può preferire un bus lungo a una metro veloce
> quando la metro chiede venti minuti a piedi, e con margini risicati il suggerimento
> sembra arbitrario. Google ordina per sola durata e non pesca dagli stessi dati di
> TfL: vedere l'elenco intero permette di scegliere con la propria testa.

**`DegradedBanner`** — compare quando TfL non ha risposto e l'ordine è per distanza
in linea d'aria. Ha un link «Perché?» che esegue la diagnostica **sul telefono che
ha il problema**: è ciò che rende possibile capire un guasto a distanza da un solo
screenshot.

**`HomeRoute`** — il rientro in albergo. Vive per conto suo e compare in ogni stato
purché l'alloggio sia impostato: serve soprattutto quando le tappe sono finite,
cioè quando il resto della schermata non ha più niente da dire. Si prende la
posizione da sé se non ce l'ha già.

#### Comportamento in difetto

- **GPS che non risponde** → dopo 12 secondi compare «Parti dall'alloggio», e la
  schermata dichiara di aver calcolato da lì e non da dove sei.
- **TfL che non risponde** → ordine per distanza in linea d'aria, con banner e
  motivo esplicito.
- **Tutte le tappe visitate** → 🎉 e il solo rientro in albergo.

---

### 5.2 «Giornata» — [DayPlan.tsx](src/screens/DayPlan.tsx)

L'itinerario del giorno, e tutti i comandi per rimetterlo in ordine.

#### Componenti

**`DayTabs`** — selettore delle giornate. Ogni tab mostra **la data vera** (`oggi`,
`domani`, `mar 5`) e le ore di visita, in ambra se la giornata supera le 7 ore.

> Le etichette «G1 / G2 / G3» sono state rimosse dopo che nascondere il giorno reale
> ha portato a prenotare per la giornata sbagliata.

Contiene anche **«dividi per zona»**: ridistribuisce tutte le tappe su N giorni,
proponendo il numero di giorni sensato in base alle ore totali.

**Il pulsante «🔄 Ripianifica da adesso»** — a tutta larghezza, in gradiente, sopra
tutto il resto perché è quello che si cerca di corsa. Rifà il programma di tutti i
giorni tenendo conto dell'ora attuale, di cosa hai già visto, dei rinvii e delle
prenotazioni. Al termine ottimizza automaticamente la giornata di oggi.

**«⚡ Ottimizza il giro»** — ordina la giornata sui tempi reali di TfL, con barra di
avanzamento (costa decine di chiamate, quindi va chiesto esplicitamente).

**«✨ Stima durate»** — chiede a Claude durate realistiche, orari tipici e momento
migliore per ogni tappa. Disabilitato senza chiave.

**`TimeRow`** — l'orario di una tappa, nei suoi tre stati:

| Stato | Aspetto |
|---|---|
| Nessun orario | `🕐 nessun orario · ho prenotato` |
| Suggerito | `🕐 arrivo previsto 14:30 · ho prenotato` |
| Prenotato | `🎟️ prenotato 14:30 · mar 5 · modifica` (verde) |

Il pannello di modifica chiede **giorno e ora insieme**: prenotare per giovedì non
deve richiedere di spostare prima la tappa a mano. Alla conferma la tappa viene
spostata nella giornata giusta (creandola se il viaggio non arriva fin lì), bloccata,
e la giornata si riordina subito attorno alla nuova prenotazione.

**La lista delle tappe** — ogni riga ha numero d'ordine, durata (con la durata piena
barrata se è stata compressa), categoria, orari «da verificare», nota, frecce ↑↓ e
una riga di azioni:

- **Visitato ✓ / Da rivedere** — marca e smarca
- **Sposta →** — a un'altra giornata
- **Non oggi** — «oggi il museo è pieno»: sposta a domani **e blocca lì**, altrimenti
  la prima riorganizzazione lo riporterebbe indietro
- **📌** — blocca o libera la tappa nella giornata in cui si trova
- **Rimuovi**

**Il pannello `notice`** — l'esito di ogni operazione, riga per riga: quante tappe
sono state spostate, quanto sono state accorciate le visite, quali arriverebbero
dopo la chiusura, di quanti minuti si arriverebbe tardi a una prenotazione.

---

### 5.3 «Aggiungi» — [AddPoi.tsx](src/screens/AddPoi.tsx)

Due modi di aggiungere un posto, in due tab.

#### `SearchPanel` — ricerca per nome

Input con debounce di 600 ms su Photon (il debounce non è cosmetico: è rispetto della
usage policy di un servizio gratuito). Ogni risultato mostra tre informazioni:

```
British Museum                    🏛️ museo
Great Russell Street, Bloomsbury, WC1B 3DG
1.2 km dall'alloggio
```

**Categoria e distanza sono ciò che distingue due risultati con lo stesso nome** —
senza, «Big Ben» restituiva due voci indistinguibili: la torre e una pescheria. Le
tappe già presenti nella giornata appaiono in grigio come «già nella giornata».

#### `AiPanel` — testo libero

Due bottoni, due funzioni distinte:

- **Estrai i posti** — incolli `"british museum, camden, la casa di sherlock"` e ne
  esce la lista strutturata.
- **Proponi tu** — `"cosa vedo vicino a Covent Garden?"` → proposte, sapendo cosa hai
  già in programma.

I risultati sono selezionabili singolarmente; quelli non trovati sulla mappa appaiono
con ⚠️ e **non sono aggiungibili**.

> **L'AI non produce mai coordinate.** Restituisce una query di ricerca che passa da
> Photon: se il posto non esiste su OpenStreetMap, non entra nell'itinerario. È il
> punto in cui un luogo allucinato viene fermato.

Senza chiave configurata il pannello spiega a cosa servirebbe e rimanda a Setup.

---

### 5.4 «Setup» — [Setup.tsx](src/screens/Setup.tsx)

Sei sezioni.

**`HotelSection`** — l'alloggio, cercato con Photon. È il riferimento per le distanze
nella ricerca e il punto di partenza di ripiego quando il GPS non risponde.

**`WalkPenaltySection`** — lo slider «Più veloce ↔ Meno a piedi», con etichetta
descrittiva e la traduzione in chiaro del valore:

> *Un minuto a piedi pesa come 2 minuti sui mezzi.*

**`AiKeySection`** — la chiave Anthropic. **Viene verificata subito con una chiamata
da 1 token**: scoprire una chiave sbagliata più tardi, per strada con le mani
occupate, è il momento peggiore. Se il test fallisce la chiave non viene salvata.

> La chiave vive solo in `localStorage` su questo telefono. Il repo è pubblico ma la
> chiave non è mai nel codice: chi apre l'URL trova un'app vuota che non consuma
> nulla.

**`BackupSection`** — export e import JSON dell'intero viaggio. I dati stanno solo
sul telefono: svuotare la cache del browser li perde.

**`DiagnosticsSection`** — prova le connessioni e riporta cosa succede *su questo
telefono*: supporto del browser, TfL, Photon, con i tempi di risposta.

**`VersionSection`** — data e ora della build in esecuzione, più «Forza
aggiornamento» che svuota le cache e ricarica.

> Sapere quale versione gira sul telefono è l'unico modo, a distanza, di distinguere
> «il fix non funziona» da «il fix non è ancora arrivato». Un service worker che non
> si aggiornava ha silenziosamente bloccato una correzione già corretta.

---

## 6. Gli algoritmi

### 6.1 Prossima tappa — [nextStop.ts](src/lib/nextStop.ts)

```
1. scarta i visitati
2. pre-filtro haversine → i 4 più vicini in linea d'aria
3. chiede a TfL i tempi reali solo per quei 4, in parallelo
4. ordina per costo composito
```

**Perché il passo 3 esiste**: a Londra un posto a 3 km con la metro diretta batte
spesso uno a 1,5 km raggiungibile solo a piedi. Il pre-filtro geometrico serve solo a
non interrogare TfL su tutte le tappe; 4 candidati danno margine perché il più
lontano possa comunque vincere.

**Cache** in `sessionStorage`, TTL 5 minuti, chiave = *(posizione arrotondata a
~100 m, penalità, insieme dei POI rimanenti)*. Riaprire l'app tre volte in due minuti
non vale tre giri di chiamate; segnare una tappa come visitata invalida
correttamente il risultato.

**Degradazione**: se *nessuno* dei candidati interrogati risponde, si ordina per
distanza in linea d'aria (4,5 km/h, volutamente pessimista) con banner e motivo. Le
tappe oltre le prime 4 sono stimate *per scelta*, non per guasto — per questo
`degraded` viene **memorizzato nella cache** e non ridedotto.

### 6.2 Ordinamento della giornata — [optimize.ts](src/lib/optimize.ts)

Due stadi classici, con un vincolo in più.

**Matrice dei costi** — `bestJourney` fra ogni coppia di tappe. Due accorgimenti per
restare sotto i ~50 req/min di TfL:

- **Simmetria**: solo i tratti *i<j*, riusando il valore per il verso opposto
  (8 tappe: 72 → 36 chiamate).
- **Pausa di 250 ms** fra le richieste: senza, la seconda metà torna vuota.

Massimo 8 tappe ottimizzate; le eccedenti restano in coda nell'ordine in cui erano.

La funzione restituisce **due matrici**: `matrix` con il costo composito (per
ordinare) e `minutes` con i minuti veri (per dire a che ora arrivi). Penalizzare la
camminata falserebbe gli orari.

**Nearest-neighbour con l'orologio in mano** — non basta che le prenotazioni si
susseguano in ordine cronologico. A ogni passo, se c'è una prenotazione in attesa, si
infila una tappa libera *solo se si fa ancora in tempo ad arrivarci*:

```ts
if (leave + minutes[j][nextAnchor] > deadline) continue
```

Senza questo controllo una prenotazione delle 14:30 finisce in fondo alla giornata e
per rispettarla bisognerebbe partire all'alba.

**2-opt vincolato** — scioglie gli incroci che il greedy lascia sempre, ma un
segmento invertito può capovolgere due prenotazioni. Una mossa è accettata solo se il
*lateness* non peggiora:

```ts
function lateness(schedule): [count: number, minutes: number]
```

Il conteggio da solo non basta: con un ritardo ormai inevitabile ogni ordine ne manca
una, e senza guardare i minuti si finisce per scegliere quello che arriva cinque ore
tardi invece di una.

### 6.3 Distribuzione su N giorni — [split.ts](src/lib/split.ts)

Due obiettivi in una volta sola, perché deciderli in sequenza non funziona.

> Raggruppare prima per zona e pareggiare le ore dopo lascia giornate da undici ore
> che nessuno spostamento locale riesce più a sbloccare. Un k-means, davanti a una
> tappa isolata come Canary Wharf, le dedica volentieri un giorno intero da un'ora.

**Passo 1 — `orderAlongMainAxis`**: le tappe vengono ordinate lungo la direzione in
cui il viaggio si sviluppa davvero. L'asse è l'**autovettore principale della
covarianza** delle posizioni (a Londra quasi sempre est-ovest), con la longitudine
scalata per `cos(lat)`. Ricavato dai dati, non assunto.

**Passo 2 — `partitionByTime`**: la sequenza viene tagliata in N tratti con ore il
più possibile pari, tramite **programmazione dinamica** che minimizza lo scarto
quadratico dal target per giornata. Tagliare una sequenza ordinata tiene insieme le
tappe vicine per costruzione: ogni giornata è un tratto continuo di città.

Due raffinamenti:
- **`preloadMin`** — le ore già occupate da prenotazioni bloccate in quel giorno.
- **`capacityMin`** — quanto quella giornata può davvero reggere, con
  `OVER_PENALTY = 4` sullo sforamento: una giornata leggera si riempie a piacere, una
  troppo carica finisce a musei chiusi.

### 6.4 Orari e capacità — [dayOrder.ts](src/lib/dayOrder.ts)

```ts
DAY_START_MIN = 9 * 60        // 09:00
DAY_END_MIN = 20 * 60         // oltre, i musei hanno chiuso
COMFORTABLE_DAY_MIN = 6 * 60  // ore di visita ragionevoli in un giorno
VISIT_SHARE = 0.72            // quota del tempo che diventa davvero visita
```

**`dayStartMinutes(date)`** — per *oggi* è **adesso**: se sono le 12:15, pianificare
una tappa alle 11:00 non serve a niente. Per gli altri giorni si parte dalle 9:00.

**`dayCapacityMinutes(date)`** — quante ore di visita restano davvero. `VISIT_SHARE`
esiste perché fra tre tappe ci sono tre tragitti, che a Londra valgono un'ora e mezza:
contare la finestra intera come tempo di visita produce programmi che finiscono dopo
la chiusura.

**`orderByBookings(pois, startMin)`** — mette in fila le tappe rispettando le
prenotazioni, con una stima di 25 minuti per spostamento. Serve a chi riorganizza
*senza* passare da «Ottimizza il giro»: quello usa i tempi reali di TfL ma costa
decine di chiamate.

**`spillOverflow(days)`** — fa scivolare al giorno seguente le tappe che non entrano
prima della chiusura. Non tocca le tappe con una data fissata.

### 6.5 Compressione — [compress.ts](src/lib/compress.ts)

Di fronte a un programma sovraccarico ci sono due strade: lasciare fuori delle tappe,
o vederle tutte con meno calma. **La seconda è quasi sempre preferibile in viaggio**
— un'ora al British Museum è meglio di zero — ma va detto, non fatto di nascosto.

- Taglio **proporzionale al margine** di ciascuna tappa: chi ha tre ore ne cede più
  di chi ne ha una.
- `ABSOLUTE_FLOOR_MIN = 30` — sotto non ha senso entrare da nessuna parte.
- `MAX_CUT = 0.4` — nessuna visita perde più del 40%.
- **Sempre reversibile**: si riparte dalle durate piene, così togliendo una tappa le
  altre si riprendono il tempo.
- `stillOver` dichiara i minuti che restano di troppo anche dopo il taglio massimo.

### 6.6 Ripianifica da adesso — [App.tsx](src/App.tsx)

L'operazione più complessa, in ordine:

1. **Separa** visitati da pendenti. Il passato non si tocca.
2. **Riallinea le date a oggi.** Un viaggio le cui giornate sono rimaste indietro
   produce piani per il giorno sbagliato. Le prenotazioni vengono traslate dello
   stesso scarto — le hai scelte come «G1», non come «5 agosto» — e il riepilogo lo
   dichiara esplicitamente, invitando a controllare i biglietti.
3. **Isola le tappe bloccate** (`pinnedDate`). Una prenotazione in un giorno ormai
   passato torna libera invece di sparire dal programma.
4. **Comprime** per far stare tutto nella capacità totale.
5. **Distribuisce** il resto con `splitByArea`, passando preload e capacità.
6. **Ordina** ogni giornata con `orderByBookings`, poi applica `spillOverflow`.
7. **Restituisce un `ReplanSummary`** con tutto ciò che è cambiato.

> Il piano si calcola **prima** di `setTrip`, non dentro l'updater: React può
> eseguirlo più tardi o due volte, e il riepilogo tornerebbe vuoto.

---

## 7. Il livello linguistico

### [italian.ts](src/lib/italian.ts) — italiano → OpenStreetMap

I posti di Londra su OSM hanno il nome inglese. Cercare «museo di storia naturale»
trova musei in Italia, che il filtro geografico scarta: il risultato è una lista
vuota su un posto che esiste eccome. (`lang=it` non aiuta: Photon restituisce zero
risultati.)

Tre livelli:

- **`LANDMARKS`** (~35 voci) — i posti che si cercano davvero in italiano, con il
  nome OSM esatto: `'torre di londra' → 'Tower of London'`, `'binario 9 3 4' →
  "King's Cross"`. Include i casi in cui il nome ovvio è sbagliato: «Kew Gardens»
  trova la stazione ferroviaria, il giardino è `Royal Botanic Gardens Kew`.
- **`GLOSSARY`** (~90 voci) — termini generici: `museo→museum`, `ponte→bridge`,
  `birreria→pub`.
- **`STOPWORDS`** — articoli e preposizioni. Confrontare senza di essi fa sì che
  «museo **di** storia naturale» e «museo **della** storia naturale» siano la stessa
  richiesta, senza elencare ogni variante nel dizionario.

Se la traduzione non produce risultati si riprova con il testo originale: forse era
già un nome proprio («Camden», «Soho»).

### [photon.ts](src/lib/photon.ts) — ranking

Photon indicizza tutto OSM, quindi «british museum» restituisce il museo, la fermata
del bus e la rastrelliera per bici con lo stesso nome.

- **`REJECT_VALUES`** — arredo urbano, elementi della rete stradale, infrastruttura
  ferroviaria. Le stazioni restano: sono destinazioni.
- **`REJECT_KEYS`** — solo `barrier`, `traffic_calming`, `power`, `emergency`.
  **`highway` non è qui**: Oxford Street, Abbey Road, Brick Lane e Portobello Road
  sono `highway` in OSM, ed escluderle in blocco le rendeva introvabili. Il rumore è
  tenuto giù dal punteggio (`KEY_SCORE.highway = 15`), non da un veto.
- **Il match esatto domina la distanza**: chi cerca «british museum» vuole il British
  Museum in cima, non il museo omonimo due strade più vicino al centro.
- **Dedup a soglia variabile**: 250 m in generale, **5 km per strade e ferrovie** —
  Oxford Street è lunga quasi due chilometri e su OSM è spezzata in segmenti, che
  altrimenti occupano mezza lista.

### [kinds.ts](src/lib/kinds.ts) — etichette leggibili

OSM dice cos'è ogni posto, ma in inglese e a bassa leggibilità (`shop=seafood`).
`describeKind` traduce in `{icon, label}` italiano: `clock → 🕰️ orologio`,
`seafood → 🐟 pescheria`. Senza, due risultati chiamati entrambi «Big Ben» sono
indistinguibili.

---

## 8. Le funzioni AI — [ai.ts](src/lib/ai.ts)

Modello `claude-opus-5`, structured output con `messages.parse()` + `zodOutputFormat`,
`effort: 'low'`, `max_tokens: 8000`.

> `max_tokens` copre thinking + risposta: su Opus 5 il thinking è attivo di default,
> quindi 8000 è margine necessario, non spreco.

`dangerouslyAllowBrowser: true` non è opzionale: senza, l'SDK non invia l'header che
serve ad Anthropic per accettare la richiesta via CORS.

### Le quattro funzioni

| Funzione | Input | Output |
|---|---|---|
| `parsePlaces` | testo libero | lista di posti strutturati |
| `suggestPlaces` | richiesta + contesto | 3-6 proposte, senza ripetere il programma |
| `enrichPlaces` | id + nomi | durata realistica, orari, momento migliore, nota |
| `reorderDay` | tappe + ordine calcolato | ordine rifinito + motivazione |

### Le due difese

**Le coordinate non vengono mai dal modello.** `PlaceSchema` chiede una
`searchQuery` — il nome inglese esatto con cui il posto è mappato su OSM — che passa
da `resolvePlaces` → Photon. Se non esiste sulla mappa, non entra.

**Il riordino è validato come permutazione.** Se la risposta non contiene esattamente
gli stessi id, tutti e una volta sola, si tiene l'ordine calcolato:

```ts
const expected = [...baselineIds].sort().join(',')
const got = [...out.orderedIds].sort().join(',')
if (expected !== got) return null
```

Un'allucinazione può peggiorare l'ordine, non corrompere l'itinerario.

**Nota sugli schemi**: i campi enumerativi sono `z.string()` e non `z.enum()`, perché
l'helper zod→JSON Schema non traduce gli enum in vincoli veri — li mette solo nella
descrizione. Un valore fuori lista farebbe fallire la validazione e perderebbe
l'intera risposta: meglio accettare e normalizzare a valle.

---

## 9. Robustezza

L'app è usata camminando, in roaming, in metropolitana. **Nessun servizio di terzi
può bloccarla.**

| Guasto | Comportamento |
|---|---|
| TfL non risponde | Ordine per distanza in linea d'aria, banner col motivo |
| TfL lento | Timeout a 15 s (in roaming la rete è più lenta che sotto wifi) |
| GPS muto | Guard timeout a 12 s → «Parti dall'alloggio» |
| Photon giù | Ricerca in errore, il resto dell'app funziona |
| Chiave AI assente | Tutte le funzioni non-AI restano intatte |
| `localStorage` pieno | Il salvataggio salta, la schermata non crasha |
| JSON corrotto | `loadTrip` ritorna un viaggio vuoto invece di lanciare |

**`withTimeout`** ([tfl.ts](src/lib/tfl.ts)) è costruito su `AbortController` e non
su `AbortSignal.any` / `AbortSignal.timeout`:

> Quelle due arrivano solo con Safari 17.4 e 16. Su un iPhone più indietro lanciano
> un errore che fa fallire *ogni* richiesta — l'app ripiegherebbe sempre sulla
> distanza in linea d'aria senza dire perché.

**`openMaps`** ([geo.ts](src/lib/geo.ts)) naviga nella stessa scheda invece di usare
`target="_blank"`:

> Ogni tap creava una scheda Safari nuova che restava lì: dopo una decina il browser
> si impianta e serve un refresh. Navigare nella stessa scheda lascia intervenire
> l'universal link — Maps si apre come app e la pagina resta raggiungibile col back.
> Se l'app è installata sulla home non c'è nessun back a cui tornare: lì serve
> davvero aprire fuori, ma una scheda per volta.

---

## 10. PWA e deploy

**Manifest + service worker** (`vite-plugin-pwa`, `registerType: 'autoUpdate'`) per
installare l'app dalla home del telefono. `skipWaiting` e `clientsClaim` sono
obbligatori:

> Senza, una correzione pubblicata non raggiunge un telefono che ha già l'app
> installata finché non svuota la cache: il vecchio service worker resta in carica a
> tempo indeterminato.

**Le API di rete non vanno mai in cache «stale»**: i tempi di viaggio devono essere
freschi. Solo Photon ha un `NetworkFirst` con 24 h di scadenza. L'itinerario sta in
`localStorage`, quindi resta leggibile offline.

**`__BUILD_TIME__`** è iniettato da Vite e mostrato in Setup e nel pannello
diagnostica: è il modo per sapere a distanza quale versione gira davvero.

**Deploy**: GitHub Actions builda e pubblica su Pages a ogni push su `main`.
`base: '/ax-travel/'` in `vite.config.ts`. La geolocalizzazione richiede HTTPS:
Pages lo è.

```bash
npm run dev        # sviluppo
npm run build      # tsc -b && vite build
npm run typecheck  # solo controllo dei tipi
```

---

## 11. Limiti noti

- **Gli orari di apertura vengono dalla conoscenza del modello**, non da una fonte
  autorevole. Mostrati sempre col badge «da verificare».
- **TfL senza app key** ha un rate limit di ~50 req/min. Per un utente solo non è un
  problema; la key è gratuita e si aggiunge in un minuto se lo diventasse.
- **La matrice dei costi è simmetrica.** Andata e ritorno non sono identici — sensi
  unici, frequenze diverse — ma per decidere un ordine l'approssimazione regge, e il
  tempo mostrato in «Ora» resta comunque quello vero, calcolato a parte.
- **Massimo 8 tappe ottimizzate** per giornata: oltre, il numero di chiamate cresce
  troppo.
- **TfL e Google Maps non pescano dagli stessi dati**: qualche percorso lo vede solo
  uno dei due. Da qui il pannello «Altre strade possibili».
- **I dati stanno solo sul telefono.** Nessuna sync, nessun backup automatico:
  esportare ogni tanto è l'unica rete di sicurezza.
- **Photon è un servizio gratuito senza SLA.** Se cade, il fallback naturale è
  Nominatim, stessa forma di risposta.

---

## 12. Fuori scope

Meteo per scegliere indoor/outdoor, budget, sync multi-dispositivo, foto per tappa,
prenotazioni effettuate dall'app.
