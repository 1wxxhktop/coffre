/**
 * Traduction des messages d’erreur produits par le backend Rust.
 *
 * Ces messages sont français dans le code natif. Plutôt que de dupliquer la
 * localisation dans chaque commande, la passerelle Tauri les traduit au
 * moment où ils remontent vers l’interface. Les messages inconnus sont
 * conservés tels quels : un détail technique reste préférable à une perte
 * d’information.
 */

import type { Locale } from './i18n'

const EN: Record<string, string> = {
  'Adresse d’appairage invalide': 'Invalid pairing address',
  'Appareil injoignable : lancez une réception sur l’autre appareil':
    'Device unreachable: start a receive operation on the other device',
  'Appareil injoignable sur le réseau local':
    'Device unreachable on the local network',
  'Approbation SSH indisponible': 'SSH approval unavailable',
  'Aucun navigateur compatible détecté pour le pont natif':
    'No compatible browser found for the native bridge',
  'Aucune clé SSH active dans ce coffre.':
    'No active SSH key in this vault.',
  'Blob altéré': 'Corrupted blob',
  'Blob altéré : authentification du bloc échouée':
    'Corrupted blob: chunk authentication failed',
  'Blob inattendu pendant le transfert': 'Unexpected blob during transfer',
  'Blob transféré invalide': 'Invalid transferred blob',
  'Blob tronqué': 'Truncated blob',
  'Blob tronqué : bloc incomplet': 'Truncated blob: incomplete chunk',
  'Blob tronqué : indicateur de dernier bloc absent':
    'Truncated blob: missing last-chunk flag',
  'Blob tronqué : taille de bloc absente':
    'Truncated blob: missing chunk size',
  'Bloc de blob trop volumineux': 'Blob chunk too large',
  'Ce fichier n’est pas un blob Coffre':
    'This file is not a Coffre blob',
  'Chiffrement du blob impossible': 'Unable to encrypt the blob',
  'Chiffrement local impossible': 'Local encryption failed',
  'Client HTTP indisponible': 'HTTP client unavailable',
  'Clé AES invalide': 'Invalid AES key',
  'Clé API manquante': 'Missing API key',
  'Clé de blob invalide': 'Invalid blob key',
  'Clé d’appairage invalide.': 'Invalid pairing key.',
  'Clé d’appareil incohérente': 'Inconsistent device key',
  'Clé locale illisible': 'Unreadable local key',
  'Code d’appairage invalide': 'Invalid pairing code',
  'Coffre trop volumineux': 'Vault too large',
  'Connexion de pont verrouillée': 'Bridge connection locked',
  'Connexion interrompue': 'Connection interrupted',
  'Données après le dernier bloc du blob':
    'Data after the last blob chunk',
  'Dossier de synchronisation introuvable': 'Sync folder not found',
  'Dossier de synchronisation vide': 'Empty sync folder',
  'Délai dépassé': 'Timed out',
  'Délai supérieur à 60 secondes': 'Delay exceeds 60 seconds',
  'En-tête de blob invalide': 'Invalid blob header',
  'Enregistrement annulé': 'Save cancelled',
  'Fichier de coffre trop volumineux': 'Vault file too large',
  'Fichier de synchronisation trop volumineux': 'Sync file too large',
  'Génération de sauvegarde invalide': 'Invalid backup generation',
  'Identifiant de blob invalide': 'Invalid blob identifier',
  'Identifiant de coffre invalide pour la synchronisation':
    'Invalid vault identifier for sync',
  'Identité locale illisible': 'Unreadable local identity',
  'Impossible de démarrer Coffre': 'Unable to start Coffre',
  'Impossible d’identifier la fenêtre active':
    'Unable to identify the active window',
  'Impossible d’installer la surveillance de session.':
    'Unable to install session monitoring.',
  'Indicateur de dernier bloc invalide': 'Invalid last-chunk flag',
  'Jeton de saisie non terminé': 'Unfinished input token',
  'La biométrie n’est pas disponible sur cette plateforme.':
    'Biometrics are not available on this platform.',
  'La clé de blob doit faire 32 octets': 'The blob key must be 32 bytes',
  'La saisie automatique est refusée dans Coffre':
    'Auto-type is refused in Coffre',
  'La saisie automatique n’est pas disponible sur mobile.':
    'Auto-type is not available on mobile.',
  'La surveillance de session est déjà démarrée.':
    'Session monitoring is already started.',
  'La surveillance de session n’est pas disponible sur cette plateforme.':
    'Session monitoring is not available on this platform.',
  'Le README de synchronisation est un lien symbolique':
    'The sync README is a symbolic link',
  'Le chemin de synchronisation n’est pas un dossier':
    'The sync path is not a directory',
  'Le chemin de synchronisation n’est pas un fichier':
    'The sync path is not a file',
  'Le code d’appairage doit désigner une adresse locale':
    'The pairing code must designate a local address',
  'Le dossier de synchronisation sort du dossier choisi':
    'The sync folder escapes the selected folder',
  'Le démarrage automatique n’est pas disponible sur cette plateforme.':
    'Autostart is not available on this platform.',
  'Le déverrouillage biométrique n’est pas disponible sur cette plateforme.':
    'Biometric unlock is not available on this platform.',
  'Le fichier de synchronisation est un lien symbolique':
    'The sync file is a symbolic link',
  'Le fichier sélectionné n’est pas un fichier régulier':
    'The selected file is not a regular file',
  'Le focus a changé : saisie automatique annulée':
    'Focus changed: auto-type cancelled',
  'Le pont natif n’est pas pris en charge sur cette plateforme':
    'The native bridge is not supported on this platform',
  'Le port de synchronisation est déjà utilisé':
    'The sync port is already in use',
  'Le trousseau du système n’est pas disponible sur cette plateforme.':
    'The system keychain is not available on this platform.',
  'Les mises à jour ne sont pas disponibles sur mobile.':
    'Updates are not available on mobile.',
  'L’agent SSH n’est pas encore pris en charge sous Windows.':
    'The SSH agent is not yet supported on Windows.',
  'L’appareil distant ne correspond pas au code':
    'The remote device does not match the code',
  'L’appareil distant ne correspond pas au pair enregistré':
    'The remote device does not match the saved peer',
  'L’authentification par empreinte a expiré.':
    'Fingerprint authentication expired.',
  'L’hôte natif n’est pas pris en charge sur cette plateforme':
    'The native host is not supported on this platform',
  'L’installation automatique du pont natif n’est pas prise en charge sur Windows':
    'Automatic installation of the native bridge is not supported on Windows',
  'Message Noise inattendu': 'Unexpected Noise message',
  'Message Noise invalide': 'Invalid Noise message',
  'Message local incohérent': 'Inconsistent local message',
  'Message local invalide': 'Invalid local message',
  'Message local tronqué': 'Truncated local message',
  'Message local trop volumineux': 'Local message too large',
  'Nom de fichier de synchronisation invalide': 'Invalid sync file name',
  'Négociation Noise invalide': 'Invalid Noise handshake',
  'Ouverture de lien non prise en charge sur cette plateforme.':
    'Opening links is not supported on this platform.',
  'Pairs illisibles': 'Unreadable peers',
  'Plateforme non prise en charge par le pont natif':
    'Platform not supported by the native bridge',
  'Pont natif verrouillé': 'Native bridge locked',
  'Préfixe HIBP invalide': 'Invalid HIBP prefix',
  'Requête HIBP impossible': 'HIBP request failed',
  'Réponse HIBP illisible': 'Unreadable HIBP response',
  'Réponse HIBP trop volumineuse': 'HIBP response too large',
  'Réponse du service d’alias trop volumineuse':
    'Alias service response too large',
  'Réponse du service illisible': 'Unreadable service response',
  'Secret d’appairage incorrect': 'Incorrect pairing secret',
  'Service d’alias inconnu': 'Unknown alias service',
  'Seules les URL http(s) sont autorisées.': 'Only http(s) URLs are allowed.',
  'Sélection annulée': 'Selection cancelled',
  'Séquence de saisie trop longue': 'Input sequence too long',
  'Taille de bloc de blob non prise en charge':
    'Unsupported blob chunk size',
  'Tampon Noise trop petit': 'Noise buffer too small',
  'Trame de pont invalide': 'Invalid bridge frame',
  'Transfert de blobs supérieur à 2 Gio': 'Blob transfer exceeds 2 GiB',
  'Trop de blobs à transférer': 'Too many blobs to transfer',
  'URL externe invalide.': 'Invalid external URL.',
  'Un appairage est déjà en cours': 'A pairing is already in progress',
  'Une réception est déjà en cours':
    'A receive operation is already in progress',
  'Valeur de saisie trop longue': 'Input value too long',
  'Version de blob non prise en charge': 'Unsupported blob version',
  'État de l’agent SSH indisponible': 'SSH agent state unavailable',
  'État de surveillance de synchronisation verrouillé':
    'Sync monitoring state locked',
  'État du coffre trop volumineux': 'Vault state too large',
}

