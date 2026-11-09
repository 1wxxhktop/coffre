# Journal des changements

## Non publié

- Dette React : filtres, sélection, limite d’affichage, QR codes et historique
  de sécurité sont désormais dérivés pendant le rendu, sans effets de
  synchronisation ; `bun run lint` ne signale plus aucun avertissement.
- Reproductibilité desktop : `bun run repro:desktop` compare deux bundles
  macOS, avec recompilation de la caisse applicative et signature ad hoc entre
  les deux. La vérification Web/extension reste couverte par `repro:check`.
- Bundle découpé : les dialogues d’élément, de réglages, de sécurité et le
  générateur sont chargés à la demande, avec un écran d’attente accessible ;
  React, zod, hash-wasm, HPKE et Tauri sont répartis en chunks stables. Plus
  aucun chunk ne dépasse 500 Ko et l’avertissement `fflate` est supprimé.
- Liste groupée automatiquement par date : sections « Aujourd’hui », « Hier »,
  « 7 derniers jours », « Ce mois-ci » puis par mois, en-têtes sticky, tri
  appliqué à l’intérieur des groupes et option pour revenir à une liste plate.
- Correctifs de l’audit du 7 novembre 2026, portés sur le format 4 :
  - écritures contrôlées dans le navigateur : une modification calculée à
    partir d’une version périmée est refusée au lieu d’effacer celle d’un
    autre onglet ; chaque déverrouillage relit le fichier enregistré ;
  - verrouillage pendant un enregistrement : la modification en cours est
    signée et enregistrée avant l’effacement des clés, au lieu d’être perdue ;
  - fermeture de page : l’état passe à « verrouillé » (bfcache) sans retirer
    la clé du déverrouillage rapide ;
  - suppression d’un coffre : la clé n’est retirée de la session qu’après
    l’écriture réussie ;
  - export CSV en clair soumis à la saisie du mot de passe maître ;
  - estimateur de robustesse par motifs (dictionnaires, clavier, suites,
    dates, substitutions), sorti de `crypto.ts` pour ne pas alourdir
    l’extension ;
  - desktop : presse-papiers natif marqué secret et effacement différé fiable,
    raison Touch ID fixée côté Rust, serveur de développement refusé dans les
    builds de production, rotation des sauvegardes sans fichier courant ;
  - import Enpass : résolution des dossiers itérative et bornée ;
  - CI : actions épinglées par SHA, `persist-credentials: false`, permissions
    minimales et tests avant signature dans la release.

- Coffre de fichiers chiffrés en flux : blobs hors `.coffre`, AES-256-GCM par
  blocs de 64 Kio, nonce STREAM, détection de troncature/substitution,
  commandes Tauri, client TypeScript et ajout/téléchargement/suppression depuis
  la fiche d’élément, avec aperçu image/PDF en mémoire, synchronisation des
  blobs par dossier, échange des blobs manquants par le réseau local F2 et
  nettoyage des blobs orphelins.
- Alias e-mail hors ligne : générateur « plus » et catch-all, mémorisation des
  préférences, enregistrement dans l’élément ; intégration opt-in
  SimpleLogin/addy.io avec clé API chiffrée dans le coffre et création/copie
  d’alias depuis le menu de l’extension.
- Saisie automatique desktop : séquence KeePass, compte à rebours, vérification
  du focus avant chaque jeton, refus si la fenêtre change, commandes Tauri
  `autotype_active_window` et `autotype_run`, raccourci global et sélection des
  connexions correspondant à la fenêtre active.
- Outils développeur : `coffre-cli run --env-file` avec références
  `coffre://coffre/élément/champ`, assistant `git-credential` avec approbation
  explicite, signature `SSHSIG`, binaire `coffre-git-sign` pour `git commit -S`,
  génération de blocs `Host` SSH, et refus documenté des clés SSH FIDO2.
- Journal d’activité local chiffré : événements par identifiant, AAD dédiée,
  fusion, plafond de 5 000 entrées, page de consultation et export JSON.
- Modèles d’éléments personnalisés : éditeur dans les réglages, champs texte,
  secret, URL, date et texte long, stockage chiffré par modèle avec AAD dédiée,
  fusion, pierres tombales, changement de mot de passe, récupération et
  création d’éléments depuis un modèle et remplissage des champs `fillable`
  depuis l’onglet Modèles de l’extension, y compris via le pont natif desktop.
