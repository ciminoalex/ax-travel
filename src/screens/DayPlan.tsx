import { useEffect, useState } from 'react'
import type { Poi, Trip } from '../lib/types'
import type { ReplanSummary } from '../App'
import { formatTime, optimizeDay } from '../lib/optimize'
import { describeError, enrichPlaces, hasApiKey, reorderDay } from '../lib/ai'
import { areaLabel } from '../lib/split'
import { dayStartMinutes, DAY_START_MIN, DAY_END_MIN } from '../lib/dayOrder'

type Props = {
  trip: Trip
  dayIndex: number
  dayPois: Poi[]
  onSelectDay: (i: number) => void
  onAddDay: () => void
  onRemoveDay: (i: number) => void
  onSplit: (days: number) => void
  onMoveToDay: (poiId: string, day: number) => void
  /** Sposta al giorno dopo e blocca lì: "oggi il museo è pieno". */
  onDefer: (poiId: string) => void
  onTogglePin: (poiId: string) => void
  /** Registra giorno e ora della prenotazione in un colpo solo. */
  onSetBooking: (poiId: string, date: string, time: string) => void
  onClearBooking: (poiId: string) => void
  /** Ripianifica l'intero viaggio da adesso. */
  onReplan: () => ReplanSummary
  onRemove: (id: string) => void
  onReorder: (from: number, to: number) => void
  onUpdate: (id: string, patch: Partial<Poi>) => void
  onSetOrder: (ids: string[]) => void
}

type Busy =
  | { kind: 'none' }
  | { kind: 'optimize'; done: number; total: number; step: string }
  | { kind: 'enrich' }
  | { kind: 'replan' }

type Notice = { tone: 'ok' | 'warn'; lines: string[] } | null

