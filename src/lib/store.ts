import { emptyTrip, type Poi, type Trip } from './types'

const KEY = 'ax-travel:trip:v1'

/**
 * In viaggio non deve esistere un bottone "salva": ogni mutazione persiste
 * subito. localStorage è sincrono, quindi non serve orchestrare nulla — ma
 * ogni lettura va difesa, perché un JSON corrotto non deve impedire
 * l'apertura dell'app mentre sei per strada.
 */
export function loadTrip(): Trip {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyTrip()
    const parsed = JSON.parse(raw) as Partial<Trip>
    return {
      ...emptyTrip(),
      ...parsed,
      pois: parsed.pois ?? {},
      days: parsed.days ?? [],
    }
  } catch {
    return emptyTrip()
  }
}

export function saveTrip(trip: Trip): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(trip))
  } catch {
    // Quota piena o storage negato (Safari privato). Meglio perdere il
    // salvataggio che far crashare la schermata su cui stai guardando
    // la prossima tappa.
  }
}

export function exportTrip(trip: Trip): string {
  return JSON.stringify(trip, null, 2)
}

/** Ritorna null se il JSON non è un viaggio valido, invece di lanciare. */
export function importTrip(json: string): Trip | null {
  try {
    const parsed = JSON.parse(json) as Partial<Trip>
    if (!parsed || typeof parsed !== 'object' || !parsed.pois) return null
    return { ...emptyTrip(), ...parsed, pois: parsed.pois, days: parsed.days ?? [] }
  } catch {
    return null
  }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** I POI di un giorno, nell'ordine dell'itinerario, saltando gli id orfani. */
export function poisOfDay(trip: Trip, dayIndex: number): Poi[] {
  const day = trip.days[dayIndex]
  if (!day) return []
  return day.poiIds.map((id) => trip.pois[id]).filter((p): p is Poi => Boolean(p))
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
