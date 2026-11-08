import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { loadSettings } from './lib/settings'

// Dans l’application desktop macOS, la barre de titre native est en surcouche :
// on réserve la zone des feux de circulation et on laisse le contenu aller
// jusqu’aux bords.
if ('__TAURI_INTERNALS__' in window && navigator.userAgent.includes('Mac')) {
  document.documentElement.classList.add('is-tauri-macos')
}

// Applique le thème avant le premier rendu pour éviter un flash sombre.
const initialSettings = loadSettings()
const systemLight =
  window.matchMedia?.('(prefers-color-scheme: dark)').matches === false
const initialTheme =
  initialSettings.theme === 'system'
    ? systemLight
      ? 'light'
      : 'dark'
    : initialSettings.theme
document.documentElement.dataset.theme = initialTheme
document.documentElement.style.colorScheme = initialTheme

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
