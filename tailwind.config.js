/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * La palette del ridisegno: carta chiara, leggibile al sole con lo
       * schermo a metà luminosità.
       *
       * Tre colori con tre significati, e nessun quarto:
       *   terra → adesso, e ciò che richiede attenzione
       *   moss  → prenotato (un vincolo che hai già ottenuto)
       *   amber → da controllare tu (biglietti, orari non autorevoli)
       *
       * Tutto il resto è inchiostro su carta a opacità diverse: usare
       * `text-ink/60` invece di dieci grigi nominati tiene la scala
       * coerente per costruzione.
       */
      colors: {
        paper: '#FBF7F0',
        ink: '#16130F',
        'ink-hover': '#2B251E',
        // I tre grigi caldi del mockup, nominati perché tornano ovunque.
        soft: '#6E655C',
        faint: '#8A8076',
        fainter: '#A69C92',

        terra: '#C2543A',
        'terra-link': '#B14A31',
        'terra-deep': '#8E3A26',

        moss: '#2C4A38',
        'moss-mid': '#3F6B52',

        amber: '#8A5A10',
        'amber-deep': '#6B4508',
      },
      fontFamily: {
        // I titoli, dove sta tutta la personalità.
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        // Il testo: una grottesca neutra che regge i numeri tabulari.
        sans: ['"Public Sans"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        // L'unica elevazione dell'app: le card che contano.
        card: '0 12px 32px rgba(22,19,15,0.07)',
        'card-sm': '0 8px 24px rgba(22,19,15,0.06)',
        'card-xs': '0 4px 14px rgba(22,19,15,0.04)',
      },
      // Rispetta la safe area di iPhone: la tab bar non deve finire
      // sotto la barra gesti.
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom)',
      },
    },
  },
  plugins: [],
}
