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
export type OptimizeResult = {
  orderedIds: string[]
  /** true se non siamo riusciti a interrogare TfL e abbiamo usato le distanze. */
  degraded: boolean
  /** Tappe lasciate fuori dall'ottimizzazione per non sforare il rate limit. */
  skipped: number
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
    return { orderedIds: pois.map((p) => p.id), degraded: false, skipped: 0 }
  }

  const head = pois.slice(0, MAX_OPTIMIZED)
  const tail = pois.slice(MAX_OPTIMIZED)

  const origin = start ?? head[0]
  const nodes = [{ id: '__start__', lat: origin.lat, lng: origin.lng }, ...head]

  const { matrix, degraded } = await buildCostMatrix(nodes, walkPenalty, onProgress)

  let order = nearestNeighbour(matrix, nodes.length)
  order = twoOpt(order, matrix)

  // Il nodo 0 è il punto di partenza, non una tappa.
  return {
    orderedIds: [...order.slice(1).map((i) => nodes[i].id), ...tail.map((p) => p.id)],
    degraded,
    skipped: tail.length,
  }
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
): Promise<{ matrix: number[][]; degraded: boolean }> {
  const n = nodes.length
  const matrix: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0))
  let failures = 0
  let done = 0
  const total = (n * (n - 1)) / 2

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let cost: number
      try {
        const journey = await bestJourney(nodes[i], nodes[j], walkPenalty)
        cost = journey
          ? journeyCost(journey, walkPenalty)
          : fallbackCost(nodes[i], nodes[j], walkPenalty)
        if (!journey) failures++
      } catch {
        cost = fallbackCost(nodes[i], nodes[j], walkPenalty)
        failures++
      }
      matrix[i][j] = cost
      matrix[j][i] = cost
      onProgress?.(++done, total)
      if (done < total) await sleep(TFL_PAUSE_MS)
    }
  }

  return { matrix, degraded: failures > total / 2 }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Come in nextStop: 4,5 km/h, tutto a piedi. Volutamente pessimista. */
function fallbackCost(a: Point, b: Point, walkPenalty: number): number {
  const walkMin = (haversineM(a, b) / 4500) * 60
  return walkMin + walkMin * walkPenalty
}

function nearestNeighbour(matrix: number[][], n: number): number[] {
  const visited = new Set<number>([0])
  const order = [0]
  let current = 0

  while (visited.size < n) {
    let best = -1
    let bestCost = Infinity
    for (let j = 0; j < n; j++) {
      if (visited.has(j)) continue
      if (matrix[current][j] < bestCost) {
        bestCost = matrix[current][j]
        best = j
      }
    }
    if (best === -1) break
    visited.add(best)
    order.push(best)
    current = best
  }

  return order
}

/**
 * Il greedy produce quasi sempre un percorso con incroci: invertire un
 * segmento alla volta li elimina. Il punto di partenza resta fisso, e non
 * chiudiamo il giro perché la giornata non deve tornare all'hotel.
 */
function twoOpt(order: number[], matrix: number[][]): number[] {
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
          best.splice(i, k - i + 1, ...best.slice(i, k + 1).reverse())
          improved = true
        }
      }
    }
  }

  return best
}
