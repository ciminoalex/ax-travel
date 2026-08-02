import type { Journey, Leg } from './types'
import type { LatLng } from './geo'

/**
 * Solo mezzi pubblici: auto, taxi e bici non compaiono mai.
 * `walking` resta perché serve per i collegamenti fermata-destinazione.
 */
const MODES = 'tube,dlr,overground,elizabeth-line,national-rail,bus,walking'

/**
 * TfL tratta questo come un suggerimento, non come un filtro: verificato che
 * restituisce comunque alternative tutte-a-piedi più lunghe. A scartarle è il
 * costo composito in journeyCost, che resta la difesa vera.
 */
const MAX_WALKING_MINUTES = 20

const BASE = 'https://api.tfl.gov.uk/Journey/JourneyResults'

// La forma della risposta TfL, ridotta ai campi che usiamo davvero.
type TflLeg = {
  duration: number
  mode?: { id?: string; name?: string }
  instruction?: { summary?: string }
  routeOptions?: { name?: string; lineIdentifier?: { name?: string } }[]
}
type TflJourney = { duration: number; legs: TflLeg[] }
type TflResponse = { journeys?: TflJourney[] }

export class TflError extends Error {}

/**
 * Tutte le alternative per un tragitto. La scelta di quale sia la migliore
 * NON avviene qui: spetta a journeyCost, così il criterio vive in un posto solo.
 */
export async function fetchJourneys(
  from: LatLng,
  to: LatLng,
  opts: { leastWalking?: boolean; signal?: AbortSignal } = {},
): Promise<Journey[]> {
  const params = new URLSearchParams({
    mode: MODES,
    walkingSpeed: 'average',
    maxWalkingMinutes: String(MAX_WALKING_MINUTES),
  })
  if (opts.leastWalking) params.set('journeyPreference', 'leastWalking')

  const url = `${BASE}/${from.lat},${from.lng}/to/${to.lat},${to.lng}?${params}`

  let res: Response
  try {
    res = await fetch(url, { signal: opts.signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new TflError('Rete non raggiungibile')
  }

  if (!res.ok) {
    // 300 = TfL non ha saputo risolvere origine o destinazione.
    throw new TflError(res.status === 300 ? 'Luogo ambiguo per TfL' : `TfL HTTP ${res.status}`)
  }

  const data = (await res.json()) as TflResponse
  return (data.journeys ?? []).map(normalizeJourney)
}

function normalizeJourney(j: TflJourney): Journey {
  const legs = (j.legs ?? []).map(normalizeLeg)
  return {
    durationMin: j.duration,
    walkingMin: legs
      .filter((l) => l.mode === 'walking')
      .reduce((sum, l) => sum + l.durationMin, 0),
    legs,
  }
}

function normalizeLeg(l: TflLeg): Leg {
  const mode = l.mode?.id ?? 'unknown'
  return { mode, durationMin: l.duration, label: legLabel(mode, l) }
}

/**
 * Un'etichetta che si legge a colpo d'occhio camminando per strada.
 * TfL è verboso ("29 bus to Tottenham Court Road Station"): qui teniamo
 * solo la linea, perché la destinazione è già nella card.
 */
function legLabel(mode: string, l: TflLeg): string {
  if (mode === 'walking') return 'a piedi'

  const line = l.routeOptions?.[0]?.lineIdentifier?.name ?? l.routeOptions?.[0]?.name
  if (line) {
    if (mode === 'bus') return `bus ${line}`
    if (mode === 'tube') return `${line} line`
    return line
  }

  const summary = l.instruction?.summary
  if (summary) return summary

  return l.mode?.name ?? mode
}

/** L'emoji giusta per ogni mezzo: si riconosce prima di leggere. */
export function modeIcon(mode: string): string {
  switch (mode) {
    case 'walking':
      return '🚶'
    case 'tube':
      return '🚇'
    case 'bus':
      return '🚌'
    case 'dlr':
    case 'overground':
    case 'elizabeth-line':
    case 'national-rail':
      return '🚆'
    default:
      return '➡️'
  }
}

/** "🚶 6 min → 🚇 Central line → 🚶 3 min" */
export function describeJourney(j: Journey): string {
  return j.legs
    .map((l) => `${modeIcon(l.mode)} ${l.label} ${l.durationMin} min`)
    .join(' → ')
}
