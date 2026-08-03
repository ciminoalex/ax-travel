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

/** Oltre quest'ora non si pianificano visite: i musei hanno chiuso. */
export const DAY_END_MIN = 20 * 60

/** Ore di visita che ci si può ragionevolmente mettere in una giornata. */
export const COMFORTABLE_DAY_MIN = 6 * 60

/**
 * Quota del tempo disponibile che diventa davvero visita.
 *
 * Il resto se ne va in spostamenti: fra tre tappe ci sono tre tragitti, che
 * a Londra valgono un'ora e mezza. Contare la finestra intera come tempo
 * di visita produce programmi che finiscono dopo la chiusura dei musei.
 */
const VISIT_SHARE = 0.72

/**
 * Quante ore di visita restano davvero in una giornata.
 *
 * Per oggi è ciò che avanza da adesso alla chiusura, al netto degli
 * spostamenti: alle 17:00 restano un paio d'ore di museo, non tre.
 */
export function dayCapacityMinutes(dateISO: string, now = new Date()): number {
  const start = dayStartMinutes(dateISO, now)
  const window = Math.max(0, DAY_END_MIN - start)
  return Math.min(COMFORTABLE_DAY_MIN, Math.round(window * VISIT_SHARE))
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

/**
 * Fa scivolare al giorno seguente le tappe che non entrano prima della
 * chiusura.
 *
 * Serve quando il viaggio è più pieno del tempo disponibile: la divisione
 * sceglie comunque la ripartizione con lo scarto minore, e può lasciare
 * l'ultima tappa a sera inoltrata. Meglio spostarla che pianificare una
 * visita a museo chiuso.
 *
 * Non tocca le tappe con una data fissata: quelle stanno dove hai deciso.
 */
export function spillOverflow(days: { date: string; pois: Poi[] }[]): typeof days {
  const out = days.map((d) => ({ ...d, pois: [...d.pois] }))

  for (let i = 0; i < out.length; i++) {
    const start = dayStartMinutes(out[i].date)
    const ordered = orderByBookings(out[i].pois, start)

    const keep: Poi[] = []
    const spill: Poi[] = []
    let clock = start

    for (const p of ordered) {
      const booked = parseTime(p.pinnedTime)
      const arrive = booked != null ? Math.max(clock + TRAVEL_GUESS_MIN, booked) : clock + TRAVEL_GUESS_MIN

      const movable = !p.pinnedDate && i + 1 < out.length
      if (movable && arrive >= DAY_END_MIN) {
        spill.push(p)
        continue
      }

      keep.push(p)
      clock = arrive + p.durationMin
    }

    out[i].pois = keep
    if (spill.length > 0) out[i + 1].pois.unshift(...spill)
  }

  return out
}
