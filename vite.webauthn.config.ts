import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, 'extension')

// L’interception WebAuthn doit vivre dans le monde de la page et être chargée
// à `document_start`. Elle est compilée séparément en IIFE, comme le content
// script, puis enregistrée dynamiquement par le service worker.
export default defineConfig({
  root,
  publicDir: false,
  build: {
    outDir: resolve(here, 'dist-extension'),
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: resolve(root, 'webauthn-main.ts'),
      formats: ['iife'],
      name: 'CoffreWebAuthn',
      fileName: () => 'webauthn-main.js',
    },
  },
})
