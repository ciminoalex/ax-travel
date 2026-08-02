# AX.Travel

Web app mobile per organizzare un viaggio a Londra. Apri l'app, lei guarda dove sei
e ti dice **qual è il prossimo posto da vedere che non hai ancora visitato** e
**come arrivarci coi mezzi**, con un tap per aprire Google Maps.

→ **https://ciminoalex.github.io/ax-travel/**

## Come sceglie il tragitto

Solo mezzi pubblici: auto, taxi e bici sono esclusi a monte.

Velocità e poca camminata sono obiettivi in conflitto — il tragitto più rapido è
spesso quello con quindici minuti a piedi. TfL restituisce più alternative per
ogni tratta e l'app le valuta con un costo composito:

```
costo = durataTotale + minutiAPiedi × penalitàCammino
```

I minuti a piedi sono già dentro la durata totale, quindi risommarli li conta due
volte: con la penalità a 1 (default) un minuto a piedi pesa il doppio di un
minuto seduto in metro. Uno slider in Setup sposta l'ago fra "più veloce" e
"meno a piedi".

Lo stesso criterio governa sia la prossima tappa sia l'ordinamento della giornata.

## Servizi usati

Nessuna API key, nessun account, nessun backend: è un sito statico e tutte le
chiamate partono dal browser.

| Servizio | Ruolo |
|---|---|
| [Photon](https://photon.komoot.io) | Ricerca luoghi su OpenStreetMap |
| [TfL Unified API](https://api.tfl.gov.uk) | Tempi di percorrenza e mezzi |
| Google Maps | Navigazione, via deep link |

I dati del viaggio stanno solo in `localStorage`, sul telefono. Non vengono
inviati da nessuna parte. Da Setup puoi esportarli in JSON come backup.

## Sviluppo

```bash
npm install
npm run dev
npm run build
```

Il deploy è automatico a ogni push su `main`.
