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
 * Unisce l'annullamento del chiamante a una scadenza propria, così una
 * richiesta che non torna non blocca l'interfaccia a tempo indeterminato.
 *
 * Costruito su AbortController invece che su AbortSignal.any/timeout:
 * quelle due arrivano solo con Safari 17.4 e 16, e su un iPhone più
 * indietro lanciano un errore che fa fallire *ogni* richiesta — l'app
 * ripiegherebbe sempre sulla distanza in linea d'aria senza dire perché.
 */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const ctrl = new AbortController()

  const timer = setTimeout(() => {
    ctrl.abort(new DOMException('Richiesta scaduta', 'TimeoutError'))
  }, ms)

  const forward = () => {
    clearTimeout(timer)
    ctrl.abort(signal?.reason)
  }

  if (signal) {
    if (signal.aborted) forward()
    else signal.addEventListener('abort', forward, { once: true })
  }

  // Il timer non serve più una volta che la richiesta si è conclusa.
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })

  return ctrl.signal
}

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
    // Senza scadenza una richiesta lenta resta appesa per minuti e blocca
    // la schermata. 15s perché in roaming la rete può essere molto più
    // lenta che sotto wifi.
    res = await fetch(url, { signal: withTimeout(opts.signal, 15000) })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    const name = (e as Error)?.name
    throw new TflError(
      name === 'TimeoutError' ? 'TfL non ha risposto in tempo' : 'Rete non raggiungibile',
    )
  }

  if (!res.ok) {
    if (res.status === 300) throw new TflError('Luogo ambiguo per TfL')
    if (res.status === 429) throw new TflError('Troppe richieste a TfL: riprova fra un minuto')
    throw new TflError(`TfL ha risposto ${res.status}`)
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
