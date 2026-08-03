/**
 * I colori ufficiali delle linee TfL.
 *
 * Sono l'unica cosa che rende un elenco di mezzi leggibile a colpo d'occhio:
 * a Londra il colore della linea è già nella testa di chi cammina, sulle
 * mappe e sui cartelli delle stazioni. Un chip giallo dice "Circle" prima
 * che tu abbia letto la parola.
 *
 * Ogni voce porta anche il colore del testo, perché il giallo Circle e il
 * rosa Hammersmith sono illeggibili in bianco: la coppia va decisa qui, una
 * volta, non indovinata dai punti in cui si usa.
 */

export type LineStyle = { bg: string; fg: string }

/** Neutro: a piedi, o un mezzo che non riconosciamo. */
const NEUTRAL: LineStyle = { bg: 'rgba(22,19,15,0.05)', fg: '#4E463D' }

const WHITE = '#FFFFFF'
const BLACK = '#16130F'

/**
 * Chiavi in minuscolo, confrontate come sottostringa dell'etichetta che
 * arriva da TfL ("Central line", "bus 15", "Elizabeth line").
 *
 * L'ordine conta: `hammersmith` deve essere provata prima di `city`
 * (Waterloo & City), e `elizabeth` prima di qualunque cosa più corta.
 */
const LINES: [key: string, style: LineStyle][] = [
  ['bakerloo', { bg: '#B36305', fg: WHITE }],
  ['central', { bg: '#E32017', fg: WHITE }],
  ['circle', { bg: '#FFD300', fg: BLACK }],
  ['district', { bg: '#00782A', fg: WHITE }],
  ['hammersmith', { bg: '#F3A9BB', fg: BLACK }],
  ['jubilee', { bg: '#A0A5A9', fg: BLACK }],
  ['metropolitan', { bg: '#9B0056', fg: WHITE }],
  ['northern', { bg: '#000000', fg: WHITE }],
  ['piccadilly', { bg: '#003688', fg: WHITE }],
  ['victoria', { bg: '#0098D4', fg: WHITE }],
  ['waterloo', { bg: '#95CDBA', fg: BLACK }],
  ['elizabeth', { bg: '#6950A1', fg: WHITE }],
  ['dlr', { bg: '#00A4A7', fg: WHITE }],
  ['tram', { bg: '#66CC00', fg: BLACK }],

  // Overground: dal 2024 le linee hanno nomi propri e colori distinti, ma
  // TfL restituisce ancora spesso "London Overground". L'arancione storico
  // resta il ripiego, sotto i nomi nuovi.
  ['lioness', { bg: '#FAA61A', fg: BLACK }],
  ['mildmay', { bg: '#0077AD', fg: WHITE }],
  ['windrush', { bg: '#DC241F', fg: WHITE }],
  ['weaver', { bg: '#823A62', fg: WHITE }],
  ['suffragette', { bg: '#5D6F71', fg: WHITE }],
  ['liberty', { bg: '#61686B', fg: WHITE }],
  ['overground', { bg: '#EE7C0E', fg: BLACK }],
]

/** Il rosso degli autobus di Londra, per le linee bus senza colore proprio. */
const BUS: LineStyle = { bg: '#E1251B', fg: WHITE }

/** Il blu di National Rail. */
const RAIL: LineStyle = { bg: '#003366', fg: WHITE }

/**
 * Il colore del chip per una tratta.
 *
 * @param mode il modo TfL normalizzato ("tube", "bus", "walking"…)
 * @param label l'etichetta già pronta ("Central line", "bus 15")
 */
export function lineStyle(mode: string, label: string): LineStyle {
  if (mode === 'walking') return NEUTRAL

  const l = label.toLowerCase()
  for (const [key, style] of LINES) {
    if (l.includes(key)) return style
  }

  if (mode === 'bus') return BUS
  if (mode === 'national-rail' || mode === 'overground') return RAIL

  return NEUTRAL
}

/** true se la tratta va disegnata come chip colorato invece che neutro. */
export function isTransit(mode: string): boolean {
  return mode !== 'walking'
}
