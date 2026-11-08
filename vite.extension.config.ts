import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, 'extension')

export default defineConfig({
  root,
  publicDir: 'public',
  build: {
    outDir: resolve(here, 'dist-extension'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup.html'),
        options: resolve(root, 'options.html'),
        menu: resolve(root, 'menu.html'),
        passkey: resolve(root, 'passkey.html'),
        background: resolve(root, 'background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