- Mode voyage (desktop) : marquage des coffres sûrs, retrait local des autres
  coffres, éléments, pièces jointes et versions sans pierre tombale, écrasement
  des sauvegardes locales, restauration depuis la synchronisation par dossier
  avec vérification du mot de passe maître.
- Synchronisation locale directe (desktop) : appairage par code/QR, identité
  X25519 locale, transport TCP chiffré par Noise XX, carnet de pairs, réception
  à la demande sur le port 47823 et fusion par `reconcileVaultFiles`. Aucun
  serveur ni connexion Internet ; annonce et découverte mDNS `_coffre._tcp`
  pendant la fenêtre de réception, mobile restant à faire.
- Extension : déverrouillage depuis la popup. Avec le pont natif, Coffre
  reprend le premier plan et déclenche Touch ID si l’option est active ; le
  mot de passe maître reste saisi dans l’application. Si l’application est
  fermée, l’hôte natif la démarre sur ce clic explicite (jamais pour une simple
  lecture d’état). Le popup suit l’état et affiche un message clair en cas de
  refus ou d’expiration. Sans desktop, il ouvre l’onglet Coffre Web.
- Extension : les propositions d’enregistrement et la dernière connexion
  choisie survivent à l’arrêt du service worker MV3. Elles vivent dans
  `storage.session` (dix minutes, dix propositions au plus, purge à la
  fermeture de l’onglet et au verrouillage), restent inaccessibles aux content
  scripts et ne touchent jamais `storage.local` ; le badge est recalculé au
  réveil.
- Extension : options du générateur (longueur, classes de caractères,
  caractères ambigus, entropie estimée) mémorisées localement.
- Extension : le remplissage d’une connexion valide automatiquement le
  formulaire (bouton de connexion ou `requestSubmit`) pour réduire les
  interactions, sans soumettre les cartes ni les identités.
- Extension : icônes d’action 16/32/48/128 px et variantes clair/sombre
  (`theme_icons`) pour la barre d’outils.
- Extension : barre de recherche et bouton du générateur ancrés en haut pendant
  le défilement ; la recherche est focalisée à l’ouverture et toute touche
  imprimable lance une recherche automatiquement.
- Extension : logo Coffre thémable (carré clair avec cadenas sombre en thème
  sombre, inversé en clair) dans le popup, le menu inline, les réglages et la
  fenêtre passkey.
- Extension : la liste des connexions utilise toute la hauteur disponible ;
  l’indicateur de remplissage actif est réduit à une pastille verte dans le
  pied de page.
- Extension : plus de demande d’enregistrement quand les identifiants soumis
  correspondent déjà à une connexion du coffre ; une mise à jour est proposée
  uniquement si le mot de passe a changé.
- Extension : le bouton d’activation du remplissage est remplacé par un
  indicateur « Remplissage actif » dès que le content script répond dans
  l’onglet courant.
- Extension : réglages intégrés au popup (thème, adresse de l’application,
  test de connexion), barre d’actions et notification ancrées en bas de la
  fenêtre, et activation du remplissage compatible WebKit/Orion (repli
  d’injection et vérification du content script).
- Extension : thème clair/sombre (système, clair, sombre), détails de connexion
  avec copie individuelle de l’identifiant, du mot de passe et du code TOTP,
  et correction des débordements du popup et du menu inline.
- Extension : remplissage des cartes bancaires et des identités/adresses depuis
  le menu à trois onglets, détection `autocomplete` et libellés français, CVC et
  PIN uniquement sur action explicite, refus des cartes hors HTTPS ou dans une
  iframe tierce non prestataire, et enregistrement d’une carte ou d’une identité
  saisie dans un formulaire.
- Imports étendus : Dashlane JSON, export XML KeePass 2.x, Dashlane et Keeper
  CSV sans ligne d’en-tête, champs Bitwarden `fields`, et rapport des colonnes
  de métadonnées ignorées.
- Portabilité CXF 1.0 : import et export des connexions, notes, cartes,
  identités et passkeys (clé publique COSE recalculée à l’import), avec
  confirmation explicite avant l’export en clair.
- Format de fichier v4 : identifiant d’appareil, révision monotone, époque des
  clés, horloges par enregistrement et pierres tombales conservées 180 jours.
- MAC global HMAC-SHA-256 sur un manifeste canonique : détection des
  suppressions, substitutions et rejeux d’enregistrements, y compris avec des
  ciphertexts authentiques. Un fichier altéré s’ouvre en lecture seule.
