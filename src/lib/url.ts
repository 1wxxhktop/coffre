/**
 * Validation des adresses rendues comme liens externes.
 *
 * Seuls `http:` et `https:` sont acceptés : un `javascript:`, `data:` ou
 * `file:` ne doit jamais devenir un lien cliquable dans l’interface.
 */
export function safeExternalUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  // Un schéma explicite est respecté : s’il n’est pas http(s), on refuse plutôt
  // que de le transformer en domaine (ex. `mailto:` deviendrait un hôte).
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null
  }

  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
    const url = new URL(withProtocol)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
