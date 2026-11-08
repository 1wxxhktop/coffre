import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'))
const extension = JSON.parse(read('extension/public/manifest.json'))
const cargo = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const core = read('src-tauri/crates/coffre-core/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const ffi = read('src-tauri/crates/coffre-core-ffi/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const cli = read('src-tauri/crates/coffre-cli/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const sshAgent = read('src-tauri/crates/coffre-ssh-agent/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1]

const versions = {
  package: pkg.version,
  tauri: tauri.version,
  extension: extension.version,
  cargo,
  core,
  ffi,
  cli,
  sshAgent,
}
const values = new Set(Object.values(versions))
if (values.size !== 1 || [...values].some((value) => !value)) {
  console.error('Versions incohérentes :', versions)
  process.exit(1)
}
console.log(`Version cohérente : ${pkg.version}`)
