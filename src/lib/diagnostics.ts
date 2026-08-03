/**
 * Perché esiste: quando l'app ripiega sulla distanza in linea d'aria, la
 * causa sta sul telefono che la sta usando — rete, permessi, o una funzione
 * del browser troppo recente. A distanza è indovinabile solo per tentativi;
 * qui il telefono la dice.
 */

export type Check = {
  name: string
  ok: boolean
  detail: string
}

export async function runDiagnostics(): Promise<Check[]> {
  return [browserSupport(), await checkTfl(), await checkPhoton()]
}

/**
 * Le API recenti che l'app usa. AbortSignal.any esiste solo da Safari 17.4:
 * usarla senza rete di sicurezza faceva fallire ogni chiamata a TfL su
 * iPhone più indietro.
 */
function browserSupport(): Check {
  const missing: string[] = []
  if (typeof AbortController === 'undefined') missing.push('AbortController')
  if (typeof AbortSignal?.timeout !== 'function') missing.push('AbortSignal.timeout')
  if (typeof AbortSignal?.any !== 'function') missing.push('AbortSignal.any')
  if (!('geolocation' in navigator)) missing.push('geolocalizzazione')
  if (!('serviceWorker' in navigator)) missing.push('service worker')

  return {
    name: 'Browser',
    // Le prime due bastano: any e timeout non sono più indispensabili.
    ok: typeof AbortController !== 'undefined' && 'geolocation' in navigator,
    detail: missing.length === 0 ? 'tutto supportato' : `non supportati: ${missing.join(', ')}`,
  }
}

async function checkTfl(): Promise<Check> {
  const url =
    'https://api.tfl.gov.uk/Journey/JourneyResults/51.5074,-0.1278/to/51.5194,-0.1270' +
    '?mode=tube,dlr,overground,elizabeth-line,national-rail,bus,walking&walkingSpeed=average'
  return timed('TfL (tempi e mezzi)', url, (data) => {
    const n = (data as { journeys?: unknown[] })?.journeys?.length ?? 0
    return n > 0 ? `${n} percorsi proposti` : 'nessun percorso proposto'
  })
}

async function checkPhoton(): Promise<Check> {
  const url = 'https://photon.komoot.io/api/?q=british%20museum&limit=1&lang=en'
  return timed('Photon (ricerca luoghi)', url, (data) => {
    const n = (data as { features?: unknown[] })?.features?.length ?? 0
    return n > 0 ? 'risponde' : 'nessun risultato'
  })
}

async function timed(
  name: string,
  url: string,
  describe: (data: unknown) => string,
): Promise<Check> {
  const started = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    const ms = Date.now() - started

    if (!res.ok) return { name, ok: false, detail: `HTTP ${res.status} in ${ms} ms` }
    return { name, ok: true, detail: `${describe(await res.json())} in ${ms} ms` }
  } catch (e) {
    const ms = Date.now() - started
    const err = e as Error
    const why =
      err?.name === 'AbortError'
        ? 'nessuna risposta entro 15 s'
        : err?.message || 'richiesta fallita'
    return { name, ok: false, detail: `${why} (dopo ${ms} ms)` }
  }
}
