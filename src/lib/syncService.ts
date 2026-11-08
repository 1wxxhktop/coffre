/**
 * Orchestration d’une synchronisation entre fichiers déjà lus sur disque.
 *
 * Responsabilités :
 *  - refuser les fichiers d’une autre époque sans mot de passe ;
 *  - adopter une nouvelle époque de clés (changement de mot de passe sur un
 *    autre appareil) après vérification que les clés de coffre sont les mêmes ;
 *  - vérifier le MAC de chaque fichier distant avec la clé maîtresse ;
 *  - fusionner, puis archiver les contenus perdants dans l’historique.
 *
 * Cette couche ne lit ni n’écrit aucun fichier et ne signe rien : l’appelant
 * persiste le résultat via `signVaultFile` / `persist`.
 */

import {
  deriveMasterKey,
  equalBytes,
  recoveryGuardAad,
  sealBytes,
  vaultKeyAad,
  wipe,
} from './crypto'
import {
  openVaultFileWithMasterKey,
  preserveConflictVersion,
  signVaultFile,
  VaultSession,
  WrongPasswordError,
  type OpenedVault,
} from './vault'
import { mergeVaultFiles, type SyncConflict } from './sync'
import type { RecoveryEnvelope, VaultFile } from './types'

export class SyncEpochRequiredError extends Error {
  readonly localEpoch: number
  readonly targetEpoch: number

  constructor(localEpoch: number, targetEpoch: number) {
    super(
      'Un autre appareil a changé le mot de passe maître. Saisissez le nouveau mot de passe pour synchroniser.',
    )
    this.name = 'SyncEpochRequiredError'
    this.localEpoch = localEpoch
    this.targetEpoch = targetEpoch
  }
}

export class SyncServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SyncServiceError'
  }
}

export interface ReconcileInput {
  local: VaultFile
  session: VaultSession
  remotes: VaultFile[]
  /** Mot de passe de la nouvelle époque, requis si elle est plus récente. */
  password?: string
}

export interface ReconcileResult {
  file: VaultFile
  /** Session à utiliser ensuite (nouvelle session après changement d’époque). */
  session: VaultSession
  conflicts: SyncConflict[]
  warnings: string[]
  /** Nouvelle époque adoptée, ou `null`. */
  adoptedEpoch: number | null
}

function epochOf(file: VaultFile): number {
  return file.keyEpoch ?? 1
}

function sameKdf(left: VaultFile['kdf'], right: VaultFile['kdf']): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.salt === right.salt &&
    left.memoryKiB === right.memoryKiB &&
    left.iterations === right.iterations &&
    left.parallelism === right.parallelism &&
    left.keyLength === right.keyLength
  )
}

async function openVerified(
  file: VaultFile,
  masterKey: Uint8Array,
): Promise<OpenedVault> {
  const opened = await openVaultFileWithMasterKey(file, masterKey)
  if (opened.readOnly || opened.integrity !== 'valid') {
    opened.session.lock()
    throw new SyncServiceError('Le MAC global du fichier distant est invalide.')
  }
  return opened
}

/** Copie les clés de coffre absentes de la session locale. */
function adoptRemoteVaultKeys(
  session: VaultSession,
  remote: VaultFile,
  opened: OpenedVault,
): void {
  for (const record of remote.vaults) {
    if (session.hasVaultKey(record.id)) continue
    if (opened.session.hasVaultKey(record.id)) {
      session.setVaultKey(record.id, opened.session.vaultKey(record.id).slice())
    }
  }
}

/**
 * Prépare le changement d’époque. Ne modifie pas encore la session locale :
 * toutes les vérifications sont faites avant.
 */