- Clé de MAC aléatoire scellée par la clé maîtresse et tournée au changement de
  mot de passe ou après une récupération par phrase.
- Anti-retour en arrière local : la plus haute révision vue est conservée hors
  du fichier (IndexedDB ou `vault/state.json`), et un fichier plus ancien
  déclenche un avertissement. Les fichiers v1 à v3 restent lisibles et sont
  migrés en v4 à la première écriture.
- Pont natif extension ↔ application desktop : hôte de messagerie native
  installé pour Chrome, Chromium, Edge, Brave et Firefox, socket local `0600`,
  appairage par code à six chiffres, ECDH P-256 + HKDF-SHA-256, messages
  AES-256-GCM avec compteurs anti-rejeu, et contrôle de domaine dans
  l’application.
- L’extension utilise le pont natif en priorité et conserve l’onglet Coffre Web
  comme repli. Une application verrouillée ramène sa fenêtre au premier plan
  sans renvoyer de secret.
- Préparation de la synchronisation : `mergeVaultFiles` fusionne les fichiers
  v4 par horloges `{ rev, writer }`, pierres tombales, versions et pièces
  jointes. Fusion pure, commutative et idempotente, couverte par des tests de
  propriété `fast-check` ; les conflits à révision égale sont signalés pour être
  archivés par l’application.
- Synchronisation desktop : `sync_prepare`, `sync_list`, `sync_read` et
  `sync_write` confinés à `Coffre/<idFichier>/`, refus des noms dangereux et des
  liens symboliques, écritures atomiques `0600`, et surveillance `notify` avec
  anti-rebond.
- Interface « Synchronisation » dans les réglages desktop : choix du dossier,
  état, dernière synchronisation, conflits archivés et synchronisation
  manuelle.
- Vérification du MAC de chaque fichier distant avant fusion ; adoption d’une
  nouvelle époque de clés après saisie du nouveau mot de passe, sans fusionner
  de ciphertexts d’époques différentes.
- Archivage déterministe des contenus perdus lors d’un conflit dans l’historique
  de l’élément, sans doublon lors des synchronisations suivantes.
- Synchronisation Web (Chromium) via File System Access API : choix d’un dossier,
  handle persistant dans IndexedDB, permission lecture/écriture, mêmes fichiers
  `.coffre` signés et mêmes règles de fusion que sur desktop. Repli manuel sur
  Safari/Firefox.
- Extension : menu directement dans les champs, dans une iframe d’extension
  isolée ; détection locale des formulaires (30 pages de test), iframes,
  connexions en plusieurs étapes, remplissage TOTP et proposition d’enregistrer
  ou de mettre à jour après soumission.
- Permissions d’hôte optionnelles : le content script n’est enregistré qu’après
  activation explicite depuis le popup, et le mot de passe d’une soumission
  reste en mémoire du service worker au plus deux minutes.
- Passkeys WebAuthn : nouveau type d’élément `passkey` (RP ID, compte,
  identifiant de credential, clé privée ECDSA P-256 PKCS#8 et clé publique COSE
  dans le contenu chiffré). L’extension intercepte `navigator.credentials`
  dans le monde `MAIN`, affiche une fenêtre de confirmation, puis l’application
  crée l’attestation `none` ou signe l’assertion. La clé privée ne traverse
  jamais le pont ; le `rpId` est validé contre l’origine réelle et les suffixes
  publics courants sont refusés. Les sites exigeant une vérification
  utilisateur (`UV`) ou un authentificateur externe retombent sur le navigateur.
- Les passkeys sont visibles dans le filtre « Passkeys », en lecture seule, et
  le compteur d’assertion reste à zéro pour éviter une écriture du coffre à
  chaque connexion. Le partage hors ligne et la duplication sont masqués pour
  ne pas recopier une clé privée par inadvertance. Un test unitaire vérifie que
  la clé privée ne figure pas dans la réponse destinée au navigateur ; le smoke
  de l’extension couvre la création, la connexion, le `clientDataJSON`, le hash
  de RP ID et la vérification de la signature ECDSA avec les primitives Node.
- Nouveau type `ssh-key` : clé privée, clé publique, empreinte et commentaire
  chiffrés, avec formulaire, fiche détaillée et filtre « Clés SSH ». Aucune clé
  privée n’est incluse dans les exports CSV.
