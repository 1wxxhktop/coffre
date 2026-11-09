import { readFileSync } from 'node:fs'

const path = new URL('../public/.well-known/security.txt', import.meta.url)
const text = readFileSync(path, 'utf8')
const fields = new Map()
for (const line of text.split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z-]+):\s*(.+)$/)
  if (match) fields.set(match[1].toLowerCase(), match[2].trim())
}

const errors = []
if (!fields.get('contact')?.startsWith('https://')) {
  errors.push('Contact doit être une URL https')
}
if (!fields.get('policy')?.startsWith('https://')) {
  errors.push('Policy doit être une URL https')
}
const expires = Date.parse(fields.get('expires') ?? '')
if (Number.isNaN(expires)) {
  errors.push('Expires doit être une date RFC 3339')
} else if (expires <= Date.now()) {
  errors.push('Expires est dépassé')
}
if (!fields.get('preferred-languages')) {
  errors.push('Preferred-Languages est absent')
}
if (errors.length > 0) {
  console.error('security.txt invalide :', errors.join(' ; '))
  process.exit(1)
}
console.log('security.txt valide.')