/** Messages dynamiques : le préfixe est traduit, le détail est conservé. */
const EN_PREFIXES: Array<[string, string]> = [
  ['Délai invalide : ', 'Invalid delay: '],
  ['Jeton de saisie inconnu : ', 'Unknown input token: '],
  ['Paramètres Noise invalides : ', 'Invalid Noise parameters: '],
  ['Saisie impossible : ', 'Typing failed: '],
  ['Touche impossible : ', 'Key press failed: '],
  ['format invalide : ', 'Invalid format: '],
  ['cryptographie : ', 'Cryptography: '],
]

/**
 * Traduit un message natif. En français, le message est renvoyé tel quel ;
 * en anglais, seuls les messages connus sont traduits.
 */
export function translateBackendError(
  locale: Locale,
  message: string,
): string {
  if (locale !== 'en') return message
  const exact = EN[message]
  if (exact) return exact
  if (message === 'mot de passe incorrect') return 'Incorrect password'
  const autoTypePrefix =
    'Saisie automatique indisponible : autorisez Coffre dans Accessibilité (macOS) ou vérifiez les permissions du système. '
  if (message.startsWith(autoTypePrefix)) {
    return `Auto-type unavailable: allow Coffre in Accessibility (macOS) or check the system permissions. ${message.slice(autoTypePrefix.length)}`
  }
  for (const [prefix, replacement] of EN_PREFIXES) {
    if (message.startsWith(prefix)) {
      return `${replacement}${message.slice(prefix.length)}`
    }
  }
  const hibp = /^HIBP HTTP (\d{3})$/.exec(message)
  if (hibp) return `HIBP HTTP ${hibp[1]}`
  return message
}
