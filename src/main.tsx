import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { loadSettings } from './lib/settings'
import { currentWindowChrome } from './lib/windowChrome'
import { isMobileRuntime } from './lib/platform'

// Dans l’application desktop, la barre de titre est intégrée à la fenêtre :
// macOS garde les feux de circulation natifs en surcouche, Windows utilise une
// barre dessinée par l’application.
const windowChrome = currentWindowChrome()
if (windowChrome === 'macos') {
  document.documentElement.classList.add('is-tauri-macos')
}
if (windowChrome === 'windows') {
  document.documentElement.classList.add('is-tauri-windows')
}
if (isMobileRuntime()) {
  document.documentElement.classList.add('is-tauri-mobile')
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
