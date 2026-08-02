import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base deve combaciare con il nome del repo su GitHub Pages:
// https://ciminoalex.github.io/ax-travel/
export default defineConfig({
  base: '/ax-travel/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'AX.Travel — Londra',
        short_name: 'AX.Travel',
        description: 'Il prossimo posto da vedere, e come arrivarci coi mezzi.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
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
        ],
      },
    }),
  ],
})
