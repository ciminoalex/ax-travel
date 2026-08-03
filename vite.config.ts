import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base deve combaciare con il nome del repo su GitHub Pages:
// https://ciminoalex.github.io/ax-travel/
export default defineConfig({
  base: '/ax-travel/',
  // Mostrato in Setup: permette di capire a colpo d'occhio se il telefono
  // ha davvero l'ultima versione o una copia vecchia in cache.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'AX.Travel — Londra',
        short_name: 'AX.Travel',
        description: 'Il prossimo posto da vedere, e come arrivarci coi mezzi.',
        theme_color: '#FBF7F0',
        background_color: '#FBF7F0',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Senza questi due, una correzione pubblicata non raggiunge un
        // telefono che ha già l'app installata finché non svuota la cache:
        // il vecchio service worker resta in carica a tempo indeterminato.
        clientsClaim: true,
        skipWaiting: true,
        // Le API di rete non vanno mai in cache "stale": i tempi di viaggio
        // devono essere freschi. La cache dell'itinerario sta in localStorage.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/photon\.komoot\.io\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'photon',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          // I font del ridisegno. Sono immutabili e hanno l'hash nell'URL,
          // quindi CacheFirst: dal secondo avvio non serve più rete, e in
          // roaming l'app non aspetta Google per disegnare il testo.
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
