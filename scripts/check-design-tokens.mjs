#!/usr/bin/env node
/**
 * Vérifie la règle de design : aucune couleur, taille de police, rayon ou
 * niveau d’empilement littéral en dehors de `tokens.css` et `light.css`.
 *
 * Les deux fichiers de jetons sont les seuls autorisés à contenir des valeurs
 * de couleur ; `light.css` ne doit contenir que des variables.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const STYLES = new URL('../src/styles/', import.meta.url).pathname
const TOKEN_FILES = new Set(['tokens.css', 'light.css'])
// Feuille imprimée du kit d’urgence : couleurs papier et tailles de QR codes
// volontairement fixes, hors du système d’écran.
const PAPER_FILES = new Set(['emergency-kit.css'])

const RULES = [
  { regex: /#[0-9a-fA-F]{3,8}\b/, label: 'couleur hexadécimale littérale' },
  { regex: /\brgba?\(/, label: 'couleur rgb()/rgba() littérale' },
  { regex: /\bhsla?\(/, label: 'couleur hsl()/hsla() littérale' },
]

const VALUE_RULES = [
  { property: 'font-size', label: 'taille de police littérale' },
  { property: 'z-index', label: 'z-index littéral' },
]

const errors = []

const entries = (await readdir(STYLES)).filter((name) => name.endsWith('.css'))
for (const name of entries) {
  if (TOKEN_FILES.has(name) || PAPER_FILES.has(name)) continue
  const content = await readFile(join(STYLES, name), 'utf8')
  const lines = content.split('\n')
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.regex.test(line)) {
        errors.push(`${name}:${index + 1} — ${rule.label} : ${line.trim()}`)
      }
    }
    for (const rule of VALUE_RULES) {
      const match = line.match(new RegExp(`${rule.property}:\\s*([^;]+);`))
      if (match && !match[1].trim().startsWith('var(')) {
        errors.push(`${name}:${index + 1} — ${rule.label} : ${line.trim()}`)
      }
    }
    const radius = line.match(/border-radius:\s*([^;]+);/)
    if (radius) {
      const value = radius[1]
      const parts = value.split(/\s+/).filter(Boolean)
      if (!parts.every((part) => part === '0' || part.startsWith('var('))) {
        errors.push(`${name}:${index + 1} — rayon littéral : ${line.trim()}`)
      }
    }
    const shadow = line.match(/box-shadow:\s*([^;]+);/)
    if (shadow && !shadow[1].includes('var(') && shadow[1] !== 'none') {
      errors.push(`${name}:${index + 1} — ombre littérale : ${line.trim()}`)
    }
  })
}

if (errors.length > 0) {
  console.error('Jetons de design : valeurs littérales interdites.\n')
  for (const error of errors) console.error(`  ${error}`)
  console.error(
    '\nDéplacez ces valeurs dans src/styles/tokens.css (ou light.css pour le thème clair).',
  )
  process.exit(1)
}

console.log('Design : aucune valeur littérale hors des fichiers de jetons.')
