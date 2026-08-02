import { useEffect, useRef, useState } from 'react'
import type { Poi } from '../lib/types'
import { searchPlaces, type PlaceHit } from '../lib/photon'
import { describeKind } from '../lib/kinds'
import { formatDistance, haversineM } from '../lib/geo'
import { describeError, hasApiKey, parsePlaces, suggestPlaces } from '../lib/ai'
import { resolvePlaces, type ResolvedPlace } from '../lib/resolve'

type Props = {
  onAdd: (poi: Omit<Poi, 'id'>) => void
  dayPois: Poi[]
  /** Se c'è l'hotel, le distanze si leggono da lì: è il tuo riferimento. */
  hotel: Poi | null
}

/** Photon è gratuito e senza chiave: il debounce è rispetto, non cosmesi. */
const DEBOUNCE_MS = 600

/** Centro di Londra: riferimento di ripiego finché non c'è l'hotel. */
const LONDON = { lat: 51.5074, lng: -0.1278 }

type Mode = 'search' | 'ai'

export default function AddPoi({ onAdd, dayPois, hotel }: Props) {
  const [mode, setMode] = useState<Mode>('search')

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-bold">Cosa vuoi vedere?</h1>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-900 p-1 ring-1 ring-slate-800">
        {(['search', 'ai'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-xl py-2.5 text-sm font-medium transition-colors ${
              mode === m ? 'bg-sky-600' : 'text-slate-400 active:bg-slate-800'
            }`}
          >
            {m === 'search' ? 'Cerca per nome' : '✨ Scrivi libero'}
          </button>
        ))}
      </div>

      {mode === 'search' ? (
        <SearchPanel onAdd={onAdd} dayPois={dayPois} hotel={hotel} />
      ) : (
        <AiPanel onAdd={onAdd} dayPois={dayPois} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ricerca per nome                                                    */
/* ------------------------------------------------------------------ */

function SearchPanel({ onAdd, dayPois, hotel }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      setError(null)
      return
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setBusy(true)
      setError(null)
      try {
        setHits(await searchPlaces(q, ctrl.signal))
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('Ricerca non disponibile. Riprova.')
      } finally {
        if (!ctrl.signal.aborted) setBusy(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  function add(hit: PlaceHit) {
    onAdd({
      name: hit.name,
      address: hit.address,
      lat: hit.lat,
      lng: hit.lng,
      durationMin: 60,
      category: hit.kind || undefined,
    })
    setAdded(hit.name)
    setQuery('')
    setHits([])
    setTimeout(() => setAdded(null), 2500)
  }

  const alreadyThere = new Set(dayPois.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`))

  return (
    <>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="British Museum, Camden Market…"
        autoComplete="off"
        autoCorrect="off"
        className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-4 text-base outline-none ring-1 ring-slate-800 placeholder:text-slate-600 focus:ring-sky-600"
      />

      {added && (
        <p className="mt-3 rounded-lg bg-emerald-950/60 px-3 py-2 text-sm text-emerald-300">
          Aggiunto: {added}
        </p>
      )}
      {busy && <p className="mt-3 text-sm text-slate-500">Cerco…</p>}
      {error && <p className="mt-3 text-sm text-amber-400">{error}</p>}

      <ul className="mt-4 space-y-2">
        {hits.map((h, i) => {
          const dup = alreadyThere.has(`${h.lat.toFixed(4)},${h.lng.toFixed(4)}`)
          const kind = describeKind(h.kindKey, h.kind)
          const origin = hotel ?? LONDON
          const distance = formatDistance(haversineM(origin, h))

          return (
            <li key={i}>
              <button
                onClick={() => add(h)}
                disabled={dup}
                className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-left ring-1 ring-slate-800 active:bg-slate-800 disabled:opacity-40"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate font-medium">{h.name}</p>
                  {/* Categoria e distanza: sono le due cose che distinguono
                      due risultati con lo stesso nome. */}
                  <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
                    {kind.icon} {kind.label}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {dup ? 'già nella giornata' : h.address || 'indirizzo non disponibile'}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {distance} {hotel ? "dall'alloggio" : 'dal centro'}
                </p>
              </button>
            </li>
          )
        })}
      </ul>

      {query.trim().length >= 2 && !busy && hits.length === 0 && !error && (
        <p className="mt-4 text-sm text-slate-500">
          Nessun posto trovato. Prova col nome inglese.
        </p>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Testo libero con AI                                                 */
/* ------------------------------------------------------------------ */

function AiPanel({ onAdd, dayPois }: Omit<Props, 'hotel'>) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<null | 'parse' | 'suggest'>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<ResolvedPlace[] | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())

  if (!hasApiKey()) {
    return (
      <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <p className="font-medium">Serve la chiave Anthropic</p>
        <p className="mt-2 text-sm text-slate-400">
          Con la chiave puoi scrivere liberamente (“british museum, camden, un pub
          storico”) e farti proporre posti. Incollala in <b>Setup</b>.
        </p>
      </div>
    )
  }

  async function run(kind: 'parse' | 'suggest') {
    const q = text.trim()
    if (!q) return
    setBusy(kind)
    setError(null)
    setResults(null)
    try {
      const context =
        dayPois.length > 0
          ? `Già in programma: ${dayPois.map((p) => p.name).join(', ')}.`
          : 'Non c’è ancora nulla in programma.'
      const places =
        kind === 'parse' ? await parsePlaces(q) : await suggestPlaces(q, context)

      if (places.length === 0) {
        setError('Non ho trovato posti in questa richiesta. Prova a essere più specifico.')
        return
      }
      // Le coordinate arrivano dalla mappa, non dal modello.
      const resolved = await resolvePlaces(places)
      setResults(resolved)
      setChosen(new Set(resolved.map((r, i) => (r.verified ? i : -1)).filter((i) => i >= 0)))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(null)
    }
  }

  function addChosen() {
    results?.forEach((r, i) => {
      if (chosen.has(i) && r.poi) onAdd(r.poi)
    })
    setResults(null)
    setText('')
    setChosen(new Set())
  }

  const chosenCount = results?.filter((r, i) => chosen.has(i) && r.poi).length ?? 0

  return (
    <>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="british museum, camden market, la casa di sherlock holmes…&#10;oppure: cosa vedo vicino a Covent Garden?"
        className="mt-4 w-full resize-none rounded-2xl bg-slate-900 px-4 py-4 text-base outline-none ring-1 ring-slate-800 placeholder:text-slate-600 focus:ring-sky-600"
      />

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => void run('parse')}
          disabled={!text.trim() || busy !== null}
          className="rounded-2xl bg-sky-600 py-3 font-semibold active:bg-sky-700 disabled:opacity-40"
        >
          {busy === 'parse' ? 'Cerco…' : 'Estrai i posti'}
        </button>
        <button
          onClick={() => void run('suggest')}
          disabled={!text.trim() || busy !== null}
          className="rounded-2xl bg-slate-800 py-3 font-semibold active:bg-slate-700 disabled:opacity-40"
        >
          {busy === 'suggest' ? 'Penso…' : 'Proponi tu'}
        </button>
      </div>

      {busy && (
        <p className="mt-3 animate-pulse text-sm text-slate-500">
          Chiedo a Claude e verifico ogni posto sulla mappa…
        </p>
      )}
      {error && <p className="mt-3 text-sm text-amber-400">{error}</p>}

      {results && (
        <>
          <ul className="mt-4 space-y-2">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    if (!r.poi) return
                    const next = new Set(chosen)
                    next.has(i) ? next.delete(i) : next.add(i)
                    setChosen(next)
                  }}
                  disabled={!r.poi}
                  className={`w-full rounded-2xl px-4 py-3 text-left ring-1 transition-colors ${
                    !r.poi
                      ? 'bg-slate-900/50 opacity-60 ring-slate-800'
                      : chosen.has(i)
                        ? 'bg-sky-950/60 ring-sky-700'
                        : 'bg-slate-900 ring-slate-800'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate font-medium">
                      {r.poi?.name ?? r.ai.displayName}
                    </p>
                    <span className="shrink-0 text-sm">
                      {r.poi ? (chosen.has(i) ? '✓' : '○') : '⚠️'}
                    </span>
                  </div>

                  {r.poi ? (
                    <>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{r.address}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {r.ai.category} · {r.poi.durationMin} min
                        {r.poi.bestTimeOfDay ? ` · meglio ${r.poi.bestTimeOfDay}` : ''}
                      </p>
                      {r.ai.note && (
                        <p className="mt-1 text-xs italic text-slate-500">{r.ai.note}</p>
                      )}
                      {r.poi.openingHours && (
                        <p className="mt-1 text-xs text-amber-500/80">
                          orari {r.poi.openingHours} — da verificare
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-0.5 text-xs text-amber-500">
                      Non trovato sulla mappa: non posso aggiungerlo senza coordinate.
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={addChosen}
            disabled={chosenCount === 0}
            className="mt-3 w-full rounded-2xl bg-emerald-600 py-4 font-semibold active:bg-emerald-700 disabled:opacity-40"
          >
            Aggiungi {chosenCount} {chosenCount === 1 ? 'posto' : 'posti'}
          </button>
        </>
      )}
    </>
  )
}
