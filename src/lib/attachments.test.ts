import { describe, expect, it } from 'vitest'
import { attachmentMime, attachmentPreviewKind } from './attachments'

function attachment(name: string, mime: string) {
  return { name, mime }
}

describe('aperçu des pièces jointes', () => {
  it('respecte le type MIME enregistré', () => {
    expect(attachmentMime(attachment('photo.bin', 'image/png'))).toBe('image/png')
    expect(attachmentPreviewKind(attachment('photo.bin', 'image/png'))).toBe('image')
    expect(attachmentPreviewKind(attachment('document', 'application/pdf'))).toBe('pdf')
    expect(attachmentPreviewKind(attachment('note', 'text/plain'))).toBe('text')
    expect(attachmentPreviewKind(attachment('audio', 'audio/mpeg'))).toBe('audio')
    expect(attachmentPreviewKind(attachment('video', 'video/mp4'))).toBe('video')
  })

  it('déduit le type depuis l’extension si le MIME est générique', () => {
    expect(attachmentMime(attachment('photo.png', 'application/octet-stream'))).toBe(
      'image/png',
    )
    expect(attachmentMime(attachment('note.md', ''))).toBe('text/markdown')
    expect(attachmentMime(attachment('secret.pdf', 'application/octet-stream'))).toBe(
      'application/pdf',
    )
    expect(attachmentPreviewKind(attachment('archive.zip', 'application/zip'))).toBeNull()
  })

  it('reconnaît les formats textuels applicatifs', () => {
    for (const mime of [
      'application/json',
      'application/xml',
      'application/yaml',
      'application/toml',
      'application/sql',
    ]) {
      expect(attachmentPreviewKind(attachment('fichier', mime))).toBe('text')
    }
  })

  it('ne devine pas un type image pour une extension inconnue', () => {
    expect(attachmentMime(attachment('fichier.inconnu', ''))).toBe(
      'application/octet-stream',
    )
    expect(attachmentPreviewKind(attachment('fichier.inconnu', ''))).toBeNull()
  })
})
