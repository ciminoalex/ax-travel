/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Rispetta la safe area di iPhone: la tab bar non deve finire
      // sotto la barra gesti.
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom)',
      },
    },
  },
  plugins: [],
}
