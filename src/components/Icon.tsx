/**
 * Le icone del ridisegno: tratti, non emoji.
 *
 * Le emoji sembravano la scelta economica — nessun asset, nessuna libreria —
 * ma cambiano forma su ogni sistema, non ereditano il colore del testo e
 * portano un registro grafico che non è quello dell'app. Qui ogni icona è
 * un path con `stroke="currentColor"`: la stessa icona serve la tab bar
 * grigia, il chip terracotta e il bottone nero senza duplicati.
 *
 * I path vengono dal mockup, su griglia 24 e con `stroke-linecap: round`.
 */

type Props = {
  /** Lato in px. Le icone sono su griglia 24, quindi scalano pulite. */
  size?: number
  className?: string
  /** Spessore del tratto: 1.8 nella tab bar, 2-2.4 nei chip piccoli. */
  width?: number
}

function Svg({
  size = 18,
  className = '',
  width = 1.9,
  children,
  fill = 'none',
}: Props & { children: React.ReactNode; fill?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Navigazione e stato                                                 */
/* ------------------------------------------------------------------ */

export function IconPin(p: Props) {
  return (
    <Svg {...p}>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1116 0z" />
      <circle cx="12" cy="10" r="2.6" />
    </Svg>
  )
}

export function IconClock(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  )
}

export function IconCalendar(p: Props) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </Svg>
  )
}

export function IconPlus(p: Props) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function IconGear(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </Svg>
  )
}

export function IconChevron(p: Props) {
  return (
    <Svg {...p}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  )
}

export function IconChevronDown(p: Props) {
  return (
    <Svg {...p}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  )
}

export function IconArrowRight(p: Props) {
  return (
    <Svg {...p}>
      <path d="M9 5l7 7-7 7" />
    </Svg>
  )
}

/* ------------------------------------------------------------------ */
/* Mezzi                                                               */
/* ------------------------------------------------------------------ */

export function IconWalk(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="13" cy="4" r="2" />
      <path d="M11 21l1.5-6-3-2.5 1-4.5 3.5 2 2.5 1" />
      <path d="M12.5 15l3 6" />
    </Svg>
  )
}

/** Il roundel astratto: cerchio più barra. Vale per tube, DLR, Overground. */
export function IconTube(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h17" />
    </Svg>
  )
}

export function IconBus(p: Props) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="12" rx="2.5" />
      <path d="M4 10h16M8 20v-4M16 20v-4" />
      <circle cx="8.5" cy="13" r="0.6" fill="currentColor" />
      <circle cx="15.5" cy="13" r="0.6" fill="currentColor" />
    </Svg>
  )
}

export function IconTrain(p: Props) {
  return (
    <Svg {...p}>
      <rect x="5" y="3" width="14" height="14" rx="3" />
      <path d="M5 11h14M8 21l2-4M16 21l-2-4" />
      <circle cx="8.8" cy="14" r="0.6" fill="currentColor" />
      <circle cx="15.2" cy="14" r="0.6" fill="currentColor" />
    </Svg>
  )
}

/* ------------------------------------------------------------------ */
/* Azioni                                                              */
/* ------------------------------------------------------------------ */

/** La mappa piegata: il deep link a Google Maps. */
export function IconMap(p: Props) {
  return (
    <Svg {...p}>
      <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
      <path d="M9 3v15M15 6v15" />
    </Svg>
  )
}

export function IconCheck(p: Props) {
  return (
    <Svg width={2.2} {...p}>
      <path d="M4 12.5l5 5L20 6.5" />
    </Svg>
  )
}

export function IconHome(p: Props) {
  return (
    <Svg {...p}>
      <path d="M4 11l8-7 8 7v9a1 1 0 01-1 1H5a1 1 0 01-1-1z" />
      <path d="M9.5 21v-6h5v6" />
    </Svg>
  )
}

export function IconSearch(p: Props) {
  return (
    <Svg width={2} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </Svg>
  )
}

export function IconMenu(p: Props) {
  return (
    <Svg width={2} {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  )
}

export function IconRefresh(p: Props) {
  return (
    <Svg {...p}>
      <path d="M20 11a8 8 0 10-1.6 5.6" />
      <path d="M20 5v6h-6" />
    </Svg>
  )
}

export function IconTrash(p: Props) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 13h9l1-13" />
    </Svg>
  )
}

export function IconUp(p: Props) {
  return (
    <Svg width={2.2} {...p}>
      <path d="M12 19V6M6 12l6-6 6 6" />
    </Svg>
  )
}

export function IconDown(p: Props) {
  return (
    <Svg width={2.2} {...p}>
      <path d="M12 5v13M6 12l6 6 6-6" />
    </Svg>
  )
}

/* ------------------------------------------------------------------ */
/* Prenotazioni e avvisi                                               */
/* ------------------------------------------------------------------ */

/** Il biglietto: una prenotazione confermata, che nessuno può spostare. */
export function IconTicket(p: Props) {
  return (
    <Svg {...p}>
      <path d="M3 9.5a2 2 0 010-4V4h18v1.5a2 2 0 000 4v5a2 2 0 000 4V20H3v-1.5a2 2 0 000-4z" />
      <path d="M12 6.5v11" />
    </Svg>
  )
}

/** Tappe spostate da un giorno all'altro. */
export function IconSwap(p: Props) {
  return (
    <Svg {...p}>
      <path d="M4 7h11M4 7l3-3M4 7l3 3" />
      <path d="M20 17H9M20 17l-3-3M20 17l-3 3" />
    </Svg>
  )
}

/** Visite accorciate: due frecce che si stringono. */
export function IconCompress(p: Props) {
  return (
    <Svg {...p}>
      <path d="M6 12h12" />
      <path d="M9 8l-3 4 3 4M15 8l3 4-3 4" />
    </Svg>
  )
}

export function IconWarn(p: Props) {
  return (
    <Svg width={2} {...p}>
      <path d="M12 4v10M12 18v.5" />
    </Svg>
  )
}

export function IconInfo(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v.5M12 11v5" />
    </Svg>
  )
}

export function IconSparkle(p: Props) {
  return (
    <Svg {...p}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </Svg>
  )
}
