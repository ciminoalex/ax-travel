import type { Poi, ScoredStop } from './types'
import { coarse, haversineM, type LatLng } from './geo'
import { bestJourney, journeyCost } from './journeyCost'
import { parseTime } from './optimize'

/**
 * Quanti candidati interrogare su TfL. Il pre-filtro geometrico è solo un
 * modo per non chiedere i tempi di tutti: 4 dà margine perché un POI più
 * lontano in linea d'aria ma con la metro diretta possa comunque vincere.
 */
const CANDIDATES = 4

const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * L'esito va memorizzato, non ridedotto: le tappe oltre le prime CANDIDATES
 * sono sempre `estimated` perché non le interroghiamo affatto, quindi
 * ricalcolare "è degradato?" guardando le tappe in cache dava sempre sì.
 */
type CacheEntry = { at: number; stops: ScoredStop[]; degraded: boolean; reason?: string }

/**
 * Riaprire l'app tre volte in due minuti non deve valere tre giri di
 * chiamate. La chiave include i POI rimanenti: appena ne segni uno come
 * visitato, il risultato è giustamente invalidato.
 */
function cacheKey(pos: LatLng, pois: Poi[], walkPenalty: number): string {
  const ids = pois.map((p) => p.id).sort().join(',')
  return `ax-travel:next:${coarse(pos)}:${walkPenalty}:${ids}`
}

function readCache(key: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (Date.now() - entry.at > CACHE_TTL_MS) return null
    return entry
  } catch {
    return null
  }
}

function writeCache(key: string, entry: Omit<CacheEntry, 'at'>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), ...entry } satisfies CacheEntry))
  } catch {
    // Cache piena: non è un errore che debba interrompere il viaggio.
  }
}

export type NextStopsResult = {
  stops: ScoredStop[]
  /** true se TfL non ha risposto e stiamo ordinando per distanza in linea d'aria. */
  degraded: boolean
  /** Perché è degradato: senza, il ripiego sembra un capriccio. */
  reason?: string
}

/**
 * Quanto si è disposti ad aspettare davanti a un ingresso.
 *
 * Sotto questa soglia una prenotazione è "il posto dove andare adesso":
 * ci arrivi e aspetti un quarto d'ora, va bene. Sopra, proporla sarebbe
 * mandarti a fare anticamera per ore.
 */
const EARLY_TOLERANCE_MIN = 30

/** Stima pessimista quando TfL non ha risposto: 4,5 km/h, tutto a piedi. */
function walkEstimateMin(straightLineM: number): number {
  return Math.round((straightLineM / 4500) * 60)
}

/** L'orario della prenotazione *di oggi*, in minuti dalla mezzanotte. */
function bookingMinutes(poi: Poi, now: Date): number | null {
  if (!poi.pinnedTime) return null
  const today = now.toISOString().slice(0, 10)
  if (poi.pinnedDate && poi.pinnedDate !== today) return null
  return parseTime(poi.pinnedTime)
}

/**
 * Rimette in fila le tappe tenendo conto degli orari, non solo della
 * distanza.
 *
 * Il costo composito da solo diceva "Harrods, 22 minuti" mentre avevi un
 * biglietto per le 14:20 altrove: una risposta rapida e sbagliata. Un
 * orario prenotato non è una preferenza, è un vincolo — e prima del suo
 * momento quella tappa non è nemmeno raggiungibile.
 *
 * L'ordine che ne esce:
 *   1. le prenotazioni per cui è ora di muoversi, la più imminente prima
 *   2. le tappe libere, per costo composito
 *   3. le tappe libere che ti farebbero perdere la prenotazione
 *   4. le prenotazioni ancora troppo lontane
 *
 * Resta una funzione pura sull'orologio, così il risultato in cache non
 * invecchia con l'ora: le annotazioni si ricalcolano a ogni lettura.
 */