export default function DayPlan(props: Props) {
  const { trip, dayIndex, dayPois, onUpdate } = props
  const [busy, setBusy] = useState<Busy>({ kind: 'none' })
  const [notice, setNotice] = useState<Notice>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [pendingOptimize, setPendingOptimize] = useState<string[] | null>(null)

  useEffect(() => {
    if (!pendingOptimize) return
    const lines = pendingOptimize
    setPendingOptimize(null)
    void optimize(lines)
    // Solo quando arriva una richiesta pendente: dayPois qui è già quello nuovo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOptimize])

  const visited = dayPois.filter((p) => p.visitedAt).length
  const totalMin = dayPois.filter((p) => !p.visitedAt).reduce((s, p) => s + p.durationMin, 0)

  async function optimize(prefix: string[] = []) {
    const pending = dayPois.filter((p) => !p.visitedAt)
    if (pending.length < 3) {
      // Con poche tappe non c'è niente da ottimizzare, ma se veniamo da una
      // ripianificazione il suo esito va comunque mostrato.
      if (prefix.length === 0) {
        setNotice({ tone: 'warn', lines: ['Servono almeno 3 tappe da visitare.'] })
      }
      setBusy({ kind: 'none' })
      return
    }

    setBusy({ kind: 'optimize', done: 0, total: 1, step: 'Calcolo i tempi tra le tappe…' })
    setNotice(null)
    try {
      // Se la giornata è oggi si riparte da adesso: proporre le 11:00
      // quando sono le 12:15 non serve a niente.
      const startMin = dayStartMinutes(trip.days[dayIndex]?.date ?? '')

      const { orderedIds, degraded, skipped, schedule } = await optimizeDay(
        pending,
        trip.hotel,
        trip.walkPenalty,
        startMin,
        (done, total) =>
          setBusy({ kind: 'optimize', done, total, step: 'Calcolo i tempi tra le tappe…' }),
      )

      let finalIds = orderedIds
      const lines = [...prefix, 'Giro riordinato per ridurre tempi e camminata.']
      if (startMin > DAY_START_MIN) {
        lines.push(`Pianificato a partire da adesso, le ${formatTime(startMin)}.`)
      }

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

      // Gli orari proposti: è ciò che porti al portale delle prenotazioni.
      // Vengono riscritti a ogni ottimizzazione, quelli già prenotati no.
      for (const entry of schedule) {
        const poi = pending.find((p) => p.id === entry.poiId)
        if (poi && !poi.pinnedTime) {
          onUpdate(entry.poiId, { suggestedTime: formatTime(entry.arriveMin) })
        }
      }

      // Una tappa che comincia dopo la chiusura è tempo buttato: meglio
      // saperlo adesso che trovarsi davanti a una porta sbarrata.
      const tooLate = schedule.filter((e) => e.arriveMin >= DAY_END_MIN)
      if (tooLate.length > 0) {
        const names = tooLate
          .map((e) => pending.find((p) => p.id === e.poiId)?.name)
          .filter(Boolean)
        lines.push(
          `Oltre l'orario di chiusura: ${names.join(', ')}. Conviene spostarle a domani.`,
        )
      }

      const late = schedule.filter((e) => e.lateBy && e.lateBy > 0)
      for (const e of late) {
        const poi = pending.find((p) => p.id === e.poiId)
        if (poi) {
          lines.push(
            `Attenzione: a ${poi.name} arriveresti ${e.lateBy} min dopo le ${poi.pinnedTime}.`,
          )
        }
      }

      setNotice({
        tone: degraded || late.length > 0 || tooLate.length > 0 ? 'warn' : 'ok',
        lines,
      })
    } catch (e) {
      setNotice({ tone: 'warn', lines: [describeError(e)] })
    } finally {
      setBusy({ kind: 'none' })
    }
  }

  /**
   * Rifà il piano di tutto il viaggio, poi mette a punto la giornata di
   * oggi coi tempi reali: è quella che serve subito, le altre si
   * ottimizzano quando arriva il loro turno.
   */
  function replan() {
    setBusy({ kind: 'replan' })
    setNotice(null)

    const summary = props.onReplan()

    const lines = [
      summary.remainingDays === 1
        ? 'Programma rifatto per oggi.'
        : `Programma rifatto su ${summary.remainingDays} giorni.`,
      `Oggi: ${summary.movedToday} ${summary.movedToday === 1 ? 'tappa' : 'tappe'}, ${formatHours(summary.todayMinutes)} di visite.`,
    ]
    if (summary.compressedMin > 0) {
      lines.push(
        `Programma pieno: ho accorciato ${summary.compressedCount} visite di ${formatHours(summary.compressedMin)} in tutto per farle entrare.`,
      )
    }
    if (summary.overflow > 0) {
      lines.push(
        `Restano ${formatHours(summary.overflow)} di troppo anche così: togli una tappa o aggiungi una giornata.`,
      )
    }

    setNotice({ tone: summary.overflow > 0 ? 'warn' : 'ok', lines })
    // L'ottimizzazione parte al render successivo, quando la lista
    // riorganizzata è arrivata fin qui: lanciarla adesso lavorerebbe
    // sull'ordine vecchio.
    setPendingOptimize(lines)
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

      {/* L'azione principale quando qualcosa va storto: rifà il piano di
          tutto il viaggio a partire da adesso. Sta sopra le altre e occupa
          tutta la larghezza perché è quella che si cerca di corsa. */}
      <button
        onClick={() => void replan()}
        disabled={busy.kind !== 'none'}
        className="mt-3 w-full rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 py-4 text-base font-bold shadow-lg shadow-sky-900/30 active:from-sky-700 active:to-indigo-700 disabled:opacity-50"
      >
        {busy.kind === 'replan' ? 'Ripianifico…' : '🔄 Ripianifica da adesso'}
      </button>
      <p className="mt-1 px-1 text-center text-xs text-slate-500">
        Rifà il programma di tutti i giorni tenendo conto dell'ora, di cosa hai
        già visto, dei rinvii e delle prenotazioni.
      </p>

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
                      {p.fullDurationMin && p.fullDurationMin > p.durationMin ? (
                        <span className="text-amber-400">
                          ⏱️ {p.durationMin} min{' '}
                          <span className="text-amber-500/60 line-through">
                            {p.fullDurationMin}
                          </span>
                        </span>
                      ) : (
                        <span>⏱️ {p.durationMin} min</span>
                      )}
                      {p.category && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5">{p.category}</span>
                      )}
                      {p.bestTimeOfDay && <span>meglio {p.bestTimeOfDay}</span>}
                    </div>

                    <TimeRow
                      poi={p}
                      trip={trip}
                      currentDate={trip.days[dayIndex]?.date ?? ''}
                      onSetBooking={props.onSetBooking}
                      onClearBooking={props.onClearBooking}
                    />
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

                  {!p.visitedAt && (
                    <button
                      onClick={() => props.onDefer(p.id)}
                      title="Oggi non c'è posto: sposta a domani e blocca lì"
                      className="rounded-lg bg-slate-800 px-3 py-1.5 active:bg-slate-700"
                    >
                      Non oggi
                    </button>
                  )}

                  <button
                    onClick={() => props.onTogglePin(p.id)}
                    title={
                      p.pinnedDate
                        ? 'Liberala: potrà essere spostata riorganizzando'
                        : 'Blocca in questa giornata'
                    }
                    className={`rounded-lg px-3 py-1.5 active:bg-slate-700 ${
                      p.pinnedDate ? 'bg-amber-900/60 text-amber-200' : 'bg-slate-800'
                    }`}
                  >
                    {p.pinnedDate ? '📌 fissata' : '📌'}
                  </button>

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

/**
 * L'orario di una tappa, nei suoi due stati.
 *
 * Suggerito: la proposta dell'app, ricalcolata a ogni ottimizzazione — è
 * l'ora da chiedere al portale del museo.
 * Prenotato: quello che hai davvero ottenuto. Da lì in poi è un vincolo, e
 * nessuna riorganizzazione lo tocca.
 */
function TimeRow({
  poi,
  trip,
  currentDate,
  onSetBooking,
  onClearBooking,
}: {
  poi: Poi
  trip: Trip
  currentDate: string
  onSetBooking: Props['onSetBooking']
  onClearBooking: Props['onClearBooking']
}) {
  const [editing, setEditing] = useState(false)
  const [time, setTime] = useState(poi.pinnedTime ?? poi.suggestedTime ?? '')
  const [date, setDate] = useState(poi.pinnedDate ?? currentDate)

  function open() {
    setTime(poi.pinnedTime ?? poi.suggestedTime ?? '')
    setDate(poi.pinnedDate ?? currentDate)
    setEditing(true)
  }

  if (editing) {
    // Giorno e ora nello stesso posto: prenotare per giovedì non deve
    // richiedere di spostare prima la tappa a mano.
    return (
      <div className="mt-2 rounded-xl bg-slate-950/60 p-2.5 ring-1 ring-sky-800/50">
        <p className="text-xs font-medium text-sky-300">Quando hai prenotato?</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-slate-700 focus:ring-sky-600"
          >
            {trip.days.map((d, i) => (
              <option key={d.date} value={d.date}>
                G{i + 1} · {shortDate(d.date)}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-slate-700 focus:ring-sky-600"
          />
          <button
            onClick={() => {
              if (time) onSetBooking(poi.id, date, time)
              setEditing(false)
            }}
            disabled={!time}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold active:bg-emerald-700 disabled:opacity-40"
          >
            Conferma
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-1 text-xs text-slate-500 underline active:text-slate-300"
          >
            annulla
          </button>
        </div>
        {poi.pinnedTime && (
          <button
            onClick={() => {
              onClearBooking(poi.id)
              setEditing(false)
            }}
            className="mt-1.5 text-xs text-rose-400 underline active:text-rose-300"
          >
            Rimuovi la prenotazione
          </button>
        )}
      </div>
    )
  }

  if (poi.pinnedTime) {
    return (
      <button
        onClick={open}
        className="mt-1.5 flex items-center gap-2 rounded-lg bg-emerald-900/70 px-2 py-1 text-xs font-semibold text-emerald-200 active:bg-emerald-800"
      >
        🎟️ prenotato {poi.pinnedTime}
        {poi.pinnedDate && poi.pinnedDate !== currentDate && ` · ${shortDate(poi.pinnedDate)}`}
        <span className="font-normal opacity-60">modifica</span>
      </button>
    )
  }

  return (
    <button
      onClick={open}
      className="mt-1.5 flex items-center gap-2 rounded-lg bg-slate-800 px-2 py-1 text-xs active:bg-slate-700"
    >
      {poi.suggestedTime ? (
        <span className="text-sky-300">🕐 arrivo previsto {poi.suggestedTime}</span>
      ) : (
        <span className="text-slate-400">🕐 nessun orario</span>
      )}
      <span className="text-slate-400">· ho prenotato</span>
    </button>
  )
}

function shortDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
  })
}

/** Oltre questo, una giornata di visite non sta più in piedi. */
const HEAVY_DAY_MIN = 7 * 60

/** Ore di visita che ci si può ragionevolmente mettere in un giorno. */
const COMFORTABLE_DAY_MIN = 6 * 60

/** Selettore delle giornate, con distribuzione per zona. */
function DayTabs({ trip, dayIndex, onSelectDay, onAddDay, onRemoveDay, onSplit }: Props) {
  const [splitting, setSplitting] = useState(false)

  const minutesOf = (poiIds: string[]) =>
    poiIds.reduce((s, id) => s + (trip.pois[id]?.durationMin ?? 0), 0)

  const totalPois = trip.days.reduce((s, d) => s + d.poiIds.length, 0)
  const totalMin = trip.days.reduce((s, d) => s + minutesOf(d.poiIds), 0)
  const suggested = Math.max(1, Math.ceil(totalMin / COMFORTABLE_DAY_MIN))

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {trip.days.map((d, i) => {
          const min = minutesOf(d.poiIds)
          const heavy = min > HEAVY_DAY_MIN
          return (
            <button
              key={i}
              onClick={() => onSelectDay(i)}
              className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                i === dayIndex ? 'bg-sky-600' : 'bg-slate-900 text-slate-400 active:bg-slate-800'
              }`}
            >
              G{i + 1}
              {/* Le ore, non il conteggio: è il tempo a dire se ci sta. */}
              <span className={`ml-1.5 ${heavy ? 'text-amber-300' : 'opacity-70'}`}>
                {formatHours(min)}
              </span>
            </button>
          )
        })}
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
            Ridistribuisce le {totalPois} tappe per zona e pareggia le ore, così ogni
            giornata resta in un'area sola e nessuna diventa impossibile.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            In tutto {formatHours(totalMin)} di visite: con {suggested}{' '}
            {suggested === 1 ? 'giorno' : 'giorni'} sono circa{' '}
            {formatHours(Math.round(totalMin / suggested))} al giorno.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => {
                  onSplit(n)
                  setSplitting(false)
                }}
                className={`rounded-lg px-3 py-2 text-xs font-semibold active:bg-sky-700 ${
                  n === suggested ? 'bg-sky-600' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {n} giorni
                {n === suggested && ' ·  consigliato'}
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
