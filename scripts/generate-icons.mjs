/**
 * Génère les icônes PNG de la PWA et des applications Tauri.
 * Usage : bun run icons
 */
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const iconsDir = join(root, 'public', 'icons')
const extensionIconsDir = join(root, 'extension', 'public', 'icons')
await Promise.all([
  mkdir(iconsDir, { recursive: true }),
  mkdir(extensionIconsDir, { recursive: true }),
])

const regular = join(root, 'public', 'icon.svg')
const maskable = join(root, 'public', 'icon-maskable.svg')

await Promise.all([
  sharp(regular).resize(192, 192).png().toFile(join(iconsDir, 'pwa-192x192.png')),
  sharp(regular).resize(512, 512).png().toFile(join(iconsDir, 'pwa-512x512.png')),
  sharp(maskable).resize(512, 512).png().toFile(join(iconsDir, 'pwa-maskable-512x512.png')),
  sharp(regular).resize(180, 180).png().toFile(join(iconsDir, 'apple-touch-icon.png')),
  sharp(regular).resize(32, 32).png().toFile(join(root, 'public', 'favicon-32.png')),
  sharp(regular).resize(192, 192).png().toFile(join(extensionIconsDir, 'icon-192.png')),
  sharp(regular).resize(512, 512).png().toFile(join(extensionIconsDir, 'icon-512.png')),
])

console.log('Icônes générées dans public/icons')