- Déverrouillage FIDO2/PRF optionnel : credential WebAuthn résident avec
  vérification utilisateur, sortie PRF transformée par HKDF-SHA-256 et
  enveloppe AES-256-GCM liée au fichier. Enrôlement/révocation dans les
  réglages, bouton de déverrouillage et suppression automatique lors d’un
  changement de mot de passe ou d’une récupération.
- Nouveau type `wifi` : SSID, mot de passe, sécurité WPA/WEP/ouvert et réseau
  masqué, avec QR code de connexion généré localement à la demande.
- Nouveau type `api-credential` : identifiant de clé, secret, environnement et
  point de terminaison, avec formulaire, fiche et filtre dédiés.
- Nouveau type `software-license` : clé de licence, titulaire, version, site
  web et date d’achat, avec formulaire, fiche et filtre dédiés.
- Nouveau type `document` : type, émetteur, numéro, date d’émission et pièce
  jointe principale, avec formulaire, fiche et filtre dédiés.
- Règles de génération par site : dataset Apple « Password Manager
  Resources » embarqué, parseur des classes et contraintes, génération de mots
  de passe compatibles dans le générateur.
- Socle de partage L10 : identités X25519 et Ed25519, empreintes SHA-256,
  enveloppes HPKE X25519/HKDF-SHA-256/AES-256-GCM pour les clés de coffre et
  l’accès d’urgence, enveloppes multi-membres, rotation de clé partagée et rôles
  signés. Identité persistée dans le fichier, ré-enveloppée au changement de
  mot de passe et créable depuis les réglages avec export public ; paquets de
  partage signés par membre, validation des identités/paquets importés et
  interface de génération/import dans les réglages, et paquet complet des
  éléments/pièces jointes/versions chiffrés, avec propagation des suppressions
  par pierres tombales. Le paquet peut être copié ou téléchargé en fichier
  `.coffre-shared.json` puis importé. Synchronisation par dossier : chaque
  membre écrit un bundle signé Ed25519 (`shared-<coffre>-<empreinte>.coffre-shared.json`),
  importé automatiquement toutes les 60 secondes ou à la demande ; les paquets
  de partage sont conservés chiffrés dans les métadonnées pour permettre les
  exports suivants. Les coffres partagés en
  lecture seule bloquent les mutations dans l’application ; la limite face à un
  client modifié est documentée. Révocation d’un membre par rotation de la clé
  du coffre, re-enveloppe des clés d’éléments et nouveau paquet pour les
  membres restants. Accès d’urgence : enveloppe HPKE de la clé maîtresse pour
  un contact ou en parts Shamir 2/3, ré-enveloppée lors des rotations ; aucun
  délai imposé sans serveur.
- Chaîne d’approvisionnement : toolchain Rust épinglée, builds Web/extension
  comparés deux fois avec `SOURCE_DATE_EPOCH=0`, bundle macOS comparé après
  recompilation de la caisse applicative, SBOM CycloneDX Rust et web générés en
  CI et joints aux releases macOS avec une somme SHA-256. `cargo deny` contrôle
  licences, avis RUSTSEC et sources ; les exceptions sont documentées dans
  `src-tauri/deny.toml`, et `RUSTSEC-2023-0071` est retiré depuis le passage à
  `rsa` 0.10 / `ssh-key` 0.7.0-rc.12. Fuzzing hebdomadaire du parseur et de la
  fusion `coffre-core` avec libFuzzer.
- Divulgation responsable : `/.well-known/security.txt` avec contact GitHub
  privé, politique, langues et expiration ; validation automatique dans le lint.
- Cœur Rust partagé `coffre-core` : Argon2id, AES-256-GCM, AAD, HMAC-SHA-256,
  manifeste canonique, ouverture des fichiers v1 à v4, création/modification/
  suppression d’éléments, signature v4 (horloges, tombstones, MAC), rotation
  du mot de passe maître, fusion L3 et façade UniFFI JSON. Commande Tauri de
  fusion sans déchiffrement. Buffers `Zeroizing`, aucune dépendance réseau,
  vecteurs croisés TypeScript ↔ Rust et CI dédiée Linux/macOS/Windows.
- CLI `coffre-cli` : `list`, `get`, `totp` et `run --env` pour les scripts,
  mot de passe lu sans écho sur le terminal ou sur stdin, jamais en argument.
  Injection des secrets par l’environnement du processus enfant, propagation
  du code de sortie, tests unitaires et d’intégration, CI Linux/macOS/Windows.
