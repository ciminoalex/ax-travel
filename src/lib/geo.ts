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
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(geolocationMessage(err))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
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
