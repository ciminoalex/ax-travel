import type { Poi } from './types'
import { bestJourney, journeyCost } from './journeyCost'
import { haversineM } from './geo'

/**
 * Ordina le tappe della giornata minimizzando il costo composito
 * (durata + camminata × penalità), lo stesso criterio della prossima tappa.
 *
 * Due stadi: nearest-neighbour dal punto di partenza, poi 2-opt per
 * sciogliere gli incroci che il greedy lascia sempre. L'AI, se disponibile,
 * interviene dopo — su un ordine già valido.
 */
/** Orario previsto per una tappa, in minuti dalla mezzanotte. */
export type ScheduleEntry = {
  poiId: string
  travelMin: number
  arriveMin: number
  leaveMin: number
  /** Prenotazione a cui si arriva dopo l'ora fissata. */
  lateBy?: number
}

export type OptimizeResult = {
  orderedIds: string[]
  /** true se non siamo riusciti a interrogare TfL e abbiamo usato le distanze. */
  degraded: boolean
  /** Tappe lasciate fuori dall'ottimizzazione per non sforare il rate limit. */
  skipped: number
  schedule: ScheduleEntry[]
}

/** Ora in cui si presume inizi la giornata, se non c'è una prenotazione prima. */
const DAY_START_MIN = 9 * 60

/** Prima di quest'ora non si parte, qualunque cosa dica la prenotazione. */
const EARLIEST_START_MIN = 7 * 60

