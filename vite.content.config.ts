import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, 'extension')

// Le content script est un script classique imposé par Manifest V3 : il est
// compilé séparément en IIFE, sans import ESM.
export default defineConfig({
  root,
  publicDir: false,
  build: {
    outDir: resolve(here, 'dist-extension'),
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: resolve(root, 'content.ts'),
      formats: ['iife'],
      name: 'CoffreContent',
      fileName: () => 'content.js',
    },
  },
})
