/**
 * Photon indicizza OpenStreetMap, dove i posti di Londra hanno il nome
 * inglese. Cercare "museo di storia naturale" trova musei in Italia, che il
 * filtro geografico poi scarta: il risultato è una lista vuota su un posto
 * che esiste eccome. Qui traduciamo la query prima di spedirla.
 *
 * (`lang=it` non aiuta: verificato che Photon restituisce zero risultati.)
 */

/** I posti che si cercano davvero in italiano, con il nome OSM esatto. */
const LANDMARKS: Record<string, string> = {
  'museo di storia naturale': 'Natural History Museum',
  'museo storia naturale': 'Natural History Museum',
  'museo britannico': 'British Museum',
  'museo della scienza': 'Science Museum',
  'museo delle cere': 'Madame Tussauds',
  'museo del design': 'Design Museum',
  'museo dei trasporti': 'London Transport Museum',
  'museo di guerra': 'Imperial War Museum',
  'museo victoria e alberto': 'Victoria and Albert Museum',
  'galleria nazionale': 'National Gallery',
  'galleria dei ritratti': 'National Portrait Gallery',
  'torre di londra': 'Tower of London',
  'ponte della torre': 'Tower Bridge',
  'ponte di londra': 'London Bridge',
  'palazzo di buckingham': 'Buckingham Palace',
  'reggia di buckingham': 'Buckingham Palace',
  'palazzo reale': 'Buckingham Palace',
  'palazzo di westminster': 'Houses of Parliament',
  'parlamento': 'Houses of Parliament',
  'abbazia di westminster': 'Westminster Abbey',
  'cattedrale di san paolo': "St Paul's Cathedral",
  'occhio di londra': 'London Eye',
  'ruota panoramica': 'London Eye',
  'mercato di camden': 'Camden Market',
  'mercato di borough': 'Borough Market',
  'mercato di portobello': 'Portobello Road Market',
  // In OSM il giardino botanico è "Royal Botanic Gardens, Kew": cercare
  // "Kew Gardens" trova la stazione ferroviaria e un hotel.
  'giardini di kew': 'Royal Botanic Gardens Kew',
  'kew gardens': 'Royal Botanic Gardens Kew',
  'castello di windsor': 'Windsor Castle',
  'piazza trafalgar': 'Trafalgar Square',
  'piazza piccadilly': 'Piccadilly Circus',
  'osservatorio di greenwich': 'Royal Observatory Greenwich',
  'cambio della guardia': 'Buckingham Palace',
  'stazione di king s cross': "King's Cross",
  'binario 9 3 4': "King's Cross",
}

/** Termini generici: coprono i posti che non stanno in nessuna lista. */
const GLOSSARY: Record<string, string> = {
  museo: 'museum', musei: 'museums', galleria: 'gallery', mostra: 'exhibition',
  storia: 'history', storico: 'historic', storica: 'historic', naturale: 'natural',
  scienza: 'science', scienze: 'science', arte: 'art', arti: 'arts',
  torre: 'tower', ponte: 'bridge', palazzo: 'palace', reggia: 'palace',
  castello: 'castle', cattedrale: 'cathedral', chiesa: 'church', abbazia: 'abbey',
  monumento: 'monument', statua: 'statue', memoriale: 'memorial',
  mercato: 'market', mercatino: 'market', negozio: 'shop', libreria: 'bookshop',
  parco: 'park', giardino: 'garden', giardini: 'gardens', bosco: 'wood',
  piazza: 'square', strada: 'street', via: 'street', viale: 'avenue',
  quartiere: 'district', stazione: 'station', porto: 'port', molo: 'pier',
  teatro: 'theatre', cinema: 'cinema', biblioteca: 'library', stadio: 'stadium',
  acquario: 'aquarium', zoo: 'zoo', osservatorio: 'observatory',
  cimitero: 'cemetery', ospedale: 'hospital', universita: 'university',
  ristorante: 'restaurant', birreria: 'pub', taverna: 'pub', caffe: 'cafe',
  fiume: 'river', canale: 'canal', lago: 'lake', collina: 'hill',
  cere: 'wax', reale: 'royal', reali: 'royal', nazionale: 'national',
  san: 'saint', santa: 'saint', santo: 'saint', sant: 'saint',
  vecchio: 'old', nuovo: 'new', grande: 'great', piccolo: 'little',
}

/** Parole che in inglese non servono e sporcano solo la ricerca. */
const STOPWORDS = new Set([
  'di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', "dell",
  'il', 'lo', 'la', 'i', 'gli', 'le', "l",
  'un', 'uno', 'una', "un'",
  'a', 'al', 'allo', 'alla', 'ai', 'agli', 'alle',
  'da', 'dal', 'dalla', 'in', 'nel', 'nella', 'con', 'su', 'sul', 'per',
  'e', 'ed', 'che', 'dove',
])

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * La query da mandare a Photon, o null se non c'è niente da tradurre
 * (query già in inglese: va lasciata intatta).
 */
export function toEnglishQuery(query: string): string | null {
  const n = normalize(query)
  if (!n) return null

  // Match su un landmark noto: è il caso più frequente e il più preciso.
  for (const [it, en] of Object.entries(LANDMARKS)) {
    if (n === it || n.includes(it)) return en
  }

  const words = n.split(' ')
  let changed = false
  const out: string[] = []

  for (const w of words) {
    if (STOPWORDS.has(w)) {
      changed = true // togliere "di" è già una traduzione
      continue
    }
    const en = GLOSSARY[w]
    if (en) {
      changed = true
      out.push(en)
    } else {
      out.push(w)
    }
  }

  if (!changed || out.length === 0) return null
  const translated = out.join(' ')
  return translated === n ? null : translated
}