- Agent SSH `coffre-ssh-agent` : protocole `SSH_AUTH_SOCK`, liste d’identités,
  signatures ed25519 et RSA, socket Unix `0600`, approbation obligatoire dans le
  terminal et binaire `--list`. Intégration desktop avec démarrage depuis les
  réglages, modale d’approbation par signature, Touch ID optionnel, signature
  de commits Git via `ssh-keygen -Y sign`, mémorisation opt-in de 15 secondes
  par clé et arrêt automatique au verrouillage.
- Surveillance des fuites optionnelle et désactivée par défaut : calcul SHA-1
  local, envoi des 5 premiers caractères seulement à Have I Been Pwned avec
  `Add-Padding`, réponse parsée en mémoire et résultats intégrés au tableau de
  bord Sécurité. Sur desktop, la requête passe par la commande Rust
  `hibp_range` (préfixe validé, délai et taille plafonnés) pour conserver la CSP
  de la WebView ; sur le Web, seul l’hôte HIBP est ajouté à `connect-src`.
  Aucun mot de passe, hash complet ou résultat n’est persisté.
- Compatibilité KeePass : import et export KDBX 4 avec mot de passe dédié et
  fichier clé optionnel à l’import. Le fichier exporté contient les éléments
  actifs, sans pièces jointes ni historique Coffre ; l’import passe par le
  provider et les contrôles de doublons habituels.
- Rappels d’échéance : date de révision des mots de passe, expiration des
  cartes et des documents d’identité, vue « Bientôt expirés », badges J-xx et
  notifications locales optionnelles (aucun serveur de notification).
- Kit d’urgence papier : parts Shamir `k` parmi `n` de la clé de récupération,
  encodées en mots EFF et QR codes, avec restauration depuis l’écran de
  récupération. Génération et impression entièrement locales.
- Partage ponctuel hors ligne : fichier `.coffre-share` chiffré par une clé
  aléatoire, clé transmise séparément en mots ou QR code, expiration facultative
  et import avec contrôle de la clé. Aucun serveur.
- Santé avancée : historique local du score (un point par jour, 365 jours) et
  assistant de changement de mot de passe avec ouverture de l’URL standard
  `/.well-known/change-password` du site.
- Internationalisation : socle français/anglais, réglage de langue, dates
  localisées, traduction de l’ensemble des composants de l’application et de
  l’interface de l’extension (`_locales`), et règle de lint `lint:i18n` contre
  les nouvelles chaînes d’interface en dur. Les messages Rust restent à
  traduire.
- Système de design : `src/styles/tokens.css` (typographie, espacement, rayons,
  profondeur, z-index, couleurs sémantiques), thème clair réduit à ses
  variables, échelle de tailles de police avec plancher à 12 px et contrôle
  automatique des valeurs littérales (`bun run lint:design`).
- Détail et édition unifiés : création dans une modale dédiée, puis lecture et
  modification dans le panneau persistant sur desktop, avec menu « … »
  (historique, déplacement entre coffres, duplication, suppression) et barre
  d’actions adaptée au pouce sur mobile.
- Liste et barre d’outils compactes : tri et sélection dans un menu, largeur
  minimale de 320 px, aucun débordement horizontal, pastilles d’alerte
  explicites (« Faible », « Réutilisé », « Sans 2FA ») et bandeau de sécurité
  dans le détail avec génération immédiate d’un nouveau mot de passe.
- Réglages en pages (Général, Sécurité, Sauvegarde et import, Stockage, Zone
  dangereuse) avec navigation latérale et vue compacte ; « Verrouiller
  maintenant » reste dans la barre latérale. L’effacement du coffre local passe
  par « Autres options » sur l’écran de déverrouillage et demande de taper
  `EFFACER`.
- Tableau de bord Sécurité honnête et actionnable : score plafonné à 40/100
  quand la majorité des connexions sont faibles ou réutilisées, explication
  du score, trois compteurs principaux, langage simplifié et ouverture des
  catégories dans la liste filtrée de la vue principale.
- Mobile de première classe : barre supérieure contextuelle avec retour,
  barre d’actions basse, onglets de navigation, menu latéral inerte lorsqu’il
  est fermé, piège à focus, appui long pour la sélection et glissement pour
  revenir.
