import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Dans l’application desktop macOS, la barre de titre native est en surcouche :
// on réserve la zone des feux de circulation et on laisse le contenu aller
// jusqu’aux bords.
if ('__TAURI_INTERNALS__' in window && navigator.userAgent.includes('Mac')) {
  document.documentElement.classList.add('is-tauri-macos')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
