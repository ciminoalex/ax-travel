import type { Poi } from './types'

/**
 * Accorcia le visite quando il viaggio non ci sta nei giorni rimasti.
 *
 * Di fronte a un programma sovraccarico ci sono due strade: lasciare fuori
 * delle tappe, o vederle tutte con meno calma. La seconda è quasi sempre
 * preferibile in viaggio — un'ora al British Museum è meglio di zero — ma
 * va detto, non fatto di nascosto.
 *
 * Il taglio è proporzionale al margine di ciascuna tappa: chi ha tre ore ne
 * cede più di chi ne ha una, e nessuna scende sotto il proprio minimo.
 */

/** Sotto questo non ha senso entrare da nessuna parte. */
const ABSOLUTE_FLOOR_MIN = 30

/** Nessuna visita viene tagliata di più del 40%. */
const MAX_CUT = 0.4

export type CompressionResult = {
  /** Le tappe con la durata aggiornata (piena o compressa). */
  pois: Poi[]
  /** Minuti tolti in totale. Zero se non è servito comprimere. */
  savedMin: number
  /** Quante tappe sono state accorciate. */
  affected: number
  /** Minuti che restano di troppo anche dopo il taglio massimo. */
  stillOver: number
}

function fullDuration(p: Poi): number {
  return p.fullDurationMin ?? p.durationMin
}

function floorFor(p: Poi): number {
  const full = fullDuration(p)
  return Math.max(ABSOLUTE_FLOOR_MIN, Math.round(full * (1 - MAX_CUT)))
}

/**
 * @param capacityMin quanto tempo di visita c'è davvero in tutto il viaggio.
 */
export function compressToFit(pois: Poi[], capacityMin: number): CompressionResult {
  // Si riparte sempre dalle durate piene: così togliendo una tappa le
  // altre si riprendono il tempo, invece di restare compresse per sempre.
  const restored = pois.map((p) => ({
    ...p,
    durationMin: fullDuration(p),
    fullDurationMin: p.fullDurationMin,
  }))

  const total = restored.reduce((s, p) => s + p.durationMin, 0)
  if (total <= capacityMin) {
    return {
      pois: restored.map(({ fullDurationMin: _drop, ...p }) => p as Poi),
      savedMin: 0,
      affected: 0,
      stillOver: 0,
    }
  }

  const excess = total - capacityMin
  const margins = restored.map((p) => Math.max(0, p.durationMin - floorFor(p)))
  const totalMargin = margins.reduce((s, m) => s + m, 0)

  if (totalMargin === 0) {
    return { pois: restored, savedMin: 0, affected: 0, stillOver: excess }
  }

  // Quanto di ogni margine va tagliato. Se il margine non basta si taglia
  // tutto il possibile e si dichiara quel che resta.
  const ratio = Math.min(1, excess / totalMargin)
  let saved = 0
  let affected = 0

  const out = restored.map((p, i) => {
    const cut = Math.round(margins[i] * ratio)
    if (cut <= 0) return p
    saved += cut
    affected++
    return {
      ...p,
      durationMin: p.durationMin - cut,
      // Ricordiamo la durata piena solo su ciò che abbiamo davvero toccato.
      fullDurationMin: fullDuration(p),
    }
  })

  return { pois: out, savedMin: saved, affected, stillOver: Math.max(0, excess - saved) }
}
