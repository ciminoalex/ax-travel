import { useState } from 'react'
import type { Poi, Trip } from '../lib/types'
import { optimizeDay } from '../lib/optimize'
import { describeError, enrichPlaces, hasApiKey, reorderDay } from '../lib/ai'
import { areaLabel } from '../lib/split'

type Props = {
  trip: Trip
  dayIndex: number
  dayPois: Poi[]
  onSelectDay: (i: number) => void
  onAddDay: () => void
  onRemoveDay: (i: number) => void
  onSplit: (days: number) => void
  onMoveToDay: (poiId: string, day: number) => void
  onRemove: (id: string) => void
  onReorder: (from: number, to: number) => void
  onUpdate: (id: string, patch: Partial<Poi>) => void
  onSetOrder: (ids: string[]) => void
}

type Busy =
  | { kind: 'none' }
  | { kind: 'optimize'; done: number; total: number; step: string }
  | { kind: 'enrich' }

type Notice = { tone: 'ok' | 'warn'; lines: string[] } | null

export default function DayPlan(props: Props) {
  const { trip, dayIndex, dayPois, onUpdate } = props
  const [busy, setBusy] = useState<Busy>({ kind: 'none' })
  const [notice, setNotice] = useState<Notice>(null)
  const [moving, setMoving] = useState<string | null>(null)

  const visited = dayPois.filter((p) => p.visitedAt).length
  const totalMin = dayPois.filter((p) => !p.visitedAt).reduce((s, p) => s + p.durationMin, 0)

  async function optimize() {
    const pending = dayPois.filter((p) => !p.visitedAt)
    if (pending.length < 3) {
      setNotice({ tone: 'warn', lines: ['Servono almeno 3 tappe da visitare.'] })
      return
    }

    setBusy({ kind: 'optimize', done: 0, total: 1, step: 'Calcolo i tempi tra le tappe…' })
    setNotice(null)
    try {
      const { orderedIds, degraded, skipped } = await optimizeDay(
        pending,
        trip.hotel,
        trip.walkPenalty,
        (done, total) =>
          setBusy({ kind: 'optimize', done, total, step: 'Calcolo i tempi tra le tappe…' }),
      )

      let finalIds = orderedIds
      const lines = ['Giro riordinato per ridurre tempi e camminata.']

      // L'AI rifinisce un ordine già valido: se la sua risposta non è una
      // permutazione esatta, teniamo quello calcolato.
      if (hasApiKey()) {
        setBusy({
          kind: 'optimize',
          done: 1,
          total: 1,
          step: 'Chiedo a Claude di tenere conto degli orari…',
        })
        try {
          const refined = await reorderDay(pending, orderedIds)
          if (refined) {
            finalIds = refined.orderedIds
            lines.push(refined.rationale)
          }
        } catch {
          // L'ordine sui tempi reali resta comunque buono.
        }
      }

      if (degraded) lines.push('TfL non ha risposto: ordine basato sulle distanze.')
      if (skipped > 0) {
        lines.push(`Le ultime ${skipped} tappe sono rimaste come stavano (oltre le 8 servirebbero troppe richieste).`)
      }

      const visitedIds = dayPois.filter((p) => p.visitedAt).map((p) => p.id)
      props.onSetOrder([...visitedIds, ...finalIds])
      setNotice({ tone: degraded ? 'warn' : 'ok', lines })
    } catch (e) {
      setNotice({ tone: 'warn', lines: [describeError(e)] })
    } finally {
      setBusy({ kind: 'none' })
    }
  }

  /** Stima durate e orari reali sulle tappe aggiunte per nome. */
  async function enrich() {
    const targets = dayPois.filter((p) => !p.visitedAt)
    if (targets.length === 0) return
    setBusy({ kind: 'enrich' })
    setNotice(null)
    try {
      const info = await enrichPlaces(targets.map((p) => ({ id: p.id, name: p.name })))
      let touched = 0
      for (const item of info) {
        const poi = targets.find((p) => p.id === item.id)
        if (!poi) continue
        onUpdate(poi.id, {
          durationMin: item.durationMin,
          openingHours: item.openingHours || undefined,
          bestTimeOfDay: item.bestTimeOfDay,
          note: item.note || undefined,
        })
        touched++
      }
      setNotice({
        tone: 'ok',
        lines: [`Aggiornate ${touched} tappe con durate e orari indicativi.`],
      })
    } catch (e) {
      setNotice({ tone: 'warn', lines: [describeError(e)] })
    } finally {
      setBusy({ kind: 'none' })
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <DayTabs {...props} />

      <div className="mt-3 flex items-baseline justify-between">
        <h1 className="text-xl font-bold">
          {dayPois.length === 0 ? 'Giornata vuota' : areaLabel(dayPois) || 'La giornata'}
        </h1>
        <p className="text-sm text-slate-500">
          {visited}/{dayPois.length} visitati
          {totalMin > 0 && ` · ${formatHours(totalMin)} di visite`}
        </p>
      </div>

      {dayPois.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">
          Nessuna tappa in questa giornata.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => void optimize()}
              disabled={busy.kind !== 'none'}
              className="rounded-2xl bg-slate-800 py-3 text-sm font-semibold active:bg-slate-700 disabled:opacity-50"
            >
              {busy.kind === 'optimize' ? 'Ottimizzo…' : '⚡ Ottimizza il giro'}
            </button>
            <button
              onClick={() => void enrich()}
              disabled={busy.kind !== 'none' || !hasApiKey()}
              title={hasApiKey() ? undefined : 'Serve la chiave Anthropic'}
              className="rounded-2xl bg-slate-800 py-3 text-sm font-semibold active:bg-slate-700 disabled:opacity-40"
            >
              {busy.kind === 'enrich' ? 'Stimo…' : '✨ Stima durate'}
            </button>
          </div>

          {busy.kind === 'optimize' && (
            <div className="mt-2 rounded-xl bg-slate-900 px-3 py-2">
              <p className="text-xs text-slate-400">{busy.step}</p>
              {busy.total > 1 && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-sky-500 transition-all"
                    style={{ width: `${Math.round((busy.done / busy.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {busy.kind === 'enrich' && (
            <p className="mt-2 animate-pulse text-xs text-slate-400">
              Chiedo a Claude durate e orari…
            </p>
          )}

          {notice && (
            <div
              className={`mt-2 rounded-xl px-3 py-2 ${
                notice.tone === 'ok' ? 'bg-emerald-950/50' : 'bg-amber-950/50'
              }`}
            >
              {notice.lines.map((l, i) => (
                <p
                  key={i}
                  className={`text-xs ${
                    notice.tone === 'ok'
                      ? i === 0
                        ? 'text-emerald-300'
                        : 'text-emerald-200/70'
                      : 'text-amber-300'
                  }`}
                >
                  {l}
                </p>
              ))}
            </div>
          )}

          <ul className="mt-4 space-y-2">
            {dayPois.map((p, i) => (
              <li
                key={p.id}
                className={`rounded-2xl bg-slate-900 p-3 ring-1 ring-slate-800 ${
                  p.visitedAt ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold">
                    {i + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${p.visitedAt ? 'line-through' : ''}`}>{p.name}</p>
                    {p.address && <p className="truncate text-xs text-slate-500">{p.address}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>⏱️ {p.durationMin} min</span>
                      {p.category && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5">{p.category}</span>
                      )}
                      {p.bestTimeOfDay && <span>meglio {p.bestTimeOfDay}</span>}
                    </div>
                    {p.openingHours && (
                      <p className="mt-1 text-xs text-amber-500/70">
                        orari {p.openingHours} — da verificare
                      </p>
                    )}
                    {p.note && <p className="mt-1 text-xs italic text-slate-500">{p.note}</p>}
                  </div>

                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      onClick={() => props.onReorder(i, i - 1)}
                      disabled={i === 0}
                      aria-label="Sposta su"
                      className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs active:bg-slate-700 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => props.onReorder(i, i + 1)}
                      disabled={i === dayPois.length - 1}
                      aria-label="Sposta giù"
                      className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs active:bg-slate-700 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-800 pt-2 text-xs">
                  <button
                    onClick={() =>
                      onUpdate(p.id, {
                        visitedAt: p.visitedAt ? undefined : new Date().toISOString(),
                      })
                    }
                    className="rounded-lg bg-slate-800 px-3 py-1.5 active:bg-slate-700"
                  >
                    {p.visitedAt ? 'Da rivedere' : 'Visitato ✓'}
                  </button>

                  {trip.days.length > 1 && (
                    <button
                      onClick={() => setMoving(moving === p.id ? null : p.id)}
                      className="rounded-lg bg-slate-800 px-3 py-1.5 active:bg-slate-700"
                    >
                      Sposta →
                    </button>
                  )}

                  <button
                    onClick={() => props.onRemove(p.id)}
                    className="ml-auto rounded-lg px-3 py-1.5 text-rose-400 active:bg-rose-950/50"
                  >
                    Rimuovi
                  </button>
                </div>

                {moving === p.id && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-800 pt-2">
                    {trip.days.map((_, di) =>
                      di === dayIndex ? null : (
                        <button
                          key={di}
                          onClick={() => {
                            props.onMoveToDay(p.id, di)
                            setMoving(null)
                          }}
                          className="rounded-lg bg-sky-900/60 px-3 py-1.5 text-xs active:bg-sky-800"
                        >
                          Giorno {di + 1}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** Selettore delle giornate, con distribuzione per zona. */
function DayTabs({ trip, dayIndex, onSelectDay, onAddDay, onRemoveDay, onSplit }: Props) {
  const [splitting, setSplitting] = useState(false)
  const totalPois = trip.days.reduce((s, d) => s + d.poiIds.length, 0)

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {trip.days.map((d, i) => (
          <button
            key={i}
            onClick={() => onSelectDay(i)}
            className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
              i === dayIndex ? 'bg-sky-600' : 'bg-slate-900 text-slate-400 active:bg-slate-800'
            }`}
          >
            G{i + 1}
            <span className="ml-1.5 opacity-70">{d.poiIds.length}</span>
          </button>
        ))}
        <button
          onClick={onAddDay}
          aria-label="Aggiungi giornata"
          className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-xs text-slate-400 active:bg-slate-800"
        >
          +
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span className="text-slate-600">{formatDate(trip.days[dayIndex]?.date)}</span>
        {trip.days.length > 1 && (
          <button
            onClick={() => onRemoveDay(dayIndex)}
            className="text-slate-600 underline active:text-rose-400"
          >
            elimina giornata
          </button>
        )}
        <button
          onClick={() => setSplitting((s) => !s)}
          className="ml-auto text-sky-500 underline active:text-sky-300"
        >
          dividi per zona
        </button>
      </div>

      {splitting && (
        <div className="mt-2 rounded-xl bg-slate-900 p-3 ring-1 ring-slate-800">
          <p className="text-xs text-slate-400">
            Ridistribuisce tutte le {totalPois} tappe raggruppandole per zona, così ogni
            giornata resta in un'area sola.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => {
                  onSplit(n)
                  setSplitting(false)
                }}
                className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold active:bg-sky-700"
              >
                {n} giorni
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function formatHours(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m}`
}