async function adoptEpoch(
  local: VaultFile,
  session: VaultSession,
  targets: Array<{ file: VaultFile; opened: OpenedVault }>,
  nextMasterKey: Uint8Array,
  targetEpoch: number,
): Promise<{ local: VaultFile; session: VaultSession; warnings: string[] }> {
  const warnings: string[] = []
  const reference = targets[0]
  const nextSession = new VaultSession(nextMasterKey)

  try {
    for (const target of targets) {
      for (const record of local.vaults) {
        if (!target.opened.session.hasVaultKey(record.id)) continue
        if (
          !session.hasVaultKey(record.id) ||
          !equalBytes(
            session.vaultKey(record.id),
            target.opened.session.vaultKey(record.id),
          )
        ) {
          throw new SyncServiceError(
            'Les clés de coffre diffèrent entre les appareils : la synchronisation exige une récupération manuelle.',
          )
        }
      }
    }

    const master = nextSession.masterKey
    const vaults = []
    for (const record of local.vaults) {
      const key = session.vaultKey(record.id)
      vaults.push({
        ...record,
        key: await sealBytes(key, master, vaultKeyAad(record.id)),
        updatedAt: new Date().toISOString(),
      })
      nextSession.setVaultKey(record.id, key.slice())
    }

    let recovery: RecoveryEnvelope | undefined
    if (local.recovery && session.hasRecoveryKey) {
      recovery = {
        ...local.recovery,
        guard: await sealBytes(
          session.recoveryKey(),
          master,
          recoveryGuardAad(),
        ),
      }
      nextSession.setRecoveryKey(session.recoveryKey().slice())
    } else if (local.recovery) {
      warnings.push(
        'L’enveloppe de récupération locale n’a pas pu être conservée : régénérez la phrase après la synchronisation.',
      )
    } else if (reference.opened.session.hasRecoveryKey) {
      nextSession.setRecoveryKey(reference.opened.session.recoveryKey().slice())
    }

    nextSession.setIntegrityKey(reference.opened.session.integrityKey().slice())

    const resealed: VaultFile = {
      ...local,
      kdf: reference.file.kdf,
      keyEpoch: targetEpoch,
      updatedAt: new Date().toISOString(),
      vaults,
      recovery,
    }
    delete resealed.integrity
    const signed = await signVaultFile(resealed, nextSession, local)
    return { local: signed, session: nextSession, warnings }
  } catch (error) {
    nextSession.lock()
    throw error
  }
}

/**
 * Vérifie et fusionne les fichiers distants. Une époque plus récente déclenche
 * `SyncEpochRequiredError` tant que le nouveau mot de passe n’est pas fourni.
 */
