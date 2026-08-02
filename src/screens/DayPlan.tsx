import type { Poi } from '../lib/types'

type Props = {
  dayPois: Poi[]
  onRemove: (id: string) => void
  onReorder: (from: number, to: number) => void
  onUpdate: (id: string, patch: Partial<Poi>) => void
}

export default function DayPlan({ dayPois, onRemove, onReorder, onUpdate }: Props) {
  const visited = dayPois.filter((p) => p.visitedAt).length

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
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <span>⏱️ {p.durationMin} min</span>
                  {p.category && <span className="rounded bg-slate-800 px-1.5 py-0.5">{p.category}</span>}
                </div>
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
