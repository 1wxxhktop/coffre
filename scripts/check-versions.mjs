import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function versionFromCargo(path) {
  return read(path).match(/^version\s*=\s*"([^"]+)"/m)?.[1]
}

function numberConstant(source, pattern, label) {
  const value = source.match(pattern)?.[1]
  if (!value) fail(`Constante introuvable : ${label}`)
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    fail(`Constante invalide : ${label} = ${value}`)
  }
  return parsed
}

const pkg = JSON.parse(read('package.json'))
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'))
const extension = JSON.parse(read('extension/public/manifest.json'))

const productVersions = {
  package: pkg.version,
  tauri: tauri.version,
  extension: extension.version,
  cargo: versionFromCargo('src-tauri/Cargo.toml'),
  core: versionFromCargo('src-tauri/crates/coffre-core/Cargo.toml'),
  ffi: versionFromCargo('src-tauri/crates/coffre-core-ffi/Cargo.toml'),
  cli: versionFromCargo('src-tauri/crates/coffre-cli/Cargo.toml'),
  sshAgent: versionFromCargo('src-tauri/crates/coffre-ssh-agent/Cargo.toml'),
}

const productValues = new Set(Object.values(productVersions))
if (productValues.size !== 1 || [...productValues].some((value) => !value)) {
  fail(`Versions produit incohérentes : ${JSON.stringify(productVersions)}`)
}

// Les documents de référence doivent suivre la version produit. Les mentions
// historiques (audits, notes de release) restent libres.
const docMarkers = {
  'README.md': `État du projet — ${pkg.version}`,
  'docs/SECURITY.md': `limites connues de Coffre ${pkg.version}`,
  'docs/RELEASE-READINESS.md': `Niveau de préparation grand public — Coffre ${pkg.version}`,
  'docs/VERSIONING.md': `**Version de référence :** ${pkg.version}`,
}

for (const [path, marker] of Object.entries(docMarkers)) {
  if (!read(path).includes(marker)) {
    fail(`Documentation en retard : ${path} doit contenir « ${marker} ».`)
  }
}

const tsVault = read('src/lib/vault.ts')
const rustFormat = read('src-tauri/crates/coffre-core/src/format.rs')
const bridge = read('src/lib/bridgeProtocol.ts')
const extensionProtocol = read('src/lib/extensionProtocol.ts')
const lan = read('src-tauri/src/lan_sync.rs')

const formatVersions = {
  typescript: numberConstant(
    tsVault,
    /export const VAULT_FILE_VERSION = (\d+)/,
    'VAULT_FILE_VERSION (TypeScript)',
  ),
  rust: numberConstant(
    rustFormat,
    /pub const VAULT_FILE_VERSION: u8 = (\d+);/,
    'VAULT_FILE_VERSION (Rust)',
  ),
}

const manifestVersions = {
  typescript: numberConstant(
    tsVault,
    /export const VAULT_MANIFEST_VERSION = (\d+)/,
    'VAULT_MANIFEST_VERSION (TypeScript)',
  ),
  rust: numberConstant(
    rustFormat,
    /pub const VAULT_MANIFEST_VERSION: u8 = (\d+);/,
    'VAULT_MANIFEST_VERSION (Rust)',
  ),
}

const protocols = {
  bridge: numberConstant(
    bridge,
    /export const BRIDGE_PROTOCOL_VERSION = (\d+)/,
    'BRIDGE_PROTOCOL_VERSION',
  ),
  extension: numberConstant(
    extensionProtocol,
    /export const EXTENSION_BRIDGE_VERSION = (\d+)/,
    'EXTENSION_BRIDGE_VERSION',
  ),
  lan: numberConstant(
    lan,
    /pub const LAN_PROTOCOL_VERSION: u8 = (\d+);/,
    'LAN_PROTOCOL_VERSION',
  ),
}

if (new Set(Object.values(formatVersions)).size !== 1) {
  fail(`Versions de format incohérentes : ${JSON.stringify(formatVersions)}`)
}
if (new Set(Object.values(manifestVersions)).size !== 1) {
  fail(`Versions de manifeste incohérentes : ${JSON.stringify(manifestVersions)}`)
}

// Politique courante, alignée sur docs/VERSIONING.md. Un bump volontaire de
// l’une de ces valeurs doit être accompagné d’une mise à jour de ce script et
// du document de versioning.
const policy = {
  fileFormat: 4,
  manifest: 3,
  bridgeProtocol: 2,
  extensionBridge: 2,
  lanProtocol: 2,
}

if (formatVersions.typescript !== policy.fileFormat) {
  fail(
    `Format ${formatVersions.typescript} inattendu : la politique courante est ${policy.fileFormat}.`,
  )
}
if (manifestVersions.typescript !== policy.manifest) {
  fail(
    `Manifeste ${manifestVersions.typescript} inattendu : la politique courante est ${policy.manifest}.`,
  )
}
for (const [key, value] of Object.entries({
  bridgeProtocol: protocols.bridge,
  extensionBridge: protocols.extension,
  lanProtocol: protocols.lan,
})) {
  if (value !== policy[key]) {
    fail(`${key} = ${value} inattendu : la politique courante est ${policy[key]}.`)
  }
}

console.log(
  [
    `Version cohérente : ${pkg.version}`,
    `format .coffre : ${formatVersions.typescript}`,
    `manifeste : ${manifestVersions.typescript}`,
    `protocoles : pont ${protocols.bridge}, extension ${protocols.extension}, LAN ${protocols.lan}`,
  ].join(' · '),
)
