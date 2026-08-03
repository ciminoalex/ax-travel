import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Poi, Trip } from './lib/types'
import { loadTrip, newId, poisOfDay, saveTrip, todayISO } from './lib/store'
import { splitByArea } from './lib/split'
import { dayStartMinutes, orderByBookings } from './lib/dayOrder'
import Now from './screens/Now'
import DayPlan from './screens/DayPlan'
import AddPoi from './screens/AddPoi'
import Setup from './screens/Setup'

export type Tab = 'now' | 'day' | 'add' | 'setup'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'now', label: 'Ora', icon: '📍' },
  { id: 'day', label: 'Giornata', icon: '🗓️' },
  { id: 'add', label: 'Aggiungi', icon: '➕' },
  { id: 'setup', label: 'Setup', icon: '⚙️' },
]

export default function App() {
  const [trip, setTrip] = useState<Trip>(() => loadTrip())
  const [tab, setTab] = useState<Tab>('now')
  const [dayIndex, setDayIndex] = useState(0)

  // In viaggio non deve esistere un bottone "salva".
  useEffect(() => {
    saveTrip(trip)
  }, [trip])

  useEffect(() => {
    if (trip.days.length === 0) {
      setTrip((t) => ({ ...t, days: [{ date: todayISO(), poiIds: [] }] }))
    }
  }, [trip.days.length])

  // Se una giornata porta la data di oggi è quella che interessa: aprire
  // l'app deve mostrare il giro di adesso, non quello del primo giorno.
  useEffect(() => {
    const today = trip.days.findIndex((d) => d.date === todayISO())
    if (today >= 0) setDayIndex(today)
  }, [trip.days.length])

  const safeIndex = Math.min(dayIndex, Math.max(0, trip.days.length - 1))
  const dayPois = useMemo(() => poisOfDay(trip, safeIndex), [trip, safeIndex])

  const addPoi = useCallback(
    (poi: Omit<Poi, 'id'>) => {
      const id = newId()
      setTrip((t) => {
        const days = t.days.length > 0 ? [...t.days] : [{ date: todayISO(), poiIds: [] }]
        const i = Math.min(safeIndex, days.length - 1)
        days[i] = { ...days[i], poiIds: [...days[i].poiIds, id] }
        return { ...t, pois: { ...t.pois, [id]: { ...poi, id } }, days }
      })
    },
    [safeIndex],
  )

  const updatePoi = useCallback((id: string, patch: Partial<Poi>) => {
    setTrip((t) => {
      const existing = t.pois[id]
      if (!existing) return t
      return { ...t, pois: { ...t.pois, [id]: { ...existing, ...patch } } }
    })
  }, [])

  const removePoi = useCallback((id: string) => {
    setTrip((t) => {
      const pois = { ...t.pois }
      delete pois[id]
      return {
        ...t,
        pois,
        days: t.days.map((d) => ({ ...d, poiIds: d.poiIds.filter((x) => x !== id) })),
      }
    })
  }, [])

  const setOrder = useCallback(
    (ids: string[]) => {
      setTrip((t) => {
        const days = [...t.days]
        if (!days[safeIndex]) return t
        days[safeIndex] = { ...days[safeIndex], poiIds: ids }
        return { ...t, days }
      })
    },
    [safeIndex],
  )

  const reorder = useCallback(
    (from: number, to: number) => {
      setTrip((t) => {
        const days = [...t.days]
        const ids = [...(days[safeIndex]?.poiIds ?? [])]
        if (to < 0 || to >= ids.length) return t
        const [moved] = ids.splice(from, 1)
        ids.splice(to, 0, moved)
        days[safeIndex] = { ...days[safeIndex], poiIds: ids }
        return { ...t, days }
      })
    },
    [safeIndex],
  )

  /** Sposta una tappa in un'altra giornata, in coda. */
  const moveToDay = useCallback(
    (poiId: string, targetDay: number) => {
      setTrip((t) => {
        if (!t.days[targetDay] || targetDay === safeIndex) return t
        const days = t.days.map((d) => ({ ...d, poiIds: d.poiIds.filter((x) => x !== poiId) }))
        days[targetDay] = { ...days[targetDay], poiIds: [...days[targetDay].poiIds, poiId] }
        return { ...t, days }
      })
    },
    [safeIndex],
  )

  /**
   * Registra una prenotazione: giorno e ora insieme.
   *
   * Sposta la tappa nella giornata giusta (creandola se il viaggio non
   * arriva fin lì) e la blocca. Farlo in un'unica operazione evita di
   * dover prima spostare e poi fissare l'ora, dimenticandosi un passaggio.
   */
  const setBooking = useCallback((poiId: string, date: string, time: string) => {
    setTrip((t) => {
      const poi = t.pois[poiId]
      if (!poi) return t

      const days = t.days.map((d) => ({ ...d, poiIds: [...d.poiIds] }))
      while (!days.some((d) => d.date === date)) {
        const last = days[days.length - 1]
        if (!last || last.date > date) break
        days.push({ date: addDays(last.date, 1), poiIds: [] })
      }

      const target = days.findIndex((d) => d.date === date)
      if (target === -1) return t

      for (const d of days) d.poiIds = d.poiIds.filter((x) => x !== poiId)
      days[target].poiIds.push(poiId)

      const pois = { ...t.pois, [poiId]: { ...poi, pinnedDate: date, pinnedTime: time } }

      // La giornata si riordina subito attorno alla nuova prenotazione:
      // vederla finire in fondo e doverla spostare a mano sarebbe assurdo.
      const dayPois = days[target].poiIds.map((id) => pois[id]).filter(Boolean)
      days[target].poiIds = orderByBookings(dayPois, dayStartMinutes(date)).map((p) => p.id)

      return { ...t, days, pois }
    })
  }, [])

  /** Toglie la prenotazione: la tappa torna spostabile. */
  const clearBooking = useCallback((poiId: string) => {
    setTrip((t) => {
      const poi = t.pois[poiId]
      if (!poi) return t
      return {
        ...t,
        pois: { ...t.pois, [poiId]: { ...poi, pinnedDate: undefined, pinnedTime: undefined } },
      }
    })
  }, [])

  /** Blocca (o libera) una tappa nella giornata in cui si trova. */
  const togglePin = useCallback(
    (poiId: string) => {
      setTrip((t) => {
        const poi = t.pois[poiId]
        if (!poi) return t
        const date = t.days.find((d) => d.poiIds.includes(poiId))?.date
        if (!date) return t
        return {
          ...t,
          pois: {
            ...t.pois,
            [poiId]: { ...poi, pinnedDate: poi.pinnedDate ? undefined : date },
          },
        }
      })
    },
    [],
  )

  /**
   * "Oggi il museo è pieno": sposta la tappa al giorno dopo e la blocca lì,
   * creando la giornata se non c'è. Senza il blocco, la prima
   * riorganizzazione la riporterebbe indietro.
   */
  const deferToNextDay = useCallback((poiId: string) => {
    setTrip((t) => {
      const poi = t.pois[poiId]
      const fromIndex = t.days.findIndex((d) => d.poiIds.includes(poiId))
      if (!poi || fromIndex === -1) return t

      const days = t.days.map((d) => ({ ...d, poiIds: [...d.poiIds] }))
      const targetIndex = fromIndex + 1
      if (!days[targetIndex]) {
        days.push({ date: addDays(days[days.length - 1].date, 1), poiIds: [] })
      }

      days[fromIndex].poiIds = days[fromIndex].poiIds.filter((x) => x !== poiId)
      days[targetIndex].poiIds.push(poiId)

      return {
        ...t,
        days,
        pois: { ...t.pois, [poiId]: { ...poi, pinnedDate: days[targetIndex].date } },
      }
    })
  }, [])

  const addDay = useCallback(() => {
    setTrip((t) => {
      const last = t.days.at(-1)
      const date = last ? nextDate(last.date) : todayISO()
      return { ...t, days: [...t.days, { date, poiIds: [] }] }
    })
  }, [])

  /** Le tappe di una giornata rimossa passano alla precedente: mai perse. */
  const removeDay = useCallback((index: number) => {
    setTrip((t) => {
      if (t.days.length <= 1) return t
      const orphans = t.days[index]?.poiIds ?? []
      const days = t.days.filter((_, i) => i !== index)
      const target = Math.max(0, index - 1)
      days[target] = { ...days[target], poiIds: [...days[target].poiIds, ...orphans] }
      return { ...t, days }
    })
    setDayIndex((i) => Math.max(0, Math.min(i, index - 1)))
  }, [])

  /**
   * Ridistribuisce le tappe del viaggio su N giornate raggruppandole per
   * zona.
   *
   * Restano ferme due categorie: le tappe già visitate (riorganizzare il
   * passato non serve) e quelle bloccate a una data — una prenotazione o un
   * museo che oggi è pieno non si spostano perché fa comodo all'algoritmo.
   * Le loro ore però pesano sul bilanciamento delle giornate.
   */
  const splitAcrossDays = useCallback((days: number) => {
    setTrip((t) => {
      const all = t.days.flatMap((d) => d.poiIds.map((id) => t.pois[id])).filter(Boolean)
      const visited = all.filter((p) => p.visitedAt)
      const pending = all.filter((p) => !p.visitedAt)
      if (pending.length === 0) return t

      const first = t.days[0]?.date ?? todayISO()
      const startDate = first < todayISO() ? todayISO() : first
      const dates = Array.from({ length: days }, (_, i) => addDays(startDate, i))

      const pinned = pending.filter((p) => p.pinnedDate)
      const free = pending.filter((p) => !p.pinnedDate)

      // Una tappa bloccata oltre l'ultima giornata la trascina con sé:
      // meglio un giorno in più che perdere il vincolo.
      for (const p of pinned) {
        while (p.pinnedDate! > dates[dates.length - 1]) {
          dates.push(addDays(dates[dates.length - 1], 1))
        }
      }

      const pinnedByDay = dates.map((d) => pinned.filter((p) => p.pinnedDate === d))
      const preload = pinnedByDay.map((ps) => ps.reduce((s, p) => s + p.durationMin, 0))

      const groups = splitByArea(free, dates.length, preload)

      const newDays = dates.map((date, i) => ({
        date,
        poiIds: [
          ...(i === 0 ? visited.map((p) => p.id) : []),
          // Le prenotazioni vanno collocate all'ora giusta, non messe in
          // testa: una visita delle 15:30 non è la prima tappa del mattino.
          // E se la giornata è oggi, si parte dall'ora attuale.
          ...orderByBookings(
            [...pinnedByDay[i], ...(groups[i] ?? [])],
            dayStartMinutes(date),
          ).map((p) => p.id),
        ],
      }))

      return { ...t, days: newDays }
    })
    setDayIndex(0)
  }, [])

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <main className="flex-1 overflow-y-auto overscroll-contain pb-4">
        {tab === 'now' && (
          <Now
            trip={trip}
            dayPois={dayPois}
            onVisit={updatePoi}
            onGoAdd={() => setTab('add')}
          />
        )}
        {tab === 'day' && (
          <DayPlan
            trip={trip}
            dayIndex={safeIndex}
            dayPois={dayPois}
            onSelectDay={setDayIndex}
            onAddDay={addDay}
            onRemoveDay={removeDay}
            onSplit={splitAcrossDays}
            onMoveToDay={moveToDay}
            onDefer={deferToNextDay}
            onTogglePin={togglePin}
            onSetBooking={setBooking}
            onClearBooking={clearBooking}
            onRemove={removePoi}
            onReorder={reorder}
            onUpdate={updatePoi}
            onSetOrder={setOrder}
          />
        )}
        {tab === 'add' && <AddPoi onAdd={addPoi} dayPois={dayPois} hotel={trip.hotel} />}
        {tab === 'setup' && <Setup trip={trip} setTrip={setTrip} />}
      </main>

      <nav
        className="grid shrink-0 grid-cols-4 border-t border-slate-800 bg-slate-900"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-col items-center gap-0.5 py-3 text-xs transition-colors ${
              tab === t.id ? 'text-sky-400' : 'text-slate-500'
            }`}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span className="text-xl leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function nextDate(iso: string): string {
  return addDays(iso, 1)
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
