import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Coffre — Gestionnaire de mots de passe',
        short_name: 'Coffre',
        description:
          'Gestionnaire de mots de passe local-first, chiffré avec AES-256-GCM et Argon2id. Aucun serveur, aucune télémétrie.',
        lang: 'fr',
        dir: 'ltr',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'security'],
        icons: [
          {
            src: '/icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,txt,wasm}'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: 'zod',
              test: /[\\/]node_modules[\\/]zod[\\/]/,
              priority: 20,
            },
            {
              name: 'hash-wasm',
              test: /[\\/]node_modules[\\/]hash-wasm[\\/]/,
              priority: 20,
            },
            {
              name: 'hpke',
              test: /[\\/]node_modules[\\/](?:@hpke|@noble)[\\/]/,
              priority: 20,
            },
            {
              name: 'tauri',
              test: /[\\/]node_modules[\\/]@tauri-apps[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
})
