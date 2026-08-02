import { useEffect, useRef, useState } from 'react'
import type { Poi } from '../lib/types'
import { searchPlaces, type PlaceHit } from '../lib/photon'

type Props = {
  onAdd: (poi: Omit<Poi, 'id'>) => void
  dayPois: Poi[]
}

/** Photon è gratuito e senza chiave: il debounce è rispetto, non cosmesi. */
const DEBOUNCE_MS = 600

export default function AddPoi({ onAdd, dayPois }: Props) {
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
    <div className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-bold">Cosa vuoi vedere?</h1>
      <p className="mt-1 text-sm text-slate-400">
        Scrivi il nome di un posto e toccalo per aggiungerlo alla giornata.
      </p>

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
          return (
            <li key={i}>
              <button
                onClick={() => add(h)}
                disabled={dup}
                className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-left ring-1 ring-slate-800 active:bg-slate-800 disabled:opacity-40"
              >
                <p className="font-medium">{h.name}</p>
                <p className="text-xs text-slate-500">
                  {dup ? 'già nella giornata' : h.address || h.kind}
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
    </div>
  )
}
