import { useEffect, useRef, useState } from 'react'
import type { Trip } from '../lib/types'
import { exportTrip, importTrip, newId } from '../lib/store'
import { searchPlaces, type PlaceHit } from '../lib/photon'
import { describeKind } from '../lib/kinds'
import { clearApiKey, hasApiKey, saveApiKey, testApiKey } from '../lib/ai'
import { runDiagnostics, type Check } from '../lib/diagnostics'
import { Button, Card, ScreenTitle, SectionLabel } from '../components/ui'
import { IconHome, IconTrash } from '../components/Icon'

/**
 * Il ridisegno lascia Setup fuori di proposito: qui non si prendono
 * decisioni camminando, e la struttura a sezioni funziona già. Cambia solo
 * il vestito — carta chiara invece di ardesia — perché una schermata scura
 * dentro un'app chiara è peggio di entrambe.
 */

type Props = {
  trip: Trip
  setTrip: React.Dispatch<React.SetStateAction<Trip>>
}

export default function Setup({ trip, setTrip }: Props) {
  return (
    <div className="mx-auto max-w-lg space-y-8 px-[18px] pb-6 pt-5">
      <ScreenTitle>Setup</ScreenTitle>
      <HotelSection trip={trip} setTrip={setTrip} />
      <WalkPenaltySection trip={trip} setTrip={setTrip} />
      <AiKeySection />
      <BackupSection trip={trip} setTrip={setTrip} />
      <DiagnosticsSection />
      <VersionSection />
    </div>
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
      <SectionLabel>Alloggio</SectionLabel>
      {trip.hotel ? (
        <Card className="mt-2 flex items-center justify-between p-4 shadow-card-xs">
          <div className="flex min-w-0 items-center gap-3">
            <IconHome size={18} className="shrink-0 text-soft" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{trip.hotel.name}</p>
              <p className="truncate text-[13px] text-faint">{trip.hotel.address}</p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setTrip((t) => ({ ...t, hotel: null }))}
            className="ml-3 shrink-0 border-terra/30 text-terra"
            aria-label="Rimuovi alloggio"
          >
            <IconTrash size={15} />
          </Button>
        </Card>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nome o indirizzo dell'hotel"
            className="mt-2 h-[52px] w-full rounded-2xl border border-ink/[0.12] bg-white px-4 text-base outline-none placeholder:text-fainter focus:border-ink/30"
          />
          <ul className="mt-2 space-y-1">
            {hits.map((h, i) => {
              const kind = describeKind(h.kindKey, h.kind)
              return (
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
                    className="w-full rounded-[18px] bg-ink/[0.04] px-4 py-3 text-left active:bg-ink/10"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold">{h.name}</span>
                      <span className="shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 text-xs text-soft">
                        {kind.label}
                      </span>
                    </div>
                    <p className="truncate text-[13px] text-faint">{h.address}</p>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

function WalkPenaltySection({ trip, setTrip }: Props) {
  const p = trip.walkPenalty
  const label =
    p <= 0.25
      ? 'Il più veloce'
      : p >= 1.75
        ? 'Meno a piedi possibile'
        : p < 0.9
          ? 'Verso il veloce'
          : p > 1.1
            ? 'Verso poca camminata'
            : 'Equilibrio'

  return (
    <section>
      <SectionLabel>Come scegliere il tragitto</SectionLabel>
      <Card className="mt-2 p-4 shadow-card-xs">
        <input
          type="range"
          min={0}
          max={2}
          step={0.25}
          value={p}
          onChange={(e) => setTrip((t) => ({ ...t, walkPenalty: Number(e.target.value) }))}
          className="w-full accent-terra"
        />
        <div className="mt-1 flex justify-between text-[13px] text-faint">
          <span>Più veloce</span>
          <span>Meno a piedi</span>
        </div>
        <p className="mt-3 font-semibold text-terra">{label}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-soft">
          {p === 0
            ? 'Conta solo il tempo totale, anche con lunghe camminate.'
            : `Un minuto a piedi pesa come ${(1 + p).toFixed(2).replace(/\.?0+$/, '')} minuti sui mezzi.`}
        </p>
      </Card>
    </section>
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
      <SectionLabel>Chiave Anthropic</SectionLabel>
      <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
        Serve per capire il testo libero, arricchire i posti e suggerirne di nuovi. Resta solo su
        questo telefono: non è nel codice e non passa da nessun server.
      </p>

      {saved ? (
        <Card className="mt-2 flex items-center justify-between p-4 shadow-card-xs">
          <p className="flex items-center gap-2 text-[15px]">
            <span className="h-2 w-2 rounded-full bg-moss-mid" />
            Chiave configurata
          </p>
          <Button
            size="sm"
            onClick={() => {
              clearApiKey()
              setSaved(false)
              setMsg(null)
            }}
            className="border-terra/30 text-terra"
          >
            Rimuovi
          </Button>
        </Card>
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
            className="mt-2 h-[52px] w-full rounded-2xl border border-ink/[0.12] bg-white px-4 font-mono text-sm outline-none placeholder:text-fainter focus:border-ink/30"
          />
          <Button
            variant="primary"
            size="md"
            block
            onClick={() => void save()}
            disabled={!key.trim() || testing}
            className="mt-2"
          >
            {testing ? 'Verifico…' : 'Salva e verifica'}
          </Button>
          <p className="mt-2 text-[13px] text-faint">
            La crei su console.anthropic.com → API keys.
          </p>
        </>
      )}

      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? 'text-moss' : 'text-amber'}`}>{msg.text}</p>
      )}
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
      <SectionLabel>Backup</SectionLabel>
      <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
        I dati stanno solo su questo telefono. Esporta ogni tanto: se svuoti la cache del browser,
        si perdono.
      </p>
      <div className="mt-2 flex gap-2">
        <Button className="flex-1" onClick={download}>
          Esporta
        </Button>
        <Button className="flex-1" onClick={() => fileRef.current?.click()}>
          Importa
        </Button>
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
      {msg && <p className="mt-2 text-sm text-terra-link">{msg}</p>}
    </section>
  )
}

function DiagnosticsSection() {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    setChecks(await runDiagnostics())
    setRunning(false)
  }

  return (
    <section>
      <SectionLabel>Diagnostica</SectionLabel>
      <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
        Se i tempi coi mezzi non compaiono e l'app ripiega sulla distanza in linea d'aria, questo
        dice da dove viene il problema.
      </p>

      <Button block onClick={() => void run()} disabled={running} className="mt-2">
        {running ? 'Provo…' : 'Prova le connessioni'}
      </Button>

      {checks && (
        <ul className="mt-2 space-y-1">
          {checks.map((c) => (
            <li key={c.name} className="rounded-[18px] bg-ink/[0.04] px-4 py-3">
              <p className="flex items-center gap-2 text-[15px]">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${c.ok ? 'bg-moss-mid' : 'bg-terra'}`}
                />
                {c.name}
              </p>
              <p className="mt-0.5 pl-4 text-[13px] text-faint">{c.detail}</p>
            </li>
          ))}
        </ul>
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
    <section className="border-t border-ink/[0.08] pt-5">
      <p className="text-[13px] text-faint">Versione del {label}</p>
      <button
        onClick={() => {
          // Forza il ricarico saltando la cache, per i casi disperati.
          void caches
            ?.keys()
            .then((k) => Promise.all(k.map((n) => caches.delete(n))))
            .finally(() => location.reload())
        }}
        className="mt-2 text-[13px] text-faint underline active:text-ink"
      >
        Forza aggiornamento
      </button>
    </section>
  )
}
