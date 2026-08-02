import { useEffect, useRef, useState } from 'react'
import type { Trip } from '../lib/types'
import { exportTrip, importTrip, newId } from '../lib/store'
import { searchPlaces, type PlaceHit } from '../lib/photon'
import { describeKind } from '../lib/kinds'
import { clearApiKey, hasApiKey, saveApiKey, testApiKey } from '../lib/ai'

type Props = {
  trip: Trip
  setTrip: React.Dispatch<React.SetStateAction<Trip>>
}

export default function Setup({ trip, setTrip }: Props) {
  return (
    <div className="mx-auto max-w-lg space-y-8 px-4 pt-6">
      <h1 className="text-2xl font-bold">Setup</h1>
      <HotelSection trip={trip} setTrip={setTrip} />
      <WalkPenaltySection trip={trip} setTrip={setTrip} />
      <AiKeySection />
      <BackupSection trip={trip} setTrip={setTrip} />
      <VersionSection />
    </div>
  )
}

function AiKeySection() {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(() => hasApiKey())
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save() {
    const trimmed = key.trim()
    if (!trimmed) return
    saveApiKey(trimmed)
    setTesting(true)
    setMsg(null)
    // Verificare subito evita di scoprire una chiave sbagliata più tardi,
    // magari per strada con le mani occupate.
    const res = await testApiKey()
    setTesting(false)
    if (res.ok) {
      setSaved(true)
      setKey('')
      setMsg({ ok: true, text: 'Chiave valida. Le funzioni AI sono attive.' })
    } else {
      clearApiKey()
      setMsg({ ok: false, text: res.error })
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Chiave Anthropic
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Serve per capire il testo libero, arricchire i posti e suggerirne di nuovi.
        Resta solo su questo telefono: non è nel codice e non passa da nessun server.
      </p>

      {saved ? (
        <div className="mt-2 flex items-center justify-between rounded-2xl bg-slate-900 p-4 ring-1 ring-slate-800">
          <p className="text-sm">
            <span className="text-emerald-400">●</span> Chiave configurata
          </p>
          <button
            onClick={() => {
              clearApiKey()
              setSaved(false)
              setMsg(null)
            }}
            className="rounded-lg px-3 py-2 text-xs text-rose-400 active:bg-rose-950/50"
          >
            Rimuovi
          </button>
        </div>
      ) : (
        <>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            type="password"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="sk-ant-..."
            className="mt-2 w-full rounded-2xl bg-slate-900 px-4 py-3.5 font-mono text-sm outline-none ring-1 ring-slate-800 placeholder:text-slate-600 focus:ring-sky-600"
          />
          <button
            onClick={() => void save()}
            disabled={!key.trim() || testing}
            className="mt-2 w-full rounded-2xl bg-sky-600 py-3 font-semibold active:bg-sky-700 disabled:opacity-40"
          >
            {testing ? 'Verifico…' : 'Salva e verifica'}
          </button>
          <p className="mt-2 text-xs text-slate-600">
            La crei su console.anthropic.com → API keys.
          </p>
        </>
      )}

      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
          {msg.text}
        </p>
      )}
    </section>
  )
}

/**
 * Sapere quale versione gira sul telefono è l'unico modo, a distanza, di
 * distinguere "il fix non funziona" da "il fix non è ancora arrivato".
 */
function VersionSection() {
  const built = new Date(__BUILD_TIME__)
  const label = built.toLocaleString('it-IT', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <section className="border-t border-slate-800 pt-4">
      <p className="text-xs text-slate-600">Versione del {label}</p>
      <button
        onClick={() => {
          // Forza il ricarico saltando la cache, per i casi disperati.
          void caches?.keys().then((k) => Promise.all(k.map((n) => caches.delete(n))))
            .finally(() => location.reload())
        }}
        className="mt-2 text-xs text-slate-500 underline active:text-slate-300"
      >
        Forza aggiornamento
      </button>
    </section>
  )
}

