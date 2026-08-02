import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { Poi } from './types'

const KEY_STORAGE = 'ax-travel:anthropic-key:v1'

/**
 * La chiave vive solo qui, sul telefono. Non è mai nel codice pubblicato
 * né viene inviata a nessuno tranne api.anthropic.com.
 */
export function loadApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE)
  } catch {
    return null
  }
}

export function saveApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim())
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE)
}

export function hasApiKey(): boolean {
  return Boolean(loadApiKey())
}

export class MissingKeyError extends Error {
  constructor() {
    super('Chiave Anthropic non configurata')
  }
}

function client(): Anthropic {
  const apiKey = loadApiKey()
  if (!apiKey) throw new MissingKeyError()
  // Senza questo flag l'SDK rifiuta di girare nel browser: non manda
  // l'header che serve ad Anthropic per accettare la richiesta via CORS.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

const MODEL = 'claude-opus-5'

/* -------------------------------------------------------------------------
 * Schemi
 *
 * Il modello non produce mai coordinate: restituisce una query di ricerca
 * che passa da Photon/OpenStreetMap. È così che un posto inventato non
 * finisce nell'itinerario — se non esiste sulla mappa, non entra.
 * ---------------------------------------------------------------------- */

/**
 * Campi liberi invece di z.enum: l'helper zod→JSON Schema non traduce gli
 * enum in vincoli veri, li mette solo nella descrizione. Un valore fuori
 * lista farebbe fallire la validazione a runtime e perderebbe l'intera
 * risposta — meglio accettare e normalizzare noi.
 */
const PlaceSchema = z.object({
  searchQuery: z
    .string()
    .describe('Nome inglese esatto da cercare su OpenStreetMap, es. "Natural History Museum"'),
  displayName: z.string().describe('Nome del posto in italiano o nella forma comune'),
  category: z
    .string()
    .describe('Una di: museo, monumento, parco, mercato, quartiere, chiesa, galleria, locale, negozio, altro'),
  durationMin: z.number().describe('Minuti di visita consigliati, realistici'),
  bestTimeOfDay: z.string().describe('Una di: mattina, pomeriggio, sera, indifferente'),
  openingHours: z.string().describe('Orari tipici, es. "10-17:30". Stringa vuota se incerti.'),
  note: z.string().describe('Una riga di contesto utile, max 15 parole'),
})

const PlacesSchema = z.object({
  places: z.array(PlaceSchema),
})

export type AiPlace = z.infer<typeof PlaceSchema>

const SYSTEM_LONDON = `Sei un esperto di Londra che aiuta un viaggiatore italiano.

Regole:
- Ogni posto deve esistere davvero e trovarsi a Londra o nei dintorni raggiungibili coi mezzi.
- searchQuery deve essere il nome INGLESE ufficiale con cui il posto è mappato su
  OpenStreetMap, senza articoli e senza città. Esempi: "Natural History Museum",
  "Borough Market", "Tower of London".
- durationMin deve essere realistico: un grande museo 120-180, una chiesa 30,
  un mercato 60, un quartiere da girare 90.
- Se una richiesta è vaga ("un pub storico", "un mercatino"), scegli tu posti
  concreti e noti che la soddisfano, invece di rispondere in modo generico.
- Non inventare: se non conosci un posto, omettilo.`

/** Da testo libero a una lista di posti concreti e verificabili. */
export async function parsePlaces(text: string): Promise<AiPlace[]> {
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_LONDON,
    output_config: { format: zodOutputFormat(PlacesSchema), effort: 'low' },
    messages: [
      {
        role: 'user',
        content: `Estrai i posti da visitare da questo testo. Testo: """${text}"""`,
      },
    ],
  })
  return res.parsed_output?.places ?? []
}

/** Proposte a partire da una richiesta libera ("cosa vedo vicino a Soho?"). */
export async function suggestPlaces(request: string, context: string): Promise<AiPlace[]> {
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_LONDON,
    output_config: { format: zodOutputFormat(PlacesSchema), effort: 'low' },
    messages: [
      {
        role: 'user',
        content:
          `Proponi da 3 a 6 posti a Londra per questa richiesta: """${request}"""\n\n` +
          `${context}\n\nNon riproporre posti già in programma.`,
      },
    ],
  })
  return res.parsed_output?.places ?? []
}

/* -------------------------------------------------------------------------
 * Arricchimento di tappe già inserite
 * ---------------------------------------------------------------------- */

const EnrichSchema = z.object({
  places: z.array(
    z.object({
      id: z.string().describe('Lo stesso id ricevuto'),
      durationMin: z.number().describe('Minuti di visita realistici per questo posto'),
      openingHours: z.string().describe('Orari tipici, es. "10-17:30". Vuoto se incerti.'),
      bestTimeOfDay: z.string().describe('Una di: mattina, pomeriggio, sera, indifferente'),
      note: z.string().describe('Una riga utile, max 15 parole'),
    }),
  ),
})

