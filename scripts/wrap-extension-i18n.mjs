import { readFileSync, writeFileSync } from 'node:fs'

const map = JSON.parse(readFileSync('scripts/i18n-extension-map.json', 'utf8'))
const byFile = new Map()
for (const entry of map) {
  if (!byFile.has(entry.file)) byFile.set(entry.file, [])
  byFile.get(entry.file).push(entry)
}

for (const [file, entries] of byFile) {
  let source = readFileSync(file, 'utf8')
  let count = 0
  for (const entry of entries) {
    const escaped = entry.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (entry.attr === 'text') {
      const regex = new RegExp(`>(\\s*)${escaped}(\\s*)<`, 'g')
      source = source.replace(regex, (_, before, after) => {
        count += 1
        return `>${before}<span data-i18n="${entry.key}">${entry.text}</span>${after}<`
      })
    } else {
      const regex = new RegExp(`${entry.attr}="${escaped}"`, 'g')
      source = source.replace(regex, (match) => {
        count += 1
        return `${match} data-i18n-${entry.attr}="${entry.key}"`
      })
    }
  }
  writeFileSync(file, source)
  console.log(`${file}: ${count} remplacements`)
}
