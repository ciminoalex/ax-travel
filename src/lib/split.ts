import type { Poi } from './types'
import { haversineM } from './geo'

/**
 * Divide le tappe in N giornate.
 *
 * Due obiettivi in una volta sola, perché deciderli in sequenza non
 * funziona: raggruppare prima per zona e pareggiare le ore dopo lascia
 * giornate da undici ore che nessuno spostamento locale riesce più a
 * sbloccare (e un k-means, davanti a una tappa isolata come Canary Wharf,
 * le dedica volentieri un giorno intero da un'ora).
 *
 * Qui invece:
 *   1. le tappe vengono ordinate lungo la direzione in cui il viaggio si
 *      sviluppa davvero — a Londra quasi sempre est-ovest;
 *   2. quella sequenza viene tagliata in N tratti con ore il più possibile
 *      pari, cercando la divisione ottima e non la prima accettabile.
 *
 * Tagliare una sequenza ordinata tiene insieme le tappe vicine per
 * costruzione: ogni giornata è un tratto continuo di città.
 */
export function splitByArea(pois: Poi[], days: number): Poi[][] {
  const k = Math.max(1, Math.min(days, pois.length))
  if (k === 1) return [pois]
  if (pois.length <= k) return pois.map((p) => [p])

  const ordered = orderAlongMainAxis(pois)
  return partitionByTime(ordered, k)
}

/**
 * Ordina le tappe lungo la direzione di massima dispersione.
 *
 * Ordinare per longitudine funzionerebbe a Londra ma non in una città che
 * si sviluppa in verticale: l'asse va ricavato dai dati, non assunto.
 */
function orderAlongMainAxis(pois: Poi[]): Poi[] {
  const meanLat = pois.reduce((s, p) => s + p.lat, 0) / pois.length
  const meanLng = pois.reduce((s, p) => s + p.lng, 0) / pois.length

  // I gradi di longitudine si accorciano allontanandosi dall'equatore:
  // senza questa correzione l'asse risulta storto.
  const lngScale = Math.cos((meanLat * Math.PI) / 180)
  const xs = pois.map((p) => (p.lng - meanLng) * lngScale)
  const ys = pois.map((p) => p.lat - meanLat)

  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < pois.length; i++) {
    sxx += xs[i] * xs[i]
    syy += ys[i] * ys[i]
    sxy += xs[i] * ys[i]
  }

  // Autovettore principale della covarianza: la direzione lungo cui le
  // tappe sono più sparpagliate.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ax = Math.cos(theta)
  const ay = Math.sin(theta)

  return pois
    .map((p, i) => ({ p, t: xs[i] * ax + ys[i] * ay }))
    .sort((a, b) => a.t - b.t)
    .map((e) => e.p)
}

/**
 * Taglia la sequenza in k tratti con ore il più possibile pari.
 *
 * Programmazione dinamica invece di un greedy: con poche decine di tappe il
 * costo è irrilevante e il risultato è la divisione migliore possibile, non
 * una qualunque che "sembra andare". Il costo di una giornata è lo scarto
 * al quadrato dal tempo medio, così una giornata mostruosa pesa molto più
 * di due leggermente sbilanciate.
 */
function partitionByTime(ordered: Poi[], k: number): Poi[][] {
  const n = ordered.length
  const target = ordered.reduce((s, p) => s + p.durationMin, 0) / k

  // prefix[i] = minuti delle prime i tappe
  const prefix = [0]
  for (let i = 0; i < n; i++) prefix.push(prefix[i] + ordered[i].durationMin)
  const segment = (a: number, b: number) => (prefix[b] - prefix[a] - target) ** 2

  const cost: number[][] = Array.from({ length: n + 1 }, () => Array(k + 1).fill(Infinity))
  const cut: number[][] = Array.from({ length: n + 1 }, () => Array(k + 1).fill(0))
  cost[0][0] = 0

  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      // Ogni giornata deve avere almeno una tappa: da qui i limiti su m.
      for (let m = j - 1; m < i; m++) {
        if (cost[m][j - 1] === Infinity) continue
        const c = cost[m][j - 1] + segment(m, i)
        if (c < cost[i][j]) {
          cost[i][j] = c
          cut[i][j] = m
        }
      }
    }
  }

  const groups: Poi[][] = []
  let end = n
  for (let j = k; j >= 1; j--) {
    const start = cut[end][j]
    groups.unshift(ordered.slice(start, end))
    end = start
  }

  return groups
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

/** Distanza massima fra due tappe della giornata: quanto è sparpagliata. */
export function spanM(pois: Poi[]): number {
  let max = 0
  for (let a = 0; a < pois.length; a++) {
    for (let b = a + 1; b < pois.length; b++) {
      max = Math.max(max, haversineM(pois[a], pois[b]))
    }
  }
  return max
}
