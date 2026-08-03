import type { Poi } from './types'
import { haversineM } from './geo'

/**
 * Divide le tappe in N giornate raggruppandole per zona.
 *
 * Il criterio è geografico e non temporale: a Londra la differenza fra un
 * giro riuscito e uno passato in metropolitana è tutta qui. Girare la stessa
 * zona in un giorno solo evita le traversate da una parte all'altra della
 * città che nascono quando le tappe vengono divise a caso.
 *
 * k-means su lat/lng, seguito da un bilanciamento: senza, un quartiere
 * denso si prende otto tappe e un altro giorno ne riceve una.
 */
export function splitByArea(pois: Poi[], days: number): Poi[][] {
  const k = Math.max(1, Math.min(days, pois.length))
  if (k === 1) return [pois]
  if (pois.length <= k) return pois.map((p) => [p])

  let centroids = seed(pois, k)
  let clusters: Poi[][] = []

  for (let iter = 0; iter < 40; iter++) {
    clusters = Array.from({ length: k }, () => [] as Poi[])
    for (const p of pois) {
      clusters[nearestIndex(p, centroids)].push(p)
    }

    const next = clusters.map((c, i) =>
      c.length > 0
        ? {
            lat: c.reduce((s, p) => s + p.lat, 0) / c.length,
            lng: c.reduce((s, p) => s + p.lng, 0) / c.length,
          }
        : centroids[i],
    )

    const stable = next.every(
      (c, i) => Math.abs(c.lat - centroids[i].lat) < 1e-6 && Math.abs(c.lng - centroids[i].lng) < 1e-6,
    )
    centroids = next
    if (stable) break
  }

  return balance(clusters, centroids)
}

type Point = { lat: number; lng: number }

/** k-means++ : i centri partono distanti, evitando cluster degeneri. */
function seed(pois: Poi[], k: number): Point[] {
  const centroids: Point[] = [{ lat: pois[0].lat, lng: pois[0].lng }]

  while (centroids.length < k) {
    let best = pois[0]
    let bestDist = -1
    for (const p of pois) {
      const d = Math.min(...centroids.map((c) => haversineM(p, c)))
      if (d > bestDist) {
        bestDist = d
        best = p
      }
    }
    centroids.push({ lat: best.lat, lng: best.lng })
  }

  return centroids
}

function nearestIndex(p: Point, centroids: Point[]): number {
  let idx = 0
  let best = Infinity
  centroids.forEach((c, i) => {
    const d = haversineM(p, c)
    if (d < best) {
      best = d
      idx = i
    }
  })
  return idx
}

/**
 * Quanto può allontanarsi una tappa dal proprio gruppo pur di pareggiare le
 * giornate. Oltre questa soglia il pareggio non vale il viaggio.
 */
const MAX_DETOUR_M = 3500

/** Sotto questo scarto le giornate sono già abbastanza pari. */
const TOLERANCE_MIN = 45

function load(g: Poi[]): number {
  return g.reduce((s, p) => s + p.durationMin, 0)
}

/**
 * Pareggia le giornate sulle **ore di visita**, non sul numero di tappe:
 * quattro tappe possono valere due ore o dodici, e a decidere se una
 * giornata è fattibile è il tempo, non il conteggio.
 *
 * A parità di necessità sposta la tappa che ci perde meno — quella per cui
 * il trasferimento è il minor peggioramento rispetto a dove si trova già.
 */
function balance(clusters: Poi[][], centroids: Point[]): Poi[][] {
  const out = clusters.map((c) => [...c])
  const target = out.reduce((s, g) => s + load(g), 0) / out.length

  for (let guard = 0; guard < 200; guard++) {
    // Dal più carico al meno carico, così il primo tentativo è quello che
    // migliora di più.
    const heavy = out.map((_, i) => i).sort((a, b) => load(out[b]) - load(out[a]))
    const light = out.map((_, i) => i).sort((a, b) => load(out[a]) - load(out[b]))

    let moved = false

    outer: for (const from of heavy) {
      if (load(out[from]) <= target + TOLERANCE_MIN) break
      for (const to of light) {
        if (to === from) continue
        if (load(out[to]) >= target - TOLERANCE_MIN) continue
        if (out[from].length <= 1) continue

        let bestIdx = -1
        let bestPenalty = Infinity
        out[from].forEach((p, i) => {
          // Spostare una tappa più lunga dello squilibrio lo ribalta
          // soltanto dall'altra parte.
          if (p.durationMin > load(out[from]) - load(out[to])) return
          const penalty = haversineM(p, centroids[to]) - haversineM(p, centroids[from])
          if (penalty < bestPenalty) {
            bestPenalty = penalty
            bestIdx = i
          }
        })

        // Nessun candidato accettabile per questa coppia: si prova la
        // successiva, invece di rinunciare al bilanciamento (era il difetto
        // che lasciava una giornata con otto tappe e le altre con due).
        if (bestIdx === -1 || bestPenalty > MAX_DETOUR_M) continue

        out[to].push(out[from].splice(bestIdx, 1)[0])
        moved = true
        break outer
      }
    }

    if (!moved) break
  }

  return out
}

/** Etichetta leggibile di una zona, dagli indirizzi delle sue tappe. */
export function areaLabel(pois: Poi[]): string {
  const areas = pois
    .map((p) => p.address.split(',')[1]?.trim())
    .filter((a): a is string => Boolean(a))

  if (areas.length === 0) return ''

  const counts = new Map<string, number>()
  for (const a of areas) counts.set(a, (counts.get(a) ?? 0) + 1)

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}