export async function reconcileVaultFiles(
  input: ReconcileInput,
): Promise<ReconcileResult> {
  let session = input.session
  const warnings: string[] = []
  let local = input.local

  if (local.version !== 4) {
    throw new SyncServiceError(
      'La synchronisation exige un coffre migré en version 4. Enregistrez une modification locale d’abord.',
    )
  }
  if (session.locked) {
    throw new SyncServiceError('Le coffre est verrouillé.')
  }

  const sameFile = input.remotes.filter((remote) => {
    if (remote.id !== local.id) {
      warnings.push(
        'Un fichier de synchronisation appartient à un autre coffre et a été ignoré.',
      )
      return false
    }
    if (remote.version !== 4) {
      warnings.push(
        'Un fichier de synchronisation n’est pas en version 4 et a été ignoré.',
      )
      return false
    }
    return true
  })

  const localEpoch = epochOf(local)
  const targetEpoch = Math.max(localEpoch, ...sameFile.map(epochOf))
  if (targetEpoch > localEpoch) {
    if (!input.password) {
      throw new SyncEpochRequiredError(localEpoch, targetEpoch)
    }
    const targetFiles = sameFile.filter((file) => epochOf(file) === targetEpoch)
    const source = targetFiles[0]
    if (!source) {
      throw new SyncServiceError('Aucun fichier distant ne correspond à la nouvelle époque.')
    }
    for (const file of targetFiles) {
      if (!sameKdf(file.kdf, source.kdf)) {
        throw new SyncServiceError(
          'Les fichiers de la nouvelle époque ont des paramètres de dérivation différents.',
        )
      }
    }

    const nextMasterKey = await deriveMasterKey(input.password, source.kdf)
    const openedTargets: Array<{ file: VaultFile; opened: OpenedVault }> = []
    let passwordFailure = false
    for (const file of targetFiles) {
      try {
        const opened = await openVerified(file, nextMasterKey)
        openedTargets.push({ file, opened })
      } catch (error) {
        if (error instanceof WrongPasswordError) {
          passwordFailure = true
        } else {
          warnings.push(
            'Un fichier de la nouvelle époque n’a pas pu être authentifié et a été ignoré.',
          )
        }
      }
    }
    if (openedTargets.length === 0) {
      wipe(nextMasterKey)
      throw new SyncServiceError(
        passwordFailure
          ? 'Le nouveau mot de passe est incorrect.'
          : 'Le nouveau mot de passe ne permet pas d’ouvrir les fichiers distants.',
      )
    }

    let adopted: { local: VaultFile; session: VaultSession; warnings: string[] }
    try {
      adopted = await adoptEpoch(
        local,
        session,
        openedTargets,
        nextMasterKey,
        targetEpoch,
      )
    } catch (error) {
      for (const { opened } of openedTargets) opened.session.lock()
      throw error
    }
    local = adopted.local
    session = adopted.session
    warnings.push(...adopted.warnings)
    for (const { file, opened } of openedTargets) {
      adoptRemoteVaultKeys(session, file, opened)
      opened.session.lock()
    }
  }

  // Fichiers à l’époque courante (après adoption éventuelle).
  const currentEpoch = epochOf(local)
  const verified: VaultFile[] = []
  for (const remote of sameFile) {
    if (epochOf(remote) < currentEpoch) {
      warnings.push(
        'Un fichier distant utilise une ancienne époque de clés et a été ignoré. Il sera mis à jour par son appareil.',
      )
      continue
    }
    if (epochOf(remote) > currentEpoch) {
      warnings.push(
        'Un fichier distant utilise une époque de clés plus récente que celle qui vient d’être adoptée et a été ignoré.',
      )
      continue
    }
    let opened: OpenedVault
    try {
      opened = await openVerified(remote, session.masterKey)
    } catch {
      warnings.push(
        'Un fichier distant n’a pas pu être authentifié et a été ignoré.',
      )
      continue
    }
    adoptRemoteVaultKeys(session, remote, opened)
    verified.push(remote)
    opened.session.lock()
  }

  if (verified.length === 0) {
    return {
      file: local,
      session,
      conflicts: [],
      warnings,
      adoptedEpoch: targetEpoch > localEpoch ? targetEpoch : null,
    }
  }

  let merged: ReturnType<typeof mergeVaultFiles>
  try {
    merged = mergeVaultFiles(local, verified)
  } catch (error) {
    if (session !== input.session) session.lock()
    throw error
  }
  warnings.push(...merged.warnings)

  let file = merged.file
  if (file.recovery) {
    const wrapsCoverMerged =
      local.recovery &&
      session.hasRecoveryKey &&
      file.vaults.every((vault) =>
        local.recovery?.wraps.some((wrap) => wrap.vaultId === vault.id),
      )
    if (wrapsCoverMerged && local.recovery) {
      // La clé de récupération distante peut différer de celle de cette
      // session. On conserve l’enveloppe locale, dont on possède la clé, tant
      // qu’elle couvre tous les coffres fusionnés.
      file = { ...file, recovery: local.recovery }
    } else {
      const next: VaultFile = { ...file }
      delete next.recovery
      file = next
      warnings.push(
        'L’enveloppe de récupération distante a été ignorée : régénérez la phrase depuis ce coffre après la synchronisation.',
      )
    }
  }

  for (const conflict of merged.conflicts) {
    if (conflict.kind !== 'item') continue
    const preserved = await preserveConflictVersion(
      file,
      session,
      conflict.losing,
    )
    if (preserved.warning) warnings.push(preserved.warning)
    file = preserved.file
  }

  return {
    file,
    session,
    conflicts: merged.conflicts,
    warnings,
    adoptedEpoch: targetEpoch > localEpoch ? targetEpoch : null,
  }
}
