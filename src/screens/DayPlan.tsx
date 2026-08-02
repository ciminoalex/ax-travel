import { useState } from 'react'
import type { Poi } from '../lib/types'
import { optimizeDay } from '../lib/optimize'
import { describeError, hasApiKey, reorderDay } from '../lib/ai'

type Props = {
  dayPois: Poi[]
  hotel: Poi | null
  walkPenalty: number
  onRemove: (id: string) => void
  onReorder: (from: number, to: number) => void
  onUpdate: (id: string, patch: Partial<Poi>) => void
  onSetOrder: (ids: string[]) => void
}

type OptState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number; step: string }
  | { phase: 'done'; rationale: string | null; degraded: boolean; skipped: number }
  | { phase: 'error'; message: string }

export default function DayPlan({
  dayPois,
  hotel,
  walkPenalty,
  onRemove,
  onReorder,
  onUpdate,
  onSetOrder,
}: Props) {
  const [opt, setOpt] = useState<OptState>({ phase: 'idle' })
  const visited = dayPois.filter((p) => p.visitedAt).length

  async function optimize() {
    // Riordinare le tappe già viste non ha senso: si ottimizza il resto.
    const pending = dayPois.filter((p) => !p.visitedAt)
    if (pending.length < 3) {
      setOpt({ phase: 'error', message: 'Servono almeno 3 tappe da visitare.' })
      return
    }

    setOpt({ phase: 'running', done: 0, total: 1, step: 'Calcolo i tempi tra le tappe…' })
    try {
      const { orderedIds, degraded, skipped } = await optimizeDay(
        pending,
        hotel,
        walkPenalty,
        (done, total) =>
          setOpt({ phase: 'running', done, total, step: 'Calcolo i tempi tra le tappe…' }),
      )

      let finalIds = orderedIds
      let rationale: string | null = null

      // L'AI rifinisce un ordine già valido: se la sua risposta non è una
      // permutazione esatta, teniamo quello calcolato.
      if (hasApiKey()) {
        setOpt({
          phase: 'running',
          done: 1,
          total: 1,
          step: 'Chiedo a Claude di tenere conto degli orari…',
        })
        try {
          const refined = await reorderDay(pending, orderedIds)
          if (refined) {
            finalIds = refined.orderedIds
            rationale = refined.rationale
          }
        } catch {
          // L'ordine sui tempi reali resta comunque buono.
        }
      }

      // Le tappe già visitate restano in testa, nell'ordine in cui erano.
      const visitedIds = dayPois.filter((p) => p.visitedAt).map((p) => p.id)
      onSetOrder([...visitedIds, ...finalIds])
      setOpt({ phase: 'done', rationale, degraded, skipped })
    } catch (e) {
      setOpt({ phase: 'error', message: describeError(e) })
    }
  }

  if (dayPois.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 pt-16 text-center text-slate-400">
        <p className="text-5xl">🗓️</p>
        <p className="mt-4">La giornata è vuota. Aggiungi qualche posto.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">La giornata</h1>
        <p className="text-sm text-slate-500">
          {visited}/{dayPois.length} visitati
        </p>
      </div>

      <button
        onClick={() => void optimize()}
        disabled={opt.phase === 'running'}
        className="mt-3 w-full rounded-2xl bg-slate-800 py-3 font-semibold active:bg-slate-700 disabled:opacity-50"
      >
        {opt.phase === 'running' ? 'Ottimizzo…' : '⚡ Ottimizza il giro'}
      </button>

      {opt.phase === 'running' && (
        <div className="mt-2 rounded-xl bg-slate-900 px-3 py-2">
          <p className="text-xs text-slate-400">{opt.step}</p>
          {opt.total > 1 && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-sky-500 transition-all"
                style={{ width: `${Math.round((opt.done / opt.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {opt.phase === 'done' && (
        <div className="mt-2 rounded-xl bg-emerald-950/50 px-3 py-2">
          <p className="text-xs text-emerald-300">
            Giro riordinato per ridurre tempi e camminata.
          </p>
          {opt.rationale && <p className="mt-1 text-xs text-emerald-200/70">{opt.rationale}</p>}
          {opt.degraded && (
            <p className="mt-1 text-xs text-amber-400">
              TfL non ha risposto: ordine basato sulle distanze.
            </p>
          )}
          {opt.skipped > 0 && (
            <p className="mt-1 text-xs text-amber-400">
              Le ultime {opt.skipped} tappe sono rimaste come stavano: oltre le 8
              servirebbero troppe richieste a TfL.
            </p>
          )}
        </div>
      )}

      {opt.phase === 'error' && (
        <p className="mt-2 rounded-xl bg-amber-950/50 px-3 py-2 text-xs text-amber-300">
          {opt.message}
        </p>
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
                  onClick={() => onReorder(i, i - 1)}
                  disabled={i === 0}
                  aria-label="Sposta su"
                  className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs active:bg-slate-700 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => onReorder(i, i + 1)}
                  disabled={i === dayPois.length - 1}
                  aria-label="Sposta giù"
                  className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs active:bg-slate-700 disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
            </div>

            <div className="mt-2 flex gap-2 border-t border-slate-800 pt-2 text-xs">
              <button
                onClick={() =>
                  onUpdate(p.id, { visitedAt: p.visitedAt ? undefined : new Date().toISOString() })
                }
                className="rounded-lg bg-slate-800 px-3 py-1.5 active:bg-slate-700"
              >
                {p.visitedAt ? 'Da rivedere' : 'Visitato ✓'}
              </button>
              <button
                onClick={() => onRemove(p.id)}
                className="ml-auto rounded-lg px-3 py-1.5 text-rose-400 active:bg-rose-950/50"
              >
                Rimuovi
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
