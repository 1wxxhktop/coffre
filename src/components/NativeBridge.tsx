import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Modal } from './Modal'
import { useVault } from '../state/VaultProvider'
import { useI18n } from '../state/I18nProvider'
import { useSettings } from '../state/SettingsProvider'
import { isTauriRuntime } from '../lib/external'
import { loadVaultKey, storeVaultKey } from '../lib/keychain'
import { generateTotp, isTotpUri, parseTotpUri } from '../lib/totp'
import {
  createPasskeyInVault,
  getPasskeyAssertion,
  toExtensionCreateResult,
  toExtensionGetResult,
} from '../lib/passkeyBridge'
import {
  hostFromUrl,
  loginAllowsHost,
  searchLogins,
} from '../lib/extensionProtocol'
import { emptyDraft, type LoginItem } from '../lib/types'
import {
  BRIDGE_KEYCHAIN_ACCOUNT,
  bridgePairingCode,
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
  const { status, items, vaults, addItem, updateItem, unlockWithBiometrics } =
    useVault()
  const { settings } = useSettings()
  const { tt } = useI18n()
  const statusRef = useRef(status)
  const itemsRef = useRef(items)
  const vaultsRef = useRef(vaults)
  const biometricsRef = useRef(settings.biometricUnlock)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

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

  const loadSessionKey = useCallback(async (): Promise<string | null> => {
    if (sessionKeyRef.current) return sessionKeyRef.current
    const stored = await loadVaultKey(BRIDGE_KEYCHAIN_ACCOUNT)
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
      const stored = await storeVaultKey(BRIDGE_KEYCHAIN_ACCOUNT, key)
      if (!stored) {
        throw new Error(
          'Le trousseau du système a refusé d’enregistrer la clé du pont natif.',
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
        case 'search':
          return {
            type: 'search-result',
            items: searchLogins(
              itemsRef.current,
              typeof payload.query === 'string' ? payload.query : '',
            ),
          }
        case 'fill': {
          const item = itemsRef.current.find(
            (candidate) =>
              candidate.id === payload.itemId &&
              !candidate.deletedAt &&
              candidate.type === 'login',
          )
          if (!item || item.type !== 'login') {
            return { type: 'credentials', credentials: null, error: 'not-found' }
          }
          const host =
            typeof payload.host === 'string'
              ? hostFromUrl(payload.host) || payload.host.trim().toLowerCase()
              : ''
          if (!loginAllowsHost(item, host)) {
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
          return {
            type: 'credentials',
            credentials: {
              id: item.id,
              title: item.title,
              username: item.username,
              password: item.password,
              totp,
            },
          }
        }
        case 'save-login': {
          const host =
            typeof payload.host === 'string'
              ? hostFromUrl(payload.host) || payload.host.trim().toLowerCase()
              : ''
          const username =
            typeof payload.username === 'string' ? payload.username.trim() : ''
          const password =
            typeof payload.password === 'string' ? payload.password : ''
          if (!host || !password) {
            return { type: 'save-result', ok: false, error: 'domain-mismatch' }
          }
          const existing = itemsRef.current.find(
            (candidate): candidate is LoginItem =>
              candidate.type === 'login' &&
              !candidate.deletedAt &&
              candidate.username.trim().toLowerCase() === username.toLowerCase() &&
              loginAllowsHost(candidate, host),
          )
          try {
            if (existing) {
              await updateItem({
                ...existing,
                password,
                urls:
                  existing.urls.filter(Boolean).length > 0
                    ? existing.urls
                    : [`https://${host}`],
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
              urls: [`https://${host}`],
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
          }
        default:
          return { type: 'protocol-error', error: 'unknown-type' }
      }
    },
    [addItem, loadSessionKey, updateItem],
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
          biometricsRef.current
        ) {
          try {
            await unlockWithBiometrics()
          } catch {
            // Touch ID annulé ou indisponible : l’utilisateur garde la main.
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
    [handleEncrypted, handlePairBegin, loadSessionKey, send, unlockWithBiometrics],
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
          Vérifiez que le code affiché dans l’extension est identique, puis
          autorisez l’accès. L’extension pourra demander des identifiants
          uniquement lorsque ce coffre est déverrouillé.
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
        {pairingError && <p className="form-error">{pairingError}</p>}
      </div>
    </Modal>
  )
}
