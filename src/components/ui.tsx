/**
 * Le primitive del ridisegno.
 *
 * La regola che tengono in piedi: **una sola azione primaria per
 * schermata**, nero pieno; tutto il resto ha il bordo sottile. Prima
 * «Ripianifica», «Ottimizza» e «Stima durate» erano tre bottoni dello
 * stesso peso e nessuno dei tre sembrava quello giusto.
 *
 * Esistono come componenti e non come classi ripetute perché quella regola
 * si rispetta solo se è scomoda da violare.
 */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `primary`: nero pieno. Una per schermata. */
  variant?: 'primary' | 'ghost' | 'plain'
  size?: 'lg' | 'md' | 'sm'
  /** Occupa tutta la larghezza. Le primarie quasi sempre sì. */
  block?: boolean
}

const SIZES = {
  lg: 'h-14 rounded-[17px] text-[17px] font-semibold',
  md: 'h-[46px] rounded-[15px] text-[15px] font-medium',
  sm: 'h-[38px] rounded-xl px-3.5 text-sm font-medium',
} as const

const VARIANTS = {
  primary: 'bg-ink text-paper active:bg-ink-hover',
  ghost: 'border border-ink/[0.14] text-ink active:bg-ink/[0.04]',
  plain: 'text-soft active:text-ink',
} as const

export function Button({
  variant = 'ghost',
  size = 'md',
  block = false,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]} ${block ? 'w-full' : ''} ${className}`}
    />
  )
}

/**
 * La superficie bianca su carta. È l'unica elevazione dell'app: se tutto
 * è una card, niente lo è — quindi la usano solo la tappa corrente, la
 * prenotazione del giorno e il riepilogo della ripianificazione.
 */
export function Card({
  className = '',
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`rounded-[26px] border border-ink/[0.08] bg-white shadow-card ${className}`}
    >
      {children}
    </div>
  )
}

/** Il maiuscoletto spaziato che apre una sezione. */
export function SectionLabel({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`text-xs font-semibold uppercase tracking-[0.12em] text-faint ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * Un numero grande con la sua unità sotto: i minuti totali e i minuti a
 * piedi, che nella schermata «Ora» hanno lo stesso peso visivo perché
 * decidono insieme se muoversi adesso o dopo.
 */
export function BigStat({
  value,
  label,
  icon,
}: {
  value: React.ReactNode
  label: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="tnum font-display text-[46px] font-semibold leading-none tracking-[-0.03em]">
          {value}
        </span>
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
        {label}
      </div>
    </div>
  )
}

/** Il titolo grande di una schermata. */
export function ScreenTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-display text-[27px] font-semibold tracking-[-0.02em]">{children}</h1>
  )
}

/**
 * Un avviso. Tre toni, tre significati, e nessun quarto:
 *   `warn` (ambra) — devi controllare tu qualcosa fuori dall'app
 *   `alert` (terracotta) — qualcosa non ha funzionato
 *   `info` (neutro) — un fatto, senza azione richiesta
 */
export function Notice({
  tone = 'info',
  icon,
  title,
  children,
}: {
  tone?: 'warn' | 'alert' | 'info'
  icon?: React.ReactNode
  title?: string
  children?: React.ReactNode
}) {
  const skin =
    tone === 'warn'
      ? 'border border-[rgba(180,120,20,0.4)] bg-[rgba(200,140,30,0.09)] text-amber-deep'
      : tone === 'alert'
        ? 'border border-terra/30 bg-terra/[0.07] text-terra-deep'
        : 'bg-ink/[0.035] text-ink/70'

  return (
    <div className={`flex items-start gap-2.5 rounded-[20px] px-4 py-4 ${skin}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="flex-1 space-y-1.5">
        {title && <p className="text-[15px] font-semibold">{title}</p>}
        {children && <div className="text-sm leading-relaxed">{children}</div>}
      </div>
    </div>
  )
}
