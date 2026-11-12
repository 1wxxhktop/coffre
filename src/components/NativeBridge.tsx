import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Modal } from './Modal'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { isTauriRuntime } from '../lib/external'
import { loadBridgeKey, storeBridgeKey } from '../lib/keychain'
import { extensionInstallInfo } from '../lib/extensionInstall'
import { generateTotp, isTotpUri, parseTotpUri } from '../lib/totp'
import { confirmSensitiveFill } from '../lib/biometrics'
import {
  createPasskeyInVault,
  getPasskeyAssertion,
  toExtensionCreateResult,
  toExtensionGetResult,
} from '../lib/passkeyBridge'
import {
  cardLast4,
  hostFromUrl,
  loginUrlForService,
  pageServiceFromUrl,
  identityFullName,
  loginAllowsHost,
  searchCards,
  searchIdentities,
  searchLogins,
} from '../lib/extensionProtocol'
import { assessPhishingForItems } from '../lib/phishing'
import {
  emptyDraft,
  type CardItem,
  type IdentityItem,
  type LoginItem,
} from '../lib/types'
import {
  bridgePairingCode,
  bridgePublicKeyFingerprint,
  bridgeRandomId,
  createBridgeKeyPair,
  decryptBridgePayload,
  deriveBridgeSessionKey,
  encryptBridgePayload,
  type BridgeEncryptedEnvelope,
  type BridgePairBegin,
  type BridgePlainMessage,
} from '../lib/bridgeProtocol'

interface BridgeFrameEvent {
  connectionId: number
  data: number[]
}

interface BridgeSessionState {
  session: string
  key: string | null
  extCounter: number
  appCounter: number
}

