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
 * Sposta le tappe dai giorni troppo pieni a quelli troppo vuoti, scegliendo
 * ogni volta quella che costa meno spostare: la più vicina al centro del
 * giorno che la riceve.
 */
function balance(clusters: Poi[][], centroids: Point[]): Poi[][] {
  const total = clusters.reduce((s, c) => s + c.length, 0)
  const maxSize = Math.ceil(total / clusters.length)
  const out = clusters.map((c) => [...c])

  for (let guard = 0; guard < 100; guard++) {
    const from = out.findIndex((c) => c.length > maxSize)
    if (from === -1) break

    const to = out.reduce((bi, c, i) => (c.length < out[bi].length ? i : bi), 0)
    if (out[to].length >= maxSize) break

    let bestIdx = 0
    let bestDist = Infinity
    out[from].forEach((p, i) => {
      const d = haversineM(p, centroids[to])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    })

    out[to].push(out[from].splice(bestIdx, 1)[0])
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
