/**
 * Traductions par texte source pour les écrans en cours de migration.
 *
 * Les écrans déjà structurés utilisent des clés (`i18n.ts`). Ce catalogue
 * permet de traduire les chaînes existantes sans renommer toutes les clés d’un
 * coup ; une chaîne absente reste en français.
 */
export const EN_TEXT: Record<string, string> = {
  'Actions irréversibles sur le coffre local.': 'Irreversible actions on the local vault.',
  'Stockage persistant activé : le navigateur ne doit plus effacer le coffre.':
    'Persistent storage enabled: the browser should no longer erase the vault.',
  'Le navigateur a refusé le stockage persistant.':
    'The browser refused persistent storage.',
  'Notifications refusées ou indisponibles dans cet environnement. Le rappel reste visible dans la vue « Bientôt expirés ».':
    'Notifications refused or unavailable in this environment. The reminder remains visible in the “Expiring soon” view.',
  'Export CSV impossible': 'CSV export failed',
  'Intégrité du coffre vérifiée': 'Vault integrity verified',
  'Mot de passe maître modifié': 'Master password changed',
  'Coffre importé et déverrouillé': 'Vault imported and unlocked',
  'Partage importé': 'Share imported',
  'Clé biométrique réinitialisée': 'Biometric key reset',
  'Réinitialisation biométrique impossible': 'Biometric reset failed',
  'Coffre exporté': 'Vault exported',
  'Export impossible': 'Export failed',
  'Aucun élément importé': 'No item imported',
  'Import impossible': 'Import failed',
  'Import du partage impossible': 'Share import failed',
  'Réglages': 'Settings',
  'Préférences locales, sécurité, sauvegardes et stockage.':
    'Local preferences, security, backups and storage.',
  'Sections des réglages': 'Settings sections',
  'Effacer tout le coffre ?': 'Erase the entire vault?',
  'Tous les coffres et éléments stockés dans ce navigateur seront supprimés. Cette action est définitive.':
    'All vaults and items stored in this browser will be deleted. This cannot be undone.',
  'Effacer définitivement': 'Erase permanently',
  'Vider la corbeille ?': 'Empty the trash?',
  'Vider définitivement': 'Empty permanently',
  'Mots de la clé, ou contenu du QR code': 'Key words, or QR code content',
  '12 caractères minimum': 'At least 12 characters',
  Apparence: 'Appearance',
  'Après 1 an': 'After 1 year',
  'Après 1 heure': 'After 1 hour',
  'Après 1 minute': 'After 1 minute',
  'Après 15 minutes': 'After 15 minutes',
  'Après 15 secondes': 'After 15 seconds',
  'Après 2 minutes': 'After 2 minutes',
  'Après 30 jours': 'After 30 days',
  'Après 30 minutes': 'After 30 minutes',
  'Après 30 secondes': 'After 30 seconds',
  'Après 5 minutes': 'After 5 minutes',
  'Après 7 jours': 'After 7 days',
  'Après 90 jours': 'After 90 days',
  'Ces préférences restent dans ce navigateur.': 'These preferences stay in this browser.',
  Clair: 'Light',
  'Clé de partage': 'Share key',
  'Coffre complet — tous les éléments': 'Full vault — all items',
  'Coffre de destination': 'Destination vault',
  Confirmer: 'Confirm',
  'Conservation de la corbeille': 'Trash retention',
  'Contenu du coffre': 'Vault contents',
  'Déchiffre et vérifie chaque coffre, élément et pièce jointe.':
    'Decrypts and verifies each vault, item and attachment.',
  'Déverrouillage rapide par le trousseau de l’appareil.':
    'Quick unlock with the device keychain.',
  'Déverrouiller avec la biométrie (Touch ID / Windows Hello)':
    'Unlock with biometrics (Touch ID / Windows Hello)',
  'Réinitialiser le déverrouillage biométrique': 'Reset biometric unlock',
  '(remplacé par la biométrie)': '(replaced by biometrics)',
  'Intégration au système': 'System integration',
  'Verrouillage avec la session, barre de menus et démarrage à l’ouverture de session.':
    'Lock with the session, menu bar and launch at login.',
  'Verrouiller avec la session': 'Lock with the session',
  'Verrouiller à la mise en veille': 'Lock when the computer sleeps',
  'Garder Coffre dans la barre de menus à la fermeture de la fenêtre':
    'Keep Coffre in the menu bar when the window closes',
  'Démarrer à l’ouverture de session': 'Launch at login',
  'Coffre démarre verrouillé et masqué ; ouvrez-le depuis la barre de menus.':
    'Coffre starts locked and hidden; open it from the menu bar.',
  'Démarrage à l’ouverture de session activé': 'Launch at login enabled',
  'Démarrage à l’ouverture de session désactivé': 'Launch at login disabled',
  'Impossible de modifier le démarrage à l’ouverture de session':
    'Unable to change launch at login',
  'Effacement du presse-papiers': 'Clipboard clearing',
  'Effacer le coffre local': 'Erase the local vault',
  'En savoir plus': 'Learn more',
  'Exporter en CSV': 'Export as CSV',
  'Exporter le coffre': 'Export the vault',
  'Exports chiffrés, exports CSV et imports depuis d’autres outils.':
    'Encrypted exports, CSV exports and imports from other tools.',
  Fichier: 'File',
  'Fichier de partage': 'Share file',
  'Format CSV': 'CSV format',
  Général: 'General',
  'Ignorer les doublons.': 'Skip duplicates.',
  'Importer depuis un autre gestionnaire': 'Import from another manager',
  'Importer un coffre': 'Import a vault',
  'Importer un partage hors ligne': 'Import an offline share',
  'Intégrité du coffre': 'Vault integrity',
  Jamais: 'Never',
  'Jamais purger automatiquement': 'Never purge automatically',
  'Je comprends que le coffre local actuel sera remplacé.':
    'I understand that the current local vault will be replaced.',
  'Kit d’urgence': 'Emergency kit',
  Langue: 'Language',
  'Langue de l’interface et des dates.': 'Interface and date language.',
  'Le fichier .coffre est chiffré avec votre mot de passe maître.':
    'The .coffre file is encrypted with your master password.',
  'Le fichier importé remplace le coffre stocké dans ce navigateur.':
    'The imported file replaces the vault stored in this browser.',
  'Les éléments sont ajoutés au coffre choisi, puis chiffrés.':
    'Items are added to the chosen vault, then encrypted.',
  'Mot de passe actuel': 'Current password',
  'Mot de passe du fichier': 'File password',
  'Mot de passe maître': 'Master password',
  'Mot de passe maître incorrect': 'Incorrect master password',
  'Mot de passe maître pour l’export CSV': 'Master password for the CSV export',
  'Mot de passe maître, récupération et trousseau du système.':
    'Master password, recovery and system keychain.',
  'Mots de passe (Apple) — connexions': 'Passwords (Apple) — logins',
  'Nouveau mot de passe': 'New password',
  'Parts imprimables de la clé de récupération, avec QR codes.':
    'Printable recovery key shares with QR codes.',
  'Persistance, intégrité et sauvegardes locales.': 'Persistence, integrity and local backups.',
  'Phrase de récupération': 'Recovery phrase',
  'Quand le coffre se ferme et comment les copies sont effacées.':
    'When the vault locks and how copies are cleared.',
  'Recevoir un rappel pour les échéances proches': 'Get a reminder for upcoming expiries',
  'Sauvegarde et import': 'Backup and import',
  'Sel unique par coffre, clé AES de 256 bits.': 'Unique salt per vault, 256-bit AES key.',
  Sombre: 'Dark',
  Stockage: 'Storage',
  'Chiffré localement, sans serveur.': 'Encrypted locally, no server.',
  'Coffre local à jour': 'Local vault up to date',
  'Synchronisation en attente': 'Sync pending',
  'Dernière écriture :': 'Last write:',
  'Aucune écriture locale': 'No local write yet',
  '3 sauvegardes locales tournantes · AES-256-GCM':
    '3 rotating local backups · AES-256-GCM',
  'Suivre le système': 'Follow system',
  Sécurité: 'Security',
  'Thème sombre, clair ou aligné sur le système.': 'Dark, light or system theme.',
  'Trousseau du système': 'System keychain',
  'Une seconde clé optionnelle, jamais stockée en clair.':
    'An optional second key, never stored in clear.',
  'Verrouillage automatique': 'Auto-lock',
  'Verrouillage et presse-papiers': 'Locking and clipboard',
  'Verrouiller lorsque la fenêtre perd le focus': 'Lock when the window loses focus',
  'Verrouiller lorsque l’onglet passe en arrière-plan':
    'Lock when the tab goes to the background',
  'Zone dangereuse': 'Danger zone',
  'en clair': 'in clear',
  'et clé transmis séparément.': 'and key transmitted separately.',

  // ItemDialog
  'Adresses': 'Addresses',
  'Code 2FA': '2FA code',
  'Coffre': 'Vault',
  'Marquer comme favori': 'Mark as favorite',
  'Séparées par des virgules.': 'Separated by commas.',
  'Type': 'Type',
  'Étiquettes': 'Tags',
  'Aucune échéance dans les 60 prochains jours.': 'No expiry in the next 60 days.',
  Coffres: 'Vaults',
  'Les 60 prochains jours.': 'The next 60 days.',
  'Les signaux faibles de votre coffre, classés par priorité.':
    'Weak signals in your vault, sorted by priority.',
  'Les éléments qui exposent le plus votre coffre.':
    'The items that expose your vault the most.',
  'Points d’attention': 'Points of attention',
  Récents: 'Recent',
  'Santé du coffre': 'Vault health',
  'Vos derniers éléments utilisés.': 'Your most recently used items.',
  'Vos éléments récemment ouverts apparaîtront ici.':
    'Your recently opened items will appear here.',
  'Votre bibliothèque locale.': 'Your local library.',
  'Vue d’ensemble': 'Overview',
  'À traiter en priorité': 'Priority items',
  Échéances: 'Expiries',
  'Coffre local': 'Local vault',
  'Emplacement des sauvegardes': 'Backup location',
  'Généré le': 'Generated on',
  'Identifiant du coffre': 'Vault ID',
  'Mode d’emploi': 'Instructions',
  'Mot de passe maître actuel (à écrire à la main)':
    'Current master password (write by hand)',
  'Mots à recopier ou à scanner :': 'Words to copy or scan:',
  'Nombre total de parts (n)': 'Total shares (n)',
  'Parts nécessaires (k)': 'Required shares (k)',
  'Personnes dépositaires des parts': 'Share custodians',
  'QR en cours…': 'QR pending…',
  'À remettre à :': 'Give to:',
  'Clé de partage (à dicter ou scanner)': 'Share key (dictate or scan)',
  'Expiration du partage': 'Share expiry',
  'Fichier à transmettre': 'File to send',
  'Le fichier': 'The file',
  'Second QR code : la clé, à transmettre séparément.':
    'Second QR code: the key, to send separately.',
  'Conflits archivés :': 'Archived conflicts:',
  'Dernière synchronisation :': 'Last sync:',
  'Dossier :': 'Folder:',
  'Dossier partagé': 'Shared folder',
  'Fichier de cet appareil :': 'This device’s file:',
  Synchronisation: 'Synchronization',
  Espace: 'Space',
  'Point ( . )': 'Dot ( . )',
  Séparateur: 'Separator',
  'Tiret ( - )': 'Hyphen ( - )',
  'Tiret bas ( _ )': 'Underscore ( _ )',
  'Confirmer le mot de passe': 'Confirm password',
  'Nouveau mot de passe maître': 'New master password',
  'Aucune version enregistrée': 'No saved version',
  'Déchiffrement de l’historique…': 'Decrypting history…',
  'J’ai noté la phrase.': 'I have written down the phrase.',
  'Nom du coffre': 'Vault name',
  'Statistiques du coffre': 'Vault statistics',
  'Type de secret': 'Secret type',
  Historique: 'History',
  'Restaurer cette version ?': 'Restore this version?',
  Restaurer: 'Restore',
  'Associer l’extension navigateur': 'Pair the browser extension',
  'Mots de la part, ou contenu du QR code': 'Share words, or QR code content',
  'Partager hors ligne': 'Share offline',
  'Copier le code TOTP': 'Copy TOTP code',
  'Impossible de copier le code': 'Unable to copy the code',
  'Ouvrir le menu': 'Open menu',
  'Ex. Travail': 'e.g. Work',
  'Importer une base KeePass (KDBX 4)': 'Import a KeePass database (KDBX 4)',
  'Fichier .kdbx, mot de passe et éventuel fichier de clé.':
    'A .kdbx file, its password and an optional key file.',
  'Fichier KDBX': 'KDBX file',
  'Fichier trop volumineux (100 Mo maximum)': 'File too large (100 MB maximum)',
  'Fichier de clé (optionnel)': 'Key file (optional)',
  'Importer la base KDBX': 'Import KDBX database',
  'Import KDBX en cours…': 'Importing KDBX…',
  'Base KDBX importée': 'KDBX database imported',
  'Import KDBX impossible': 'KDBX import failed',
  'Exporter en KDBX': 'Export to KDBX',
  'Exporter en CXF': 'Export to CXF',
  'Export CXF téléchargé': 'CXF export downloaded',
  'Format de portabilité FIDO pour les mots de passe et les passkeys.':
    'FIDO portability format for passwords and passkeys.',
  'Le fichier CXF n’est pas chiffré : il contient vos mots de passe et les clés privées de vos passkeys en clair.':
    'The CXF file is not encrypted: it contains your passwords and passkey private keys in clear text.',
  'Transférez-le uniquement vers un gestionnaire de confiance, puis supprimez-le. Les pièces jointes ne sont pas incluses.':
    'Transfer it only to a trusted manager, then delete it. Attachments are not included.',
  'Je comprends que ce fichier contient des secrets en clair et je le stocke en conséquence.':
    'I understand this file contains clear-text secrets and will store it accordingly.',
  'Exporter le fichier CXF': 'Export the CXF file',
  '{count} élément(s) actif(s), dont {passkeys} passkey(s).':
    '{count} active item(s), including {passkeys} passkey(s).',
  'Une base KeePass 4 chiffrée avec un mot de passe dédié.':
    'A KeePass 4 database encrypted with a dedicated password.',
  'Mot de passe KDBX': 'KDBX password',
  '8 caractères minimum': 'At least 8 characters',
  'Répétez le mot de passe': 'Repeat the password',
  Annuler: 'Cancel',
  'Le fichier .kdbx contient tous les éléments actifs. Les pièces jointes et l’historique ne sont pas inclus.':
    'The .kdbx file contains all active items. Attachments and history are not included.',
  Exporter: 'Export',
  'Export en cours…': 'Exporting…',
  'Mot de passe trop court (8 caractères minimum).':
    'Password too short (at least 8 characters).',
  'Les mots de passe ne correspondent pas.': 'The passwords do not match.',
  'Export KDBX impossible': 'KDBX export failed',
  'Base KDBX exportée': 'KDBX database exported',
  'Service d’alias indisponible': 'Alias service unavailable',
  'Service d’alias (optionnel)': 'Alias service (optional)',
  'Clé API': 'API key',
  'Générer via le service': 'Generate via service',
  'La clé API n’est utilisée que pour cette requête et n’est pas enregistrée.':
    'The API key is only used for this request and is not stored.',
  'Alias e-mail': 'Email alias',
  'Enregistrer la clé chiffrée dans le coffre': 'Save the key encrypted in the vault',
  'Une clé est déjà enregistrée pour ce service.': 'A key is already saved for this service.',
  'La clé n’est pas enregistrée sauf si vous cochez la case.': 'The key is not saved unless you check the box.',
  SimpleLogin: 'SimpleLogin',
  'addy.io': 'addy.io',
  'Génère une adresse « plus » ou catch-all sans contacter de service.':
    'Generate a plus or catch-all address without contacting any service.',
  'prenom@domaine.fr': 'name@domain.com',
  'Adresse e-mail de base': 'Base email address',
  'Adresse e-mail de base invalide': 'Invalid base email address',
  Mode: 'Mode',
  'Adresse « plus » (prenom+site@domaine)': 'Plus address (name+site@domain)',
  'Catch-all sur mon domaine (site@domaine)': 'Catch-all on my domain (site@domain)',
  'Étiquette du site': 'Site tag',
  'Régénérer l’étiquette': 'Regenerate tag',
  'Utiliser cet alias': 'Use this alias',
  'Alias e-mail enregistré': 'Email alias saved',
  'Alias e-mail impossible': 'Email alias failed',
  'Saisie automatique': 'Auto-type',
  'Saisie…': 'Typing…',
  'Aucune connexion disponible.': 'No login available.',
  'Coffre va masquer sa fenêtre puis taper la séquence dans l’application active.':
    'Coffre will hide its window, then type the sequence into the active application.',
  'Activez la fenêtre cible avant la fin du compte à rebours.':
    'Focus the target window before the countdown ends.',
  'Saisie automatique effectuée.': 'Auto-type completed.',
  'Saisie automatique impossible.': 'Auto-type failed.',
  Séquence: 'Sequence',
  'Après le démarrage, activez la fenêtre cible. La saisie est annulée si le focus change en cours de route.':
    'After starting, focus the target window. Typing is cancelled if focus changes.',
  Démarrer: 'Start',
  'Journal d’activité': 'Activity log',
  'Événements sensibles conservés chiffrés dans le coffre. Utile pour repérer un usage inattendu.':
    'Sensitive events kept encrypted in the vault. Useful to spot unexpected use.',
  'Événements récents': 'Recent events',
  'événement(s)': 'event(s)',
  'Aucun événement enregistré.': 'No events recorded.',
  'Exporter le journal': 'Export the log',
  Déverrouillage: 'Unlock',
  'Échec de déverrouillage': 'Unlock failure',
  Verrouillage: 'Lock',
  Export: 'Export',
  'Changement de mot de passe': 'Password change',
  'Changement de récupération': 'Recovery change',
  Appairage: 'Pairing',
  Partage: 'Share',
  'Remplissage par l’extension': 'Extension fill',
  'Avertissement anti-hameçonnage': 'Phishing warning',
  'Agent SSH': 'SSH agent',
  Appel: 'Phone call',
  'Clé matérielle': 'Hardware key',
  Application: 'App',
  Matériel: 'Hardware',
  '2FA disponible': '2FA available',
  Documentation: 'Documentation',
  'Passkey disponible': 'Passkey available',
  'Ce site accepte les passkeys.': 'This site supports passkeys.',
  'Créer une passkey': 'Create a passkey',
  'Sans double authentification': 'No two-factor authentication',
  'Le compte dépend du seul mot de passe': 'The account relies on its password alone',
  'Sites sans HTTPS': 'Sites without HTTPS',
  'URL servie en clair sur le réseau': 'URL sent in clear text over the network',
  'Connexion sans mot de passe possible': 'Passwordless sign-in is possible',
  Aperçu: 'Preview',
  'Aperçu impossible': 'Preview failed',
  'Aperçu en mémoire, sans écriture en clair sur le disque.':
    'In-memory preview, without writing clear text to disk.',
  'Choisir un document volumineux': 'Choose a large document',
  'Document chiffré ajouté': 'Encrypted document added',
  'Ajout du document impossible': 'Unable to add document',
  'Document volumineux': 'Large document',
  'Aucun coffre de destination disponible.': 'No destination vault available.',
  'Élément créé depuis le modèle.': 'Item created from template.',
  'Création impossible.': 'Creation failed.',
  'Créer un élément depuis {name}': 'Create an item from {name}',
  'Modèle mis à jour.': 'Template updated.',
  'Modèle créé.': 'Template created.',
  'Enregistrement impossible.': 'Saving failed.',
  'Modèle supprimé.': 'Template deleted.',
  'Modèles d’éléments': 'Item templates',
  'Définissez vos propres types d’éléments. Les modèles sont chiffrés dans le coffre et synchronisés avec lui.':
    'Define your own item types. Templates are encrypted in the vault and synced with it.',
  'Modifier le modèle': 'Edit template',
  'Nouveau modèle': 'New template',
  'Jusqu’à 30 champs par modèle.': 'Up to 30 fields per template.',
  'Créer un modèle': 'Create a template',
  'Nom du modèle': 'Template name',
  'Icône': 'Icon',
  'Libellé du champ': 'Field label',
  'Type du champ': 'Field type',
  'Remplissable': 'Fillable',
  'Supprimer le champ': 'Delete field',
  'Enregistrer le modèle': 'Save template',
  'Modèles enregistrés': 'Saved templates',
  'modèle(s)': 'template(s)',
  'champ(s)': 'field(s)',
  'Modifier {name}': 'Edit {name}',
  'Supprimer {name}': 'Delete {name}',
  Texte: 'Text',
  Secret: 'Secret',
  Date: 'Date',
  'Texte long': 'Long text',
  'Mode voyage activé.': 'Travel mode enabled.',
  'Activation impossible.': 'Enabling failed.',
  'Mode voyage désactivé avec des conflits archivés.':
    'Travel mode disabled with archived conflicts.',
  'Mode voyage désactivé, coffres restaurés.':
    'Travel mode disabled, vaults restored.',
  'Désactivation impossible.': 'Disabling failed.',
  'Mode voyage': 'Travel mode',
  'Retire de cet appareil les coffres qui ne sont pas sûrs pour le voyage. Ils seront restaurés depuis la synchronisation à la désactivation.':
    'Removes vaults that are not travel-safe from this device. They are restored from sync when travel mode is disabled.',
  'Cochez les coffres à conserver pendant le voyage. Les autres seront retirés du fichier local, pas seulement masqués.':
    'Select the vaults to keep during travel. The others are removed from the local file, not just hidden.',
  'élément(s)': 'item(s)',
  'Activer le mode voyage': 'Enable travel mode',
  'Coffres conservés sur cet appareil :': 'Vaults kept on this device:',
  'Les autres coffres ne sont plus dans le fichier local. Cette protection vise l’inspection de l’appareil, pas une contrainte exercée sur la personne.':
    'The other vaults are no longer in the local file. This protects against device inspection, not against coercion.',
  'Configurez une synchronisation par dossier avant de désactiver le mode voyage.':
    'Configure folder sync before disabling travel mode.',
  'Mot de passe maître actuel': 'Current master password',
  'Mot de passe maître de l’autre appareil': 'Other device’s master password',
  'Désactiver et restaurer les coffres': 'Disable and restore vaults',
  'Découverte impossible.': 'Discovery failed.',
  'Découvrir les appareils': 'Discover devices',
  'Adresse du pair mise à jour.': 'Peer address updated.',
  'Mise à jour impossible.': 'Update failed.',
  'Mettre à jour l’adresse': 'Update address',
  'Blobs orphelins supprimés.': 'Orphan blobs deleted.',
  'Nettoyage impossible.': 'Cleanup failed.',
  'Documents chiffrés': 'Encrypted documents',
  'blob(s)': 'blob(s)',
  'Supprimer {count} blob(s) orphelin(s)': 'Delete {count} orphan blob(s)',
  'Réseau local indisponible.': 'Local network unavailable.',
  'Appareil appairé.': 'Device paired.',
  'Appairage impossible.': 'Pairing failed.',
  'Code d’appairage prêt. Il expire dans deux minutes.':
    'Pairing code ready. It expires in two minutes.',
  'Synchronisation locale terminée avec des conflits archivés.':
    'Local sync completed with archived conflicts.',
  'Synchronisation locale terminée.': 'Local sync completed.',
  'Synchronisation locale impossible.': 'Local sync failed.',
  'Fichier reçu de {name} ({count} blob(s)).': 'File received from {name} ({count} blob(s)).',
  'Réception impossible.': 'Receiving failed.',
  'Suppression impossible.': 'Deletion failed.',
  'Code copié.': 'Code copied.',
  'Copie impossible.': 'Copy failed.',
  'Synchronisation locale': 'Local sync',
  'Appareils sur le même réseau Wi-Fi, sans serveur ni Internet. Le port n’est ouvert que pendant une réception.':
    'Devices on the same Wi-Fi network, with no server or Internet. The port is only open while receiving.',
  'Empreinte de cet appareil': 'This device’s fingerprint',
  'Nom de cet appareil': 'This device’s name',
  'Créer un code d’appairage': 'Create a pairing code',
  'Recevoir une synchronisation': 'Receive a sync',
  'Code d’appairage': 'Pairing code',
  'Scannez ce code ou copiez-le sur l’autre appareil.':
    'Scan this code or copy it to the other device.',
  'Copier le code': 'Copy code',
  'coffre-lan://pair/…': 'coffre-lan://pair/…',
  'Rejoindre avec un code': 'Join with a code',
  'Appairer cet appareil': 'Pair this device',
  'Appareil sans nom': 'Unnamed device',
  Synchroniser: 'Sync',
  'Oublier cet appareil': 'Forget this device',
  'Adopter le nouveau mot de passe': 'Adopt the new password',
  'Créer un coffre': 'Create a vault',
  'Code TOTP copié': 'TOTP code copied',
  'Phrase copiée': 'Phrase copied',
  'Phrase de récupération supprimée': 'Recovery phrase removed',
  'Une seconde clé, optionnelle, pour retrouver l’accès sans le mot de passe maître.':
    'An optional second key to regain access without the master password.',
  'Dossier de synchronisation configuré.': 'Sync folder configured.',
  'Synchronisation terminée.': 'Synchronization complete.',
  'Synchronisation désactivée pour ce coffre.': 'Synchronization disabled for this vault.',
  'Désactiver la synchronisation ?': 'Disable synchronization?',
  'Le fichier de cet appareil reste dans le dossier, mais Coffre ne le lira ni ne l’écrira plus.':
    'This device’s file stays in the folder, but Coffre will no longer read or write it.',
  Désactiver: 'Disable',
  'Clé de partage copiée': 'Share key copied',
  'La copie automatique a échoué ; notez les mots à la main.':
    'Automatic copy failed; write down the words by hand.',
  'Un fichier chiffré et une clé séparée, à transmettre par deux canaux différents.':
    'An encrypted file and a separate key, to be sent through two different channels.',
  'Version restaurée': 'Version restored',
  'Coffre créé': 'Vault created',
  'Coffre renommé': 'Vault renamed',
  'La copie automatique a échoué ; recopiez les mots à la main.':
    'Automatic copy failed; copy the words by hand.',
  'Un document papier pour reconstituer la clé de récupération avec plusieurs personnes de confiance.':
    'A paper document to reconstruct the recovery key with several trusted people.',
  'Valeur copiée': 'Value copied',
  Générateur: 'Generator',
  'Généré localement avec le générateur cryptographique du navigateur.':
    'Generated locally with the browser’s cryptographic generator.',
  'Copier la valeur générée': 'Copy the generated value',
  'Méthode de récupération': 'Recovery method',
  'Une extension demande à se connecter à ce coffre.':
    'An extension is requesting access to this vault.',
  'Pièce jointe supprimée': 'Attachment deleted',
  'Pièce jointe téléchargée': 'Attachment downloaded',
  'Presse-papiers effacé': 'Clipboard cleared',
  'Impossible de copier': 'Unable to copy',
  'Élément enregistré': 'Item saved',
  'Élément créé': 'Item created',
  'Impossible de modifier le favori': 'Unable to change favorite',
  'Élément déplacé dans la corbeille': 'Item moved to trash',
  'Élément restauré': 'Item restored',
  'Élément supprimé définitivement': 'Item permanently deleted',
  'Mot de passe remplacé': 'Password replaced',
  'Duplication impossible': 'Duplication failed',
  'Déplacement impossible': 'Move failed',
  'Retirer des favoris': 'Remove from favorites',
  'Ajouter aux favoris': 'Add to favorites',
  'Plus d’actions': 'More actions',
  'Type d’élément': 'Item type',
  'travail, perso': 'work, personal',
  'email ou nom d’utilisateur': 'email or username',
  'Saisissez votre mot de passe': 'Enter your password',
  'Générer un mot de passe': 'Generate a password',
  'Retirer l’adresse': 'Remove address',
  'Nom sur la carte': 'Name on card',
  'Optionnel': 'Optional',
  'Informations complémentaires…': 'Additional information…',
  'Nom du champ': 'Field name',
  'Nom du champ personnalisé': 'Custom field name',
  'Type du champ personnalisé': 'Custom field type',
  'Valeur': 'Value',
  'Actions de l’élément': 'Item actions',
  'Déplacer vers la corbeille ?': 'Move to trash?',
  'Mettre à la corbeille': 'Move to trash',
  'Supprimer définitivement ?': 'Delete permanently?',
  'Supprimer cette pièce jointe ?': 'Delete this attachment?',
  'Télécharger': 'Download',
  'Ajouter un champ': 'Add a field',
  'Ajouter une adresse': 'Add an address',
  'Ajouter une pièce jointe': 'Add an attachment',
  'Adresse': 'Address',
  'Adresse web': 'Web address',
  'Adresses du site': 'Site addresses',
  'Afficher le mot de passe': 'Show password',
  'Aucune pièce jointe.': 'No attachment.',
  'Aucune version enregistrée.': 'No saved version.',
  'Aucune adresse': 'No address',
  'Autres URL': 'Other URLs',
  'Carte bancaire': 'Bank card',
  'Champ personnalisé': 'Custom field',
  'Champs personnalisés': 'Custom fields',
  'Code PIN': 'PIN code',
  'Code TOTP (otpauth://)': 'TOTP code (otpauth://)',
  'Code postal': 'Postal code',
  'Commentaire': 'Comment',
  'Confirmer la suppression': 'Confirm deletion',
  'Copier': 'Copy',
  'Copié': 'Copied',
  'Créé le': 'Created on',
  'Date de naissance': 'Date of birth',
  'Déplacer vers': 'Move to',
  'Dernière modification': 'Last modified',
  'Dupliquer': 'Duplicate',
  'E-mail': 'Email',
  'Enregistrer': 'Save',
  'Enregistré': 'Saved',
  'Expiration': 'Expiry',
  'Expiration de la carte d’identité': 'Identity card expiry',
  'Expiration du passeport': 'Passport expiry',
  'Expiration du permis de conduire': 'Driving licence expiry',
  'Fermer': 'Close',
  'Générer': 'Generate',
  'Identifiant': 'Username',
  'Identité': 'Identity',
  'Masquer le mot de passe': 'Hide password',
  'Modifier': 'Edit',
  'Mot de passe': 'Password',
  'Mot de passe à changer': 'Password to change',
  'Nom': 'Last name',
  'Nom complet': 'Full name',
  'Notes': 'Notes',
  'Nouvel élément': 'New item',
  'Numéro': 'Number',
  'Numéro de carte': 'Card number',
  'Pays': 'Country',
  'Pièces jointes': 'Attachments',
  'Prénom': 'First name',
  'Rappel d’échéance': 'Expiry reminder',
  'Réseau': 'Network',
  'Réseau / type': 'Network / type',
  'Retirer': 'Remove',
  'Sans titre': 'Untitled',
  'Supprimer': 'Delete',
  'Supprimer définitivement': 'Delete permanently',
  'Téléphone': 'Phone',
  'Titre': 'Title',
  'Titulaire': 'Cardholder',
  'Valeur de': 'Value of',
  'Ville': 'City',
  'Voir': 'View',
  'À remettre à': 'Give to',
  'Choisir un fichier': 'Choose a file',
  'Changer sur le site': 'Change on the site',
  'Compléter': 'Complete',
  'Problème de sécurité': 'Security issue',
  'Favori': 'Favorite',
  'Supprimé le': 'Deleted on',
  'pièce jointe': 'attachment',
  'pièces jointes': 'attachments',
  'Clé de sécurité FIDO2': 'FIDO2 security key',
  'Déverrouillage par FIDO2/PRF, sans mot de passe.':
    'FIDO2/PRF unlock, without a password.',
  'Clé de sécurité configurée': 'Security key configured',
  'Clé de sécurité révoquée': 'Security key revoked',
  'Configuration de la clé de sécurité impossible':
    'Could not configure the security key',
  'Révocation de la clé de sécurité impossible':
    'Could not revoke the security key',
  'Révoquer la clé': 'Revoke key',
  'Configurer une clé': 'Configure a key',
  'Configuration…': 'Configuring…',
  'Révocation…': 'Revoking…',
  'Clé privée': 'Private key',
  'Clé publique': 'Public key',
  'Empreinte': 'Fingerprint',
  '-----BEGIN OPENSSH PRIVATE KEY-----': '-----BEGIN OPENSSH PRIVATE KEY-----',
  'ssh-ed25519 AAAA…': 'ssh-ed25519 AAAA…',
  'SHA256:…': 'SHA256:…',
  'SSID': 'SSID',
  'WPA/WPA2/WPA3': 'WPA/WPA2/WPA3',
  'WEP': 'WEP',
  'Sans mot de passe': 'No password',
  'Réseau masqué': 'Hidden network',
  'Oui': 'Yes',
  'Non': 'No',
  'QR code Wi-Fi': 'Wi-Fi QR code',
  'Afficher le QR code Wi-Fi': 'Show Wi-Fi QR code',
  'Masquer le QR code Wi-Fi': 'Hide Wi-Fi QR code',
  'Scannez ce code pour rejoindre le réseau.': 'Scan this code to join the network.',
  'Identifiant de clé': 'Key ID',
  'Environnement': 'Environment',
  'Point de terminaison': 'Endpoint',
  'Production': 'Production',
  'https://api.exemple.fr': 'https://api.example.com',
  'Clé de licence': 'License key',
  'Licencié à': 'Licensed to',
  'Version': 'Version',
  'Site web': 'Website',
  'Date d’achat': 'Purchase date',
  'XXXX-XXXX-XXXX-XXXX': 'XXXX-XXXX-XXXX-XXXX',
  'https://exemple.fr': 'https://example.com',
  'Type de document': 'Document type',
  'Émetteur': 'Issuer',
  'Numéro du document': 'Document number',
  'Date d’émission': 'Issue date',
  'Contrat': 'Contract',
  'Facture': 'Invoice',
  'Certificat': 'Certificate',
  'Autre': 'Other',
  'Pièce jointe principale': 'Primary attachment',
  'Règles du site appliquées :': 'Site rules applied:',
  'Identité de partage': 'Sharing identity',
  'Prépare le partage de coffres avec un contact de confiance.':
    'Prepare vault sharing with a trusted contact.',
  'Identité de partage créée': 'Sharing identity created',
  'Création de l’identité impossible': 'Could not create the identity',
  'Transmettez cette identité publique hors bande. Elle ne contient aucune clé privée.':
    'Share this public identity out of band. It contains no private key.',
  'Identité publique': 'Public identity',
  'Identité copiée': 'Identity copied',
  'Copier l’identité publique': 'Copy public identity',
  'Aucune identité de partage pour ce coffre.':
    'No sharing identity for this vault.',
  'Créer mon identité': 'Create my identity',
  'Créer un paquet de partage': 'Create a sharing package',
  'Coffre à partager': 'Vault to share',
  'Identités des membres (une par ligne)': 'Member identities (one per line)',
  'Collez une identité publique JSON par ligne': 'Paste one public identity JSON per line',
  'Générer le paquet': 'Generate package',
  'Génération du paquet impossible': 'Could not generate the package',
  'Paquet de partage': 'Sharing package',
  'Paquet de partage généré': 'Sharing package generated',
  'Paquet copié': 'Package copied',
  'Copier le paquet': 'Copy package',
  'Les rôles sont vérifiés à l’import ; l’écriture n’est pas encore restreinte par le rôle.':
    'Roles are verified on import; write access is not yet restricted by role.',
  'Importer un coffre partagé': 'Import a shared vault',
  'Collez le paquet JSON reçu': 'Paste the received JSON package',
  'Nom du coffre importé': 'Imported vault name',
  'Importer le coffre': 'Import vault',
  'Coffre partagé importé': 'Shared vault imported',
  'Import du coffre impossible': 'Could not import the vault',
  'Le paquet complet contient les éléments chiffrés du coffre. Le paquet de clé seule n’ajoute que le coffre vide.':
    'The full package contains the vault’s encrypted items. The key-only package adds an empty vault.',
  'Générer le paquet complet': 'Generate full package',
  'Synchronisation par dossier': 'Folder sync',
  'Chaque membre dépose un bundle signé dans un dossier commun. Les fichiers restent chiffrés ; choisissez un dossier déjà synchronisé (iCloud Drive, Dropbox, Syncthing…).':
    'Each member drops a signed bundle into a shared folder. Files stay encrypted; choose a folder that is already synced (iCloud Drive, Dropbox, Syncthing…).',
  'jamais': 'never',
  'Synchroniser maintenant': 'Sync now',
  'Changer de dossier': 'Change folder',
  'Synchronisation automatique toutes les 60 secondes lorsque le coffre est déverrouillé.':
    'Automatic sync every 60 seconds while the vault is unlocked.',
  'Choisir un dossier': 'Choose a folder',
  'Choisir un dossier de partage': 'Choose a sharing folder',
  'Dossier de partage configuré.': 'Sharing folder configured.',
  'Configuration du dossier impossible.': 'Could not configure the folder.',
  'Synchronisation impossible.': 'Sync failed.',
  'Synchronisation du partage désactivée.': 'Sharing sync disabled.',
  'Paquet complet généré': 'Full package generated',
  'Lecture seule': 'Read-only',
  'Membres du coffre': 'Vault members',
  'Aucun membre enregistré.': 'No members saved.',
  'Écriture': 'Write',
  'Lecture': 'Read',
  'Administrateur': 'Administrator',
  'Révoquer': 'Revoke',
  'Membre révoqué, nouveau paquet généré.':
    'Member revoked, new package generated.',
  'Un membre révoqué conserve l’ancienne clé pour les contenus déjà reçus.':
    'A revoked member keeps the old key for content already received.',
  'Révocation impossible.': 'Revocation failed.',
  'Accès d’urgence': 'Emergency access',
  'Enveloppe la clé maîtresse pour un contact de confiance.':
    'Wrap the master key for a trusted contact.',
  'Contact configuré le': 'Contact configured on',
  'Supprimer l’accès d’urgence': 'Remove emergency access',
  'Identité du contact': 'Contact identity',
  'Collez l’identité publique JSON du contact': 'Paste the contact’s public JSON identity',
  'Configurer l’accès d’urgence': 'Configure emergency access',
  'Accès d’urgence configuré': 'Emergency access configured',
  'Accès d’urgence supprimé': 'Emergency access removed',
  'Configuration impossible': 'Configuration failed',
  'Suppression impossible': 'Deletion failed',
  'Mode d’accès d’urgence': 'Emergency access mode',
  'Contact unique (immédiat)': 'Single contact (immediate)',
  'Shamir 2/3': 'Shamir 2/3',
  'Identités des contacts (une par ligne)': 'Contact identities (one per line)',
  'Contacts requis': 'Required contacts',
  'contacts requis pour ouvrir l’accès d’urgence':
    'contacts required to open emergency access',
  'Sans serveur, aucun délai ne peut être imposé : un accès immédiat s’ouvre dès que le contact possède le fichier et sa clé privée. En mode Shamir, le nombre de contacts configuré est requis.':
    'Without a server, no delay can be enforced: immediate access opens as soon as the contact holds the file and their private key. In Shamir mode, the configured number of contacts is required.',
  'Télécharger le paquet': 'Download package',
  'Fuites connues': 'Known breaches',
  'Surveillance optionnelle en k-anonymat.': 'Optional k-anonymity monitoring.',
  'Vérifier mes mots de passe dans les fuites connues (Have I Been Pwned)':
    'Check my passwords against known breaches (Have I Been Pwned)',
  'Historique du générateur': 'Generator history',
  'Les 50 derniers mots de passe générés restent chiffrés dans le coffre.':
    'The last 50 generated passwords stay encrypted in the vault.',
  Conservation: 'Retention',
  Désactivé: 'Disabled',
  '1 jour': '1 day',
  '7 jours': '7 days',
  '30 jours': '30 days',
  'Aucun mot de passe généré récemment.': 'No recently generated password.',
  'Sans domaine': 'No domain',
  Masquer: 'Hide',
  Afficher: 'Show',
  'Créer une connexion': 'Create a login',
  'Connexion générée': 'Generated login',
  'Connexion créée depuis l’historique': 'Login created from history',
  'Historique du générateur effacé': 'Generator history cleared',
  'Historique du générateur purgé': 'Generator history purged',
  'Les mots de passe générés restent chiffrés dans le coffre.':
    'Generated passwords stay encrypted in the vault.',
  'Secrets générés localement, jamais en clair.':
    'Secrets generated locally, never in clear text.',
  'entrée(s) disponible(s) dans l’historique.':
    'entry/entries available in history.',
  'Aucun coffre disponible': 'No vault available',
  'Création impossible': 'Creation failed',
  'Tout effacer': 'Clear all',
  'Régénérer': 'Regenerate',
  'Sauvegardes planifiées': 'Scheduled backups',
  'Sauvegarde planifiée': 'Scheduled backup',
  'Copies chiffrées du fichier .coffre dans un dossier choisi, même quand le coffre est verrouillé.':
    'Encrypted copies of the .coffre file in a chosen folder, even while the vault is locked.',
  'Sur le Web, Coffre ne peut pas écrire en arrière-plan : un rappel vous invite à exporter.':
    'On the Web, Coffre cannot write in the background: a reminder invites you to export.',
  'Le mode voyage suspend les sauvegardes planifiées pour ne pas écrire un coffre réduit par-dessus la rétention.':
    'Travel mode pauses scheduled backups so a reduced vault is not written over the retention set.',
  Fréquence: 'Frequency',
  Quotidienne: 'Daily',
  Hebdomadaire: 'Weekly',
  'Dossier cible': 'Target folder',
  'Choisir un dossier de sauvegarde': 'Choose a backup folder',
  'Dossier de sauvegarde configuré.': 'Backup folder configured.',
  'Impossible de choisir ce dossier.': 'Unable to choose this folder.',
  'Quotidiennes conservées': 'Daily backups kept',
  'Hebdomadaires conservées': 'Weekly backups kept',
  'Mensuelles conservées': 'Monthly backups kept',
  'Dernière sauvegarde :': 'Last backup:',
  'Aucune sauvegarde réussie pour le moment.': 'No successful backup yet.',
  'Sauvegarder maintenant': 'Back up now',
  'Tester la restauration': 'Test restore',
  'Aucune sauvegarde à tester.': 'No backup to test.',
  'Sauvegarde effectuée.': 'Backup completed.',
  'Aucune sauvegarde nécessaire.': 'No backup needed.',
  'Le dossier de sauvegarde est introuvable.': 'The backup folder cannot be found.',
  'Sauvegarde impossible.': 'Backup failed.',
  'Intégrité confirmée : {items} éléments (coffre courant : {current}).':
    'Integrity confirmed: {items} items (current vault: {current}).',
  'Vérification impossible. Saisissez le mot de passe de cette sauvegarde.':
    'Verification failed. Enter this backup’s password.',
  'Sauvegarde illisible ou corrompue.': 'Backup unreadable or corrupted.',
  'Test de restauration :': 'Restore test:',
  'Mot de passe de la sauvegarde': 'Backup password',
  Vérifier: 'Verify',
  Tester: 'Test',
  'Sauvegardes suspendues par le mode voyage.': 'Backups paused by travel mode.',
  'Le dossier de sauvegarde est introuvable (disque débranché ?).':
    'The backup folder cannot be found (drive disconnected?).',
  'Choisissez un dossier de sauvegarde.': 'Choose a backup folder.',
  'La dernière sauvegarde a échoué.': 'The last backup failed.',
  'Aucune sauvegarde planifiée n’a encore réussi.':
    'No scheduled backup has succeeded yet.',
  'La dernière sauvegarde date de plus de deux périodes.':
    'The last backup is more than two periods old.',
  'Pensez à exporter une sauvegarde manuelle.':
    'Remember to export a manual backup.',
  'Ajouter les codes': 'Add codes',
  'Ajouter un code': 'Add a code',
  'Aucun code détecté dans le texte.': 'No code detected in the text.',
  'Aucun code enregistré.': 'No code saved.',
  'Aucun code pour le moment.': 'No code yet.',
  'Ces codes sont déjà présents.': 'These codes are already present.',
  'Code de secours': 'Recovery code',
  'Codes de secours à renouveler': 'Recovery codes to renew',
  'Coller des codes de secours': 'Paste recovery codes',
  'Copier ce code': 'Copy this code',
  'Marquer ce code comme utilisé ?': 'Mark this code as used?',
  'Marquer utilisé': 'Mark used',
  'Mise à jour impossible': 'Update failed',
  'Rétablir': 'Restore',
  'Supprimer ce code': 'Remove this code',
  'Un code par ligne ou séparés par des espaces':
    'One code per line or separated by spaces',
  'Un élément ne contient plus que deux codes de secours ou moins.':
    'One item has only two recovery codes or fewer left.',
  '{count} éléments ne contiennent plus que deux codes de secours ou moins.':
    '{count} items have only two recovery codes or fewer left.',
  Utilisé: 'Used',
  'Utilisé le': 'Used on',
  Disponible: 'Available',
  'Codes restants': 'Remaining codes',
  'Ouvrir': 'Open',
  'Les puces, numéros de liste et doublons sont ignorés. Les codes restent chiffrés dans le coffre.':
    'Bullets, list numbers and duplicates are ignored. Codes stay encrypted in the vault.',
  'Le code copié sera daté et ne sera plus proposé. Vous pourrez le rétablir depuis la fiche.':
    'The copied code will be dated and no longer offered. You can restore it from the item.',
  "Mises à jour":
    "Updates",
  "Nouvelles versions publiées sur GitHub, signées et vérifiées avant installation.":
    "New versions published on GitHub, signed and verified before installation.",
  "La version Web se met à jour automatiquement à chaque visite, sans action de votre part.":
    "The web version updates itself automatically on each visit, with nothing to do.",
  "Version installée :":
    "Installed version:",
  "Version installée":
    "Installed version",
  "Dernière vérification":
    "Last check",
  "Recherche…":
    "Checking…",
  "Rechercher maintenant":
    "Check now",
  "Coffre est à jour.":
    "Coffre is up to date.",
  "Version {version} disponible":
    "Version {version} available",
  "Préversion":
    "Pre-release",
  "Notes de version":
    "Release notes",
  "Téléchargement de la mise à jour":
    "Downloading the update",
  "Téléchargement…":
    "Downloading…",
  "Téléchargement… {percent} %":
    "Downloading… {percent}%",
  "Installer et redémarrer":
    "Install and restart",
  "Installation… Coffre va redémarrer.":
    "Installing… Coffre will restart.",
  "Ignorer cette version":
    "Skip this version",
  "La mise à jour sera installée à la fermeture de Coffre.":
    "The update will be installed when Coffre quits.",
  "Recherche automatique":
    "Automatic check",
  "Désactivée":
    "Off",
  "À chaque démarrage":
    "At every launch",
  "Chaque jour":
    "Every day",
  "Chaque semaine":
    "Every week",
  "Canal":
    "Channel",
  "Stable":
    "Stable",
  "Bêta (préversions)":
    "Beta (pre-releases)",
  "Installation":
    "Installation",
  "Me demander":
    "Ask me",
  "À la fermeture de Coffre":
    "When Coffre quits",
  "Télécharger automatiquement en arrière-plan":
    "Download automatically in the background",
  "Les préversions apportent les nouveautés plus tôt mais peuvent contenir des défauts. Gardez des sauvegardes à jour.":
    "Pre-releases bring new features earlier but may contain bugs. Keep your backups up to date.",
  "Version ignorée : {version}":
    "Skipped version: {version}",
  "Ne plus ignorer":
    "Stop skipping",
  "La recherche contacte github.com : GitHub voit votre adresse IP et la version de Coffre. Aucune donnée du coffre n’est envoyée. Chaque paquet est signé et sa signature vérifiée avant installation ; le coffre est verrouillé avant le redémarrage.":
    "Checking contacts github.com: GitHub sees your IP address and Coffre version. No vault data is sent. Every package is signed and its signature verified before installation; the vault is locked before restarting.",
  "Coffre {version} est disponible":
    "Coffre {version} is available",
  "Plus tard":
    "Later",
  "Prête : elle sera installée à la fermeture de Coffre.":
    "Ready: it will be installed when Coffre quits.",
  "Les mises à jour ne sont pas disponibles dans ce build : la clé de signature n’y est pas intégrée (build local ou de développement).":
    "Updates are not available in this build: the signing key is not embedded (local or development build).",
  "Canal de mise à jour invalide.":
    "Invalid update channel.",
  "Impossible de joindre le serveur de mises à jour. Vérifiez la connexion et réessayez.":
    "Cannot reach the update server. Check your connection and try again.",
  "Téléchargement impossible, ou signature du paquet invalide. Rien n’a été installé.":
    "Download failed, or the package signature is invalid. Nothing was installed.",
  "Installation impossible. Coffre reste dans sa version actuelle.":
    "Installation failed. Coffre stays on its current version.",
  "Cette mise à jour n’est plus disponible. Relancez une recherche.":
    "This update is no longer available. Check again.",
  "Téléchargez la mise à jour avant de l’installer.":
    "Download the update before installing it.",
  "Une opération de mise à jour est déjà en cours.":
    "An update operation is already in progress.",
  "Texte masqué":
    "Hidden text",
  "Code 2FA (TOTP)":
    "2FA code (TOTP)",
  "Nombre":
    "Number",
  "Mois et année":
    "Month and year",
  "Oui / non":
    "Yes / no",
  "Clé TOTP invalide":
    "Invalid TOTP key",
  "champ":
    "field",
  "Valeur inhabituelle pour ce type de champ.":
    "Unusual value for this field type.",
  "Clé TOTP (2FA)":
    "TOTP key (2FA)",
  "Clé invalide : lettres A à Z et chiffres 2 à 7 (au moins 8 caractères), ou lien otpauth://.":
    "Invalid key: letters A to Z and digits 2 to 7 (at least 8 characters), or an otpauth:// link.",
  "Saisissez la clé affichée par le site lors de l’activation de la 2FA (souvent sous le QR code). Un lien otpauth:// fonctionne aussi.":
    "Enter the key the site shows when you turn on 2FA (often below the QR code). An otpauth:// link works too.",
  "{title} (copie)":
    "{title} (copy)",
  "Élément dupliqué":
    "Item duplicated",
  "Élément dupliqué, sans les pièces jointes":
    "Item duplicated, without attachments",
  "Dupliquer (⌘D)":
    "Duplicate (⌘D)",
  "{version} disponible — Télécharger":
    "{version} available — Download",
  "Redémarrer pour mettre à jour":
    "Restart to update",
  "Installation…":
    "Installing…",
  "Réessayer":
    "Retry",
  "Rechercher les mises à jour":
    "Check for updates",
  "À jour":
    "Up to date",
  "Saisie":
    "Type",
  "Alias":
    "Alias",
  "Inconnue":
    "Unknown",
  "Aujourd’hui":
    "Today",
  "Hier":
    "Yesterday",
  "Il y a {count} jours":
    "{count} days ago",
  "Il y a {count} mois":
    "{count} months ago",
  "Il y a plus d’un an":
    "More than a year ago",
  "Robustesse":
    "Strength",
  "Aucun mot de passe":
    "No password",
  "Réutilisation":
    "Reuse",
  "Proche d’un autre mot de passe":
    "Similar to another password",
  "Mot de passe unique":
    "Unique password",
  "Utilisé par 1 autre compte":
    "Used by 1 other account",
  "Utilisé par {count} autres comptes":
    "Used by {count} other accounts",
  "Comptes qui partagent ce mot de passe":
    "Accounts sharing this password",
  "Ouvrir {title}":
    "Open {title}",
  "Vérification désactivée":
    "Check turned off",
  "Présent dans une fuite":
    "Found in a breach",
  "Aucune fuite connue":
    "No known breach",
  "Double authentification":
    "Two-factor authentication",
  "Configurée":
    "Set up",
  "Disponible, non configurée":
    "Available, not set up",
  "Non renseignée":
    "Not recorded",
  "Palette de commandes":
    "Command palette",
  "Rechercher un élément ou une action":
    "Search for an item or an action",
  "Rechercher un élément ou une action…":
    "Search for an item or an action…",
  "Échap":
    "Esc",
  "Aucun résultat":
    "No results",
  "Actions":
    "Actions",
  "Éléments":
    "Items",
  "Utilisés récemment":
    "Recently used",
  "Tableau de bord":
    "Dashboard",
  "Tous les éléments":
    "All items",
  "Favoris":
    "Favorites",
  "Corbeille":
    "Trash",
  "Bilan de sécurité":
    "Security review",
  "Sélectionner plusieurs éléments":
    "Select several items",
  "Verrouiller le coffre":
    "Lock the vault",
  "Accès rapide":
    "Quick access",
  "Déplacer le champ":
    "Move field",
  "sans nom":
    "unnamed",
  "Glisser pour déplacer (ou flèches haut et bas)":
    "Drag to move (or up and down arrows)",
  "Très faible":
    "Very weak",
  "Faible":
    "Weak",
  "Moyen":
    "Fair",
  "Solide":
    "Strong",
  "Excellent":
    "Excellent",
}

/** Traduit un texte source ; renvoie le texte tel quel s’il est inconnu. */
export function translateText(locale: 'fr' | 'en', text: string): string {
  return locale === 'en' ? EN_TEXT[text] ?? text : text
}
