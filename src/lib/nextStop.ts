import type { Poi, ScoredStop } from './types'
import { coarse, haversineM, type LatLng } from './geo'
import { bestJourney, journeyCost } from './journeyCost'

/**
 * Quanti candidati interrogare su TfL. Il pre-filtro geometrico è solo un
 * modo per non chiedere i tempi di tutti: 4 dà margine perché un POI più
 * lontano in linea d'aria ma con la metro diretta possa comunque vincere.
 */
const CANDIDATES = 4

const CACHE_TTL_MS = 5 * 60 * 1000

type CacheEntry = { at: number; stops: ScoredStop[] }

/**
 * Riaprire l'app tre volte in due minuti non deve valere tre giri di
 * chiamate. La chiave include i POI rimanenti: appena ne segni uno come
 * visitato, il risultato è giustamente invalidato.
 */
function cacheKey(pos: LatLng, pois: Poi[], walkPenalty: number): string {
  const ids = pois.map((p) => p.id).sort().join(',')
  return `ax-travel:next:${coarse(pos)}:${walkPenalty}:${ids}`
}

function readCache(key: string): ScoredStop[] | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (Date.now() - entry.at > CACHE_TTL_MS) return null
    return entry.stops
  } catch {
    return null
  }
}

function writeCache(key: string, stops: ScoredStop[]): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), stops } satisfies CacheEntry))
  } catch {
    // Cache piena: non è un errore che debba interrompere il viaggio.
  }
}

export type NextStopsResult = {
  stops: ScoredStop[]
  /** true se TfL non ha risposto e stiamo ordinando per distanza in linea d'aria. */
  degraded: boolean
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
  if (cached) return { stops: cached, degraded: cached.some((s) => s.estimated) }

  const byDistance = pending
    .map((poi) => ({ poi, straightLineM: haversineM(pos, poi) }))
    .sort((a, b) => a.straightLineM - b.straightLineM)

  const candidates = byDistance.slice(0, CANDIDATES)
  const rest = byDistance.slice(CANDIDATES)

  const scored = await Promise.all(
    candidates.map(async ({ poi, straightLineM }): Promise<ScoredStop> => {
      try {
        const journey = await bestJourney(pos, poi, walkPenalty, signal)
        if (!journey) return estimate(poi, straightLineM, walkPenalty)
        return {
          poi,
          journey,
          cost: journeyCost(journey, walkPenalty),
          estimated: false,
          straightLineM,
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        return estimate(poi, straightLineM, walkPenalty)
      }
    }),
  )

  // I POI oltre i primi N non li interroghiamo: restano in fondo alla lista
  // con una stima, così la schermata li mostra comunque.
  const estimated = rest.map(({ poi, straightLineM }) =>
    estimate(poi, straightLineM, walkPenalty),
  )

  const stops = [...scored, ...estimated].sort((a, b) => a.cost - b.cost)
  const degraded = scored.every((s) => s.estimated)

  if (!degraded) writeCache(key, stops)
  return { stops, degraded }
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
