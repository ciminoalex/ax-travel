import type { Poi } from './types'
import { parseTime } from './optimize'

/**
 * Mette in fila le tappe di una giornata rispettando le prenotazioni.
 *
 * Serve a chi riorganizza senza passare da "Ottimizza il giro": quello usa
 * i tempi reali di TfL, ma costa decine di chiamate e va chiesto
 * esplicitamente. Qui basta una stima per non ritrovarsi una prenotazione
 * delle 15:30 come prima tappa del mattino.
 *
 * Le tappe con orario sono punti fermi in ordine cronologico; le altre
 * riempiono lo spazio prima di ciascuna, finché ci stanno.
 */

/** Spostamento medio fra due tappe a Londra, per la sola stima. */
const TRAVEL_GUESS_MIN = 25

export const DAY_START_MIN = 9 * 60

/**
 * Da che ora comincia davvero una giornata.
 *
 * Per oggi è adesso: se sono le 12:15, pianificare una tappa alle 11:00 non
 * serve a niente. Per gli altri giorni si parte dall'orario canonico,
 * perché domani mattina è ancora tutta da usare.
 */
export function dayStartMinutes(dateISO: string, now = new Date()): number {
  const today = now.toISOString().slice(0, 10)
  if (dateISO !== today) return DAY_START_MIN

  const nowMin = now.getHours() * 60 + now.getMinutes()
  return Math.max(DAY_START_MIN, nowMin)
}

export function orderByBookings(pois: Poi[], startMin = DAY_START_MIN): Poi[] {
  const booked = pois
    .filter((p) => parseTime(p.pinnedTime) != null)
    .sort((a, b) => (parseTime(a.pinnedTime) ?? 0) - (parseTime(b.pinnedTime) ?? 0))

  // Nessuna prenotazione: l'ordine che arriva (geografico) va già bene.
  if (booked.length === 0) return pois

  const free = pois.filter((p) => parseTime(p.pinnedTime) == null)
  const out: Poi[] = []
  let clock = startMin
  let i = 0

  for (const anchor of booked) {
    const at = parseTime(anchor.pinnedTime) ?? 0

    // Riempie il tempo che precede la prenotazione, senza sforarlo.
    while (i < free.length) {
      const cost = free[i].durationMin + TRAVEL_GUESS_MIN
      if (clock + cost > at) break
      out.push(free[i])
      clock += cost
      i++
    }

    out.push(anchor)
    clock = Math.max(clock + TRAVEL_GUESS_MIN, at) + anchor.durationMin
  }

  // Ciò che non entrava prima delle prenotazioni viene dopo.
  out.push(...free.slice(i))
  return out
}
