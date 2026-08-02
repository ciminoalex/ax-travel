import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Poi, Trip } from './lib/types'
import { loadTrip, newId, poisOfDay, saveTrip, todayISO } from './lib/store'
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

  // In viaggio non deve esistere un bottone "salva".
  useEffect(() => {
    saveTrip(trip)
  }, [trip])

  // Un solo giorno per ora; il multi-giorno arriva in fase B.
  const dayIndex = 0
  useEffect(() => {
    if (trip.days.length === 0) {
      setTrip((t) => ({ ...t, days: [{ date: todayISO(), poiIds: [] }] }))
    }
  }, [trip.days.length])

  const dayPois = useMemo(() => poisOfDay(trip, dayIndex), [trip])

  const addPoi = useCallback((poi: Omit<Poi, 'id'>) => {
    const id = newId()
    setTrip((t) => {
      const days = t.days.length > 0 ? [...t.days] : [{ date: todayISO(), poiIds: [] }]
      days[dayIndex] = { ...days[dayIndex], poiIds: [...days[dayIndex].poiIds, id] }
      return { ...t, pois: { ...t.pois, [id]: { ...poi, id } }, days }
    })
  }, [])

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

  const reorder = useCallback((from: number, to: number) => {
    setTrip((t) => {
      const days = [...t.days]
      const ids = [...(days[dayIndex]?.poiIds ?? [])]
      if (to < 0 || to >= ids.length) return t
      const [moved] = ids.splice(from, 1)
      ids.splice(to, 0, moved)
      days[dayIndex] = { ...days[dayIndex], poiIds: ids }
      return { ...t, days }
    })
  }, [])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <main className="flex-1 overflow-y-auto pb-2">
        {tab === 'now' && (
          <Now trip={trip} dayPois={dayPois} onVisit={updatePoi} onGoAdd={() => setTab('add')} />
        )}
        {tab === 'day' && (
          <DayPlan dayPois={dayPois} onRemove={removePoi} onReorder={reorder} onUpdate={updatePoi} />
        )}
        {tab === 'add' && <AddPoi onAdd={addPoi} dayPois={dayPois} />}
        {tab === 'setup' && <Setup trip={trip} setTrip={setTrip} />}
      </main>

      <nav
        className="sticky bottom-0 grid grid-cols-4 border-t border-slate-800 bg-slate-900/95 backdrop-blur"
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