export function orderByAvailability(stops: ScoredStop[], now = new Date()): ScoredStop[] {
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const travelOf = (s: ScoredStop) => s.journey?.durationMin ?? walkEstimateMin(s.straightLineM)

  const rows = stops.map((s) => {
    const booked = bookingMinutes(s.poi, now)
    return { stop: s, booked, arrive: nowMin + travelOf(s) }
  })

  // La prenotazione più vicina nel tempo è quella che vincola la giornata.
  const anchor = rows
    .filter((r): r is typeof r & { booked: number } => r.booked != null)
    .sort((a, b) => a.booked - b.booked)[0]

  const annotated: ScoredStop[] = rows.map(({ stop, booked, arrive }) => {
    if (booked != null) {
      const slack = booked - arrive
      return { ...stop, bookingSlackMin: slack, tooEarly: slack > EARLY_TOLERANCE_MIN }
    }

    // Il conflitto si dichiara solo quando è certo: se non finiresti la
    // visita nemmeno *prima* dell'ora prenotata, il viaggio per arrivarci
    // non serve nemmeno contarlo. Meglio tacere che allarmare a vuoto.
    if (anchor && arrive + stop.poi.durationMin > anchor.booked) {
      return { ...stop, clashesWith: anchor.stop.poi.name }
    }

    return stop
  })

  const rank = (s: ScoredStop): number => {
    if (s.bookingSlackMin != null) return s.tooEarly ? 3 : 0
    return s.clashesWith ? 2 : 1
  }

  return annotated.sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    // Fra prenotazioni vince la più imminente; fra tappe libere, il costo.
    if (a.bookingSlackMin != null && b.bookingSlackMin != null) {
      return a.bookingSlackMin - b.bookingSlackMin
    }
    return a.cost - b.cost
  })
}

/**
 * I prossimi posti da vedere, ordinati dal migliore.
 *
 *   1. scarta i visitati
 *   2. pre-filtro haversine → i più vicini in linea d'aria
 *   3. chiede a TfL i tempi reali solo per quelli
 *   4. ordina per costo composito (durata + camminata × penalità)
 *
 * Il passo 3 esiste perché il più vicino non è il migliore: a Londra un
 * posto a 3 km con la metro diretta batte spesso uno a 1,5 km raggiungibile
 * solo a piedi.
 */
export async function computeNextStops(
  pos: LatLng,
  dayPois: Poi[],
  walkPenalty: number,
  signal?: AbortSignal,
): Promise<NextStopsResult> {
  const pending = dayPois.filter((p) => !p.visitedAt)
  if (pending.length === 0) return { stops: [], degraded: false }

  const key = cacheKey(pos, pending, walkPenalty)
  const cached = readCache(key)
  if (cached) {
    // In cache stanno i tempi di viaggio, che a cinque minuti di distanza
    // valgono ancora. Il margine sulle prenotazioni no: si rifà adesso.
    return {
      stops: orderByAvailability(cached.stops),
      degraded: cached.degraded,
      reason: cached.reason,
    }
  }

  const byDistance = pending
    .map((poi) => ({ poi, straightLineM: haversineM(pos, poi) }))
    .sort((a, b) => a.straightLineM - b.straightLineM)

  const candidates = byDistance.slice(0, CANDIDATES)
  const rest = byDistance.slice(CANDIDATES)

  let firstError: string | undefined

  const scored = await Promise.all(
    candidates.map(async ({ poi, straightLineM }): Promise<ScoredStop> => {
      try {
        const journey = await bestJourney(pos, poi, walkPenalty, signal)
        if (!journey) {
          firstError ??= 'TfL non ha proposto nessun percorso'
          return estimate(poi, straightLineM, walkPenalty)
        }
        return {
          poi,
          journey,
          cost: journeyCost(journey, walkPenalty),
          estimated: false,
          straightLineM,
        }
      } catch (e) {
        // Qualunque motivo — rete, scadenza, annullamento — la tappa resta
        // proponibile con una stima. Meglio un dato approssimato che una
        // schermata che non si sblocca; ma il motivo va detto.
        firstError ??= (e as Error)?.message || 'errore sconosciuto'
        return estimate(poi, straightLineM, walkPenalty)
      }
    }),
  )

  // I POI oltre i primi N non li interroghiamo: restano in fondo alla lista
  // con una stima, così la schermata li mostra comunque.
  const estimated = rest.map(({ poi, straightLineM }) =>
    estimate(poi, straightLineM, walkPenalty),
  )

  const measured = [...scored, ...estimated].sort((a, b) => a.cost - b.cost)

  // Degradato solo se NESSUNO dei candidati interrogati ha risposto. Le
  // tappe oltre i candidati sono stimate per scelta, non per un guasto.
  const degraded = scored.every((s) => s.estimated)
  const reason = degraded ? firstError : undefined

  // In cache va la misura, non il giudizio: gli orari li rifà chi legge.
  if (!degraded) writeCache(key, { stops: measured, degraded, reason })
  return { stops: orderByAvailability(measured), degraded, reason }
}

/**
 * Fallback quando TfL non risponde: 4,5 km/h a piedi, trattando la distanza
 * in linea d'aria come se fosse tutta camminata. Volutamente pessimista —
 * meglio una stima prudente che un tempo inventato ottimista.
 */
function estimate(poi: Poi, straightLineM: number, walkPenalty: number): ScoredStop {
  const walkMin = Math.round((straightLineM / 4500) * 60)
  return {
    poi,
    journey: null,
    cost: walkMin + walkMin * walkPenalty,
    estimated: true,
    straightLineM,
  }
}
