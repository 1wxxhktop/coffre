/**
 * Génère le vecteur croisé du manifeste 2 avec tous les sidecars.
 *
 * Utilisation : bun test-vectors/generate-sidecars-vector.ts
 *
 * Le fichier produit n’est pas déchiffrable : il sert uniquement à vérifier
 * que le manifeste canonique TypeScript et Rust sérialisent exactement les
 * mêmes octets. Les valeurs scellées sont fictives.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson, computeManifest } from '../src/lib/vault'
import type { VaultFile } from '../src/lib/types'

const NOW = '2026-11-09T15:00:00.000Z'
const WRITER = 'w_manifest_vector'

function sealed(n: string, c: string) {
  return { n, c }
}

const file: VaultFile = {
  format: 'coffre',
  version: 4,
  id: 'vf_manifest_sidecars',
  createdAt: NOW,
  updatedAt: NOW,
  kdf: {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    memoryKiB: 8192,
    iterations: 1,
    parallelism: 1,
    keyLength: 32,
  },
  vaults: [
    {
      id: 'v_manifest',
      key: sealed('vault-key-nonce', 'vault-key-ciphertext'),
      name: sealed('vault-name-nonce', 'vault-name-ciphertext'),
      createdAt: NOW,
      updatedAt: NOW,
      clock: { rev: 1, writer: WRITER },
    },
  ],
  items: [],
  attachments: [],
  versions: [],
  templates: [
    {
      id: 'tpl_manifest',
      key: sealed('template-key-nonce', 'template-key-ciphertext'),
      content: sealed('template-content-nonce', 'template-content-ciphertext'),
      createdAt: NOW,
      updatedAt: NOW,
      clock: { rev: 2, writer: WRITER },
    },
  ],
  activity: [
    {
      id: 'act_manifest',
      data: sealed('activity-nonce', 'activity-ciphertext'),
      createdAt: NOW,
      clock: { rev: 2, writer: WRITER },
    },
  ],
  generatorHistory: [
    {
      id: 'gen_manifest',
      data: sealed('generator-nonce', 'generator-ciphertext'),
      createdAt: NOW,
      clock: { rev: 2, writer: WRITER },
    },
  ],
  aliasKeys: [
    {
      service: 'addy',
      data: sealed('alias-nonce', 'alias-ciphertext'),
      createdAt: NOW,
      clock: { rev: 2, writer: WRITER },
    },
  ],
  sharing: {
    version: 1,
    encryptionPublicKey: 'sharing-encryption-public-key',
    signingPublicKey: 'sharing-signing-public-key',
    fingerprint: 'sharing-fingerprint',
    privateKeys: sealed('sharing-nonce', 'sharing-ciphertext'),
    createdAt: NOW,
  },
  emergency: {
    version: 1,
    mode: 'immediate',
    contact: {
      encryptionPublicKey: 'contact-encryption-public-key',
      signingPublicKey: 'contact-signing-public-key',
      fingerprint: 'contact-fingerprint',
    },
    sealed: {
      enc: 'emergency-enc',
      ciphertext: 'emergency-ciphertext',
    },
    createdAt: NOW,
  },
  writer: WRITER,
  revision: 1,
  keyEpoch: 1,
  tombstones: [],
  integrity: {
    mac: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    key: sealed('integrity-nonce', 'integrity-ciphertext'),
  },
}

const manifest = await computeManifest(file, 2)
const legacy = await computeManifest(file, 1)
writeFileSync(
  join(import.meta.dir, 'manifest-v2-sidecars.file.json'),
  `${JSON.stringify(file, null, 2)}\n`,
)
writeFileSync(
  join(import.meta.dir, 'manifest-v2-sidecars.manifest.json'),
  `${canonicalJson(manifest)}\n`,
)
writeFileSync(
  join(import.meta.dir, 'manifest-v1-sidecars.manifest.json'),
  `${canonicalJson(legacy)}\n`,
)
console.log(
  `Vecteur sidecars : ${manifest.records.length} enregistrements, manifestes ${legacy.manifest}/${manifest.manifest}`,
)