export type EnrichedPlace = {
  id: string
  durationMin: number
  openingHours: string
  bestTimeOfDay: 'mattina' | 'pomeriggio' | 'sera' | undefined
  note: string
}

/**
 * Una tappa aggiunta cercandola per nome nasce con 60 minuti di default,
 * uguale per il British Museum e per una piazza. Qui il modello dà a
 * ciascuna una durata sensata, più orari e momento migliore.
 */
export async function enrichPlaces(
  places: { id: string; name: string }[],
): Promise<EnrichedPlace[]> {
  const list = places.map((p) => `- id=${p.id} · ${p.name}`).join('\n')

  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_LONDON,
    output_config: { format: zodOutputFormat(EnrichSchema), effort: 'low' },
    messages: [
      {
        role: 'user',
        content:
          'Per ognuna di queste tappe a Londra indica quanto tempo serve davvero ' +
          'a visitarla, gli orari tipici e il momento migliore della giornata. ' +
          `Usa esattamente gli id ricevuti.\n\n${list}`,
      },
    ],
  })

  return (res.parsed_output?.places ?? []).map((p) => ({
    id: p.id,
    durationMin: clampDuration(p.durationMin),
    openingHours: p.openingHours?.trim() ?? '',
    bestTimeOfDay: normalizeTimeOfDay(p.bestTimeOfDay),
    note: p.note?.trim() ?? '',
  }))
}

function clampDuration(min: number): number {
  if (!Number.isFinite(min) || min <= 0) return 60
  return Math.min(300, Math.max(15, Math.round(min)))
}

function normalizeTimeOfDay(v: string | undefined): EnrichedPlace['bestTimeOfDay'] {
  const s = (v ?? '').toLowerCase().trim()
  if (s.startsWith('matt') || s.startsWith('morn')) return 'mattina'
  if (s.startsWith('pome') || s.startsWith('after')) return 'pomeriggio'
  if (s.startsWith('sera') || s.startsWith('even')) return 'sera'
  return undefined
}

/* -------------------------------------------------------------------------
 * Riordino
 * ---------------------------------------------------------------------- */

const OrderSchema = z.object({
  orderedIds: z.array(z.string()).describe('Gli stessi id ricevuti, riordinati'),
  rationale: z.string().describe('Una frase sul perché di questo ordine'),
})

export type ReorderResult = { orderedIds: string[]; rationale: string }

/**
 * Rifinisce un ordine già calcolato sui tempi reali di viaggio, tenendo
 * conto di orari e momento migliore della giornata.
 *
 * Ritorna null se la risposta non è una permutazione esatta degli id in
 * ingresso: un'allucinazione può peggiorare l'ordine, non cancellare tappe.
 */
export async function reorderDay(
  pois: Poi[],
  baselineIds: string[],
): Promise<ReorderResult | null> {
  const list = baselineIds
    .map((id) => pois.find((p) => p.id === id))
    .filter((p): p is Poi => Boolean(p))
    .map((p) => {
      const bits = [`id=${p.id}`, p.name, `${p.durationMin} min`]
      if (p.openingHours) bits.push(`orari ${p.openingHours}`)
      if (p.bestTimeOfDay) bits.push(`meglio ${p.bestTimeOfDay}`)
      return '- ' + bits.join(' · ')
    })
    .join('\n')

  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system:
      'Ordini itinerari a Londra. L\'ordine che ricevi è già ottimizzato sui tempi ' +
      'reali di viaggio coi mezzi: modificalo solo dove orari di apertura o momento ' +
      'migliore della giornata lo giustificano. Usa esattamente gli id ricevuti, ' +
      'tutti e una volta sola.',
    output_config: { format: zodOutputFormat(OrderSchema), effort: 'low' },
    messages: [
      {
        role: 'user',
        content: `Tappe di oggi, già ordinate per tempi di viaggio:\n${list}`,
      },
    ],
  })

  const out = res.parsed_output
  if (!out) return null

  // La validazione è il punto in cui l'AI smette di poter fare danni.
  const expected = [...baselineIds].sort().join(',')
  const got = [...out.orderedIds].sort().join(',')
  if (expected !== got) return null

  return out
}

/** Verifica che la chiave funzioni davvero, con la chiamata più economica possibile. */
export async function testApiKey(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await client().messages.create({
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: describeError(e) }
  }
}

export function describeError(e: unknown): string {
  if (e instanceof MissingKeyError) return 'Chiave Anthropic non configurata (vai in Setup).'
  const status = (e as { status?: number }).status
  if (status === 401) return 'Chiave non valida o revocata.'
  if (status === 403) return 'La chiave non ha i permessi necessari.'
  if (status === 429) return 'Troppe richieste: aspetta qualche secondo e riprova.'
  if (status === 400) return 'Richiesta rifiutata dal modello. Riprova con parole diverse.'
  if (status && status >= 500) return 'Servizio Anthropic momentaneamente non disponibile.'
  const msg = (e as Error)?.message ?? ''
  if (/fetch|network/i.test(msg)) return 'Rete non raggiungibile.'
  return msg || 'Errore imprevisto.'
}
