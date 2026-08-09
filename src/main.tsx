import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AppStateProvider } from './state/AppState'
import { AuthProvider } from './state/AuthContext'
import './styles/global.css'

/*
 * Der Service Worker der PWA.
 *
 * Er speichert nichts zwischen und fängt keine Anfragen ab (siehe `public/sw.js`)
 * — er gehört zur installierbaren App und sonst nichts. Deshalb wird er hier
 * nebenbei angemeldet und nicht abgewartet: Er hat auf nichts Einfluss, was der
 * erste Bildschirm braucht.
 *
 * Ein Fehlschlag wird geschluckt. Im Entwicklungsserver gibt es die Datei
 * mitunter gar nicht, und ein Fehler in der Konsole wäre die einzige Folge.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
