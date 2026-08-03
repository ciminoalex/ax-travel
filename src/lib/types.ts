/** Un punto di interesse: hotel, museo, mercato, pub. Stessa forma per tutti. */
export type Poi = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  /** Quanto ci resto. Default 60, modificabile a mano. */
  durationMin: number

  /**
   * Durata piena, prima che la ripianificazione la comprimesse per far
   * stare tutto. Conservarla rende la compressione reversibile: se togli
   * una tappa e ripianifichi, le altre si riprendono il loro tempo.
   */
  fullDurationMin?: number
  /** Se valorizzato (ISO), il posto è visitato. Dà anche la cronologia gratis. */
  visitedAt?: string

  /**
   * Giornata a cui la tappa è legata (ISO date). La usa chi ha una
   * prenotazione, o chi ha scoperto che oggi il museo è pieno e deve
   * rimandare: riorganizzare il giro non deve spostarla altrove.
   */
  pinnedDate?: string

  /**
   * Ora della prenotazione confermata, "HH:MM".
   *
   * Una volta che hai prenotato sul portale del museo questo orario è
   * scolpito: vincola l'ordine dell'intera giornata e nessuna
   * riorganizzazione può spostarlo. Da non confondere con `suggestedTime`.
   */
  pinnedTime?: string

  /**
   * Ora a cui l'app prevede che arriverai, ricalcolata a ogni
   * ottimizzazione. È la proposta da portare al portale delle
   * prenotazioni, non un impegno: cambia quando cambia il giro.
   */
  suggestedTime?: string

  // Campi riempiti dall'AI in fase B — opzionali, l'app funziona senza.
  category?: string
  /** Orari indicativi dal modello: da mostrare sempre con badge "da verificare". */
  openingHours?: string
  bestTimeOfDay?: 'mattina' | 'pomeriggio' | 'sera'
  note?: string
}

export type Day = {
  /** ISO date, es. "2026-08-03" */
  date: string
  /** L'ordine dell'array è l'ordine dell'itinerario. */
  poiIds: string[]
}

export type Trip = {
  hotel: Poi | null
  days: Day[]
  /** POI indicizzati per id: spostarne uno tra giorni è un'operazione banale. */
  pois: Record<string, Poi>
  /**
   * Quanto pesano i minuti a piedi rispetto a quelli sui mezzi.
   * 0 = sceglie sempre il più veloce. 1 = un minuto a piedi vale il doppio
   * di uno seduto in metro. 2 = evita la camminata quasi a ogni costo.
   */
  walkPenalty: number
}

/** Una tratta di un tragitto: "Central Line, 8 min" oppure "a piedi, 4 min". */
export type Leg = {
  mode: string
  durationMin: number
  /** "Central Line", "29 bus", "a piedi" — pronto da mostrare. */
  label: string
}

export type Journey = {
  durationMin: number
  /** Il numero che conta davvero quando decidi se muoverti. */
  walkingMin: number
  legs: Leg[]
}

/** Un candidato per la prossima tappa, già valutato. */
export type ScoredStop = {
  poi: Poi
  journey: Journey | null
  /** Costo composito: durata + minuti a piedi × walkPenalty. */
  cost: number
  /** true se journey è null e stiamo ripiegando sulla distanza in linea d'aria. */
  estimated: boolean
  /** Distanza in linea d'aria in metri — usata per il fallback e da mostrare. */
  straightLineM: number
}

export const DEFAULT_WALK_PENALTY = 1

export function emptyTrip(): Trip {
  return { hotel: null, days: [], pois: {}, walkPenalty: DEFAULT_WALK_PENALTY }
}
