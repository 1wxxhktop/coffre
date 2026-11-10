/**
 * Manifeste de mise à jour (`latest.json`) lu par le module updater de Tauri.
 *
 * Utilisé par la CI de release (`scripts/updater-manifest.ts`) : un manifeste
 * par release, publié avec elle, puis copié dans la release roulante
 * `canal-beta` pour le canal bêta.
 */

export interface UpdaterPlatform {
  url: string
  signature: string
}

export interface UpdaterManifest {
  version: string
  notes: string
  pub_date: string
  platforms: Record<string, UpdaterPlatform>
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** Les deux architectures macOS pointent vers le même bundle universel. */
export const MACOS_UNIVERSAL_PLATFORMS = ['darwin-aarch64', 'darwin-x86_64']

export function isValidVersion(version: string): boolean {
  return VERSION.test(version)
}

/**
 * Compare deux versions SemVer : négatif si `a < b`, positif si `a > b`.
 * Une préversion précède la version finale (`1.2.0-beta.1 < 1.2.0`).
 */
export function compareVersions(a: string, b: string): number {
  const left = VERSION.exec(a)
  const right = VERSION.exec(b)
  if (!left || !right) throw new Error('version invalide')
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(left[index]) - Number(right[index])
    if (diff !== 0) return diff
  }
  const leftPre = left[4]
  const rightPre = right[4]
  if (!leftPre && !rightPre) return 0
  if (!leftPre) return 1
  if (!rightPre) return -1
  const leftParts = leftPre.split('.')
  const rightParts = rightPre.split('.')
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const l = leftParts[index]
    const r = rightParts[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const ln = /^\d+$/.test(l)
    const rn = /^\d+$/.test(r)
    if (ln && rn) {
      const diff = Number(l) - Number(r)
      if (diff !== 0) return diff
    } else if (ln !== rn) {
      return ln ? -1 : 1
    } else if (l !== r) {
      return l < r ? -1 : 1
    }
  }
  return 0
}

export function buildManifest(input: {
  version: string
  notes: string
  pubDate: Date
  url: string
  signature: string
  platforms?: string[]
}): UpdaterManifest {
  if (!isValidVersion(input.version)) throw new Error('version invalide')
  const url = new URL(input.url)
  if (url.protocol !== 'https:') throw new Error('URL de paquet non HTTPS')
  const signature = input.signature.trim()
  if (!signature) throw new Error('signature vide')
  const platforms = input.platforms ?? MACOS_UNIVERSAL_PLATFORMS
  return {
    version: input.version,
    notes: input.notes.trim(),
    pub_date: input.pubDate.toISOString(),
    platforms: Object.fromEntries(
      platforms.map((name) => [name, { url: url.toString(), signature }]),
    ),
  }
}

/**
 * Vrai si le manifeste `next` doit remplacer `current` sur le canal bêta :
 * jamais de retour à une version plus ancienne.
 */
export function shouldReplaceChannel(
  current: Pick<UpdaterManifest, 'version'> | null,
  next: Pick<UpdaterManifest, 'version'>,
): boolean {
  if (!current || !isValidVersion(current.version)) return true
  return compareVersions(next.version, current.version) > 0
}