export function parseTime(hhmm?: string): number | null {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export function formatTime(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = Math.round(min % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Oltre questa soglia il numero di chiamate cresce troppo: le tappe in
 * eccesso restano in coda nell'ordine in cui erano, invece di far fallire
 * l'intera operazione a metà.
 */
const MAX_OPTIMIZED = 8

export async function optimizeDay(
  pois: Poi[],
  start: { lat: number; lng: number } | null,
  walkPenalty: number,
  onProgress?: (done: number, total: number) => void,
): Promise<OptimizeResult> {
  if (pois.length <= 2) {
    return { orderedIds: pois.map((p) => p.id), degraded: false, skipped: 0, schedule: [] }
  }

  const head = pois.slice(0, MAX_OPTIMIZED)
  const tail = pois.slice(MAX_OPTIMIZED)

  const origin = start ?? head[0]
  type Node = {
    id: string
    lat: number
    lng: number
    durationMin?: number
    pinnedTime?: string
  }
  const nodes: Node[] = [{ id: '__start__', lat: origin.lat, lng: origin.lng }, ...head]

  const { matrix, minutes, degraded } = await buildCostMatrix(nodes, walkPenalty, onProgress)

  // Le prenotazioni con orario sono ancore: vanno visitate in ordine
  // cronologico, e nessuna ottimizzazione del percorso può scavalcarle.
  const anchors = anchorOrder(nodes)

  let order = nearestNeighbour(matrix, minutes, nodes, nodes.length, anchors)

  // Un percorso più corto che fa saltare una prenotazione non è un
  // miglioramento: si accetta solo se le prenotazioni non ci rimettono.
  let currentLateness = lateness(buildSchedule(order, nodes, minutes))
  order = twoOpt(order, matrix, anchors, (candidate) => {
    const candidateLateness = lateness(buildSchedule(candidate, nodes, minutes))
    if (!noWorse(candidateLateness, currentLateness)) return false
    currentLateness = candidateLateness
    return true
  })

  // Il nodo 0 è il punto di partenza, non una tappa.
  return {
    orderedIds: [...order.slice(1).map((i) => nodes[i].id), ...tail.map((p) => p.id)],
    degraded,
    skipped: tail.length,
    schedule: buildSchedule(order, nodes, minutes),
  }
}

/**
 * A che ora arrivi a ogni tappa, sommando viaggi e soste.
 *
 * Se una tappa ha una prenotazione la giornata si aggancia a quell'ora:
 * arrivare prima significa aspettare, arrivare dopo significa perdere il
 * turno — ed è la cosa che va detta chiaramente.
 */
function buildSchedule(
  order: number[],
  nodes: { id: string; durationMin?: number; pinnedTime?: string }[],
  minutes: number[][],
): ScheduleEntry[] {
  const stops = order.slice(1)
  if (stops.length === 0) return []

  // Se la prima tappa è già una prenotazione si può anticipare la sveglia,
  // ma entro limiti umani: una prenotazione irraggiungibile va segnalata
  // come tale, non "risolta" facendoti partire alle quattro del mattino.
  let clock = DAY_START_MIN
  const firstBooked = parseTime(nodes[stops[0]].pinnedTime)
  if (firstBooked != null) {
    const travel = minutes[order[0]][stops[0]] ?? 0
    clock = Math.max(EARLIEST_START_MIN, Math.min(clock, firstBooked - travel))
  }

  const out: ScheduleEntry[] = []
  let prev = order[0]

  for (const idx of stops) {
    const travel = minutes[prev][idx] ?? 0
    let arrive = clock + travel

    const booked = parseTime(nodes[idx].pinnedTime)
    let lateBy: number | undefined
    if (booked != null) {
      if (arrive > booked) lateBy = arrive - booked
      // Presentarsi prima non anticipa l'ingresso: si aspetta.
      arrive = Math.max(arrive, booked)
    }

    const leave = arrive + (nodes[idx].durationMin ?? 0)
    out.push({ poiId: nodes[idx].id, travelMin: travel, arriveMin: arrive, leaveMin: leave, lateBy })

    clock = leave
    prev = idx
  }

  return out
}

type Point = { lat: number; lng: number }

/**
 * La matrice è il costo reale del giro, ma pagato in chiamate a TfL.
 *
 * Due accorgimenti la tengono sotto il limite di ~50 richieste al minuto
 * che TfL applica senza app key:
 *
 * - **Simmetria**: interroghiamo solo i tratti i<j e riusiamo il valore
 *   per il verso opposto. Dimezza le chiamate (per 8 tappe: 72 → 36).
 *   Andata e ritorno non sono identici — sensi unici, frequenze diverse —
 *   ma per decidere un ordine l'approssimazione regge, e il tempo mostrato
 *   nella schermata "Ora" resta comunque quello vero, calcolato a parte.
 * - **Pausa fra le richieste**: senza, 36 chiamate partono in pochi secondi
 *   e la seconda metà torna vuota.
 */
const TFL_PAUSE_MS = 250

async function buildCostMatrix(
  nodes: Point[],
  walkPenalty: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ matrix: number[][]; minutes: number[][]; degraded: boolean }> {
  const n = nodes.length
  const matrix: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0))
  // Il costo composito serve a ordinare, i minuti veri a dire a che ora
  // arrivi: penalizzare la camminata falserebbe gli orari.
  const minutes: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0))
  let failures = 0
  let done = 0
  const total = (n * (n - 1)) / 2

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let cost: number
      let mins: number
      try {
        const journey = await bestJourney(nodes[i], nodes[j], walkPenalty)
        if (journey) {
          cost = journeyCost(journey, walkPenalty)
          mins = journey.durationMin
        } else {
          cost = fallbackCost(nodes[i], nodes[j], walkPenalty)
          mins = fallbackMinutes(nodes[i], nodes[j])
          failures++
        }
      } catch {
        cost = fallbackCost(nodes[i], nodes[j], walkPenalty)
        mins = fallbackMinutes(nodes[i], nodes[j])
        failures++
      }
      matrix[i][j] = matrix[j][i] = cost
      minutes[i][j] = minutes[j][i] = mins
      onProgress?.(++done, total)
      if (done < total) await sleep(TFL_PAUSE_MS)
    }
  }

  return { matrix, minutes, degraded: failures > total / 2 }
}

