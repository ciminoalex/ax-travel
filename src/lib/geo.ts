export type LatLng = { lat: number; lng: number }

/** Distanza in linea d'aria in metri. */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Deep link a Google Maps in modalità mezzi pubblici.
 * Nessuna API key: è solo un URL. Su telefono apre l'app nativa.
 */
export function mapsTransitUrl(from: LatLng, to: LatLng): string {
  const o = `${from.lat},${from.lng}`
  const d = `${to.lat},${to.lng}`
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=transit`
}

/** L'app è stata installata sulla home e gira senza barra del browser. */
function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/**
 * Apre Google Maps senza lasciare schede aperte dietro di sé.
 *
 * Con `target="_blank"` ogni tap creava una scheda Safari nuova che
 * restava lì: dopo una decina il browser si impianta e serve un refresh.
 * Navigare nella stessa scheda lascia intervenire l'universal link — Maps
 * si apre come app e la pagina resta dov'era, raggiungibile col back.
 *
 * Se invece l'app è installata sulla home non c'è nessun back a cui
 * tornare: lì serve davvero aprire fuori, ma una scheda per volta.
 */
export function openMaps(url: string): void {
  if (isStandalone()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  window.location.href = url
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

/**
 * Arrotonda una posizione a ~100 m. Serve come chiave di cache: riaprire
 * l'app dopo dieci passi non deve invalidare i tempi appena calcolati.
 */
export function coarse(p: LatLng): string {
  return `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`
}

export function getCurrentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocalizzazione non disponibile su questo browser'))
      return
    }

    // Rete cellulare invece di GPS: per scegliere la prossima tappa bastano
    // poche decine di metri, e in mezzo ai palazzi il fix GPS può non
    // arrivare mai. maximumAge accetta una posizione recente già nota.
    const options: PositionOptions = {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 120000,
    }

    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    // iOS a volte non richiama né success né error (permesso mai deciso,
    // tab in background): senza questa rete di sicurezza la schermata
    // resta a caricare per sempre.
    const guard = setTimeout(
      () => done(() => reject(new Error('Il telefono non ha risposto alla richiesta di posizione.'))),
      12000,
    )

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        done(() => {
          clearTimeout(guard)
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        }),
      (err) =>
        done(() => {
          clearTimeout(guard)
          reject(new Error(geolocationMessage(err)))
        }),
      options,
    )
  })
}

function geolocationMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Permesso di localizzazione negato. Attivalo nelle impostazioni del browser.'
    case err.POSITION_UNAVAILABLE:
      return 'Posizione non disponibile. Se sei in metro, riprova in superficie.'
    case err.TIMEOUT:
      return 'Localizzazione troppo lenta. Riprova.'
    default:
      return 'Impossibile ottenere la posizione.'
  }
}