function HotelSection({ trip, setTrip }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        setHits(await searchPlaces(q, ctrl.signal))
      } catch {
        setHits([])
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Alloggio</h2>
      {trip.hotel ? (
        <div className="mt-2 flex items-center justify-between rounded-2xl bg-slate-900 p-4 ring-1 ring-slate-800">
          <div className="min-w-0">
            <p className="font-medium">🏨 {trip.hotel.name}</p>
            <p className="truncate text-xs text-slate-500">{trip.hotel.address}</p>
          </div>
          <button
            onClick={() => setTrip((t) => ({ ...t, hotel: null }))}
            className="ml-3 shrink-0 rounded-lg px-3 py-2 text-xs text-rose-400 active:bg-rose-950/50"
          >
            Rimuovi
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nome o indirizzo dell'hotel"
            className="mt-2 w-full rounded-2xl bg-slate-900 px-4 py-3.5 outline-none ring-1 ring-slate-800 placeholder:text-slate-600 focus:ring-sky-600"
          />
          <ul className="mt-2 space-y-2">
            {hits.map((h, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    setTrip((t) => ({
                      ...t,
                      hotel: {
                        id: newId(),
                        name: h.name,
                        address: h.address,
                        lat: h.lat,
                        lng: h.lng,
                        durationMin: 0,
                      },
                    }))
                    setQuery('')
                    setHits([])
                  }}
                  className="w-full rounded-xl bg-slate-900 px-4 py-3 text-left ring-1 ring-slate-800 active:bg-slate-800"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate font-medium">{h.name}</p>
                    <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
                      {describeKind(h.kindKey, h.kind).icon} {describeKind(h.kindKey, h.kind).label}
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-500">{h.address}</p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function WalkPenaltySection({ trip, setTrip }: Props) {
  const p = trip.walkPenalty
  const label = p <= 0.25 ? 'Il più veloce' : p >= 1.75 ? 'Meno a piedi possibile' : p < 0.9 ? 'Verso il veloce' : p > 1.1 ? 'Verso poca camminata' : 'Equilibrio'

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Come scegliere il tragitto
      </h2>
      <div className="mt-2 rounded-2xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <input
          type="range"
          min={0}
          max={2}
          step={0.25}
          value={p}
          onChange={(e) => setTrip((t) => ({ ...t, walkPenalty: Number(e.target.value) }))}
          className="w-full accent-sky-500"
        />
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>Più veloce</span>
          <span>Meno a piedi</span>
        </div>
        <p className="mt-3 text-sm font-medium text-sky-300">{label}</p>
        <p className="mt-1 text-xs text-slate-500">
          {p === 0
            ? 'Conta solo il tempo totale, anche con lunghe camminate.'
            : `Un minuto a piedi pesa come ${(1 + p).toFixed(2).replace(/\.?0+$/, '')} minuti sui mezzi.`}
        </p>
      </div>
    </section>
  )
}

function BackupSection({ trip, setTrip }: Props) {
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function download() {
    const blob = new Blob([exportTrip(trip)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ax-travel-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function upload(file: File) {
    const imported = importTrip(await file.text())
    if (!imported) {
      setMsg('File non valido.')
      return
    }
    setTrip(imported)
    setMsg('Viaggio importato.')
    setTimeout(() => setMsg(null), 3000)
  }

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Backup</h2>
      <p className="mt-1 text-xs text-slate-500">
        I dati stanno solo su questo telefono. Esporta ogni tanto: se svuoti la cache del
        browser, si perdono.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <button
          onClick={download}
          className="rounded-2xl bg-slate-800 py-3 font-medium active:bg-slate-700"
        >
          Esporta
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-2xl bg-slate-800 py-3 font-medium active:bg-slate-700"
        >
          Importa
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />
      {msg && <p className="mt-2 text-sm text-sky-300">{msg}</p>}
    </section>
  )
}
