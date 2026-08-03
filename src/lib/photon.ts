import { haversineM } from './geo'
import { toEnglishQuery } from './italian'
import { withTimeout } from './tfl'

const ENDPOINT = 'https://photon.komoot.io/api/'

/** Centro di Londra: fa da bias per l'autocomplete. */
const LONDON = { lat: 51.5074, lng: -0.1278 }

export type PlaceHit = {
  name: string
  address: string
  lat: number
  lng: number
  /** osm_value, es. "museum", "seafood". Distingue la torre dalla pescheria. */
  kind: string
  /** osm_key, es. "tourism", "shop". Fallback quando il valore è insolito. */
  kindKey: string
}

type PhotonProps = {
  name?: string
  street?: string
  housenumber?: string
  locality?: string
  district?: string
  city?: string
  postcode?: string
  countrycode?: string
  osm_key?: string
  osm_value?: string
}
type PhotonFeature = {
  properties: PhotonProps
  geometry: { coordinates: [number, number] }
}

/**
 * Photon indicizza tutto OpenStreetMap, quindi cercando "british museum"
 * restituisce il museo ma anche la fermata del bus e la rastrelliera per
 * bici che portano lo stesso nome. Questi non sono posti da visitare.
 */
const REJECT_VALUES = new Set([
  // Arredo urbano e servizi: non sono posti da visitare.
  'bus_stop', 'bus_station', 'bicycle_rental', 'bicycle_parking', 'parking',
  'parking_entrance', 'street_lamp', 'bench', 'waste_basket', 'post_box',
  'telephone', 'atm', 'recycling', 'taxi', 'car_sharing', 'charging_station',
  'toilets', 'drinking_water',
  // Elementi della rete stradale, non luoghi.
  'crossing', 'traffic_signals', 'stop', 'give_way', 'turning_circle',
  'turning_loop', 'mini_roundabout', 'motorway_junction', 'milestone',
  'passing_place', 'speed_camera', 'elevator', 'services', 'rest_area',
  'construction', 'proposed', 'platform', 'emergency_access_point',
  // Infrastruttura ferroviaria (le stazioni restano: sono destinazioni).
  'rail', 'switch', 'signal', 'level_crossing', 'buffer_stop',
  'subway_entrance', 'railway_crossing',
])

/**
 * Famiglie da scartare per intero. `highway` NON è qui: Oxford Street,
 * Abbey Road, Brick Lane e Portobello Road sono `highway` in OSM, e
 * scartarle in blocco le rendeva introvabili. Il rumore delle strade
 * senza nome cercato è tenuto giù dal punteggio, non da un veto.
 */
const REJECT_KEYS = new Set(['barrier', 'traffic_calming', 'power', 'emergency'])

/** Quanto è "un posto da visitare". Più alto = più su nella lista. */
const KEY_SCORE: Record<string, number> = {
  tourism: 100,
  historic: 95,
  leisure: 70,
  amenity: 50,
  shop: 45,
  building: 30,
  place: 25,
  // Basso di proposito: una via emerge quando la cerchi per nome (il match
  // esatto vale molto di più), non quando cerchi altro.
  highway: 15,
  railway: 15,
}

/** Oltre questo raggio non è più "un posto da vedere a Londra". */
const MAX_KM_FROM_LONDON = 50

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  // OSM ha i nomi in inglese: "museo di storia naturale" troverebbe solo
  // musei italiani, che il filtro geografico scarta lasciando una lista
  // vuota su un posto che esiste.
  const english = toEnglishQuery(q)

  if (english) {
    const hits = await runSearch(english, signal)
    if (hits.length > 0) return hits
    // La traduzione non ha prodotto nulla: forse era già un nome proprio
    // ("Camden", "Soho"). Riproviamo con quello che hai scritto davvero.
  }

  return runSearch(q, signal)
}

async function runSearch(q: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const params = new URLSearchParams({
    q,
    lat: String(LONDON.lat),
    lon: String(LONDON.lng),
    limit: '15', // chiediamo largo perché filtriamo parecchio
    lang: 'en',
  })

  const res = await fetch(`${ENDPOINT}?${params}`, { signal: withTimeout(signal, 9000) })
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`)

  const data = (await res.json()) as { features?: PhotonFeature[] }
  return rank(data.features ?? [], q).slice(0, 6)
}

/** "The British Museum" e "british museum" devono confrontarsi uguali. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritici, dopo la scomposizione NFD
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function rank(features: PhotonFeature[], query: string): PlaceHit[] {
  const q = normalize(query)
  const qWords = q.split(' ').filter(Boolean)
  const scored: { hit: PlaceHit; score: number }[] = []

  for (const f of features) {
    const p = f.properties
    if (p.osm_key && REJECT_KEYS.has(p.osm_key)) continue
    if (p.osm_value && REJECT_VALUES.has(p.osm_value)) continue

    // Senza nome è un indirizzo, non un posto: ripieghiamo sulla via.
    const name = p.name ?? p.street
    if (!name) continue

    const [lng, lat] = f.geometry.coordinates
    const distanceKm = haversineM({ lat, lng }, LONDON) / 1000
    if (distanceKm > MAX_KM_FROM_LONDON) continue

    // Quanto il nome risponde a ciò che hai scritto. Domina sul resto:
    // chi cerca "british museum" vuole il British Museum in cima, non il
    // museo omonimo che sta due strade più vicino al centro.
    const n = normalize(name)
    let score = 0
    if (n === q) score += 300
    else if (n.startsWith(q)) score += 180
    else if (qWords.every((w) => n.includes(w))) score += 90

    // A parità di match, il nome più aderente vince: scarta "British Museum
    // Cafe" a favore di "British Museum".
    score -= Math.max(0, n.length - q.length) * 0.6

    score += KEY_SCORE[p.osm_key ?? ''] ?? 10
    score -= distanceKm / 4

    scored.push({
      hit: {
        name,
        address: formatAddress(p),
        lat,
        lng,
        kind: p.osm_value ?? '',
        kindKey: p.osm_key ?? '',
      },
      score,
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return dedupe(scored.map((s) => s.hit))
}

/**
 * Lo stesso posto compare più volte: come nodo e come area, o — per una
 * via — spezzato nei segmenti che la compongono. Oxford Street è lunga
 * quasi due chilometri, quindi per le strade la soglia dev'essere molto
 * più larga, altrimenti la stessa via occupa mezza lista.
 */
function dedupe(hits: PlaceHit[]): PlaceHit[] {
  const out: PlaceHit[] = []
  for (const h of hits) {
    const limit = h.kindKey === 'highway' || h.kindKey === 'railway' ? 5000 : 250
    const dup = out.some((o) => o.name === h.name && haversineM(o, h) < limit)
    if (!dup) out.push(h)
  }
  return out
}

function formatAddress(p: PhotonProps): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const area = p.district ?? p.locality ?? p.city
  return [street, area, p.postcode].filter(Boolean).join(', ')
}
