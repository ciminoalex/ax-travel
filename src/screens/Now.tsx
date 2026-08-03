import { useCallback, useEffect, useState } from 'react'
import type { Poi, ScoredStop, Trip } from '../lib/types'
import {
  formatDistance,
  getCurrentPosition,
  mapsTransitUrl,
  openMaps,
  type LatLng,
} from '../lib/geo'
import { computeNextStops } from '../lib/nextStop'
import { modeIcon } from '../lib/tfl'
import { runDiagnostics, type Check } from '../lib/diagnostics'

type Props = {
  trip: Trip
  dayPois: Poi[]
  onVisit: (id: string, patch: Partial<Poi>) => void
  onGoAdd: () => void
}

type State =
  | { phase: 'locating' }
  | { phase: 'routing' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready'
      pos: LatLng
      stops: ScoredStop[]
      degraded: boolean
      reason?: string
      fromHotel: boolean
    }

export default function Now({ trip, dayPois, onVisit, onGoAdd }: Props) {
  const [state, setState] = useState<State>({ phase: 'locating' })
  const pending = dayPois.filter((p) => !p.visitedAt)

  /** Calcola le tappe a partire da un punto noto, saltando il GPS. */
  const routeFrom = useCallback(
    async (pos: LatLng, fromHotel: boolean) => {
      setState({ phase: 'routing' })
      try {
        const { stops, degraded, reason } = await computeNextStops(pos, dayPois, trip.walkPenalty)
        setState({ phase: 'ready', pos, stops, degraded, reason, fromHotel })
      } catch (e) {
        setState({ phase: 'error', message: (e as Error).message })
      }
    },
    [dayPois, trip.walkPenalty],
  )

  const refresh = useCallback(async () => {
    setState({ phase: 'locating' })
    let pos: LatLng
    try {
      pos = await getCurrentPosition()
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message })
      return
    }
    await routeFrom(pos, false)
  }, [routeFrom])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (pending.length === 0) {
    return (
      <Screen>
        <div className="mt-16 text-center">
          <p className="text-5xl">{dayPois.length === 0 ? '🗺️' : '🎉'}</p>
          <p className="mt-4 text-lg text-slate-300">
            {dayPois.length === 0
              ? 'Nessun posto in programma.'
              : 'Hai visto tutto quello che avevi in lista.'}
          </p>
          <button
            onClick={onGoAdd}
            className="mt-6 rounded-xl bg-sky-600 px-6 py-3 font-semibold active:bg-sky-700"
          >
            Aggiungi un posto
          </button>
        </div>
      </Screen>
    )
  }

  if (state.phase === 'locating' || state.phase === 'routing') {
    return (
      <Screen>
        <div className="mt-20 text-center text-slate-400">
          <p className="animate-pulse text-4xl">{state.phase === 'locating' ? '📍' : '🚇'}</p>
          <p className="mt-3">
            {state.phase === 'locating' ? 'Cerco dove sei…' : 'Calcolo i tempi coi mezzi…'}
          </p>
          {/* Se il GPS non risponde, l'alloggio è un punto di partenza
              accettabile: meglio un risultato utile che una schermata ferma. */}
          {state.phase === 'locating' && trip.hotel && (
            <button
              onClick={() => void routeFrom(trip.hotel!, true)}
              className="mt-6 rounded-xl border border-slate-700 px-5 py-2.5 text-sm text-slate-300 active:bg-slate-800"
            >
              Parti dall'alloggio
            </button>
          )}
        </div>
      </Screen>
    )
  }

  if (state.phase === 'error') {
    return (
      <Screen>
        <div className="mt-16 rounded-2xl border border-amber-800/60 bg-amber-950/40 p-5">
          <p className="font-semibold text-amber-200">Posizione non disponibile</p>
          <p className="mt-2 text-sm text-amber-100/80">{state.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => void refresh()}
              className="rounded-xl bg-amber-600 px-5 py-2.5 font-semibold active:bg-amber-700"
            >
              Riprova
            </button>
            {trip.hotel && (
              <button
                onClick={() => void routeFrom(trip.hotel!, true)}
                className="rounded-xl border border-amber-700/60 px-5 py-2.5 font-semibold text-amber-200 active:bg-amber-900/40"
              >
                Parti dall'alloggio
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-amber-100/50">
            Su iPhone: Impostazioni → Privacy → Localizzazione → Safari.
          </p>
        </div>
      </Screen>
    )
  }

  const [best, ...others] = state.stops

  return (
    <Screen>
      {state.degraded && <DegradedBanner reason={state.reason} />}
      {state.fromHotel && (
        <p className="mb-3 rounded-lg bg-slate-800/70 px-3 py-2 text-xs text-slate-300">
          Calcolato dall'alloggio, non da dove sei ora.
        </p>
      )}

      {best && <BestCard stop={best} pos={state.pos} onVisited={() => onVisit(best.poi.id, { visitedAt: new Date().toISOString() })} />}

      {others.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Poi le altre tappe
          </h2>
          <ul className="space-y-2">
            {others.map((s) => (
              <li
                key={s.poi.id}
                className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.poi.name}</p>
                  <p className="text-xs text-slate-500">
                    {s.journey
                      ? `${s.journey.durationMin} min · 🚶 ${s.journey.walkingMin} min a piedi`
                      : `~${formatDistance(s.straightLineM)} in linea d'aria`}
                  </p>
                </div>
                <button
                  onClick={() => openMaps(mapsTransitUrl(state.pos, s.poi))}
                  className="ml-3 shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs active:bg-slate-700"
                >
                  Maps
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        onClick={() => void refresh()}
        className="mt-6 w-full rounded-xl border border-slate-800 py-3 text-sm text-slate-400 active:bg-slate-900"
      >
        Ricalcola da dove sono ora
      </button>
    </Screen>
  )
}

function BestCard({
  stop,
  pos,
  onVisited,
}: {
  stop: ScoredStop
  pos: LatLng
  onVisited: () => void
}) {
  const { poi, journey } = stop

  return (
    <section className="rounded-3xl bg-gradient-to-b from-sky-900/60 to-slate-900 p-5 ring-1 ring-sky-800/50">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-400">Prossima tappa</p>
      <h1 className="mt-1 text-3xl font-bold leading-tight">{poi.name}</h1>
      {poi.address && <p className="mt-1 text-sm text-slate-400">{poi.address}</p>}

      {journey ? (
        <>
          {/* I minuti a piedi stanno accanto al totale con lo stesso peso
              visivo: è il numero che decide se ti muovi adesso o dopo. */}
          <div className="mt-5 flex items-end gap-6">
            <div>
              <p className="text-4xl font-bold tabular-nums">{journey.durationMin}</p>
              <p className="text-xs uppercase tracking-wide text-slate-400">minuti in tutto</p>
            </div>
            <div>
              <p className="text-4xl font-bold tabular-nums text-sky-300">
                🚶 {journey.walkingMin}
              </p>
              <p className="text-xs uppercase tracking-wide text-slate-400">minuti a piedi</p>
            </div>
          </div>

          <ol className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-300">
            {journey.legs.map((l, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-slate-600">→</span>}
                <span>
                  {modeIcon(l.mode)} {l.label}
                  <span className="text-slate-500"> {l.durationMin}′</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="mt-5 text-slate-300">
          ~{formatDistance(stop.straightLineM)} in linea d'aria — tempi non disponibili.
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          onClick={() => openMaps(mapsTransitUrl(pos, poi))}
          className="rounded-2xl bg-sky-600 py-4 text-center font-semibold active:bg-sky-700"
        >
          Apri in Maps
        </button>
        <button
          onClick={onVisited}
          className="rounded-2xl bg-slate-800 py-4 font-semibold active:bg-slate-700"
        >
          Visitato ✓
        </button>
      </div>
    </section>
  )
}

/**
 * Il ripiego sulla linea d'aria è progettato per non bloccare il viaggio,
 * ma nasconde la causa. Qui la causa è a un tap: la diagnostica gira sul
 * telefono che ha il problema, e un solo screenshot basta per capirlo.
 */
function DegradedBanner({ reason }: { reason?: string }) {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [running, setRunning] = useState(false)

  async function diagnose() {
    setRunning(true)
    setChecks(await runDiagnostics())
    setRunning(false)
  }

  return (
    <div className="mb-3 rounded-lg bg-amber-950/50 px-3 py-2">
      <p className="text-xs text-amber-200">
        Tempi non disponibili — ordino per distanza in linea d'aria.
      </p>
      {reason && <p className="mt-0.5 text-xs text-amber-200/70">{reason}</p>}

      {!checks && (
        <button
          onClick={() => void diagnose()}
          disabled={running}
          className="mt-1.5 text-xs text-amber-300 underline active:text-amber-100 disabled:opacity-50"
        >
          {running ? 'Controllo…' : 'Perché?'}
        </button>
      )}

      {checks && (
        <ul className="mt-2 space-y-1">
          {checks.map((c) => (
            <li key={c.name} className="text-xs">
              <span className={c.ok ? 'text-emerald-400' : 'text-rose-400'}>●</span>{' '}
              <span className="text-amber-100/90">{c.name}</span>
              <span className="text-amber-100/50"> — {c.detail}</span>
            </li>
          ))}
          <li className="pt-0.5 text-xs text-amber-100/40">
            versione del {new Date(__BUILD_TIME__).toLocaleString('it-IT', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </li>
        </ul>
      )}
    </div>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-lg px-4 pt-6">{children}</div>
}
