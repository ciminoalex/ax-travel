import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'

/**
 * Aggiornamento senza intervento manuale.
 *
 * Un'app installata sulla home continua a servire la versione in cache
 * finché il vecchio service worker non cede il posto. In viaggio non si
 * può chiedere di svuotare la cache del browser: appena esiste una
 * versione nuova, la applichiamo e ricarichiamo.
 */
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true) // attiva il nuovo service worker e ricarica
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return
    // Ricontrolla ogni mezz'ora: una sessione lunga non deve restare
    // indietro solo perché l'app non viene mai chiusa.
    setInterval(() => void registration.update(), 30 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
