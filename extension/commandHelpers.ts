import type {
  ExtensionAutofillSummary,
  ExtensionLoginSummary,
} from '../src/lib/extensionProtocol'
import { hostMatches } from '../src/lib/extensionProtocol'

/** Connexions dont l’URL correspond réellement à l’hôte de la page active. */
export function matchingLoginSummaries(
  items: ExtensionAutofillSummary[],
  host: string,
): ExtensionLoginSummary[] {
  return items.filter(
    (item): item is ExtensionLoginSummary =>
      'username' in item && 'host' in item && hostMatches(item.host, host),
  )
}

/** Connexion la plus pertinente disposant d’un TOTP. */
export function totpLoginSummary(
  items: ExtensionAutofillSummary[],
  host: string,
): ExtensionLoginSummary | null {
  return (
    matchingLoginSummaries(items, host).find((item) => item.hasTotp) ?? null
  )
}
