/**
 * Classification des pièces jointes pour l’aperçu intégré.
 *
 * Le type MIME enregistré fait foi ; lorsqu’il est absent ou générique, il est
 * déduit de l’extension du nom de fichier. Aucun contenu n’est analysé ici.
 */

import type { AttachmentMeta } from './types'

export type AttachmentPreviewKind = 'image' | 'pdf' | 'text' | 'audio' | 'video'

/** Limite de texte affiché dans l’aperçu, pour éviter un DOM géant. */
export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  log: 'text/plain',
  ini: 'text/plain',
  conf: 'text/plain',
  toml: 'application/toml',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  css: 'text/css',
  html: 'text/html',
  htm: 'text/html',
  sh: 'text/x-shellscript',
  sql: 'application/sql',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
}

const TEXT_APPLICATION_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/javascript',
  'application/x-javascript',
  'application/sql',
])

/** Type MIME effectif, avec repli sur l’extension du fichier. */
export function attachmentMime(
  attachment: Pick<AttachmentMeta, 'mime' | 'name'>,
): string {
  const normalized = attachment.mime.split(';')[0]?.trim().toLowerCase() ?? ''
  if (normalized && normalized !== 'application/octet-stream') return normalized
  const extension = attachment.name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension] ?? (normalized || 'application/octet-stream')
}

/** Type d’aperçu possible, ou `null` si le format n’est pas pris en charge. */
export function attachmentPreviewKind(
  attachment: Pick<AttachmentMeta, 'mime' | 'name'>,
): AttachmentPreviewKind | null {
  const mime = attachmentMime(attachment)
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('text/') || TEXT_APPLICATION_MIMES.has(mime)) return 'text'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return null
}
