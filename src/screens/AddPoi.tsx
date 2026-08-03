import { useEffect, useRef, useState } from 'react'
import type { Poi } from '../lib/types'
import { searchPlaces, type PlaceHit } from '../lib/photon'
import { describeKind } from '../lib/kinds'
import { formatDistance, haversineM } from '../lib/geo'
import { describeError, hasApiKey, parsePlaces, suggestPlaces } from '../lib/ai'
import { resolvePlaces, type ResolvedPlace } from '../lib/resolve'
import { toEnglishQuery } from '../lib/italian'
import { Button, Notice, ScreenTitle, SectionLabel } from '../components/ui'
import { IconCheck, IconPlus, IconSearch, IconWarn } from '../components/Icon'

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

/**
 * Un campo solo.
 *
 * Prima c'erano due tab da scegliere *prima* di sapere cosa si voleva:
 * «Cerca per nome» e «Scrivi libero». Ma la scelta giusta dipende da come
 * ti viene in mente il posto, non da una decisione presa in anticipo. Qui
 * si scrive e basta; se quello che hai scritto non è un nome, l'AI è due
 * righe più in basso.
 */
export default function AddPoi({ onAdd, dayPois, hotel }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const q = query.trim()
  // La query davvero spedita a OpenStreetMap. Mostrarla spiega da sé una
  // lista vuota — e perché "museo di storia naturale" trova qualcosa.
  const english = q.length >= 2 ? toEnglishQuery(q) : null

  useEffect(() => {
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
  }, [q])

  function add(hit: PlaceHit) {
    onAdd({
      name: hit.name,
      address: hit.address,
      lat: hit.lat,
      lng: hit.lng,
      durationMin: 60,
      category: describeKind(hit.kindKey, hit.kind).label,
    })
    setAdded(hit.name)
    setQuery('')
    setHits([])
    setTimeout(() => setAdded(null), 2500)
  }

  const alreadyThere = new Set(dayPois.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`))
  const origin = hotel ?? LONDON

  return (
    <div className="mx-auto max-w-lg px-[18px] pb-6 pt-5">
      <ScreenTitle>Aggiungi tappe</ScreenTitle>

      <div className="mt-4">
        <div className="flex h-[52px] items-center gap-2.5 rounded-2xl border border-ink/[0.12] bg-white px-3.5 shadow-card-xs focus-within:border-ink/30">
          <IconSearch size={18} className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="British Museum, Camden Market…"
            autoComplete="off"
            autoCorrect="off"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-fainter"
          />
          {/* Il badge dice che la query è stata tradotta prima di partire. */}
          {english && <span className="shrink-0 text-xs text-fainter">EN</span>}
        </div>
        {english && (
          <p className="px-1 pt-2 text-[13px] text-faint">
            Cerco «{english}» su OpenStreetMap
          </p>
        )}
      </div>

      {added && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-moss-mid/10 px-3 py-2.5 text-sm text-moss">
          <IconCheck size={16} />
          Aggiunto: {added}
        </p>
      )}
      {busy && <p className="mt-3 px-1 text-sm text-faint">Cerco…</p>}
      {error && (
        <div className="mt-3">
          <Notice tone="warn" icon={<IconWarn size={18} />}>
            {error}
          </Notice>
        </div>
      )}

      {hits.length > 0 && (
        <ul className="mt-3 space-y-1">
          {hits.map((h, i) => {
            const dup = alreadyThere.has(`${h.lat.toFixed(4)},${h.lng.toFixed(4)}`)
            const kind = describeKind(h.kindKey, h.kind)
            const distance = formatDistance(haversineM(origin, h))
            // Il primo risultato è quello giusto quasi sempre: è l'unico
            // con il tasto pieno, così si aggiunge senza leggere il resto.
            const primary = i === 0 && !dup

            return (
              <li
                key={i}
                className={`flex items-center gap-3 px-4 py-3.5 ${
                  primary
                    ? 'rounded-[18px] border border-ink/[0.08] bg-white shadow-card-xs'
                    : dup
                      ? 'opacity-50'
                      : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{h.name}</span>
                    {/* Categoria: è ciò che distingue la torre dalla pescheria
                        quando due risultati si chiamano entrambi "Big Ben". */}
                    <span className="shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 text-xs text-soft">
                      {kind.label}
                    </span>
                  </div>
                  {h.address && (
                    <p className="mt-0.5 truncate text-[13px] text-soft">{h.address}</p>
                  )}
                  <p className="mt-0.5 text-[13px] text-faint">
                    {distance} {hotel ? "dall'alloggio" : 'dal centro'}
                  </p>
                </div>

                {dup ? (
                  <span className="shrink-0 text-[13px] text-faint">già in lista</span>
                ) : (
                  <button
                    onClick={() => add(h)}
                    aria-label={`Aggiungi ${h.name}`}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] transition-colors ${
                      primary
                        ? 'bg-ink text-paper active:bg-ink-hover'
                        : 'border border-ink/[0.14] text-ink active:bg-ink/[0.04]'
                    }`}
                  >
                    <IconPlus size={18} width={2.2} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {q.length >= 2 && !busy && hits.length === 0 && !error && (
        <p className="mt-4 px-1 text-sm text-faint">
          Nessun posto trovato. Prova col nome inglese, o descrivilo qui sotto.
        </p>
      )}

      <AiPanel onAdd={onAdd} dayPois={dayPois} />
    </div>
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
      const places = kind === 'parse' ? await parsePlaces(q) : await suggestPlaces(q, context)

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
    <section className="mt-6 border-t border-ink/[0.08] pt-5">
      <SectionLabel>Oppure scrivi a ruota libera</SectionLabel>

      {!hasApiKey() ? (
        <p className="mt-3 rounded-[18px] bg-ink/[0.04] px-4 py-4 text-[15px] leading-relaxed text-soft">
          Con la chiave Anthropic puoi scrivere «british museum, camden, un pub storico» e farti
          proporre posti. Si incolla in <b className="text-ink">Setup</b>.
        </p>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="«british museum, camden, la casa di sherlock» — oppure «cosa vedo vicino a Covent Garden?»"
            className="mt-3 w-full resize-none rounded-[18px] bg-ink/[0.04] px-4 py-3.5 text-[15px] leading-relaxed outline-none ring-1 ring-transparent placeholder:text-faint focus:ring-ink/20"
          />

          <div className="mt-2 flex gap-2">
            <Button
              className="flex-1"
              onClick={() => void run('parse')}
              disabled={!text.trim() || busy !== null}
            >
              {busy === 'parse' ? 'Cerco…' : 'Estrai i posti'}
            </Button>
            <Button
              className="flex-1"
              onClick={() => void run('suggest')}
              disabled={!text.trim() || busy !== null}
            >
              {busy === 'suggest' ? 'Penso…' : 'Proponi tu'}
            </Button>
          </div>

          <p className="mt-2.5 text-[13px] leading-relaxed text-faint">
            Ogni proposta viene verificata sulla mappa: se non esiste, non entra nell'itinerario.
          </p>

          {busy && (
            <p className="mt-3 animate-pulse text-sm text-faint">
              Chiedo a Claude e verifico ogni posto sulla mappa…
            </p>
          )}
          {error && (
            <div className="mt-3">
              <Notice tone="warn" icon={<IconWarn size={18} />}>
                {error}
              </Notice>
            </div>
          )}

          {results && (
            <>
              <ul className="mt-4 space-y-1.5">
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
                      className={`w-full rounded-[18px] px-4 py-3.5 text-left transition-colors ${
                        !r.poi
                          ? 'bg-ink/[0.03] opacity-60'
                          : chosen.has(i)
                            ? 'border border-ink/[0.14] bg-white shadow-card-xs'
                            : 'bg-ink/[0.04]'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold">
                          {r.poi?.name ?? r.ai.displayName}
                        </span>
                        <span className="shrink-0">
                          {r.poi ? (
                            chosen.has(i) ? (
                              <IconCheck size={16} className="text-moss-mid" />
                            ) : (
                              <IconPlus size={16} className="text-fainter" />
                            )
                          ) : (
                            <IconWarn size={16} className="text-amber" />
                          )}
                        </span>
                      </div>

                      {r.poi ? (
                        <>
                          <p className="mt-0.5 truncate text-[13px] text-soft">{r.address}</p>
                          <p className="mt-1 text-[13px] text-faint">
                            {r.ai.category} · {r.poi.durationMin} min
                            {r.poi.bestTimeOfDay ? ` · meglio ${r.poi.bestTimeOfDay}` : ''}
                          </p>
                          {r.ai.note && (
                            <p className="mt-1 text-[13px] italic text-faint">{r.ai.note}</p>
                          )}
                          {r.poi.openingHours && (
                            <p className="mt-1 text-[13px] text-amber">
                              orari {r.poi.openingHours} — da verificare
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="mt-0.5 text-[13px] text-amber">
                          Non trovato sulla mappa: non posso aggiungerlo senza coordinate.
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>

              <Button
                variant="primary"
                size="lg"
                block
                onClick={addChosen}
                disabled={chosenCount === 0}
                className="mt-3"
              >
                Aggiungi {chosenCount} {chosenCount === 1 ? 'posto' : 'posti'}
              </Button>
            </>
          )}
        </>
      )}
    </section>
  )
}
