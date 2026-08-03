import { useCallback, useEffect, useState } from 'react'
import type { Journey, Poi, ScoredStop, Trip } from '../lib/types'
import { bestJourney, journeyCost, journeyOptions } from '../lib/journeyCost'
import {
  formatDistance,
  getCurrentPosition,
  mapsTransitUrl,
  openMaps,
  type LatLng,
} from '../lib/geo'
import { computeNextStops } from '../lib/nextStop'
import { runDiagnostics, type Check } from '../lib/diagnostics'
import JourneyLegs from '../components/JourneyLegs'
import { BigStat, Button, Card, Notice, ScreenTitle, SectionLabel } from '../components/ui'
import {
  IconChevron,
  IconCheck,
  IconHome,
  IconMap,
  IconPin,
  IconRefresh,
  IconWalk,
} from '../components/Icon'

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
  const done = dayPois.length - pending.length

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
        <div className="mt-14 flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-moss-mid/10 text-moss-mid">
            {dayPois.length === 0 ? <IconPin size={28} /> : <IconCheck size={30} />}
          </div>
          <p className="mt-5 font-display text-2xl font-semibold tracking-[-0.02em]">
            {dayPois.length === 0 ? 'Nessun posto in programma' : 'Hai visto tutto'}
          </p>
          <p className="mt-1.5 text-[15px] text-soft">
            {dayPois.length === 0
              ? 'Aggiungi le prime tappe e il giro si organizza da sé.'
              : 'Non resta niente in lista per oggi.'}
          </p>
          <Button variant="primary" size="lg" onClick={onGoAdd} className="mt-6 px-7">
            Aggiungi un posto
          </Button>
        </div>
        {/* Finite le tappe, il rientro è l'unica cosa che serve ancora. */}
        {trip.hotel && <HomeRoute hotel={trip.hotel} walkPenalty={trip.walkPenalty} />}
      </Screen>
    )
  }

  if (state.phase === 'locating' || state.phase === 'routing') {
    return (
      <Screen>
        <div className="mt-24 flex flex-col items-center text-center text-faint">
          <span className="animate-pulse">
            {state.phase === 'locating' ? <IconPin size={30} /> : <IconRefresh size={30} />}
          </span>
          <p className="mt-3 text-[15px]">
            {state.phase === 'locating' ? 'Cerco dove sei…' : 'Calcolo i tempi coi mezzi…'}
          </p>
          {/* Se il GPS non risponde, l'alloggio è un punto di partenza
              accettabile: meglio un risultato utile che una schermata ferma. */}
          {state.phase === 'locating' && trip.hotel && (
            <Button onClick={() => void routeFrom(trip.hotel!, true)} className="mt-6 px-5">
              Parti dall'alloggio
            </Button>
          )}
        </div>
      </Screen>
    )
  }

  if (state.phase === 'error') {
    return (
      <Screen>
        <div className="mt-10">
          <Notice tone="warn" title="Posizione non disponibile">
            <p>{state.message}</p>
            <p className="pt-1 text-[13px] opacity-70">
              Su iPhone: Impostazioni → Privacy → Localizzazione → Safari.
            </p>
          </Notice>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void refresh()} className="px-5">
              Riprova
            </Button>
            {trip.hotel && (
              <Button onClick={() => void routeFrom(trip.hotel!, true)} className="px-5">
                Parti dall'alloggio
              </Button>
            )}
          </div>
        </div>
      </Screen>
    )
  }

  const [best, ...others] = state.stops

  return (
    <Screen>
      <header className="flex items-baseline justify-between">
        <ScreenTitle>Prossima tappa</ScreenTitle>
        <span className="text-[13px] text-faint">
          {done} di {dayPois.length} fatte
        </span>
      </header>
      <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-faint">
        <IconPin size={13} width={2} />
        {state.fromHotel ? "Calcolato dall'alloggio, non da dove sei" : 'Da dove sei ora'}
      </p>

      {state.degraded && (
        <div className="mt-4">
          <DegradedBanner reason={state.reason} />
        </div>
      )}

      {best && (
        <BestCard
          stop={best}
          pos={state.pos}
          walkPenalty={trip.walkPenalty}
          onVisited={() => onVisit(best.poi.id, { visitedAt: new Date().toISOString() })}
        />
      )}

      {others.length > 0 && (
        <section className="mt-5">
          <SectionLabel className="px-1">Poi vicine</SectionLabel>
          <ul className="mt-2.5 space-y-px">
            {others.map((s) => (
              <li key={s.poi.id}>
                <button
                  onClick={() => openMaps(mapsTransitUrl(state.pos, s.poi))}
                  className="flex w-full items-center gap-3 rounded-[4px] bg-ink/[0.035] px-4 py-3 text-left first:rounded-t-2xl last:rounded-b-2xl active:bg-ink/[0.06]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold">{s.poi.name}</span>
                    <span className="block text-[13px] text-faint">
                      {s.journey
                        ? `${s.journey.durationMin} min · ${s.journey.walkingMin} a piedi`
                        : `~${formatDistance(s.straightLineM)} in linea d'aria`}
                    </span>
                  </span>
                  <IconChevron size={17} width={2} className="shrink-0 text-fainter" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        onClick={() => void refresh()}
        className="mt-5 flex w-full items-center justify-center gap-2 py-2 text-[13px] text-faint active:text-ink"
      >
        <IconRefresh size={14} />
        Ricalcola da dove sono ora
      </button>

      {trip.hotel && (
        <HomeRoute hotel={trip.hotel} pos={state.pos} walkPenalty={trip.walkPenalty} />
      )}
    </Screen>
  )
}

function BestCard({
  stop,
  pos,
  walkPenalty,
  onVisited,
}: {
  stop: ScoredStop
  pos: LatLng
  walkPenalty: number
  onVisited: () => void
}) {
  const { poi, journey } = stop

  return (
    <Card className="mt-4 p-5">
      <h2 className="font-display text-[31px] font-semibold leading-[1.08] tracking-[-0.02em]">
        {poi.name}
      </h2>
      {poi.address && <p className="mt-1 text-sm text-soft">{poi.address}</p>}

      {journey ? (
        <>
          {/* I due numeri hanno la stessa scala di un titolo: sono ciò che
              si legge camminando, e decidono insieme se muoversi adesso. */}
          <div className="mt-5 flex items-stretch gap-[18px]">
            <BigStat value={journey.durationMin} label="min in tutto" />
            <div className="w-px bg-ink/10" />
            <BigStat
              value={journey.walkingMin}
              label="min a piedi"
              icon={<IconWalk size={17} width={1.9} />}
            />
          </div>

          <div className="mt-4 border-t border-ink/[0.07] pt-4">
            <JourneyLegs journey={journey} />
            <Alternatives from={pos} to={poi} walkPenalty={walkPenalty} chosen={journey} />
          </div>
        </>
      ) : (
        <p className="mt-5 text-[15px] text-soft">
          ~{formatDistance(stop.straightLineM)} in linea d'aria — tempi non disponibili.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2.5">
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => openMaps(mapsTransitUrl(pos, poi))}
        >
          <IconMap size={18} width={2} />
          Apri in Maps
        </Button>
        <Button block onClick={onVisited}>
          <IconCheck size={16} />
          Segna come visitato
        </Button>
      </div>
    </Card>
  )
}

/**
 * Le altre strade possibili.
 *
 * L'app sceglie col costo composito — velocità più camminata contata
 * doppia — ma TfL e Google non pescano dagli stessi dati e non sempre
 * propongono gli stessi percorsi. Quando il suggerimento sorprende, qui
 * si vede l'elenco intero e il perché di quella scelta, invece di doverla
 * prendere per buona.
 *
 * Si carica solo su richiesta: è un secondo giro di chiamate a un'API
 * gratuita, non qualcosa da fare a ogni apertura.
 */
function Alternatives({
  from,
  to,
  walkPenalty,
  chosen,
}: {
  from: LatLng
  to: LatLng
  walkPenalty: number
  chosen: Journey
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [options, setOptions] = useState<Journey[] | null>(null)

  async function load() {
    setState('loading')
    try {
      setOptions(await journeyOptions(from, to, walkPenalty))
      setState('idle')
    } catch {
      setState('error')
    }
  }

  if (!options) {
    return (
      <button
        onClick={() => void load()}
        disabled={state === 'loading'}
        className="mt-3 text-[13px] text-terra-link active:text-terra-deep disabled:opacity-50"
      >
        {state === 'loading'
          ? 'Cerco altre strade…'
          : state === 'error'
            ? 'Non riesco a caricarle, riprova'
            : 'Altre strade possibili'}
      </button>
    )
  }

  const same = (j: Journey) =>
    j.durationMin === chosen.durationMin && j.walkingMin === chosen.walkingMin

  return (
    <div className="mt-4 rounded-2xl bg-ink/[0.035] p-3">
      <SectionLabel>Altre strade possibili</SectionLabel>
      <ul className="mt-2 space-y-2">
        {options.map((j, i) => (
          <li
            key={i}
            className={`rounded-xl px-2.5 py-2 ${
              same(j) ? 'bg-white ring-1 ring-terra/30' : 'bg-white/60'
            }`}
          >
            <p className="text-sm">
              <span className="tnum font-semibold">{j.durationMin} min</span>
              <span className="text-faint"> · {j.walkingMin} a piedi</span>
              {same(j) && <span className="font-medium text-terra"> · scelto</span>}
            </p>
            <JourneyLegs journey={j} className="mt-1.5" />
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[13px] leading-relaxed text-faint">
        L'ordine tiene conto sia della durata sia dei minuti a piedi, che pesano il doppio (il
        primo costa {Math.round(journeyCost(options[0], walkPenalty))} contro{' '}
        {Math.round(journeyCost(options[options.length - 1], walkPenalty))} dell'ultimo). Google
        ordina per sola durata, e non pesca dagli stessi dati di TfL.
      </p>
    </div>
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
    <Notice tone="warn" title="Tempi non disponibili">
      <p>Ordino per distanza in linea d'aria.</p>
      {reason && <p className="opacity-70">{reason}</p>}

      {!checks && (
        <button
          onClick={() => void diagnose()}
          disabled={running}
          className="underline active:opacity-60 disabled:opacity-50"
        >
          {running ? 'Controllo…' : 'Perché?'}
        </button>
      )}

      {checks && (
        <ul className="space-y-1 pt-1">
          {checks.map((c) => (
            <li key={c.name} className="text-[13px]">
              <span className={c.ok ? 'text-moss-mid' : 'text-terra'}>●</span> {c.name}
              <span className="opacity-60"> — {c.detail}</span>
            </li>
          ))}
          <li className="text-[13px] opacity-50">
            versione del{' '}
            {new Date(__BUILD_TIME__).toLocaleString('it-IT', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </li>
        </ul>
      )}
    </Notice>
  )
}

/**
 * Il rientro in albergo.
 *
 * Nel ridisegno non è più un blocco che compete con la prossima tappa: è
 * una riga a piè di pagina, che si apre solo quando serve. Vive per conto
 * suo e compare in ogni stato purché l'alloggio sia impostato — serve
 * soprattutto quando le tappe sono finite, cioè quando il resto della
 * schermata non ha più niente da dire.
 */
function HomeRoute({ hotel, pos, walkPenalty }: { hotel: Poi; pos?: LatLng; walkPenalty: number }) {
  type State =
    | { phase: 'idle' }
    | { phase: 'working' }
    | { phase: 'done'; from: LatLng; journey: Journey | null }
    | { phase: 'error'; message: string }

  const [state, setState] = useState<State>({ phase: 'idle' })

  async function go() {
    setState({ phase: 'working' })
    try {
      const from = pos ?? (await getCurrentPosition())
      const journey = await bestJourney(from, hotel, walkPenalty)
      setState({ phase: 'done', from, journey })
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message })
    }
  }

  return (
    <section className="mt-5 border-t border-ink/[0.08] pt-3.5">
      <div className="flex items-center gap-3">
        <IconHome size={18} className="shrink-0 text-soft" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Torna in albergo</p>
          <p className="truncate text-[13px] text-faint">
            {state.phase === 'done' && state.journey
              ? `${state.journey.durationMin} min · ${state.journey.walkingMin} a piedi · ${hotel.name}`
              : state.phase === 'working'
                ? 'Calcolo il rientro…'
                : state.phase === 'error'
                  ? state.message
                  : hotel.name}
          </p>
        </div>
        {state.phase === 'done' ? (
          <Button size="sm" onClick={() => openMaps(mapsTransitUrl(state.from, hotel))}>
            Maps
          </Button>
        ) : (
          <Button size="sm" disabled={state.phase === 'working'} onClick={() => void go()}>
            Calcola
          </Button>
        )}
      </div>

      {state.phase === 'done' && state.journey && (
        <JourneyLegs journey={state.journey} className="mt-3 pl-[30px]" />
      )}
      {state.phase === 'done' && !state.journey && (
        <p className="mt-2 pl-[30px] text-[13px] text-amber">
          TfL non ha proposto percorsi. Apri in Maps per i dettagli.
        </p>
      )}
    </section>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-lg px-[18px] pb-6 pt-5">{children}</div>
}
