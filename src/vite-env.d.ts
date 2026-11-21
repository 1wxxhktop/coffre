/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface Window {
  /** Gestionnaire du bouton retour Android, installé par VaultApp. */
  __coffreHandleBack?: () => boolean
}