function fallbackMinutes(a: Point, b: Point): number {
  return Math.round((haversineM(a, b) / 4500) * 60)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Come in nextStop: 4,5 km/h, tutto a piedi. Volutamente pessimista. */
function fallbackCost(a: Point, b: Point, walkPenalty: number): number {
  const walkMin = (haversineM(a, b) / 4500) * 60
  return walkMin + walkMin * walkPenalty
}

/**
 * Gli indici delle tappe con orario fissato, in ordine cronologico.
 * È la sequenza che ogni percorso proposto deve rispettare.
 */
function anchorOrder(nodes: { id: string; pinnedTime?: string }[]): number[] {
  return nodes
    .map((n, i) => ({ i, t: n.pinnedTime }))
    .filter((e): e is { i: number; t: string } => Boolean(e.t))
    .sort((a, b) => a.t.localeCompare(b.t))
    .map((e) => e.i)
}

/** Le ancore compaiono nell'ordine giusto e senza saltarne nessuna? */
function respectsAnchors(order: number[], anchors: number[]): boolean {
  if (anchors.length < 2) return true
  const seen = order.filter((i) => anchors.includes(i))
  return seen.every((v, k) => v === anchors[k])
}

/**
 * Costruisce il giro tenendo d'occhio l'orologio.
 *
 * Non basta che le prenotazioni si susseguano in ordine cronologico: prima
 * di una prenotazione ci sta solo ciò che si riesce davvero a visitare in
 * tempo. Senza questo controllo una prenotazione alle 10:30 può finire in
 * fondo alla giornata, e per rispettarla bisognerebbe partire all'alba.
 *
 * A ogni passo: se c'è una prenotazione in attesa, si infila una tappa
 * libera solo se si fa ancora in tempo ad arrivarci; altrimenti si va
 * dritti alla prenotazione.
 */
function nearestNeighbour(
  matrix: number[][],
  minutes: number[][],
  nodes: { durationMin?: number; pinnedTime?: string }[],
  n: number,
  anchors: number[],
): number[] {
  const remaining = new Set<number>()
  for (let i = 1; i < n; i++) remaining.add(i)

  const order = [0]
  let current = 0
  let clock = DAY_START_MIN

  while (remaining.size > 0) {
    const nextAnchor = anchors.find((i) => remaining.has(i))
    let choice = -1
    let bestCost = Infinity

    for (const j of remaining) {
      if (j === nextAnchor) continue
      // Le altre prenotazioni aspettano il proprio turno.
      if (nodes[j].pinnedTime) continue

      if (nextAnchor !== undefined) {
        const deadline = parseTime(nodes[nextAnchor].pinnedTime) ?? Infinity
        const arrive = clock + minutes[current][j]
        const leave = arrive + (nodes[j].durationMin ?? 0)
        // Ci si passa prima solo se poi si arriva comunque in orario.
        if (leave + minutes[j][nextAnchor] > deadline) continue
      }

      if (matrix[current][j] < bestCost) {
        bestCost = matrix[current][j]
        choice = j
      }
    }

    if (choice === -1) {
      if (nextAnchor === undefined) break
      choice = nextAnchor
    }

    const booked = parseTime(nodes[choice].pinnedTime)
    const arrive = Math.max(clock + minutes[current][choice], booked ?? 0)
    clock = arrive + (nodes[choice].durationMin ?? 0)

    remaining.delete(choice)
    order.push(choice)
    current = choice
  }

  return order
}

/**
 * Il greedy produce quasi sempre un percorso con incroci: invertire un
 * segmento alla volta li elimina. Il punto di partenza resta fisso, e non
 * chiudiamo il giro perché la giornata non deve tornare all'hotel.
 */
/**
 * Quanto un giro tradisce le prenotazioni: quante ne manca e di quanti
 * minuti in tutto. Il conteggio da solo non basta — con un ritardo ormai
 * inevitabile ogni ordine ne manca una, e senza guardare i minuti si
 * finisce per scegliere quello che arriva cinque ore tardi invece di una.
 */
function lateness(schedule: ScheduleEntry[]): [count: number, minutes: number] {
  let count = 0
  let minutes = 0
  for (const e of schedule) {
    if (e.lateBy && e.lateBy > 0) {
      count++
      minutes += e.lateBy
    }
  }
  return [count, minutes]
}

/** true se `a` non è peggio di `b`. */
function noWorse(a: [number, number], b: [number, number]): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] <= b[1]
}

function twoOpt(
  order: number[],
  matrix: number[][],
  anchors: number[],
  acceptable: (candidate: number[]) => boolean,
): number[] {
  const best = [...order]
  let improved = true

  while (improved) {
    improved = false
    for (let i = 1; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const before =
          matrix[best[i - 1]][best[i]] +
          (k + 1 < best.length ? matrix[best[k]][best[k + 1]] : 0)
        const after =
          matrix[best[i - 1]][best[k]] +
          (k + 1 < best.length ? matrix[best[i]][best[k + 1]] : 0)
        if (after < before - 0.01) {
          const candidate = [...best]
          candidate.splice(i, k - i + 1, ...candidate.slice(i, k + 1).reverse())
          // Invertire un tratto può capovolgere due prenotazioni:
          // un percorso più corto che ti fa mancare il biglietto non serve.
          if (!respectsAnchors(candidate, anchors)) continue
          if (!acceptable(candidate)) continue
          best.splice(0, best.length, ...candidate)
          improved = true
        }
      }
    }
  }

  return best
}
