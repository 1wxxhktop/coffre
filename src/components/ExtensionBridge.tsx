import { useEffect } from 'react'
import { useVault } from '../state/VaultProvider'
import { generateTotp, isTotpUri, parseTotpUri } from '../lib/totp'
import { confirmSensitiveFill } from '../lib/biometrics'
import { generateEmailAlias, getAliasDefaults } from '../lib/emailAlias'
import {
  createPasskeyInVault,
  getPasskeyAssertion,
  toExtensionCreateResult,
  toExtensionGetResult,
} from '../lib/passkeyBridge'
import {
  EXTENSION_BRIDGE_VERSION,
  cardDetailsOf,
  hostFromUrl,
  loginUrlForService,
  identityFullName,
  loginAllowsHost,
  searchCards,
  searchIdentities,
  searchLogins,
  type CoffreExtensionBridge,
  type ExtensionPhishingChoice,
} from '../lib/extensionProtocol'
import { assessPhishingForItems, type PhishingQuery } from '../lib/phishing'
import {
  emptyDraft,
  type IdentityItem,
  type ItemDraft,
  type LoginItem,
} from '../lib/types'

/**
 * Expose une passerelle locale à l’extension navigateur lorsque le coffre est
 * déverrouillé. Elle disparaît au verrouillage et ne persiste rien.
 */
