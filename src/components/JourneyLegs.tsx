import type { Journey } from '../lib/types'
import { isTransit, lineStyle } from '../lib/lineColors'
import { IconArrowRight, IconBus, IconTrain, IconTube, IconWalk } from './Icon'

/**
 * I mezzi di un tragitto, in fila.
 *
 *   [🚶 4′] → [District · 11′] → [🚶 2′]
 *
 * Le tratte a piedi restano neutre, quelle sui mezzi prendono il colore
 * reale della linea: a Londra il colore è già nella testa di chi cammina,
 * e un chip verde dice "District" prima che tu abbia letto la parola.
 */

function ModeIcon({ mode, size = 13 }: { mode: string; size?: number }) {
  if (mode === 'walking') return <IconWalk size={size} width={2} />
  if (mode === 'bus') return <IconBus size={size} width={1.8} />
  if (mode === 'national-rail') return <IconTrain size={size} width={1.8} />
  return <IconTube size={size} width={2} />
}

/** "Central line" → "Central": il colore dice già che è una linea. */
function shortLabel(label: string): string {
  return label.replace(/\s+line$/i, '')
}

export default function JourneyLegs({
  journey,
  className = '',
}: {
  journey: Journey
  className?: string
}) {
  return (
    <ol className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {journey.legs.map((leg, i) => {
        const style = lineStyle(leg.mode, leg.label)
        const transit = isTransit(leg.mode)

        return (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <IconArrowRight size={11} width={2.4} className="text-[#B6ADA3]" />}
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] ${
                transit ? 'font-semibold' : ''
              }`}
              style={{ background: style.bg, color: style.fg }}
            >
              <ModeIcon mode={leg.mode} />
              {transit ? `${shortLabel(leg.label)} · ${leg.durationMin}′` : `${leg.durationMin}′`}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
