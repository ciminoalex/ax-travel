import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Poi, Trip } from './lib/types'
import { loadTrip, newId, poisOfDay, saveTrip, todayISO } from './lib/store'
import { splitByArea } from './lib/split'
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
   * Ridistribuisce tutte le tappe del viaggio su N giornate raggruppandole
   * per zona. Le tappe già visitate restano dove sono: riorganizzare il
   * passato non serve a nessuno.
   */
  const splitAcrossDays = useCallback((days: number) => {
    setTrip((t) => {
      const all = t.days.flatMap((d) => d.poiIds.map((id) => t.pois[id])).filter(Boolean)
      const visited = all.filter((p) => p.visitedAt)
      const pending = all.filter((p) => !p.visitedAt)
      if (pending.length === 0) return t

      const groups = splitByArea(pending, days)
      // Se il viaggio era stato impostato in un giorno ormai passato, le
      // nuove giornate nascerebbero già scadute: si riparte da oggi.
      const first = t.days[0]?.date ?? todayISO()
      const startDate = first < todayISO() ? todayISO() : first

      const newDays = groups.map((g, i) => ({
        date: addDays(startDate, i),
        poiIds: [...(i === 0 ? visited.map((p) => p.id) : []), ...g.map((p) => p.id)],
      }))

      return { ...t, days: newDays.length > 0 ? newDays : t.days }
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
