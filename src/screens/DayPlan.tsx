import { useEffect, useState } from 'react'
import type { Poi, Trip } from '../lib/types'
import type { ReplanPlan, ReplanSummary } from '../App'
import { formatTime, optimizeDay } from '../lib/optimize'
import { describeError, enrichPlaces, hasApiKey, reorderDay } from '../lib/ai'
import { areaLabel } from '../lib/split'
import { dayStartMinutes, DAY_START_MIN, DAY_END_MIN } from '../lib/dayOrder'
import { Button, Card, Notice, ScreenTitle, SectionLabel } from '../components/ui'
import {
  IconCheck,
  IconChevron,
  IconCompress,
  IconDown,
  IconHome,
  IconInfo,
  IconMenu,
  IconPlus,
  IconSparkle,
  IconSwap,
  IconTicket,
  IconTrash,
  IconUp,
  IconWarn,
} from '../components/Icon'

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
  /** Calcola il nuovo piano senza applicarlo: l'anteprima lo mostra prima. */
  onComputeReplan: () => ReplanPlan | null
  onApplyReplan: (plan: ReplanPlan) => void
  onRemove: (id: string) => void
  onReorder: (from: number, to: number) => void
  onUpdate: (id: string, patch: Partial<Poi>) => void
  onSetOrder: (ids: string[]) => void
}

type Busy =
  | { kind: 'none' }
  | { kind: 'optimize'; done: number; total: number; step: string }
  | { kind: 'enrich' }

type NoticeState = { tone: 'ok' | 'warn'; lines: string[] } | null