- Accessibilité : navigation au clavier dans la liste, focus visible sur les
  lignes et cartes, animations neutralisées avec `prefers-reduced-motion`, et
  tests e2e de noms accessibles, de piège à focus, d’inertie du menu et
  d’absence de débordement à 1280, 1024, 768 et 375 px.
- Finitions : textes d’aide longs repliés derrière « En savoir plus » et
  explication d’une phrase pour chaque catégorie secondaire du tableau de bord
  Sécurité.
- Régression visuelle optionnelle : `e2e/visual.spec.ts` capture six écrans
  dans les deux thèmes (`bun run test:visual`).
- Colonnes redimensionnables sur desktop : largeur de la barre latérale et de
  la liste ajustable à la souris, au doigt ou au clavier, mémorisée localement.
- Barre latérale repliable en rail de 64 px avec uniquement les icônes, des
  infobulles et des noms accessibles ; état mémorisé et tiroir complet conservé
  sur mobile.
- Tableau de bord complet : score de santé, statistiques, points d’attention,
  éléments prioritaires, récents, coffres, échéances et actions rapides.
  Affiché par défaut après le déverrouillage, avec l’état du stockage local
  (dernière écriture, synchronisation en attente, sauvegardes tournantes).
  Accessible depuis la barre latérale et l’onglet « Accueil » sur mobile.
- Corrections d’interface : libellé « Retour à … » sur mobile, en-tête de
  détail ramené à une ligne, bandeau d’alerte qui passe sous le texte, libellé
  « Aucun élément » à zéro, trame de fond retirée de l’application et onglets
  bas exclusifs. Points de rupture unifiés (1099 / 768 / 639 px en largeur,
  deux en hauteur).
- Réglages : navigation latérale sticky et contenu défilant indépendamment.
- Correction du défilement résiduel en bas de l’application : le document est
  bloqué quand l’application est montée, les panneaux gèrent leur propre
  défilement et le débordement horizontal de la liste est masqué.
- Icône de marque plate et monochrome, pilotée par les variables du thème :
  carré plein et cadenas en réserve, lisibles en sombre comme en clair. Les
  favicons et icônes PWA/Tauri sont alignés sur ce dessin.

## 0.8.0 — 2026-11-07

- Stockage natif desktop : `app_data_dir()/vault/vault.coffre`, écritures
  atomiques, permissions restrictives, trois sauvegardes tournantes et
  migration automatique depuis IndexedDB.
- Retrait complet du portage expérimental Zig/nanoui et de ses dépendances
  vendorisées.
- Export CSV : format Mots de passe (Apple) pour les connexions et format
  complet Coffre pour tous les éléments, réimportable.
- Chaîne de release macOS : build universel, signature Developer ID,
  notarisation, vérification `spctl`, workflow sur tag et documentation.
- Tableau de bord Sécurité complet : score, répartition, faiblesses,
  réutilisations, variantes proches, ancienneté, 2FA, connexions incomplètes et
  doublons.
- Actions groupées : sélection multiple, favoris et corbeille.
- Thèmes sombre/clair neutres (noir et blanc) et mode système.
- Import 1Password `.1pux`.
- Variante Firefox de l’extension, avec manifeste compatible Chromium.
- Popup d’extension : recherche permanente, générateur de mot de passe local,
  correction des débordements et copie sécurisée.
- Verrouillage à la perte de focus sur desktop et raccourci global de recherche.
- Trousseau natif macOS/Windows/Linux et déverrouillage rapide optionnel.
- Déverrouillage Touch ID sur macOS, avec service de trousseau séparé.
- Interface desktop en colonnes (navigation, liste, détail persistant).
- Filtre « Récents », tri de la liste, sélecteurs habillés.
- Page de connexion compacte sans défilement aux hauteurs usuelles.
- Fenêtre macOS sans barre de titre native (feux de circulation en surcouche).
- Durcissements d’audit : clé de session après déverrouillage rapide, plafond
  KDF, vérification de l’enveloppe de récupération, liens externes Tauri,
  `strict` TypeScript, verrou multi-onglets, single-instance, effacement du
  presse-papiers au verrouillage, tests Rust/CI.

## 0.7.0

- Import Enpass et CSV de gestionnaires courants.
- Corbeille, historique des versions, sauvegardes locales, phrase de récupération.
- Extension Chromium et socle desktop Tauri.

## 0.6.0

- Extension navigateur Manifest V3 et remplissage automatique.

## 0.5.0

- Import Proton Pass et déduplication.
