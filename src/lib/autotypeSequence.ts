/**
 * Validation de la séquence de saisie automatique.
 *
 * La grammaire est volontairement identique à celle du backend Rust :
 * `{USERNAME}`, `{PASSWORD}`, `{TOTP}`, `{TAB}`, `{ENTER}`, `{SPACE}`,
 * `{BACKSPACE}`, `{DELETE}`, `{ESC}`, `{DELAY <ms>}` et `{{` / `}}`.
 */

export const AUTOTYPE_SEQUENCE_MAX_LENGTH = 4_000
export const AUTOTYPE_DELAY_MAX_MS = 60_000

const KEY_TOKENS = new Set([
  'USERNAME',
  'PASSWORD',
  'TOTP',
  'TAB',
  'ENTER',
  'RETURN',
  'SPACE',
  'BACKSPACE',
  'DELETE',
  'ESC',
  'ESCAPE',
])

export type AutotypeSequenceIssue =
  | { code: 'too-long' }
  | { code: 'unclosed-token' }
  | { code: 'invalid-delay'; token: string }
  | { code: 'delay-too-long' }
  | { code: 'unknown-token'; token: string }

/**
 * Vérifie une séquence. `null` signifie qu’elle peut être exécutée par Rust.
 * Le texte littéral et les accolades échappées ne sont pas modifiés.
 */
export function validateAutotypeSequence(
  sequence: string,
): AutotypeSequenceIssue | null {
  if (sequence.length > AUTOTYPE_SEQUENCE_MAX_LENGTH) {
    return { code: 'too-long' }
  }

  let index = 0
  while (index < sequence.length) {
    const character = sequence[index]
    if (character === '{') {
      if (sequence[index + 1] === '{') {
        index += 2
        continue
      }
      const end = sequence.indexOf('}', index + 1)
      if (end === -1) return { code: 'unclosed-token' }
      const token = sequence.slice(index + 1, end)
      const upper = token.trim().toUpperCase()
      if (upper.startsWith('DELAY ')) {
        const value = upper.slice('DELAY '.length).trim()
        if (!/^\d+$/.test(value)) return { code: 'invalid-delay', token }
        if (Number(value) > AUTOTYPE_DELAY_MAX_MS) {
          return { code: 'delay-too-long' }
        }
      } else if (!KEY_TOKENS.has(upper)) {
        return { code: 'unknown-token', token }
      }
      index = end + 1
      continue
    }
    if (character === '}' && sequence[index + 1] === '}') {
      index += 2
      continue
    }
    index += 1
  }

  return null
}