interface PendingPairing {
  connectionId: number
  id: string
  code: string
  extensionPublicKey: string
  extensionFingerprint: string
  appPrivateKey: CryptoKey
  appPublicKey: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function focusWindow(): Promise<void> {
  const window = getCurrentWindow()
  try {
    await window.unminimize()
  } catch {
    // La fenêtre peut déjà être restaurée.
  }
  try {
    await window.show()
  } catch {
    // Certaines plateformes refusent show() sans focus.
  }
  try {
    await window.setFocus()
  } catch {
    // Le focus est un confort : l’appairage reste possible si l’OS le refuse.
  }
}

function isEncryptedEnvelope(value: unknown): value is BridgeEncryptedEnvelope {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Record<string, unknown>
  return (
    envelope.type === 'enc' &&
    typeof envelope.id === 'string' &&
    typeof envelope.session === 'string' &&
    typeof envelope.counter === 'number' &&
    Number.isSafeInteger(envelope.counter) &&
    envelope.counter > 0 &&
    typeof envelope.iv === 'string' &&
    typeof envelope.data === 'string'
  )
}

/**
 * Pont natif actif uniquement dans l’application desktop. Il reçoit les trames
 * du relais, gère l’appairage et ne répond aux recherches et remplissages que
 * lorsque le coffre est déverrouillé.
 */
export function NativeBridge() {
  const {
    status,
    items,
    templates,
    vaults,
    addItem,
    updateItem,
    unlockWithBiometrics,
    recordActivity,
    recordGeneratedPassword,
  } = useVault()
  const { settings } = useSettings()
  const { tt } = useI18n()
  const statusRef = useRef(status)
  const itemsRef = useRef(items)
  const templatesRef = useRef(templates)
  const vaultsRef = useRef(vaults)
  const biometricsRef = useRef(settings.biometricUnlock)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    templatesRef.current = templates
  }, [templates])

  useEffect(() => {
    vaultsRef.current = vaults
  }, [vaults])

  useEffect(() => {
    biometricsRef.current = settings.biometricUnlock
  }, [settings.biometricUnlock])

  const [pendingPairing, setPendingPairing] = useState<PendingPairing | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState<string | null>(null)

  const sessionKeyRef = useRef<string | null>(null)
  const extensionVersionRef = useRef<string | null | undefined>(undefined)
  const sessionsRef = useRef(new Map<number, BridgeSessionState>())
  const pendingPairingRef = useRef<PendingPairing | null>(null)
  const pairingTimerRef = useRef<number | null>(null)

  const clearPairingTimer = useCallback(() => {
    if (pairingTimerRef.current !== null) {
      window.clearTimeout(pairingTimerRef.current)
      pairingTimerRef.current = null
    }
  }, [])

  const send = useCallback(async (connectionId: number, payload: unknown) => {
    try {
      await invoke('bridge_send', {
        connectionId,
        data: Array.from(encoder.encode(JSON.stringify(payload))),
      })
    } catch {
      // La connexion a pu se fermer entre deux messages.
    }
  }, [])

  const managedExtensionVersion = useCallback(async (): Promise<string | null> => {
    if (extensionVersionRef.current === undefined) {
      const info = await extensionInstallInfo()
      extensionVersionRef.current = info.available ? info.version : null
    }
    return extensionVersionRef.current
  }, [])

  const loadSessionKey = useCallback(async (): Promise<string | null> => {
    if (sessionKeyRef.current) return sessionKeyRef.current
    const stored = await loadBridgeKey()
    if (stored) sessionKeyRef.current = stored
    return sessionKeyRef.current
  }, [])

  const rejectPairing = useCallback(
    (reason: 'rejected' | 'expired') => {
      const pending = pendingPairingRef.current
      pendingPairingRef.current = null
      clearPairingTimer()
      setPendingPairing(null)
      setPairingBusy(false)
      setPairingError(null)
      if (pending) {
        void send(pending.connectionId, {
          id: pending.id,
          type: reason === 'rejected' ? 'pair-rejected' : 'pair-expired',
        })
      }
    },
    [clearPairingTimer, send],
  )

  const acceptPairing = useCallback(async () => {
    const pending = pendingPairingRef.current
    if (!pending || pairingBusy) return
    setPairingBusy(true)
    setPairingError(null)
    try {
      const key = await deriveBridgeSessionKey(
        pending.appPrivateKey,
        pending.appPublicKey,
        pending.extensionPublicKey,
      )
      sessionKeyRef.current = key
      const stored = await storeBridgeKey(key)
      if (!stored) {
        throw new Error(
          'La clé du pont natif n’a pas pu être enregistrée.',
        )
      }
      const session = sessionsRef.current.get(pending.connectionId)
      if (!session) {
        throw new Error('La session du pont natif a expiré. Réessayez.')
      }
      session.key = key
      session.extCounter = 0
      session.appCounter = 0
      pendingPairingRef.current = null
      clearPairingTimer()
      setPendingPairing(null)
      setPairingBusy(false)
      await send(pending.connectionId, {
        id: pending.id,
        type: 'pair-accepted',
        session: session.session,
      })
    } catch (error) {
      setPairingBusy(false)
      setPairingError(
        error instanceof Error ? error.message : 'Appairage impossible',
      )
    }
  }, [clearPairingTimer, pairingBusy, send])

  const handlePairBegin = useCallback(
    async (connectionId: number, message: BridgePairBegin) => {
      if (statusRef.current !== 'unlocked') {
        await send(connectionId, { id: message.id, type: 'locked' })
        await focusWindow()
        return
      }
      if (!message.publicKey || typeof message.publicKey !== 'string') {
        await send(connectionId, {
          id: message.id,
          type: 'protocol-error',
          error: 'pairing-key',
        })
        return
      }

      const pair = await createBridgeKeyPair()
      const pending: PendingPairing = {
        connectionId,
        id: message.id,
        code: bridgePairingCode(),
        extensionPublicKey: message.publicKey,
        extensionFingerprint: await bridgePublicKeyFingerprint(message.publicKey),
        appPrivateKey: pair.privateKey,
        appPublicKey: pair.publicKey,
      }
      clearPairingTimer()
      pendingPairingRef.current = pending
      setPairingError(null)
      setPendingPairing(pending)
      await send(connectionId, {
        id: message.id,
        type: 'pair-pending',
        code: pending.code,
        publicKey: pair.publicKey,
      })
      await focusWindow()
      pairingTimerRef.current = window.setTimeout(() => rejectPairing('expired'), 120_000)
    },
    [clearPairingTimer, rejectPairing, send],
  )

  const handlePayload = useCallback(
    async (payload: BridgePlainMessage): Promise<unknown> => {
      switch (payload.type) {
        case 'search': {
          const query = typeof payload.query === 'string' ? payload.query : ''
          const kind =
            payload.kind === 'card' ||
            payload.kind === 'identity' ||
            payload.kind === 'custom'
              ? payload.kind
              : 'login'
          if (kind === 'custom') {
            const text = query.trim().toLowerCase()
            return {
              type: 'search-result',
              items: itemsRef.current
                .filter(
                  (item) =>
                    item.type === 'note' &&
                    !item.deletedAt &&
                    Boolean(item.templateId) &&
                    (!text || item.title.toLowerCase().includes(text)),
                )
                .slice(0, 50)
                .map((item) => {
                  const template = templatesRef.current.find(
                    (entry) => entry.id === item.templateId,
                  )
                  return {
                    id: item.id,
                    kind: 'custom',
                    title: item.title,
                    fieldCount: template
                      ? template.fields.filter((field) => field.fillable).length
                      : item.customFields.length,
                  }
                }),
            }
          }
          return {
            type: 'search-result',
            items:
              kind === 'card'
                ? searchCards(itemsRef.current, query)
                : kind === 'identity'
                  ? searchIdentities(itemsRef.current, query)
                  : searchLogins(itemsRef.current, query),
          }
        }
        case 'assess-host': {
          const host = typeof payload.host === 'string' ? payload.host : ''
          const url = typeof payload.url === 'string' ? payload.url : ''
          const username =
            typeof payload.username === 'string' ? payload.username : ''
          const mode = payload.mode === 'save' ? 'save' : 'fill'
          const itemId =
            typeof payload.itemId === 'string' ? payload.itemId : ''
          const item = itemId
            ? itemsRef.current.find(
                (candidate) => candidate.id === itemId && !candidate.deletedAt,
              )
            : undefined
          // Schéma et port comptent : la règle refuse HTTPS → HTTP et compare
          // le port quand l’élément en précise un.
          const normalizedHost =
            pageServiceFromUrl(url) ||
            pageServiceFromUrl(host) ||
            host.trim().toLowerCase()
          return {
            type: 'phishing-assessment',
            assessment: assessPhishingForItems(itemsRef.current, {
              host,
              url,
              username,
              mode,
              itemId,
              skipDomainSignals: Boolean(
                item &&
                  item.type === 'login' &&
                  normalizedHost &&
                  loginAllowsHost(item, normalizedHost),
              ),
            }),
          }
        }
        case 'phishing-choice': {
          const host = typeof payload.host === 'string' ? payload.host : ''
          const choice =
            payload.choice === 'continue' ? 'continue' : payload.choice === 'cancel' ? 'cancel' : ''
          const signals = Array.isArray(payload.signals)
            ? payload.signals
                .filter((entry): entry is string => typeof entry === 'string')
                .map((entry) => entry.slice(0, 40))
                .slice(0, 20)
            : []
          if (!host || !choice) {
            return { type: 'phishing-choice-result', ok: false, error: 'invalid' }
          }
          void recordActivity(
            'phishing-warning',
            `${choice}:${signals.join(',')}`,
            host,
          )
          return { type: 'phishing-choice-result', ok: true }
        }
        case 'fill': {
          const kind =
            payload.kind === 'card' ||
            payload.kind === 'identity' ||
            payload.kind === 'custom'
              ? payload.kind
              : 'login'
          if (kind === 'custom') {
            const item = itemsRef.current.find(
              (candidate) =>
                candidate.id === payload.itemId &&
                !candidate.deletedAt &&
                candidate.type === 'note' &&
                Boolean(candidate.templateId),
            )
            if (!item || item.type !== 'note') {
              return { type: 'credentials', credentials: null, error: 'not-found' }
            }
            const template = templatesRef.current.find(
              (entry) => entry.id === item.templateId,
            )
            const values = template
              ? template.fields
                  .filter((field) => field.fillable)
                  .map((field) => {
                    const value = item.customFields.find(
                      (entry) => entry.label === field.label,
                    )
                    return value ? { label: field.label, value: value.value } : null
                  })
                  .filter(
                    (entry): entry is { label: string; value: string } =>
                      entry !== null,
                  )
              : []
            return {
              type: 'credentials',
              credentials: { kind: 'custom', id: item.id, title: item.title, values },
            }
          }
          if (kind === 'card' || kind === 'identity') {
            const item = itemsRef.current.find(
              (candidate) =>
                candidate.id === payload.itemId && !candidate.deletedAt,
            )
            if (!item || item.type !== kind) {
              return { type: 'credentials', credentials: null, error: 'not-found' }
            }
            if (item.type === 'card') {
              const includeSensitive = payload.includeSensitive === true
              if (
                includeSensitive &&
                !(await confirmSensitiveFill(
                  'Remplir le code de sécurité de la carte',
                ))
              ) {
                return { type: 'credentials', credentials: null, error: 'cancelled' }
              }
              return {
                type: 'credentials',
                credentials: {
                  kind: 'card',
                  id: item.id,
                  title: item.title,
                  cardholder: item.cardholder,
                  number: item.number,
                  expiry: item.expiry,
                  cvc: includeSensitive ? item.cvc : '',
                  pin: includeSensitive ? item.pin : '',
                  brand: item.brand,
                },
              }
            }
            return {
              type: 'credentials',
              credentials: {
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
              },
            }
          }
          const item = itemsRef.current.find(
            (candidate) =>
              candidate.id === payload.itemId &&
              !candidate.deletedAt &&
              candidate.type === 'login',
          )
          if (!item || item.type !== 'login') {
            return { type: 'credentials', credentials: null, error: 'not-found' }
          }
          // Le service reçu peut être une origine (`http://hôte:port`) : il est
          // transmis tel quel à la règle de domaines.
          const host =
            typeof payload.host === 'string' ? payload.host.trim() : ''
          if (payload.allowMismatch !== true && !loginAllowsHost(item, host)) {
            return {
              type: 'credentials',
              credentials: null,
              error: 'domain-mismatch',
            }
          }
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
            type: 'credentials',
            credentials: {
              kind: 'login',
              id: item.id,
              title: item.title,
              username: item.username,
              password: item.password,
              totp,
            },
          }
        }
        case 'record-generated-password': {
          const password =
            typeof payload.password === 'string' ? payload.password : ''
          const host = typeof payload.host === 'string' ? payload.host : ''
          if (!password || password.length > 1024) {
            return { type: 'record-result', ok: false, error: 'invalid' }
          }
          try {
            await recordGeneratedPassword({ password, host })
            return { type: 'record-result', ok: true }
          } catch {
            return { type: 'record-result', ok: false, error: 'record-failed' }
          }
        }
        case 'save-card': {
          const number =
            typeof payload.number === 'string'
              ? payload.number.replace(/\s+/g, '').trim()
              : ''
          if (!number) {
            return { type: 'save-result', ok: false, error: 'invalid' }
          }
          const text = (value: unknown, max: number): string =>
            typeof value === 'string' ? value.trim().slice(0, max) : ''
          const expiry = text(payload.expiry, 20)
          const existing = itemsRef.current.find(
            (candidate): candidate is CardItem =>
              candidate.type === 'card' &&
              !candidate.deletedAt &&
              cardLast4(candidate) === number.slice(-4) &&
              candidate.expiry.trim() === expiry,
          )
          try {
            if (existing) {
              await updateItem({
                ...existing,
                cardholder: text(payload.cardholder, 200) || existing.cardholder,
                number,
                expiry: expiry || existing.expiry,
                cvc: text(payload.cvc, 8) || existing.cvc,
                pin: text(payload.pin, 12) || existing.pin,
                brand: text(payload.brand, 40) || existing.brand,
              })
              return {
                type: 'save-result',
                ok: true,
                updated: true,
                itemId: existing.id,
              }
            }
            const vaultId = vaultsRef.current[0]?.id
            if (!vaultId) {
              return { type: 'save-result', ok: false, error: 'no-vault' }
            }
            const item = await addItem({
              ...emptyDraft('card', vaultId),
              title: text(payload.title, 200) || text(payload.brand, 40) || 'Carte bancaire',
              type: 'card',
              cardholder: text(payload.cardholder, 200),
              number,
              expiry,
              cvc: text(payload.cvc, 8),
              pin: text(payload.pin, 12),
              brand: text(payload.brand, 40),
            })
            return {
              type: 'save-result',
              ok: true,
              updated: false,
              itemId: item.id,
            }
          } catch {
            return { type: 'save-result', ok: false, error: 'save-failed' }
          }
        }
        case 'save-identity': {
          const text = (value: unknown, max: number): string =>
            typeof value === 'string' ? value.trim().slice(0, max) : ''
          const firstName = text(payload.firstName, 200)
          const lastName = text(payload.lastName, 200)
          const fullName = text(payload.fullName, 400)
          const email = text(payload.email, 500)
          const name = [firstName, lastName].filter(Boolean).join(' ').trim() || fullName
          if (!name && !email) {
            return { type: 'save-result', ok: false, error: 'invalid' }
          }
          const existing = itemsRef.current.find(
            (candidate): candidate is IdentityItem =>
              candidate.type === 'identity' &&
              !candidate.deletedAt &&
              ((Boolean(email) &&
                candidate.email.trim().toLowerCase() === email.toLowerCase()) ||
                (Boolean(name) && identityFullName(candidate) === name)),
          )
          try {
            if (existing) {
              await updateItem({
                ...existing,
                firstName: firstName || existing.firstName,
                lastName: lastName || existing.lastName,
                email: email || existing.email,
                phone: text(payload.phone, 100) || existing.phone,
                address: text(payload.address, 500) || existing.address,
                city: text(payload.city, 200) || existing.city,
                postalCode: text(payload.postalCode, 40) || existing.postalCode,
                country: text(payload.country, 200) || existing.country,
              })
              return {
                type: 'save-result',
                ok: true,
                updated: true,
                itemId: existing.id,
              }
            }
            const vaultId = vaultsRef.current[0]?.id
            if (!vaultId) {
              return { type: 'save-result', ok: false, error: 'no-vault' }
            }
            const item = await addItem({
              ...emptyDraft('identity', vaultId),
              title: text(payload.title, 200) || name || email || 'Identité',
              type: 'identity',
              firstName,
              lastName,
              email,
              phone: text(payload.phone, 100),
              address: text(payload.address, 500),
              city: text(payload.city, 200),
              postalCode: text(payload.postalCode, 40),
              country: text(payload.country, 200),
              birthDate: '',
              passportExpiry: '',
              idCardExpiry: '',
              licenseExpiry: '',
            })
            return {
              type: 'save-result',
              ok: true,
              updated: false,
              itemId: item.id,
            }
          } catch {
            return { type: 'save-result', ok: false, error: 'save-failed' }
          }
        }
        case 'check-login': {
          const host =
            typeof payload.host === 'string' ? payload.host.trim() : ''
          const username =
            typeof payload.username === 'string' ? payload.username.trim() : ''
          const password =
            typeof payload.password === 'string' ? payload.password : ''
          if (!host) return { type: 'login-state', state: 'missing' }
          const existing = itemsRef.current.filter(
            (candidate): candidate is LoginItem =>
              candidate.type === 'login' &&
              !candidate.deletedAt &&
              candidate.username.trim().toLowerCase() === username.toLowerCase() &&
              loginAllowsHost(candidate, host),
          )
          return {
            type: 'login-state',
            state:
              existing.length === 0
                ? 'missing'
                : existing.some((item) => item.password === password)
                  ? 'same'
                  : 'different',
          }
        }
        case 'save-login': {
          const service =
            typeof payload.host === 'string' ? payload.host.trim() : ''
          const host = hostFromUrl(service) || service.toLowerCase()
          const username =
            typeof payload.username === 'string' ? payload.username.trim() : ''
          const password =
            typeof payload.password === 'string' ? payload.password : ''
          if (!host || !password) {
            return { type: 'save-result', ok: false, error: 'domain-mismatch' }
          }
          const assessment = assessPhishingForItems(itemsRef.current, {
            host,
            url: service,
            username,
            mode: 'save',
          })
          if (
            assessment.signals.length > 0 &&
            payload.overridePhishing !== true
          ) {
            return {
              type: 'save-result',
              ok: false,
              error: 'phishing-warning',
            }
          }
          const existing = itemsRef.current.find(
            (candidate): candidate is LoginItem =>
              candidate.type === 'login' &&
              !candidate.deletedAt &&
              candidate.username.trim().toLowerCase() === username.toLowerCase() &&
              loginAllowsHost(candidate, service),
          )
          try {
            if (existing) {
              await updateItem({
                ...existing,
                password,
                urls:
                  existing.urls.filter(Boolean).length > 0
                    ? existing.urls
                    : [loginUrlForService(service)],
              })
              return {
                type: 'save-result',
                ok: true,
                updated: true,
                itemId: existing.id,
              }
            }
            const vaultId = vaultsRef.current[0]?.id
            if (!vaultId) {
              return { type: 'save-result', ok: false, error: 'no-vault' }
            }
            const item = await addItem({
              ...emptyDraft('login', vaultId),
              title:
                typeof payload.title === 'string' && payload.title.trim()
                  ? payload.title.trim().slice(0, 200)
                  : host,
              username,
              password,
              urls: [loginUrlForService(service)],
              type: 'login',
              totp: '',
            })
            return {
              type: 'save-result',
              ok: true,
              updated: false,
              itemId: item.id,
            }
          } catch {
            return { type: 'save-result', ok: false, error: 'save-failed' }
          }
        }
        case 'passkey-create': {
          const rpId =
            typeof payload.rpId === 'string'
              ? payload.rpId.trim().toLowerCase()
              : ''
          const origin =
            typeof payload.origin === 'string' ? payload.origin : ''
          const challenge =
            typeof payload.challenge === 'string' ? payload.challenge : ''
          const userName =
            typeof payload.userName === 'string'
              ? payload.userName.slice(0, 500)
              : ''
          if (!rpId || !origin || !challenge) {
            return {
              type: 'passkey-create-result',
              ok: false,
              error: 'invalid',
            }
          }
          const excludeCredentials = Array.isArray(payload.excludeCredentials)
            ? payload.excludeCredentials
                .filter((value): value is string => typeof value === 'string')
                .slice(0, 50)
            : []
          try {
            const result = await createPasskeyInVault(
              {
                items: itemsRef.current,
                vaults: vaultsRef.current,
                addItem,
              },
              {
                rpId,
                origin,
                challenge,
                userName,
                userHandle:
                  typeof payload.userHandle === 'string'
                    ? payload.userHandle
                    : undefined,
                excludeCredentials,
              },
            )
            return {
              type: 'passkey-create-result',
              ok: true,
              result: toExtensionCreateResult(result),
            }
          } catch {
            return {
              type: 'passkey-create-result',
              ok: false,
              error: 'passkey-failed',
            }
          }
        }
        case 'passkey-get': {
          const rpId =
            typeof payload.rpId === 'string'
              ? payload.rpId.trim().toLowerCase()
              : ''
          const origin =
            typeof payload.origin === 'string' ? payload.origin : ''
          const challenge =
            typeof payload.challenge === 'string' ? payload.challenge : ''
          if (!rpId || !origin || !challenge) {
            return {
              type: 'passkey-get-result',
              ok: false,
              error: 'invalid',
            }
          }
          const allowCredentials = Array.isArray(payload.allowCredentials)
            ? payload.allowCredentials
                .filter((value): value is string => typeof value === 'string')
                .slice(0, 50)
            : []
          try {
            const result = await getPasskeyAssertion(itemsRef.current, {
              rpId,
              origin,
              challenge,
              allowCredentials,
            })
            return {
              type: 'passkey-get-result',
              ok: true,
              result: result ? toExtensionGetResult(result) : null,
            }
          } catch {
            return {
              type: 'passkey-get-result',
              ok: false,
              error: 'passkey-failed',
            }
          }
        }
        case 'status':
          return {
            type: 'status',
            unlocked: statusRef.current === 'unlocked',
            paired: Boolean(await loadSessionKey()),
            extensionVersion: await managedExtensionVersion(),
          }
        default:
          return { type: 'protocol-error', error: 'unknown-type' }
      }
    },
    [
      addItem,
      loadSessionKey,
      managedExtensionVersion,
      recordActivity,
      recordGeneratedPassword,
      updateItem,
    ],
  )

  const handleEncrypted = useCallback(
    async (connectionId: number, envelope: BridgeEncryptedEnvelope) => {
      const session = sessionsRef.current.get(connectionId)
      if (!session) {
        await send(connectionId, {
          id: envelope.id,
          type: 'protocol-error',
          error: 'no-hello',
        })
        return
      }
      const key = session.key ?? (await loadSessionKey())
      session.key = key
      if (!key) {
        await send(connectionId, {
          id: envelope.id,
          type: 'protocol-error',
          error: 'unpaired',
        })
        return
      }
      if (envelope.session !== session.session) {
        await send(connectionId, {
          id: envelope.id,
          type: 'protocol-error',
          error: 'stale-session',
        })
        return
      }
      if (envelope.counter <= session.extCounter) {
        await send(connectionId, {
          id: envelope.id,
          type: 'protocol-error',
          error: 'replay',
        })
        return
      }

      let payload: BridgePlainMessage
      try {
        const decoded = await decryptBridgePayload(
          key,
          envelope.session,
          envelope.counter,
          'extension-to-app',
          envelope,
        )
        if (!decoded || typeof decoded !== 'object') {
          throw new Error('charge utile invalide')
        }
        payload = decoded as BridgePlainMessage
      } catch {
        await send(connectionId, {
          id: envelope.id,
          type: 'protocol-error',
          error: 'decrypt',
        })
        return
      }
      session.extCounter = envelope.counter

      const response =
        statusRef.current === 'unlocked'
          ? await handlePayload(payload)
          : { type: 'protocol-error', error: 'locked' }
      session.appCounter += 1
      try {
        const encrypted = await encryptBridgePayload(
          key,
          envelope.session,
          session.appCounter,
          'app-to-extension',
          response,
        )
        await send(connectionId, {
          id: envelope.id,
          type: 'enc',
          session: envelope.session,
          counter: session.appCounter,
          ...encrypted,
        })
      } catch {
        await send(connectionId, {
          id: envelope.id,
          type: 'protocol-error',
          error: 'encrypt',
        })
      }
    },
    [handlePayload, loadSessionKey, send],
  )

  const handleFrame = useCallback(
    async (connectionId: number, data: Uint8Array) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(decoder.decode(data)) as Record<string, unknown>
      } catch {
        return
      }
      if (typeof message.id !== 'string' || typeof message.type !== 'string') return

      if (message.type === 'hello') {
        const key = await loadSessionKey()
        const session = bridgeRandomId()
        sessionsRef.current.set(connectionId, {
          session,
          key,
          extCounter: 0,
          appCounter: 0,
        })
        await send(connectionId, {
          id: message.id,
          type: 'hello',
          session,
          paired: Boolean(key),
          unlocked: statusRef.current === 'unlocked',
        })
        return
      }

      if (message.type === 'unlock-request' || message.type === 'focus') {
        await focusWindow()
        if (
          message.type === 'unlock-request' &&
          statusRef.current !== 'unlocked' &&
          biometricsRef.current &&
          Boolean(await loadSessionKey())
        ) {
          try {
            await unlockWithBiometrics()
          } catch {
            // Touch ID annulé ou indisponible : la fenêtre de déverrouillage
            // reste au premier plan et l’utilisateur garde la main.
          }
        }
        await send(connectionId, { id: message.id, type: 'focused' })
        return
      }

      if (message.type === 'status') {
        const key = await loadSessionKey()
        await send(connectionId, {
          id: message.id,
          type: 'status',
          unlocked: statusRef.current === 'unlocked',
          paired: Boolean(key),
          // Version de l’extension présente sur le disque : l’extension se
          // recharge d’elle-même si elle est plus ancienne.
          extensionVersion: await managedExtensionVersion(),
        })
        return
      }

      if (message.type === 'pair-begin') {
        await handlePairBegin(connectionId, message as unknown as BridgePairBegin)
        return
      }

      if (isEncryptedEnvelope(message)) {
        await handleEncrypted(connectionId, message)
      }
    },
    [
      handleEncrypted,
      handlePairBegin,
      loadSessionKey,
      managedExtensionVersion,
      send,
      unlockWithBiometrics,
    ],
  )

  useEffect(() => {
    if (!isTauriRuntime()) return
    let disposed = false
    let unlistenMessage: (() => void) | undefined
    let unlistenClosed: (() => void) | undefined

    void (async () => {
      unlistenMessage = await listen<BridgeFrameEvent>(
        'coffre:bridge-message',
        (event) => {
          if (disposed) return
          const data = new Uint8Array(event.payload.data)
          void handleFrame(event.payload.connectionId, data)
        },
      )
      unlistenClosed = await listen<{ connectionId: number }>(
        'coffre:bridge-closed',
        (event) => {
          sessionsRef.current.delete(event.payload.connectionId)
          const pending = pendingPairingRef.current
          if (pending?.connectionId === event.payload.connectionId) {
            rejectPairing('rejected')
          }
        },
      )
      await loadSessionKey()
    })()

    return () => {
      disposed = true
      unlistenMessage?.()
      unlistenClosed?.()
    }
  }, [handleFrame, loadSessionKey, rejectPairing])

  useEffect(() => {
    if (status !== 'unlocked' && pendingPairingRef.current) {
      rejectPairing('rejected')
    }
  }, [rejectPairing, status])

  useEffect(() => () => clearPairingTimer(), [clearPairingTimer])

  useEffect(() => {
    const forget = () => {
      sessionKeyRef.current = null
      sessionsRef.current.clear()
      if (pendingPairingRef.current) rejectPairing('rejected')
    }
    window.addEventListener('coffre:bridge-forget', forget)
    return () => window.removeEventListener('coffre:bridge-forget', forget)
  }, [rejectPairing])

  if (!pendingPairing) return null

  return (
    <Modal
      title={tt('Associer l’extension navigateur')}
      description={tt('Une extension demande à se connecter à ce coffre.')}
      size="sm"
      onClose={() => {
        if (!pairingBusy) rejectPairing('rejected')
      }}
      footer={
        <>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => rejectPairing('rejected')}
            disabled={pairingBusy}
          >
            Refuser
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void acceptPairing()}
            disabled={pairingBusy}
            data-autofocus
          >
            {pairingBusy ? 'Association…' : 'Autoriser l’extension'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: '14px', justifyItems: 'center' }}>
        <p>
          Vérifiez que le code et l’empreinte affichés dans l’extension sont
          identiques, puis autorisez l’accès. L’extension pourra demander des
          identifiants uniquement lorsque ce coffre est déverrouillé.
        </p>
        <strong
          className="mono"
          style={{
            fontSize: '34px',
            letterSpacing: '0.28em',
            paddingLeft: '0.28em',
          }}
          aria-label={`Code d’appairage ${pendingPairing.code}`}
        >
          {pendingPairing.code}
        </strong>
        <p className="field__hint">
          {tt('Empreinte de l’extension')} :{' '}
          <span className="mono">{pendingPairing.extensionFingerprint}</span>
        </p>
        {pairingError && <p className="form-error">{pairingError}</p>}
      </div>
    </Modal>
  )
}
