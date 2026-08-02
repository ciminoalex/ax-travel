import type { AiPlace } from './ai'
import { searchPlaces } from './photon'
import type { Poi } from './types'

/**
 * Un posto proposto dall'AI, dopo il confronto con la mappa.
 * `verified` distingue ciò che esiste davvero da ciò che il modello
 * ha nominato senza che OpenStreetMap lo confermi.
 */
export type ResolvedPlace = {
  ai: AiPlace
  poi: Omit<Poi, 'id'> | null
  verified: boolean
  address: string
}

/**
 * Le coordinate arrivano sempre dalla mappa, mai dal modello: è il punto
 * in cui un posto inventato viene fermato prima di entrare nell'itinerario.
 *
 * Le richieste sono sequenziali di proposito — Photon è gratuito e senza
 * chiave, e un burst parallelo è il modo più rapido per farsi limitare.
 */
export async function resolvePlaces(
  places: AiPlace[],
  signal?: AbortSignal,
): Promise<ResolvedPlace[]> {
  const out: ResolvedPlace[] = []

  for (const ai of places) {
    if (signal?.aborted) break
    try {
      const hits = await searchPlaces(ai.searchQuery, signal)
      const hit = hits[0]
      if (hit) {
        out.push({
          ai,
          verified: true,
          address: hit.address,
          poi: {
            // Il nome della mappa è quello che ritroverai sui cartelli.
            name: hit.name,
            address: hit.address,
            lat: hit.lat,
            lng: hit.lng,
            durationMin: sane(ai.durationMin),
            category: ai.category?.trim() || undefined,
            openingHours: ai.openingHours?.trim() || undefined,
            bestTimeOfDay: normalizeTime(ai.bestTimeOfDay),
            note: ai.note?.trim() || undefined,
          },
        })
        continue
      }
    } catch {
      // Rete o Photon giù: sotto lo marchiamo come non verificato.
    }

    out.push({ ai, poi: null, verified: false, address: '' })
  }

  return out
}

/** Il modello a volte propone durate assurde: le riportiamo nel plausibile. */
function sane(min: number): number {
  if (!Number.isFinite(min) || min <= 0) return 60
  return Math.min(300, Math.max(15, Math.round(min)))
}

/**
 * Il campo è una stringa libera (vedi PlaceSchema), quindi può arrivare
 * "Mattina", "morning" o qualunque variante: tutto ciò che non riconosciamo
 * diventa "nessuna preferenza" invece di finire nell'itinerario come rumore.
 */
function normalizeTime(v: string | undefined): Poi['bestTimeOfDay'] {
  const s = (v ?? '').toLowerCase().trim()
  if (s.startsWith('matt') || s.startsWith('morn')) return 'mattina'
  if (s.startsWith('pome') || s.startsWith('after')) return 'pomeriggio'
  if (s.startsWith('sera') || s.startsWith('even') || s.startsWith('nott')) return 'sera'
  return undefined
}
