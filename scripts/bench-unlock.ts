/**
 * Mesure locale de l’ouverture d’un gros coffre.
 *
 * Usage : bun scripts/bench-unlock.ts [nombre] [concurrence]
 * Les enregistrements sont générés en mémoire avec une KDF volontairement
 * réduite : la mesure porte sur le déchiffrement des éléments, pas sur Argon2.
 */

import {
  itemContentAad,
  itemKeyAad,
  randomBytes,
  randomId,
  sealBytes,
  sealJson,
} from '../src/lib/crypto'
import { createVaultFile, openVaultFileWithMasterKey } from '../src/lib/vault'
import { emptyDraft, type ItemContent } from '../src/lib/types'

const count = Math.max(1, Number(process.argv[2] ?? 10_000))
const concurrency = Math.max(1, Number(process.argv[3] ?? 16))

const opened = await createVaultFile('benchmark password', 'Bench', {
  memoryKiB: 8_192,
  iterations: 1,
  parallelism: 1,
})
const vaultId = opened.vaults[0].id
const vaultKey = opened.session.vaultKey(vaultId)
const now = new Date().toISOString()

const generationStart = performance.now()
const records = []
for (let index = 0; index < count; index += 1) {
  const draft = emptyDraft('login', vaultId)
  const content = {
    ...draft,
    title: `Compte ${index}`,
    username: `ada${index}@example.com`,
    password: `secret-${index}`,
    urls: [`https://example.com/${index}`],
    attachments: [],
    deletedAt: null,
  } as ItemContent
  const id = randomId('i')
  const itemKey = randomBytes(32)
  records.push({
    id,
    vaultId,
    key: await sealBytes(itemKey, vaultKey, itemKeyAad(vaultId, id)),
    content: await sealJson(content, itemKey, itemContentAad(vaultId, id)),
    createdAt: now,
    updatedAt: now,
  })
}
const generationMs = performance.now() - generationStart

const file = { ...opened.file, items: records }
const masterKey = opened.session.masterKey
const openStart = performance.now()
const reopened = await openVaultFileWithMasterKey(file, masterKey)
const openMs = performance.now() - openStart

console.log(`Éléments            : ${count.toLocaleString('fr-FR')}`)
console.log(`Concurrence         : ${concurrency}`)
console.log(`Génération          : ${generationMs.toFixed(0)} ms`)
console.log(`Ouverture           : ${openMs.toFixed(0)} ms`)
console.log(`Éléments ouverts    : ${reopened.items.length.toLocaleString('fr-FR')}`)
process.exit(0)