export default function DayPlan(props: Props) {
  const { trip, dayIndex, dayPois, onUpdate } = props
  const [busy, setBusy] = useState<Busy>({ kind: 'none' })
  const [notice, setNotice] = useState<NoticeState>(null)
  const [plan, setPlan] = useState<ReplanPlan | null>(null)
  const [openStop, setOpenStop] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
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
  const nextId = dayPois.find((p) => !p.visitedAt)?.id

  async function optimize(prefix: string[] = []) {
    const pending = dayPois.filter((p) => !p.visitedAt)
    if (pending.length < 3) {
      // Con poche tappe non c'è niente da ottimizzare, ma se veniamo da una
      // ripianificazione il suo esito va comunque mostrato.
      if (prefix.length === 0) {
        setNotice({ tone: 'warn', lines: ['Servono almeno 3 tappe da visitare.'] })
      } else {
        setNotice({ tone: 'ok', lines: prefix })
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
        lines.push(
          `Le ultime ${skipped} tappe sono rimaste come stavano (oltre le 8 servirebbero troppe richieste).`,
        )
      }

      const visitedIds = dayPois.filter((p) => p.visitedAt).map((p) => p.id)
      props.onSetOrder([...visitedIds, ...finalIds])

      // Gli orari proposti: è ciò che porti al portale delle prenotazioni.
      // Vengono riscritti a ogni ottimizzazione, quelli già prenotati no.
      // Il tempo di viaggio è già calcolato qui: conservarlo fa leggere la
      // giornata come una sequenza invece che come un elenco.
      for (const entry of schedule) {
        const poi = pending.find((p) => p.id === entry.poiId)
        if (!poi) continue
        onUpdate(entry.poiId, {
          travelFromPrevMin: entry.travelMin,
          ...(poi.pinnedTime ? {} : { suggestedTime: formatTime(entry.arriveMin) }),
        })
      }

      // Una tappa che comincia dopo la chiusura è tempo buttato: meglio
      // saperlo adesso che trovarsi davanti a una porta sbarrata.
      const tooLate = schedule.filter((e) => e.arriveMin >= DAY_END_MIN)
      if (tooLate.length > 0) {
        const names = tooLate
          .map((e) => pending.find((p) => p.id === e.poiId)?.name)
          .filter(Boolean)
        lines.push(`Oltre l'orario di chiusura: ${names.join(', ')}. Conviene spostarle a domani.`)
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

  /* ---------------------------------------------------------------- */
  /* Ripianificazione: calcola, mostra, poi (forse) applica            */
  /* ---------------------------------------------------------------- */

  function startReplan() {
    setNotice(null)
    const computed = props.onComputeReplan()
    if (!computed) {
      setNotice({ tone: 'warn', lines: ['Non c’è più niente da ripianificare.'] })
      return
    }
    setPlan(computed)
  }

  function applyPlan(p: ReplanPlan) {
    props.onApplyReplan(p)
    setPlan(null)
    // L'ottimizzazione parte al render successivo, quando la lista
    // riorganizzata è arrivata fin qui: lanciarla adesso lavorerebbe
    // sull'ordine vecchio.
    setPendingOptimize(replanLines(p.summary))
  }

  if (plan) {
    return (
      <ReplanPreview
        summary={plan.summary}
        onApply={() => applyPlan(plan)}
        onDiscard={() => setPlan(null)}
      />
    )
  }

  const area = areaLabel(dayPois)

  return (
    <div className="mx-auto max-w-lg px-[18px] pb-6 pt-5">
      <header className="flex items-baseline justify-between">
        <ScreenTitle>Giornata</ScreenTitle>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMenuOpen((m) => !m)}
            aria-label="Altre azioni"
            aria-expanded={menuOpen}
            className="text-soft active:text-ink"
          >
            <IconMenu size={20} />
          </button>
        </div>
      </header>

      {menuOpen && (
        <DayMenu
          {...props}
          busy={busy.kind !== 'none'}
          onOptimize={() => {
            setMenuOpen(false)
            void optimize()
          }}
          onEnrich={() => {
            setMenuOpen(false)
            void enrich()
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}

      <DayTabs {...props} />

      <p className="mt-2.5 px-1 text-[13px] text-faint">
        {dayPois.length === 0
          ? 'Nessuna tappa in questa giornata'
          : `${area ? area + ' · ' : ''}${visited}/${dayPois.length} viste${totalMin > 0 ? ` · ${formatHours(totalMin)} di visite` : ''}`}
      </p>

      {busy.kind === 'optimize' && (
        <div className="mt-3 rounded-2xl bg-ink/[0.035] px-4 py-3">
          <p className="text-[13px] text-soft">{busy.step}</p>
          {busy.total > 1 && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full bg-terra transition-all"
                style={{ width: `${Math.round((busy.done / busy.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
      {busy.kind === 'enrich' && (
        <p className="mt-3 animate-pulse text-[13px] text-soft">
          Chiedo a Claude durate e orari…
        </p>
      )}

      {notice && (
        <div className="mt-3">
          <Notice tone={notice.tone === 'ok' ? 'info' : 'warn'}>
            {notice.lines.map((l, i) => (
              <p key={i} className={i === 0 ? 'font-medium' : 'opacity-75'}>
                {l}
              </p>
            ))}
          </Notice>
        </div>
      )}

      {dayPois.length > 0 && (
        <ol className="mt-4">
          {dayPois.map((p, i) => (
            <Stop
              key={p.id}
              poi={p}
              index={i}
              isNext={p.id === nextId}
              isLast={i === dayPois.length - 1}
              open={openStop === p.id}
              onToggle={() => setOpenStop(openStop === p.id ? null : p.id)}
              {...props}
            />
          ))}
          {trip.hotel && (
            <li className="flex gap-3">
              <div className="w-[42px] shrink-0" />
              <div className="w-px bg-ink/10" />
              <div className="flex flex-1 items-center gap-2.5 py-2.5">
                <IconHome size={16} className="text-soft" />
                <span className="text-[15px] text-soft">Rientro in albergo</span>
              </div>
            </li>
          )}
        </ol>
      )}

      {/* L'unica azione primaria: rifà il piano di tutto il viaggio da
          adesso. Tutto il resto sta nel menu, perché tre bottoni dello
          stesso peso non dicono quale sia quello giusto. */}
      <Button variant="primary" size="lg" block onClick={startReplan} className="mt-6">
        Ripianifica da adesso
      </Button>
      <p className="mt-2 px-2 text-center text-[13px] leading-relaxed text-faint">
        Ricalcola tutti i giorni tenendo conto dell'ora, di cosa hai già visto, dei rinvii e
        delle prenotazioni. Prima di applicarlo lo vedi.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Una tappa nella timeline                                            */
/* ------------------------------------------------------------------ */

function Stop({
  poi,
  index,
  isNext,
  isLast,
  open,
  onToggle,
  trip,
  dayIndex,
  dayPois,
  onUpdate,
  onRemove,
  onReorder,
  onDefer,
  onTogglePin,
  onMoveToDay,
  onSetBooking,
  onClearBooking,
}: Props & {
  poi: Poi
  index: number
  isNext: boolean
  isLast: boolean
  open: boolean
  onToggle: () => void
}) {
  const time = poi.pinnedTime ?? poi.suggestedTime
  const visited = Boolean(poi.visitedAt)
  const travel = !visited && index > 0 ? poi.travelFromPrevMin : undefined

  return (
    <>
      {/* Il viaggio è una riga a sé, con la colonna dell'orario vuota:
          avviene *prima* di arrivare, e mettergli accanto l'ora d'arrivo
          farebbe leggere "alle 14:20 viaggi", che è il contrario. */}
      {travel != null && (
        <li className="flex gap-3">
          <div className="w-[42px] shrink-0" />
          <div className="w-px bg-ink/10" />
          <p className="flex-1 py-1 text-xs text-fainter">{travel} min di viaggio</p>
        </li>
      )}

      <li className="flex gap-3">
        {/* La colonna degli orari: è la spina dorsale della giornata, e il
            motivo per cui questa non è più una pila di card uguali. */}
        <div
          className={`tnum w-[42px] shrink-0 pt-3 text-right text-[13px] ${
            poi.pinnedTime
              ? 'font-semibold text-terra'
              : visited
                ? 'text-fainter'
                : 'text-soft'
          }`}
        >
          {time ?? ''}
        </div>
        <div
          className={`w-px ${
            isNext ? 'bg-gradient-to-b from-terra to-ink/10' : 'bg-ink/10'
          } ${isLast && !isNext ? 'opacity-60' : ''}`}
        />

        <div className="min-w-0 flex-1 pb-1">
          {isNext ? (
          <Card className="my-1 rounded-[20px] p-4 shadow-card-sm">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-[21px] font-semibold tracking-[-0.01em]">
                  {poi.name}
                </h3>
                <p className="mt-1 text-[13px] text-soft">
                  <Duration poi={poi} />
                  {poi.category && ` · ${poi.category}`}
                </p>
              </div>
              <span className="shrink-0 pt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-terra">
                Prossima
              </span>
            </div>

            <TimeRow
              poi={poi}
              trip={trip}
              currentDate={trip.days[dayIndex]?.date ?? ''}
              onSetBooking={onSetBooking}
              onClearBooking={onClearBooking}
            />

            {poi.openingHours && (
              <p className="mt-2 text-[13px] text-amber">
                orari {poi.openingHours} — da verificare
              </p>
            )}
            {poi.note && <p className="mt-1.5 text-[13px] italic text-faint">{poi.note}</p>}

            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => onUpdate(poi.id, { visitedAt: new Date().toISOString() })}
              >
                Visitato
              </Button>
              <Button size="sm" className="flex-1" onClick={() => onDefer(poi.id)}>
                Non oggi
              </Button>
              <Button size="sm" onClick={onToggle} aria-label="Altre azioni" className="w-[42px] px-0">
                <IconMenu size={16} />
              </Button>
            </div>
          </Card>
        ) : (
          <button
            onClick={onToggle}
            className={`flex w-full items-center gap-2.5 py-2.5 text-left ${visited ? 'opacity-50' : ''}`}
          >
            {visited && <IconCheck size={17} className="shrink-0 text-moss-mid" />}
            <span className="min-w-0 flex-1">
              <span
                className={`block truncate text-base ${visited ? 'font-medium' : 'font-semibold'}`}
              >
                {poi.name}
              </span>
              <span className="block text-[13px] text-faint">
                {poi.pinnedTime ? (
                  <span className="text-moss-mid">prenotato · </span>
                ) : poi.suggestedTime && !visited ? (
                  'arrivo previsto · '
                ) : null}
                <Duration poi={poi} />
              </span>
              {poi.openingHours && !visited && (
                <span className="block text-[13px] text-terra">
                  orari {poi.openingHours} — da verificare
                </span>
              )}
            </span>
            <IconChevron
              size={16}
              width={2}
              className={`shrink-0 text-fainter transition-transform ${open ? 'rotate-90' : ''}`}
            />
          </button>
        )}

        {open && (
          <StopActions
            poi={poi}
            index={index}
            trip={trip}
            dayIndex={dayIndex}
            dayCount={dayPois.length}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onReorder={onReorder}
            onDefer={onDefer}
            onTogglePin={onTogglePin}
            onMoveToDay={onMoveToDay}
            onSetBooking={onSetBooking}
            onClearBooking={onClearBooking}
            onDone={onToggle}
          />
        )}
        </div>
      </li>
    </>
  )
}

/** La durata, con quella piena barrata se la ripianificazione l'ha accorciata. */
function Duration({ poi }: { poi: Poi }) {
  if (poi.fullDurationMin && poi.fullDurationMin > poi.durationMin) {
    return (
      <span className="text-amber">
        {poi.durationMin} min <s className="opacity-50">{poi.fullDurationMin}</s>
      </span>
    )
  }
  return <>{poi.durationMin} min</>
}

/**
 * Tutte le azioni su una tappa, aperte al tocco.
 *
 * Il mockup le nasconde dietro un menu per non riempire la timeline di
 * bottoni. Il rischio dichiarato è che su un giorno pieno diventi scomodo:
 * qui restano tutte a un solo tocco di distanza, nessuna sepolta più in
 * fondo di così.
 */
function StopActions({
  poi,
  index,
  trip,
  dayIndex,
  dayCount,
  onUpdate,
  onRemove,
  onReorder,
  onDefer,
  onTogglePin,
  onMoveToDay,
  onSetBooking,
  onClearBooking,
  onDone,
}: {
  poi: Poi
  index: number
  trip: Trip
  dayIndex: number
  dayCount: number
  onUpdate: Props['onUpdate']
  onRemove: Props['onRemove']
  onReorder: Props['onReorder']
  onDefer: Props['onDefer']
  onTogglePin: Props['onTogglePin']
  onMoveToDay: Props['onMoveToDay']
  onSetBooking: Props['onSetBooking']
  onClearBooking: Props['onClearBooking']
  onDone: () => void
}) {
  const [moving, setMoving] = useState(false)

  return (
    <div className="mb-2 rounded-[18px] bg-ink/[0.035] p-3">
      <TimeRow
        poi={poi}
        trip={trip}
        currentDate={trip.days[dayIndex]?.date ?? ''}
        onSetBooking={onSetBooking}
        onClearBooking={onClearBooking}
      />

      {poi.note && <p className="mt-2 text-[13px] italic text-faint">{poi.note}</p>}

      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            onUpdate(poi.id, { visitedAt: poi.visitedAt ? undefined : new Date().toISOString() })
          }
        >
          {poi.visitedAt ? 'Da rivedere' : 'Visitato'}
        </Button>

        {!poi.visitedAt && (
          <Button size="sm" onClick={() => onDefer(poi.id)} title="Sposta a domani e blocca lì">
            Non oggi
          </Button>
        )}

        {dayCount > 1 && (
          <>
            <Button size="sm" onClick={() => onReorder(index, index - 1)} aria-label="Sposta su">
              <IconUp size={15} />
            </Button>
            <Button size="sm" onClick={() => onReorder(index, index + 1)} aria-label="Sposta giù">
              <IconDown size={15} />
            </Button>
          </>
        )}

        {trip.days.length > 1 && (
          <Button size="sm" onClick={() => setMoving((m) => !m)}>
            Sposta di giorno
          </Button>
        )}

        <Button
          size="sm"
          onClick={() => onTogglePin(poi.id)}
          title={
            poi.pinnedDate
              ? 'Liberala: potrà essere spostata riorganizzando'
              : 'Blocca in questa giornata'
          }
          className={poi.pinnedDate ? 'border-amber/50 bg-amber/10 text-amber-deep' : ''}
        >
          {poi.pinnedDate ? 'Fissata qui' : 'Fissa qui'}
        </Button>

        <Button
          size="sm"
          onClick={() => {
            onRemove(poi.id)
            onDone()
          }}
          className="ml-auto border-terra/30 text-terra"
          aria-label="Rimuovi"
        >
          <IconTrash size={15} />
        </Button>
      </div>

      {moving && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-ink/[0.08] pt-2.5">
          {trip.days.map((d, di) =>
            di === dayIndex ? null : (
              <Button
                key={di}
                size="sm"
                onClick={() => {
                  onMoveToDay(poi.id, di)
                  setMoving(false)
                  onDone()
                }}
              >
                {dayLabel(d.date)}
              </Button>
            ),
          )}
        </div>
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
      <div className="mt-2.5 rounded-2xl border border-ink/[0.12] bg-white p-3">
        <p className="text-[13px] font-semibold text-ink">Quando hai prenotato?</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-ink/[0.14] bg-white px-2.5 py-2 text-[13px] outline-none focus:border-ink/40"
          >
            {trip.days.map((d) => (
              <option key={d.date} value={d.date}>
                {dayLabel(d.date)} · {shortDate(d.date)}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="tnum rounded-xl border border-ink/[0.14] bg-white px-2.5 py-2 text-[13px] outline-none focus:border-ink/40"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!time}
            onClick={() => {
              if (time) onSetBooking(poi.id, date, time)
              setEditing(false)
            }}
          >
            Conferma
          </Button>
          <button
            onClick={() => setEditing(false)}
            className="px-1 text-[13px] text-faint underline active:text-ink"
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
            className="mt-2 text-[13px] text-terra underline active:text-terra-deep"
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
        className="mt-2.5 flex w-full items-center gap-2 rounded-xl bg-moss-mid/10 px-3 py-2.5 text-left active:bg-moss-mid/20"
      >
        <IconTicket size={15} className="shrink-0 text-moss" />
        <span className="tnum flex-1 text-sm font-semibold text-moss">
          Prenotato {poi.pinnedTime}
          {poi.pinnedDate && poi.pinnedDate !== currentDate && ` · ${shortDate(poi.pinnedDate)}`}
        </span>
        <span className="text-[13px] text-moss underline">modifica</span>
      </button>
    )
  }

  return (
    <button
      onClick={open}
      className="mt-2.5 flex w-full items-center gap-2 rounded-xl bg-ink/[0.05] px-3 py-2 text-left active:bg-ink/10"
    >
      <IconTicket size={15} className="shrink-0 text-faint" />
      <span className="flex-1 text-[13px] text-soft">
        {poi.suggestedTime ? (
          <>
            arrivo previsto <span className="tnum font-semibold">{poi.suggestedTime}</span>
          </>
        ) : (
          'nessun orario'
        )}
      </span>
      <span className="text-[13px] text-terra-link">ho prenotato</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Anteprima della ripianificazione                                    */
/* ------------------------------------------------------------------ */

/** Le righe di riepilogo, riusate anche nel notice dopo l'applicazione. */
function replanLines(s: ReplanSummary): string[] {
  const lines = [
    s.remainingDays === 1
      ? 'Programma rifatto per oggi.'
      : `Programma rifatto su ${s.remainingDays} giorni.`,
    `Oggi: ${s.movedToday} ${s.movedToday === 1 ? 'tappa' : 'tappe'}, ${formatHours(s.todayMinutes)} di visite.`,
  ]
  if (s.compressedMin > 0) {
    lines.push(
      `Ho accorciato ${s.compressedCount} visite di ${formatHours(s.compressedMin)} in tutto.`,
    )
  }
  if (s.overflow > 0) {
    lines.push(`Restano ${formatHours(s.overflow)} di troppo: togli una tappa o aggiungi un giorno.`)
  }
  return lines
}

/**
 * Il piano nuovo, prima di applicarlo.
 *
 * `ReplanSummary` esisteva già ma arrivava a cose fatte: si leggeva cosa
 * era successo, non cosa stava per succedere. Qui il calcolo c'è già —
 * costa niente rifarlo — ma la decisione resta a chi ha i biglietti in
 * tasca. Ambra per ciò che richiede una verifica umana, neutro per il resto.
 */
function ReplanPreview({
  summary,
  onApply,
  onDiscard,
}: {
  summary: ReplanSummary
  onApply: () => void
  onDiscard: () => void
}) {
  const [detail, setDetail] = useState(false)
  const now = formatTime(dayStartMinutes(new Date().toISOString().slice(0, 10)))

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col px-[18px] pb-6 pt-5">
      <ScreenTitle>Nuovo piano, dalle {now}</ScreenTitle>
      <p className="mt-2 text-[15px] leading-relaxed text-soft">
        {summary.remainingDays === 1 ? 'Una giornata ricalcolata' : `${summary.remainingDays} giornate ricalcolate`}{' '}
        su cosa hai già visto. Niente è ancora salvato.
      </p>

      <Card className="mt-5 rounded-[20px] px-4 shadow-card-sm">
        <Fact icon={<IconSwap size={18} className="text-soft" />}>
          Oggi {summary.movedToday} {summary.movedToday === 1 ? 'tappa' : 'tappe'}, in tutto{' '}
          {formatHours(summary.todayMinutes)} di visite
        </Fact>
        {summary.compressedCount > 0 && (
          <Fact icon={<IconCompress size={18} className="text-soft" />}>
            {summary.compressedCount} visite accorciate, in tutto {formatHours(summary.compressedMin)}{' '}
            in meno
          </Fact>
        )}
        {summary.bookings > 0 && (
          <Fact icon={<IconTicket size={18} className="text-moss" />}>
            {summary.bookings}{' '}
            {summary.bookings === 1 ? 'prenotazione rispettata' : 'prenotazioni rispettate'}
          </Fact>
        )}
        <Fact icon={<IconCheck size={18} className="text-soft" />} last>
          Le tappe già viste e quelle fissate restano dove sono
        </Fact>
      </Card>

      {summary.shiftedDays !== 0 && (
        <div className="mt-3">
          <Notice
            tone="warn"
            icon={<IconWarn size={18} />}
            title={`Le date sono state traslate di ${Math.abs(summary.shiftedDays)} ${Math.abs(summary.shiftedDays) === 1 ? 'giorno' : 'giorni'}`}
          >
            <p>
              Le giornate erano datate{' '}
              {summary.shiftedDays < 0 ? 'più avanti' : 'indietro'} rispetto a oggi.
              {summary.shiftedBookings > 0 &&
                ` ${summary.shiftedBookings} ${summary.shiftedBookings === 1 ? 'prenotazione si è spostata' : 'prenotazioni si sono spostate'} con le giornate: controlla i biglietti prima di applicare.`}
            </p>
          </Notice>
        </div>
      )}

      {summary.overflow > 0 && (
        <div className="mt-3">
          <Notice icon={<IconInfo size={18} />}>
            Restano {formatHours(summary.overflow)} di troppo anche dopo aver accorciato le
            visite: togli una tappa o aggiungi una giornata.
          </Notice>
        </div>
      )}

      <button
        onClick={() => setDetail((d) => !d)}
        className="mt-3 self-start px-1 py-2 text-[15px] text-terra-link active:text-terra-deep"
      >
        {detail ? 'Nascondi il dettaglio' : 'Vedi il piano giorno per giorno →'}
      </button>

      {detail && (
        <ul className="space-y-px">
          {summary.perDay.map((d) => (
            <li
              key={d.date}
              className="flex items-center justify-between rounded-[4px] bg-ink/[0.035] px-4 py-2.5 first:rounded-t-2xl last:rounded-b-2xl"
            >
              <span className="text-[15px] font-medium">{dayLabel(d.date)}</span>
              <span className="tnum text-[13px] text-faint">
                {d.stops} {d.stops === 1 ? 'tappa' : 'tappe'} · {formatHours(d.minutes)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-8">
        <Button variant="primary" size="lg" block onClick={onApply}>
          Applica
        </Button>
        <Button variant="plain" size="md" block onClick={onDiscard}>
          Lascia com'era
        </Button>
      </div>
    </div>
  )
}

function Fact({
  icon,
  children,
  last = false,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div
      className={`flex items-center gap-3 py-3.5 ${last ? '' : 'border-b border-ink/[0.07]'}`}
    >
      <span className="shrink-0">{icon}</span>
      <p className="flex-1 text-[15px] leading-snug">{children}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Giornate e menu                                                     */
/* ------------------------------------------------------------------ */

function shortDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
  })
}

/**
 * "oggi" e "domani" invece della data quando è ciò che conta: sono le
 * uniche due giornate su cui si prendono decisioni con l'orologio in mano.
 */
function dayLabel(iso: string): string {
  const today = new Date().toISOString().slice(0, 10)
  if (iso === today) return 'oggi'
  const tomorrow = new Date(new Date(today + 'T12:00:00').getTime() + 86400000)
    .toISOString()
    .slice(0, 10)
  if (iso === tomorrow) return 'domani'
  return shortDate(iso)
}

/** Oltre questo, una giornata di visite non sta più in piedi. */
const HEAVY_DAY_MIN = 7 * 60

/** Ore di visita che ci si può ragionevolmente mettere in un giorno. */
const COMFORTABLE_DAY_MIN = 6 * 60

/** Selettore delle giornate: la data vera, e le ore dentro il tab. */
function DayTabs({ trip, dayIndex, onSelectDay, onAddDay }: Props) {
  const minutesOf = (poiIds: string[]) =>
    poiIds.reduce((s, id) => s + (trip.pois[id]?.durationMin ?? 0), 0)

  return (
    <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
      {trip.days.map((d, i) => {
        const min = minutesOf(d.poiIds)
        const heavy = min > HEAVY_DAY_MIN
        const active = i === dayIndex

        return (
          <button
            key={i}
            onClick={() => onSelectDay(i)}
            className={`shrink-0 rounded-2xl px-4 py-2 text-left transition-colors ${
              active
                ? 'bg-ink text-paper'
                : heavy
                  ? 'border border-amber/40 bg-amber/[0.08]'
                  : 'border border-ink/[0.14]'
            }`}
          >
            {/* La data, non "G1": nascondere il giorno vero porta a
                prenotare per la giornata sbagliata. */}
            <span className="block text-sm font-semibold">{dayLabel(d.date)}</span>
            <span
              className={`tnum block text-[11px] ${
                active ? 'opacity-70' : heavy ? 'font-semibold text-amber' : 'text-faint'
              }`}
            >
              {formatHours(min)}
            </span>
          </button>
        )
      })}
      <button
        onClick={onAddDay}
        aria-label="Aggiungi giornata"
        className="flex w-11 shrink-0 items-center justify-center rounded-2xl border border-dashed border-ink/20 text-faint active:bg-ink/[0.04]"
      >
        <IconPlus size={16} width={2} />
      </button>
    </div>
  )
}

/**
 * Il menu della giornata.
 *
 * «Ottimizza» e «Stima durate» stavano accanto a «Ripianifica» con lo
 * stesso peso: tre bottoni fra cui scegliere di corsa, e nessuno che
 * dicesse "questo". Qui scendono di un livello, restando a un tocco.
 */
function DayMenu({
  trip,
  dayIndex,
  dayPois,
  onSplit,
  onRemoveDay,
  onOptimize,
  onEnrich,
  onClose,
  busy,
}: Props & {
  onOptimize: () => void
  onEnrich: () => void
  onClose: () => void
  busy: boolean
}) {
  const [splitting, setSplitting] = useState(false)

  const totalPois = trip.days.reduce((s, d) => s + d.poiIds.length, 0)
  const totalMin = trip.days.reduce(
    (s, d) => s + d.poiIds.reduce((x, id) => x + (trip.pois[id]?.durationMin ?? 0), 0),
    0,
  )
  const suggested = Math.max(1, Math.ceil(totalMin / COMFORTABLE_DAY_MIN))

  return (
    <div className="mt-3 rounded-[20px] border border-ink/[0.08] bg-white p-3 shadow-card-sm">
      {!splitting ? (
        <div className="flex flex-col gap-2">
          <Button block onClick={onOptimize} disabled={busy || dayPois.length < 3}>
            Ottimizza il giro
          </Button>
          <Button
            block
            onClick={onEnrich}
            disabled={busy || !hasApiKey()}
            title={hasApiKey() ? undefined : 'Serve la chiave Anthropic'}
          >
            <IconSparkle size={16} />
            Stima durate con l'AI
          </Button>
          <Button block onClick={() => setSplitting(true)}>
            Dividi per zona
          </Button>
          {trip.days.length > 1 && (
            <Button
              block
              onClick={() => {
                onRemoveDay(dayIndex)
                onClose()
              }}
              className="border-terra/30 text-terra"
            >
              Elimina questa giornata
            </Button>
          )}
        </div>
      ) : (
        <>
          <SectionLabel>Dividi per zona</SectionLabel>
          <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
            Ridistribuisce le {totalPois} tappe per zona e pareggia le ore, così ogni giornata
            resta in un'area sola. In tutto {formatHours(totalMin)}: con {suggested}{' '}
            {suggested === 1 ? 'giorno' : 'giorni'} sono circa{' '}
            {formatHours(Math.round(totalMin / suggested))} al giorno.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {[2, 3, 4, 5, 6].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={n === suggested ? 'primary' : 'ghost'}
                onClick={() => {
                  onSplit(n)
                  onClose()
                }}
              >
                {n} giorni
              </Button>
            ))}
          </div>
          <button
            onClick={() => setSplitting(false)}
            className="mt-3 text-[13px] text-faint underline active:text-ink"
          >
            indietro
          </button>
        </>
      )}
    </div>
  )
}

function formatHours(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m}`
}