export function ExtensionBridge() {
  const {
    status,
    items,
    templates,
    vaults,
    addItem,
    updateItem,
    recordActivity,
    recordGeneratedPassword,
  } = useVault()

  useEffect(() => {
    if (status !== 'unlocked') {
      delete window.__coffreExtension
      return
    }

    // Une passerelle capturée avant le verrouillage ne doit plus répondre.
    let revoked = false
    const bridge: CoffreExtensionBridge = {
      version: EXTENSION_BRIDGE_VERSION,
      async search(query) {
        if (revoked || !query.trim()) return []
        return searchLogins(items, query)
      },
      async searchCards(query) {
        if (revoked || !query.trim()) return []
        return searchCards(items, query)
      },
      async searchIdentities(query) {
        if (revoked || !query.trim()) return []
        return searchIdentities(items, query)
      },
      async generateAlias(site) {
        const defaults = getAliasDefaults()
        if (!defaults.baseEmail) return null
        try {
          return generateEmailAlias({
            baseEmail: defaults.baseEmail,
            site,
            mode: defaults.mode,
          }).alias
        } catch {
          return null
        }
      },
      async searchCustom(query) {
        if (revoked || !query.trim()) return []
        const text = query.trim().toLowerCase()
        return items
          .filter(
            (item) =>
              item.type === 'note' &&
              !item.deletedAt &&
              Boolean(item.templateId) &&
              (!text || item.title.toLowerCase().includes(text)),
          )
          .slice(0, 50)
          .map((item) => {
            const template = templates.find((entry) => entry.id === item.templateId)
            const fillable = template
              ? template.fields.filter((field) => field.fillable).length
              : item.customFields.length
            return {
              id: item.id,
              kind: 'custom' as const,
              title: item.title,
              fieldCount: fillable,
            }
          })
      },
      async fillItem(itemId, options) {
        if (revoked) return null
        const item = items.find(
          (candidate) => candidate.id === itemId && !candidate.deletedAt,
        )
        if (!item) return null
        const requestedHost = options?.host?.trim() ?? ''
        if (item.type === 'login') {
          // L’hôte est obligatoire : sans lui, un script de l’onglet Coffre
          // pourrait énumérer et extraire tous les identifiants.
          if (!requestedHost || !loginAllowsHost(item, requestedHost)) {
            return null
          }
          const host = requestedHost
          let totp = ''
          if (item.totp && isTotpUri(item.totp)) {
            try {
              totp = await generateTotp(parseTotpUri(item.totp))
            } catch {
              totp = ''
            }
          }
          void recordActivity('extension-fill', item.title, host)
          return {
            kind: 'login',
            id: item.id,
            title: item.title,
            username: item.username,
            password: item.password,
            totp,
          }
        }
        const card = cardDetailsOf(item)
        if (card) {
          if (!requestedHost) return null
          if (
            options?.includeSensitive &&
            !(await confirmSensitiveFill(
              'Remplir le code de sécurité de la carte',
            ))
          ) {
            return null
          }
          return {
            kind: 'card',
            id: item.id,
            title: item.title,
            cardholder: card.cardholder,
            number: card.number,
            expiry: card.expiry,
            cvc: options?.includeSensitive ? card.cvc : '',
            pin: options?.includeSensitive ? card.pin : '',
            brand: card.brand,
          }
        }
        if (item.type === 'note' && item.templateId) {
          if (!requestedHost) return null
          const template = templates.find((entry) => entry.id === item.templateId)
          const fields = template
            ? template.fields.filter((field) => field.fillable)
            : []
          return {
            kind: 'custom',
            id: item.id,
            title: item.title,
            values: fields
              .map((field) => {
                const value = item.customFields.find(
                  (entry) => entry.label === field.label,
                )
                return value ? { label: field.label, value: value.value } : null
              })
              .filter((entry): entry is { label: string; value: string } => entry !== null),
          }
        }
        if (item.type === 'identity') {
          if (!requestedHost) return null
          return {
            kind: 'identity',
            id: item.id,
            title: item.title,
            fullName: identityFullName(item),
            firstName: item.firstName,
            lastName: item.lastName,
            email: item.email,
            phone: item.phone,
            address: item.address,
            city: item.city,
            postalCode: item.postalCode,
            country: item.country,
          }
        }
        return null
      },
      async fill(itemId, host) {
        if (revoked) return null
        const item = items.find(
          (candidate) => candidate.id === itemId && !candidate.deletedAt,
        )
        if (!item || item.type !== 'login') return null
        const requestedHost = host?.trim() ?? ''
        if (!requestedHost || !loginAllowsHost(item, requestedHost)) {
          return null
        }

        let totp = ''
        if (item.totp && isTotpUri(item.totp)) {
          try {
            totp = await generateTotp(parseTotpUri(item.totp))
          } catch {
            totp = ''
          }
        }

        void recordActivity('extension-fill', item.title, requestedHost)
        return {
          id: item.id,
          title: item.title,
          username: item.username,
          password: item.password,
          totp,
        }
      },
      async assessHost(query: PhishingQuery) {
        const item = query.itemId
          ? items.find(
              (candidate) => candidate.id === query.itemId && !candidate.deletedAt,
            )
          : undefined
        const host = query.host ?? query.url ?? ''
        const skipDomainSignals = Boolean(
          item && item.type === 'login' && host && loginAllowsHost(item, host),
        )
        return assessPhishingForItems(items, { ...query, skipDomainSignals })
      },
      async recordPhishingChoice(input: ExtensionPhishingChoice) {
        await recordActivity(
          'phishing-warning',
          `${input.choice}:${input.signals.join(',')}`,
          input.host,
        )
      },
      async recordGeneratedPassword(input: { password: string; host?: string }) {
        await recordGeneratedPassword(input)
      },
      async saveLogin(input) {
        // `input.host` peut être une origine (`http://hôte:port`) : elle sert
        // à la règle de domaines et à l’URL enregistrée, l’hôte au titre.
        const service = input.host.trim()
        const host = hostFromUrl(service) || service.toLowerCase()
        if (!host || !input.password) return null
        const username = input.username.trim()
        const assessment = assessPhishingForItems(items, {
          host,
          url: service,
          username,
          mode: 'save',
        })
        if (assessment.signals.length > 0 && !input.overridePhishing) {
          return null
        }
        // Changement de mot de passe : le service worker a identifié la
        // connexion à mettre à jour, y compris lorsque le formulaire ne
        // rappelle pas l’identifiant.
        if (input.itemId) {
          const target = items.find(
            (item): item is LoginItem =>
              item.id === input.itemId &&
              item.type === 'login' &&
              !item.deletedAt &&
              loginAllowsHost(item, service),
          )
          if (!target) return null
          await updateItem({
            ...target,
            password: input.password,
            urls:
              target.urls.filter(Boolean).length > 0
                ? target.urls
                : [loginUrlForService(service)],
          })
          return { id: target.id, updated: true }
        }
        const existing = items.find(
          (item): item is LoginItem =>
            item.type === 'login' &&
            !item.deletedAt &&
            item.username.trim().toLowerCase() === username.toLowerCase() &&
            loginAllowsHost(item, service),
        )
        if (existing) {
          await updateItem({
            ...existing,
            password: input.password,
            urls:
              existing.urls.filter(Boolean).length > 0
                ? existing.urls
                : [loginUrlForService(service)],
          })
          return { id: existing.id, updated: true }
        }
        const vaultId = vaults[0]?.id
        if (!vaultId) return null
        const item = await addItem({
          ...emptyDraft('login', vaultId),
          title: input.title?.trim() || host,
          username,
          password: input.password,
          urls: [loginUrlForService(service)],
          type: 'login',
          totp: '',
        })
        return { id: item.id, updated: false }
      },
      async checkLogin(input) {
        const host = input.host.trim()
        if (!host) return 'missing'
        const username = input.username.trim()
        const existing = items.filter(
          (item): item is LoginItem =>
            item.type === 'login' &&
            !item.deletedAt &&
            item.username.trim().toLowerCase() === username.toLowerCase() &&
            loginAllowsHost(item, host),
        )
        if (existing.length === 0) return 'missing'
        return existing.some((item) => item.password === input.password)
          ? 'same'
          : 'different'
      },
      async saveCard(input) {
        const number = input.number.replace(/\s+/g, '').trim()
        if (!number) return null
        const expiry = input.expiry.trim()
        const existing = items.find((item) => {
          if (item.deletedAt) return false
          const card = cardDetailsOf(item)
          return (
            card !== null &&
            card.number.replace(/\s+/g, '').slice(-4) === number.slice(-4) &&
            card.expiry.trim() === expiry
          )
        })
        if (existing) {
          if (existing.type === 'card') {
            await updateItem({
              ...existing,
              cardholder: input.cardholder || existing.cardholder,
              number,
              expiry: expiry || existing.expiry,
              cvc: input.cvc || existing.cvc,
              pin: input.pin || existing.pin,
              brand: input.brand || existing.brand,
            })
          } else if (existing.type === 'bank-account') {
            await updateItem({
              ...existing,
              cardholder: input.cardholder || existing.cardholder,
              cardNumber: number,
              cardExpiry: expiry || existing.cardExpiry,
              cardCvc: input.cvc || existing.cardCvc,
              cardPin: input.pin || existing.cardPin,
              cardBrand: input.brand || existing.cardBrand,
            })
          }
          return { id: existing.id, updated: true }
        }
        const vaultId = vaults[0]?.id
        if (!vaultId) return null
        const item = await addItem({
          ...emptyDraft('bank-account', vaultId),
          title:
            input.title?.trim() ||
            input.brand?.trim() ||
            'Compte et carte',
          type: 'bank-account',
          cardholder: input.cardholder,
          cardNumber: number,
          cardExpiry: expiry,
          cardCvc: input.cvc ?? '',
          cardPin: input.pin ?? '',
          cardBrand: input.brand ?? '',
        } as ItemDraft)
        return { id: item.id, updated: false }
      },
      async saveIdentity(input) {
        const email = input.email.trim().toLowerCase()
        const name = [input.firstName, input.lastName]
          .filter(Boolean)
          .join(' ')
          .trim()
        if (!email && !name && !input.fullName.trim()) return null
        const existing = items.find(
          (item): item is IdentityItem =>
            item.type === 'identity' &&
            !item.deletedAt &&
            ((Boolean(email) && item.email.trim().toLowerCase() === email) ||
              (Boolean(name) && identityFullName(item) === name)),
        )
        if (existing) {
          await updateItem({
            ...existing,
            firstName: input.firstName || existing.firstName,
            lastName: input.lastName || existing.lastName,
            email: input.email || existing.email,
            phone: input.phone || existing.phone,
            address: input.address || existing.address,
            city: input.city || existing.city,
            postalCode: input.postalCode || existing.postalCode,
            country: input.country || existing.country,
          })
          return { id: existing.id, updated: true }
        }
        const vaultId = vaults[0]?.id
        if (!vaultId) return null
        const item = await addItem({
          ...emptyDraft('identity', vaultId),
          title:
            input.title?.trim() ||
            name ||
            input.fullName.trim() ||
            email ||
            'Identité',
          type: 'identity',
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          address: input.address,
          city: input.city,
          postalCode: input.postalCode,
          country: input.country,
          birthDate: '',
          passportExpiry: '',
          idCardExpiry: '',
          licenseExpiry: '',
        })
        return { id: item.id, updated: false }
      },
      async passkeyCreate(input) {
        if (revoked) return null
        if (
          !(await confirmSensitiveFill(
            `Créer une passkey pour ${input.rpId}`,
          ))
        ) {
          return null
        }
        try {
          const result = await createPasskeyInVault(
            { items, vaults, addItem },
            {
              rpId: input.rpId,
              origin: input.origin,
              challenge: input.challenge,
              userName: input.userName,
              userHandle: input.userHandle,
              excludeCredentials: input.excludeCredentials,
            },
          )
          return toExtensionCreateResult(result)
        } catch {
          return null
        }
      },
      async passkeyGet(input) {
        if (revoked) return null
        if (
          !(await confirmSensitiveFill(
            `Signer une passkey pour ${input.rpId}`,
          ))
        ) {
          return null
        }
        try {
          const result = await getPasskeyAssertion(items, {
            rpId: input.rpId,
            origin: input.origin,
            challenge: input.challenge,
            allowCredentials: input.allowCredentials,
          })
          return result ? toExtensionGetResult(result) : null
        } catch {
          return null
        }
      },
    }

    window.__coffreExtension = bridge
    return () => {
      revoked = true
      if (window.__coffreExtension === bridge) {
        delete window.__coffreExtension
      }
    }
  }, [
    status,
    items,
    templates,
    vaults,
    addItem,
    updateItem,
    recordActivity,
    recordGeneratedPassword,
  ])

  return null
}
