import type { Journey } from './types'
import type { LatLng } from './geo'
import { fetchJourneys } from './tfl'

/**
 * Oltre questa soglia di camminata vale la pena chiedere a TfL un secondo
 * parere con journeyPreference=leastWalking: propone percorsi che non aveva
 * considerato ottimali a tempo.
 */
const RETRY_WALK_THRESHOLD_MIN = 15

/**
 * Il criterio di scelta dell'app, in una riga.
 *
 * I minuti a piedi sono già dentro `durationMin`: risommarli li conta due
 * volte. Con walkPenalty=1 un minuto a piedi pesa quindi il doppio di un
 * minuto seduto in metro — che è esattamente il compromesso richiesto
 * fra velocità e poca camminata.
 *
 * 25 min con 4 a piedi → 29     ← vince
 * 22 min con 14 a piedi → 36
 */
export function journeyCost(j: Journey, walkPenalty: number): number {
  return j.durationMin + j.walkingMin * walkPenalty
}

export function pickBest(journeys: Journey[], walkPenalty: number): Journey | null {
  if (journeys.length === 0) return null
  return journeys.reduce((best, j) =>
    journeyCost(j, walkPenalty) < journeyCost(best, walkPenalty) ? j : best,
  )
}

/**
 * Tutte le alternative, dalla migliore alla peggiore secondo il costo
 * composito, senza duplicati.
 *
 * Il criterio dell'app resta il primo suggerimento, ma TfL e Google non
 * propongono sempre gli stessi percorsi: vedere le altre opzioni permette
 * di scegliere con la propria testa invece di fidarsi e basta.
 */
export async function journeyOptions(
  from: LatLng,
  to: LatLng,
  walkPenalty: number,
  signal?: AbortSignal,
): Promise<Journey[]> {
  const journeys = await fetchJourneys(from, to, { signal })

  // Un secondo parere mirato quando il migliore cammina parecchio: TfL
  // propone percorsi che a sola durata non aveva considerato.
  let extra: Journey[] = []
  const best = pickBest(journeys, walkPenalty)
  if (best && best.walkingMin > RETRY_WALK_THRESHOLD_MIN) {
    try {
      extra = await fetchJourneys(from, to, { leastWalking: true, signal })
    } catch {
      // Il primo elenco resta valido.
    }
  }

  const seen = new Set<string>()
  return [...journeys, ...extra]
    .filter((j) => {
      const key = `${j.durationMin}|${j.walkingMin}|${j.legs.map((l) => l.label).join('>')}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => journeyCost(a, walkPenalty) - journeyCost(b, walkPenalty))
}

/**
 * Il miglior tragitto fra due punti secondo il costo composito.
 * Ritorna null se TfL non sa proporre nulla.
 */
export async function bestJourney(
  from: LatLng,
  to: LatLng,
  walkPenalty: number,
  signal?: AbortSignal,
): Promise<Journey | null> {
  const journeys = await fetchJourneys(from, to, { signal })
  let best = pickBest(journeys, walkPenalty)

  // Troppa camminata in tutte le alternative: un secondo giro mirato.
  // Una sola volta, per non moltiplicare le chiamate a un'API senza key.
  if (best && best.walkingMin > RETRY_WALK_THRESHOLD_MIN) {
    try {
      const alt = await fetchJourneys(from, to, { leastWalking: true, signal })
      const bestAlt = pickBest(alt, walkPenalty)
      if (bestAlt && journeyCost(bestAlt, walkPenalty) < journeyCost(best, walkPenalty)) {
        best = bestAlt
      }
    } catch {
      // Il primo risultato resta valido: il secondo parere è un miglioramento
      // opzionale, non una dipendenza.
    }
  }

  return best
}
