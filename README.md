# Coffre

**Gestionnaire de mots de passe local-first, chiffré et hors ligne.**

Coffre conserve vos identifiants, notes, cartes et identités dans un fichier
chiffré sur votre appareil. Aucun compte, aucun serveur Coffre, aucune télémétrie.
La synchronisation et la vérification des fuites sont optionnelles ; cette
dernière, désactivée par défaut, n’envoie qu’un préfixe SHA-1 de 5 caractères.
L’interface est en français.

> **État du projet — 0.9.0 (extension enrichie, thème, générateur et remplissage).**
> La version web/PWA est fonctionnelle et couverte par 562 tests unitaires et
> 73 parcours Playwright exécutés sur Chromium et WebKit (146 exécutions, 6 ignorées). Une
> intégration continue vérifie lint, types, tests et build ; les bundles desktop
> sont compilés à la demande. Le
> desktop Tauri v2 compile et se lance sur macOS arm64, avec un déverrouillage
> rapide optionnel par le trousseau du système et une disposition en colonnes
> proche de 1Password ; le mobile n’est pas encore initialisé.
> Voir [Plateformes](#plateformes).

---

## Pourquoi pas un fork de Proton Pass ?

Un audit complet de la version 0.8.0 est disponible dans
[docs/AUDIT-2026-11-07.md](docs/AUDIT-2026-11-07.md) : constats, sévérités,
corrections appliquées et plan de remédiation. L’état de préparation grand
public et les bloquants de distribution sont détaillés dans
[docs/RELEASE-READINESS.md](docs/RELEASE-READINESS.md).

Le point de départ demandé était
[github.com/orgs/protonpass/repositories](https://github.com/orgs/protonpass/repositories).
Après étude des dépôts publics, un fork littéral ne permet pas de répondre à
l’exigence « 100 % local, sans serveur » :

- les clients Proton Pass publics dépendent de l’API et du compte Proton ;
- le backend Proton n’est pas open source ;
- les formats et enveloppes cryptographiques sont liés au service Proton ;
- il n’existe pas de client web autonome et local-first dans ces dépôts.

Coffre est donc un **projet indépendant**, qui reprend les idées d’architecture
et de cryptographie de Proton Pass (modèle d’items, hiérarchie de clés, AAD de
domaine, Argon2id + AES-256-GCM) sans réutiliser son backend ni son code client.
Le détail de cette analyse est dans [docs/PROTON-PASS.md](docs/PROTON-PASS.md).

---

## Fonctionnalités

- **Interface français / anglais** : réglage de langue, dates localisées,
  composants de l’application et interface de l’extension traduits, avec une
  règle de lint qui refuse les nouvelles chaînes d’interface en dur. Les
  messages Rust restent à traduire.
- **Coffres multiples** : création, renommage, suppression, filtre par coffre.
- **Dix types d’éléments** : connexion, note sécurisée, carte bancaire,
  identité, passkey WebAuthn, clé SSH, réseau Wi-Fi, identifiant d’API, licence
  logicielle et document avec pièce jointe principale.
- **Passkeys WebAuthn (ES256)** : création et connexion sans mot de passe dans
  l’extension, confirmation explicite dans une fenêtre Coffre, clé privée
  PKCS#8 conservée dans le contenu chiffré de l’élément, validation stricte du
  RP ID et repli « utiliser un autre appareil ». Le compteur d’assertion reste
  volontairement à zéro, comme pour de nombreux authentificateurs de
  plateforme.
- **Cœur natif pour extensions (S2)** : `coffre-core` expose l’ouverture par clé
  maîtresse (sans Argon2id), la recherche de connexions par service avec la
  même règle de domaines que `loginAllowsHost`, la révélation du seul élément
  demandé (mot de passe et code TOTP), les identités AutoFill sans secret, et
  les assertions/créations de passkeys ES256. La façade UniFFI est commune à
  l’application, aux extensions natives et aux tests croisés TypeScript ↔ Rust.
- **Champs personnalisés** : texte, texte masqué, adresse web et texte long,
  jusqu’à 30 champs par élément.
- **Pièces jointes chiffrées** : ajout, téléchargement et suppression de
  fichiers, avec chiffrement séparé par la clé de l’élément.
- **Import** : exports JSON non chiffrés de Bitwarden, Proton Pass, Enpass et
  Dashlane, archives 1Password `.1pux`, exports XML KeePass 2.x, documents CXF
  1.0 (mots de passe et passkeys), et CSV de Bitwarden, 1Password, LastPass,
  Chrome/Edge/Brave, Firefox, Safari, Dashlane (avec ou sans en-tête),
  KeePass/KeePassXC, NordPass, Keeper, RoboForm, SafeInCloud et Enpass, avec
  détection des colonnes, aperçu, rapport des colonnes ignorées et
  déduplication avant import.
- **Export CXF 1.0** : document JSON de portabilité FIDO pour les connexions,
  notes, cartes, identités et passkeys, avec avertissement explicite sur les
  secrets en clair.
- **Extension navigateur** (Manifest V3, Chromium et Firefox) : remplissage
  automatique des connexions, codes TOTP, **cartes bancaires** et **identités /
  adresses** depuis l’onglet Coffre déverrouillé, ou directement depuis
  l’application desktop grâce au **pont natif** appairé et chiffré (ECDH P-256,
  HKDF, AES-256-GCM). Menu dans les champs (iframe d’extension, détection
  locale), iframes, connexions en plusieurs étapes, proposition d’enregistrer
  ou de mettre à jour après soumission, et **passkeys WebAuthn** (création et
  connexion) avec confirmation dans une fenêtre d’extension. Le CVC et le PIN
  ne sont remplis qu’après une action explicite ; une carte est refusée hors
  HTTPS et dans une iframe tierce qui n’est pas un prestataire de paiement
  connu. Les pages sont autorisées explicitement via les permissions
  optionnelles. L’extension ne stocke aucun identifiant et ne copie rien dans le
  presse-papiers ; seule la clé de session du pont natif est conservée dans son
  stockage local.
- **Disponibilité de la 2FA et des passkeys** : le tableau de bord ne signale
  « Sans 2FA » que pour les sites dont une méthode est connue (2FA Directory,
  MIT) et propose les connexions qui peuvent utiliser une passkey (Passkeys
  Directory, CC BY 4.0). Une catégorie « Site sans HTTPS » repère les URL
  `http://`. La fiche d’une connexion affiche les méthodes possibles (TOTP, SMS,
  clé matérielle, etc.), la documentation du site et l’action « Créer une
  passkey ». Les jeux de données sont embarqués, datés et chargés dans un chunk
  séparé ; ils ne sont pas inclus dans l’extension et aucune requête réseau
  n’est effectuée. [Capture de la fiche](docs/screenshots/site-security.png).
- **Recherche** insensible aux accents, filtres par type et favoris, étiquettes ;
  elle inclut les champs personnalisés et les noms de pièces jointes.
- **Tri de la liste** : utilisation récente, nom, date de création, date de
  modification ou type. Les filtres (récents, favoris, types, corbeille) restent
  dans la barre latérale pour éviter les doublons.
- **Actions groupées** : sélection multiple, ajout/retrait des favoris et mise
  à la corbeille en une seule opération.
- **Générateur** de mots de passe et de phrases de passe (liste EFF de
  7 776 mots), avec réglages et estimation d’entropie.
- **TOTP** (RFC 6238) : import d’une URI `otpauth://`, codes SHA-1/256/512,
  compte à rebours.
- **Copie temporaire** : effacement du presse-papiers après un délai et au
  verrouillage, si son contenu n’a pas changé.
- **Verrouillage automatique** après inactivité, verrouillage immédiat lorsque
  l’onglet passe en arrière-plan (option active par défaut), verrouillage à la
  perte de focus sur desktop (option) et verrouillage manuel.
- **Intégration au système (desktop)** : verrouillage immédiat lorsque la
  session du système se verrouille ou que la machine se met en veille (deux
  options actives par défaut), icône de barre de menus avec ouverture,
  recherche rapide, générateur et verrouillage, démarrage à l’ouverture de
  session (désactivé par défaut, coffre verrouillé et masqué), et conservation
  optionnelle de l’application dans la barre de menus à la fermeture de la
  fenêtre. Le menu ne contient aucun nom de coffre, d’élément ou d’utilisateur.
- **Corbeille** : suppression réversible, restauration, suppression définitive
  et purge automatique configurable.
- **Historique des versions** : chaque modification réelle conserve le contenu
  précédent, consultable et restaurable depuis la fiche de l’élément.
- **Stockage durable** : fichier natif atomique et trois sauvegardes tournantes
  dans l’application desktop ; sur le Web, IndexedDB avec stockage persistant
  demandé au navigateur, statut et espace utilisé affichés dans les réglages.
- **Synchronisation par dossier** (optionnelle) : sur desktop et dans Chromium,
  un fichier chiffré par appareil dans un dossier déjà synchronisé (iCloud
  Drive, Dropbox, Syncthing, clé USB), fusion par horloges et pierres tombales,
  vérification du MAC distant, changement d’époque de clés géré et conflits
  archivés dans l’historique. Sur Web, le handle de dossier est conservé dans
  IndexedDB ; Safari/Firefox gardent l’export/import manuel.
- **Synchronisation locale directe** (desktop) : appairage par code/QR,
  transport TCP chiffré par Noise XX, réception à la demande et fusion avec les
  mêmes règles que la synchronisation par dossier. Aucun serveur, aucune
  connexion Internet ; le port d’écoute n’est ouvert que pendant une réception.
- **Modèles intégrés et personnalisés** : un modèle complet pour chacun des
  dix types d’éléments (connexion, note, carte, identité, passkey, clé SSH,
  Wi-Fi, identifiant d’API, licence logicielle, document), avec tous leurs
  champs ; les modèles personnalisés choisissent leur type et restent chiffrés
  dans le coffre avec une clé et une AAD dédiées.
- **Icônes de service locales** : les éléments affichent le glyphe du service
  détecté depuis leur URL, leur RP ID, leur endpoint ou leur site (GitHub,
  Google, Apple, Amazon, cartes bancaires, etc.), ou un monogramme pour les
  domaines inconnus. Aucune requête réseau.
- **Coffre de fichiers chiffrés en flux** : blobs hors du fichier `.coffre`,
  chiffrés par blocs de 64 Kio avec AES-256-GCM et construction STREAM,
  détection de troncature, réordonnancement et substitution. Le noyau Rust et
  le client Tauri sont en place ; le rattachement à l’interface et
  l’enveloppe des clés par élément restent à faire.
- **Alias e-mail hors ligne** : générateur d’adresses « plus »
  (`prenom+site@domaine`) ou catch-all sur un domaine personnel, enregistré dans
  l’élément, sans aucun appel réseau.
- **Saisie automatique desktop** : depuis une connexion, masque Coffre, attend
  que la fenêtre cible soit active puis tape une séquence compatible KeePass
  (`{USERNAME}`, `{PASSWORD}`, `{TOTP}`, `{TAB}`, `{ENTER}`, `{DELAY n}`). Le
  focus est vérifié avant chaque jeton et la saisie s’arrête s’il change.
- **Journal d’activité chiffré** : déverrouillages, exports, changements de mot
  de passe, appairages, partages et remplissages par l’extension, stockés
  événement par événement dans le coffre et exportables en JSON.
- **Mode voyage** (desktop) : seuls les coffres marqués « sûrs pour le voyage »
  restent dans le fichier local ; les autres en sont retirés, y compris des
  sauvegardes locales, sans pierre tombale de synchronisation. La désactivation
  exige le mot de passe maître et restaure les coffres depuis la synchronisation
  par dossier.
- **Vérification d’intégrité** à la demande : déchiffre chaque coffre, élément,
  version, pièce jointe et enveloppe de récupération pour détecter une
  altération locale.
- **MAC global et anti-retour en arrière (format 4)** : un HMAC-SHA-256 couvre
  chaque enregistrement et les pierres tombales ; un fichier altéré s’ouvre en
  lecture seule et une révision plus ancienne que celle déjà vue déclenche un
  avertissement.
- **Tableau de bord Sécurité** : score et répartition des mots de passe,
  faiblesses, réutilisations, variantes proches, ancienneté, absence de 2FA,
  connexions incomplètes et sites en doublon, avec accès direct aux éléments à
  corriger. L’évolution du score est conservée localement, un point par jour.
- **Surveillance des fuites (optionnelle)** : désactivée par défaut, elle
  calcule le SHA-1 localement et n’envoie que ses 5 premiers caractères à
  Have I Been Pwned avec `Add-Padding`. Le mot de passe et le hash complet ne
  quittent jamais l’appareil ; aucun résultat n’est persisté. Sur desktop, la
  requête passe par une commande Rust pour garder la CSP de la WebView fermée.
- **Assistant de changement de mot de passe** : depuis la fiche d’une
  connexion signalée, ouverture de l’URL standard
  `/.well-known/change-password` du site et génération d’un nouveau mot de
  passe. L’ancien reste dans l’historique de l’élément.
- **Rappels d’échéance** : date de révision d’un mot de passe, expiration des
  cartes et des documents d’identité, vue « Bientôt expirés », badges J-xx et
  notifications locales optionnelles, sans serveur de notification.
- **Changement de mot de passe maître** sans réchiffrer tous les éléments.
- **Phrase de récupération optionnelle** : dix mots générés localement,
  enveloppe séparée des clés de coffre, déverrouillage d’urgence avec choix
  d’un nouveau mot de passe maître.
- **Kit d’urgence papier (Shamir)** : parts imprimables de la clé de
  récupération, avec QR codes et mots EFF. `k` parts sur `n` suffisent pour
  rouvrir le coffre ; une part seule ne révèle rien. Génération et impression
  entièrement locales.
- **Partage ponctuel hors ligne** : fichier `.coffre-share` chiffré avec une
  clé aléatoire, transmise séparément en mots ou en QR code. Expiration
  facultative, import avec aperçu, aucun serveur.
- **Sauvegarde** : export/import d’un fichier `.coffre` chiffré et trois
  générations de copie locale de secours, restaurables depuis l’écran de
  récupération. Export CSV en clair au format **Mots de passe (Apple)** pour les
  connexions, ou au format **Coffre complet** pour tous les types d’éléments.
- **Partage de coffres (L10)** : identité depuis les réglages, paquets signés
  avec la clé du coffre enveloppée pour chaque membre, import d’un coffre
  partagé avec paquet complet des éléments chiffrés. Les rôles sont vérifiés et
  les mutations sont bloquées en lecture seule dans l’application ; un client
  modifié resterait toutefois capable d’écrire avec la clé partagée. La
  révocation d’un membre tourne la clé du coffre, re-enveloppe les clés
  d’éléments et génère un nouveau paquet pour les membres restants. Un dossier
  commun permet la synchronisation des bundles signés (toutes les 60 secondes
  ou à la demande) ; l’échange manuel `.coffre-shared.json` reste disponible.
  L’accès d’urgence enveloppe la clé maîtresse pour un contact ou la partage en
  Shamir 2/3 ; sans serveur, aucun délai imposé n’est possible.
- **Règles de mot de passe par site** : le générateur applique les contraintes
  de longueur, classes et symboles du dataset Apple « Password Manager
  Resources », embarqué localement et sans requête réseau.
- **Compatibilité KeePass** : import et export KDBX 4 avec un mot de passe
  dédié (et fichier clé à l’import), sans pièces jointes ni historique Coffre.
- **Déverrouillage FIDO2/PRF** : une clé de sécurité compatible PRF peut
  envelopper la clé maîtresse dans le fichier. Le mot de passe maître reste le
  secret racine ; l’enveloppe est révocable, liée au fichier et supprimée lors
  d’un changement de mot de passe ou d’une récupération.
- **Déverrouillage biométrique desktop** : Touch ID sur macOS et Windows Hello
  sur Windows. La clé maîtresse est rangée dans un service de trousseau séparé
  et n’est libérée qu’après une authentification réussie ; sous Windows, le
  consentement Windows Hello est vérifié avant chaque lecture de l’entrée
  Credential Manager protégée par DPAPI.
- **PWA installable** : fonctionnement hors ligne, icônes, service worker.
- **Interface desktop en colonnes** : barre latérale, liste compacte et panneau
  de détail persistant. La création passe par une modale ; la lecture et
  l’édition restent dans le panneau, avec menu d’actions secondaires,
  déplacement entre coffres, duplication et navigation clavier.
- **Tableau de bord** : page d’accueil par défaut après le déverrouillage, avec
  score de santé, statistiques, points d’attention, éléments prioritaires,
  récents, coffres, échéances et état du stockage local (dernière écriture,
  synchronisation en attente, sauvegardes tournantes).
- **Liste groupée par date** : sections « Aujourd’hui », « Hier », « 7 derniers
  jours », « Ce mois-ci » puis par mois, avec en-têtes sticky et tri appliqué à
  l’intérieur de chaque groupe. L’option « Grouper par date » permet de revenir
  à une liste plate.
- **Design system** : jetons centralisés (`src/styles/tokens.css`), thème clair
  par variables, échelle typographique avec plancher à 12 px, rayons,
  espacements et profondeur cohérents. Réglages en pages (Général, Sécurité,
  Sauvegarde et import, Stockage, Zone dangereuse).
- **Accès rapide global (desktop)** : `⌘⇧Espace` (macOS) ou
  `Ctrl+Shift+Espace` affiche la fenêtre et place le curseur dans la recherche.
- **Trousseau natif (desktop)** : déverrouillage rapide optionnel par le
  trousseau macOS, Windows ou Linux. La clé maîtresse n’y est écrite que si
  l’option est activée et elle est supprimée au verrouillage.
- **Touch ID (desktop macOS)** : déverrouillage par empreinte. La clé est rangée
  dans un trousseau biométrique séparé et n’est libérée qu’après une
  authentification réussie ; `keychain_load` ne peut pas la lire.
- **Dérivation Argon2id dans un Web Worker** et index de recherche pré-calculé ;
  la liste est paginée pour les très gros coffres.
- **Une seule session à la fois** : instance desktop unique et verrou Web Locks
  entre onglets ; les liens externes Tauri s’ouvrent dans le navigateur système.
- **Thèmes neutres sombre/clair** (noir et blanc) et **mode système**, interface responsive, sélecteurs natifs
  habillés, accessibilité clavier et modales avec piège à focus.

### Corbeille et historique

La suppression d’un élément le déplace d’abord dans la corbeille : son contenu
reste chiffré et peut être restauré à tout moment. La date de mise à la corbeille
est stockée **dans le contenu chiffré**, pas dans les métadonnées visibles du
fichier. La purge automatique s’exécute à l’ouverture du coffre, après un import
ou une restauration de sauvegarde ; le délai est réglable (7, 30, 90, 365 jours,
ou jamais).

Chaque modification réelle d’un élément archive son contenu précédent, chiffré
avec la clé de l’élément et une AAD dédiée à la version. L’historique est
consultable depuis la fiche (« Historique ») et une version peut être restaurée ;
le contenu courant est alors archivé à son tour, ce qui rend l’opération
réversible. Les passages en corbeille, les changements de favori et les
ajouts/suppressions de pièces jointes ne créent pas de version.

| Limite | Valeur |
| --- | --- |
| Versions par élément | 20 |
| Versions dans tout le coffre | 2 000 |
| Rétention de la corbeille | 30 jours par défaut, 0 = jamais |

### Sauvegardes locales

Chaque enregistrement du coffre conserve les **trois dernières versions** du
fichier chiffré. Dans l’application desktop, le fichier courant et ses
sauvegardes (`vault.coffre`, `vault.coffre.bak1` à `bak3`) vivent dans le
dossier de données de l’application, avec des permissions réservées au compte.
Sur le Web, ils sont stockés dans IndexedDB (`backup`, `backup:2`, `backup:3`).
Si le fichier courant ne peut plus être lu ou déchiffré, l’écran d’erreur
propose de choisir une génération et de la restaurer avec le mot de passe maître
correspondant. Seuls des compteurs et des dates sont affichés : le contenu reste
chiffré et aucune clé n’est conservée en clair.

Ces copies vivent sur le même appareil : elles protègent d’une corruption
logique, **pas** d’une perte de l’appareil, d’un disque défaillant, d’une
éviction du stockage ni d’un profil effacé. Exportez régulièrement un fichier
`.coffre` vers un support distinct.

### Phrase de récupération

La récupération est **optionnelle et désactivée par défaut**. Depuis les
réglages, Coffre peut générer une phrase de dix mots de la liste EFF (environ
129 bits d’entropie). Elle n’est affichée qu’une fois et n’est jamais stockée.

Le fichier `.coffre` contient alors une enveloppe chiffrée :

- la phrase dérive une clé par Argon2id, qui scelle une clé de récupération
  aléatoire ;
- cette clé de récupération scelle chaque clé de coffre ;
- une copie de la clé de récupération, scellée par la clé maîtresse, permet de
  maintenir l’enveloppe (ajout d’un coffre, changement de mot de passe) sans
  redemander la phrase.

En cas d’oubli du mot de passe maître, « Déverrouiller avec une phrase de
récupération » ouvre le coffre et impose un nouveau mot de passe. L’ancien mot
de passe cesse alors de fonctionner ; la phrase reste valable. Supprimer ou
remplacer la phrase depuis les réglages invalide immédiatement l’ancienne.

Une phrase perdue ne peut pas être retrouvée, et une phrase compromise donne
accès à tout coffre dont le fichier est obtenu : conservez-la sur papier,
séparément de vos exports.

### Kit d’urgence et parts Shamir

Depuis les réglages, « Créer le kit d’urgence » produit un document imprimable
(ou exportable en PDF via l’impression du navigateur) contenant :

- l’identifiant du coffre, la date de génération et les instructions ;
- un champ manuscrit pour le mot de passe maître et l’emplacement des
  sauvegardes ;
- `n` parts de la clé de récupération, chacune avec un QR code et ses mots EFF,
  à confier à des personnes différentes.

Le découpage utilise Shamir sur GF(256) : `k` parts sur `n` reconstituent la clé
de récupération, `k - 1` n’en révèlent rien. Les parts ne remplacent pas le mot
de passe maître : elles permettent de rouvrir le coffre en imposant un nouveau
mot de passe. Elles ne remplacent pas non plus une sauvegarde du fichier
`.coffre`. Toute la génération, l’encodage en mots et les QR codes sont locaux ;
aucune part n’est écrite sur le disque ni envoyée sur le réseau.

### Partage ponctuel hors ligne

Depuis la fiche d’un élément, « Partager hors ligne » produit un fichier
`.coffre-share` et une clé aléatoire de 32 octets. Le fichier contient
l’élément chiffré en AES-256-GCM ; la clé est affichée en mots EFF et en QR
code, à transmettre par un autre canal (de vive voix, second QR, message
distinct). Le fichier seul ne permet pas de lire l’élément, et la clé seule ne
suffit pas.

Une expiration facultative (1, 7 ou 30 jours) est inscrite dans le fichier ;
l’application Coffre refuse un partage expiré. Cette date ne peut pas être
imposée hors ligne : un tiers qui modifie le fichier peut la contourner. Les
pièces jointes ne sont pas incluses. Le destinataire importe le partage depuis
Réglages → « Sauvegarde et import » → « Importer un partage hors ligne », avec
la clé séparée. Aucun serveur n’est contacté.

### Champs personnalisés et pièces jointes

Les champs personnalisés sont stockés dans le contenu chiffré de l’élément. Un
champ peut être affiché en clair, masqué comme un secret, rendu comme un lien
ou présenté comme un texte long. Ils sont inclus dans la recherche.

Les pièces jointes sont chiffrées séparément avec la clé de leur élément et une
AAD dédiée. Leurs métadonnées (nom, type MIME, taille, date) sont conservées
dans le contenu chiffré de l’élément. Limites actuelles :

| Limite | Valeur |
| --- | --- |
| Taille d’un fichier | 5 Mo |
| Pièces jointes par élément | 10 |
| Total par élément | 25 Mo |
| Total par coffre | 50 Mo |

### Santé et changement de mot de passe

Le tableau de bord Sécurité conserve un **historique local du score** : une
mesure par jour, avec le score et les compteurs de faiblesses, réutilisations,
absence de 2FA et éléments affectés. Seuls des nombres et des dates sont
stockés dans `localStorage` (`coffre:security-history:v1`) ; aucun mot de
passe, aucune URL et aucun identifiant n’y figure. L’historique est plafonné à
365 jours.

Pour une connexion signalée, la fiche propose **« Changer sur le site »** :
Coffre ouvre l’URL standard `https://<hôte>/.well-known/change-password`
(RFC proposée par le W3C) dans le navigateur système. Le bouton **« Générer »**
ouvre le générateur ; après le changement sur le site, la modification de
l’élément archive automatiquement l’ancien mot de passe dans l’historique.

### Rappels d’échéance

Chaque élément peut porter une date de révision ou d’échéance, stockée dans son
contenu chiffré. Les cartes utilisent leur date d’expiration `MM/AA`, valable
jusqu’au dernier jour du mois, et les identités peuvent enregistrer séparément
l’expiration du passeport, de la carte d’identité et du permis de conduire.

La vue **Bientôt expirés** rassemble les échéances passées ou situées dans les
soixante jours. Un badge `J-xx` apparaît dans la liste et dans la fiche. Le
réglage **Rappels d’échéance** affiche en plus une notification locale, au plus
une fois par échéance et par jour, à l’ouverture de l’application et toutes les
heures tant qu’elle reste ouverte. Le navigateur ou le système peut refuser
l’autorisation ; aucun serveur de notification n’est contacté et aucune date ne
quitte l’appareil.

### Formats d’import

L’import lit un fichier local et le convertit en éléments Coffre, puis les
chiffre avec le coffre de destination. Le fichier source n’est ni conservé ni
envoyé sur le réseau.

| Source | Format | Remarques |
| --- | --- | --- |
| Bitwarden | JSON non chiffré | Types connexion, note, carte et identité ; dossiers convertis en étiquettes ; champs personnalisés conservés |
| Proton Pass | JSON non chiffré | Types connexion, note, carte et identité ; alias convertis en connexions ; clés SSH, Wi-Fi et éléments personnalisés convertis en notes ; coffres convertis en étiquettes ; champs supplémentaires conservés |
| Enpass | JSON non chiffré | Types connexion, note, carte et identité ; dossiers (y compris imbriqués) convertis en étiquettes ; champs personnalisés et sensibles conservés ; TOTP base32 converti en URI `otpauth://` |
| Bitwarden | CSV | Colonnes `folder`, `favorite`, `type`, `name`, `notes`, `login_uri`, `login_username`, `login_password`, `login_totp` |
| 1Password | CSV | `Title`, `Url`, `Username`, `Password`, `OTPAuth`, `Favorite`, `Archived`, `Tags`, `Notes` |
| LastPass | CSV | `url`, `username`, `password`, `extra`, `name`, `grouping`, `fav` |
| Chrome / Edge / Brave | CSV | `name`, `url`, `username`, `password`, `note` ; titre déduit du domaine s’il manque |
| Firefox | CSV | `url`, `username`, `password`, `httpRealm`, `formActionOrigin`, `guid`, `timeCreated`, `timeLastUsed`, `timePasswordChanged` |
| Safari | CSV | `Title`, `URL`, `Username`, `Password`, `Notes`, `OTPAuth` |
| Dashlane | CSV | `username`, `username2`, `username3`, `title`, `password`, `note`, `url`, `category`, `otpSecret` ; les exports sans ligne d’en-tête à cinq colonnes sont aussi reconnus |
| Dashlane | JSON non chiffré | Liste `AUTHENTIFIANT` ; identifiant secondaire conservé en champ personnalisé |
| KeePass / KeePassXC | CSV | `Account`, `Login Name`, `Password`, `Web Site`, `Comments` ou `Group`, `Title`, `Username`, `Password`, `URL`, `Notes`, `TOTP` |
| KeePass / KeePassXC | XML non chiffré | Export XML KeePass 2.x, groupes convertis en étiquettes, champs protégés signalés |
| NordPass | CSV | `name`, `url`, `username`, `password`, `note`, `cardholdername`, `cardnumber`, `cvc`, `expirydate`, `folder`, `type` |
| Keeper | CSV | `Folder`, `Title`, `Login`, `Password`, `Website`, `Notes` ; les exports sans en-tête à sept colonnes sont aussi reconnus |
| RoboForm | CSV | `name`, `url`, `username`, `password`, `note` |
| SafeInCloud | CSV | `Title`, `Login`, `Password`, `URL`, `Notes` |
| Enpass | CSV | `Title`, `Username`, `Password`, `URL`, `Notes`, `Folder` |
| 1Password 1PUX | ZIP + JSON | `export.data`, connexions, cartes, notes, identités et champs personnalisés |
| CXF 1.0 | JSON | Connexions, notes, cartes, identités et **passkeys** ; la clé publique COSE est recalculée localement |

Les colonnes inconnues deviennent des champs personnalisés ; les colonnes de
métadonnées non utilisées sont listées dans le rapport d’import. Avant l’import,
Coffre compare les éléments au contenu actuel du coffre (même type et mêmes
informations d’identification : nom d’utilisateur et site pour une connexion,
quatre derniers chiffres pour une carte, adresse e-mail pour une identité,
contenu pour une note) et propose d’ignorer les doublons. L’archive `.1pux`
non chiffrée de 1Password est lue directement (pièces jointes exclues). Les
exports chiffrés (Bitwarden chiffré, Proton Pass chiffré, sauvegarde
`.enpassbackup`) ne sont pas pris en charge : exportez d’abord en clair, puis
supprimez le fichier intermédiaire. Un fichier `.coffre` doit passer par
« Importer un coffre » avec son mot de passe. Les passkeys sont importées
depuis CXF 1.0 ; les passkeys KeePassXC ne sont pas encore converties.

---

### Compatibilité KeePass KDBX 4

Coffre lit et écrit les bases **KDBX 4** de KeePassXC et KeePass 2.x :

- KDF **Argon2d**, **Argon2id** et **AES-KDF** ;
- chiffrement **AES-256-CBC** et **ChaCha20** ;
- compression gzip, blocs HMAC-SHA-256 et vérification de l’en-tête ;
- groupes convertis en étiquettes, champs standard et personnalisés, champs
  protégés, TOTP (`otp`), fichiers de clé XML v1/v2, binaires et hexadécimaux.

L’export produit une base KDBX 4 avec Argon2id et ChaCha20, lisible par
KeePassXC. Les pièces jointes et l’historique KDBX sont signalés à l’import mais
ne sont pas encore convertis ; les passkeys KeePassXC ne sont pas importées.

### Portabilité CXF 1.0

Coffre importe et exporte le **Credential Exchange Format 1.0** de la FIDO
Alliance sous forme de document JSON (`coffre.cxf.json`) :

- connexions (`basic-auth`, `totp`), notes, cartes, identités (`address`,
  `person-name`) et passkeys ;
- les passkeys sont converties dans les deux sens ; la clé publique COSE est
  recalculée localement depuis la clé privée PKCS#8 à l’import ;
- les passkeys dont le compteur de signature n’est pas nul sont exclues de
  l’export, conformément à la spécification ;
- les pièces jointes et l’historique ne sont pas inclus.

Le document CXF **n’est pas chiffré** : il contient les mots de passe et les
clés privées des passkeys en clair. L’interface demande une confirmation
explicite avant l’export ; le fichier doit être transféré uniquement vers un
gestionnaire de confiance, puis supprimé. Le chiffrement du transport CXP n’est
pas implémenté.

### Modèles d’éléments

Dans **Réglages → Modèles**, les **modèles intégrés** couvrent tous les types
d’éléments du coffre et affichent la liste complète de leurs champs. Un bouton
crée directement un élément de ce type.

Vous pouvez aussi créer un modèle personnalisé avec un nom, une icône, un type
d’élément et jusqu’à 30 champs. Chaque champ peut être un texte, un secret, une
URL, une date ou un texte long, et peut être marqué comme remplissable.

Les modèles intégrés sont des raccourcis statiques : ils ne sont pas stockés
dans le fichier. Les modèles personnalisés, eux, sont chiffrés dans une section
du fichier `.coffre` avec une clé aléatoire par modèle et une AAD propre. Ils
sont donc synchronisés et exportés avec le coffre, sans apparaître en clair. La
clé de récupération et le changement de mot de passe ré-enveloppent aussi ces
clés. Le bouton « Créer un élément » d’un modèle crée un élément de son type,
avec ses champs structurés et ses champs personnalisés, et conserve la référence
`templateId`. Les champs marqués `fillable` sont proposés dans l’onglet
**Modèles** du menu de l’extension et remplis par rapprochement de libellé.

### Coffre de fichiers chiffrés en flux

Les documents volumineux sont stockés hors du fichier `.coffre`, dans
`vault/blobs/<id>`. Chaque blob est chiffré par blocs de 64 Kio avec
AES-256-GCM ; le nonce STREAM combine un préfixe aléatoire, un compteur et un
drapeau de dernier bloc authentifié. La troncature, le réordonnancement et la
substitution de blocs sont détectés avant toute écriture en clair.

Dans la fiche d’un élément, le bouton **Document volumineux** choisit un
fichier local, le chiffre en blob et ajoute une pièce jointe dont la clé est
stockée dans le contenu chiffré de l’élément. Le téléchargement déchiffre vers
un emplacement choisi par l’utilisateur ; la suppression retire aussi le blob.
Les images et PDF peuvent être prévisualisés en mémoire depuis la fiche. La
synchronisation par dossier copie les blobs référencés dans
`Coffre/<idFichier>/blobs/` et importe ceux qui manquent. Les réglages de
stockage affichent le nombre et la taille des blobs et permettent de supprimer
les blobs orphelins. Les tests couvrent troncature, substitution et
réordonnancement ; un test manuel de 1 Gio est disponible avec
`cargo test -p coffre --lib blob_store::tests::fichier_1_gio -- --ignored`. La
synchronisation locale F2 échange aussi les blobs manquants après le fichier
`.coffre`, par blocs de 256 Kio et avec vérification des identifiants. Un test
Rust en boucle locale vérifie le transfert entre deux dossiers de blobs.

### Alias e-mail

Depuis une connexion, le bouton **Alias e-mail** génère localement une adresse
« plus » (`prenom+site@domaine`) ou catch-all (`site@domaine`) à partir d’une
adresse de base et d’une étiquette de site. L’adresse est enregistrée dans
l’élément (`emailAlias`) et devient l’identifiant si celui-ci est vide. Les
préférences d’adresse de base et de mode sont mémorisées localement.

Le générateur est entièrement hors ligne. Une intégration **opt-in**
SimpleLogin/addy.io permet aussi de demander un alias au service choisi : la
requête part uniquement après saisie d’une clé API et clic explicite. La clé
peut être enregistrée chiffrée dans le coffre (`aliasKeys`, une clé par
service) et réutilisée. Le menu de l’extension propose aussi **Créer un alias
e-mail** et copie l’adresse générée, sans requête réseau.

### Saisie automatique desktop

Depuis une connexion, le bouton **Saisie automatique** lance un compte à
rebours de trois secondes. Coffre masque alors sa fenêtre ; activez
l’application cible. La séquence par défaut est
`{USERNAME}{TAB}{PASSWORD}{ENTER}`. Les jetons `{TOTP}`, `{TAB}`, `{ENTER}`,
`{SPACE}`, `{BACKSPACE}`, `{ESC}`, `{DELAY n}` et `{{` / `}}` sont pris en
charge.

Rust vérifie la fenêtre active avant chaque jeton et annule la saisie si le
focus change. Sur macOS, l’autorisation **Accessibilité** est requise et
expliquée par le message d’erreur. Le raccourci global **Cmd+Shift+A** (Ctrl+Shift+A sur Windows/Linux) capture la
fenêtre active avant d’ouvrir Coffre, propose les connexions dont le titre ou
l’URL correspond, puis lance la saisie après masquage. La séquence est stockée
dans le champ optionnel `autotypeSequence` de l’élément, mais l’éditeur de champ
dédié n’est pas encore exposé. Les validations Windows/Linux restent à faire.

### Journal d’activité

Dans **Réglages → Journal d’activité**, consultez les événements sensibles
conservés dans le coffre : déverrouillages, exports, changements de mot de
passe, appairages, partages et remplissages par l’extension. Chaque événement
est chiffré séparément avec la clé maîtresse et une AAD propre, puis fusionné
entre appareils par identifiant. Le journal est plafonné à 5 000 événements et
peut être exporté en JSON.

Limites : les échecs de déverrouillage ne peuvent pas être chiffrés tant que le
coffre est verrouillé et ne sont donc pas enregistrés ; une récupération par
phrase ou parts réinitialise le journal, car les anciens événements sont scellés
par l’ancienne clé maîtresse.

### Mode voyage

Dans **Réglages → Synchronisation → Mode voyage**, cochez les coffres à
conserver sur l’appareil, puis saisissez le mot de passe maître. Les autres
coffres sont retirés du fichier local et des trois sauvegardes, sans créer de
pierre tombale : les autres appareils ne voient pas de suppression.

La désactivation vérifie le mot de passe maître et lit les fichiers d’une
synchronisation par dossier déjà configurée. Elle fusionne les coffres
manquants, réécrit le fichier local et efface l’état de voyage. Si l’autre
appareil a changé de mot de passe, un second champ permet de saisir le mot de
passe de la nouvelle époque.

Cette protection vise l’inspection de l’appareil, **pas une contrainte exercée
sur la personne** : un adversaire qui peut forcer le déverrouillage ou exiger le
mot de passe n’est pas arrêté par le mode voyage. Une source de synchronisation
ou une sauvegarde contenant les coffres masqués est indispensable avant de
désactiver le mode.

### Synchronisation locale directe

Sur desktop, deux appareils du même réseau Wi-Fi peuvent s’appairer sans
dossier partagé ni service cloud :

1. dans **Réglages → Synchronisation → Synchronisation locale**, créer un code
   d’appairage sur le premier appareil ;
2. scanner le QR code ou coller le code `coffre-lan://pair/…` sur le second ;
3. lancer **Recevoir une synchronisation** sur un appareil, puis
   **Synchroniser** sur l’autre.

Le transport utilise Noise `XX_25519_ChaChaPoly_BLAKE2s` ; les clés statiques
des appareils sont conservées localement et un appareil non appairé est refusé
avant tout échange de fichier. Le port TCP `47823` n’est ouvert que pendant la
fenêtre de réception (deux minutes). Pendant cette fenêtre, l’appareil
s’annonce en mDNS sous `_coffre._tcp.local.` ; le bouton **Découvrir les
appareils** liste les pairs connus et permet de mettre à jour leur adresse si
elle a changé. Les applications mobiles et le scan caméra restent à faire.

## Démarrage rapide

Prérequis : [Bun](https://bun.sh/) ≥ 1.4 (recommandé) ou Node.js ≥ 22.12.

```bash
bun install
bun run dev
```

Ouvrir <http://localhost:1420>.

Au premier lancement, choisissez un mot de passe maître d’au moins 12
caractères. **Aucune récupération n’est configurée par défaut** : sans ce mot de
passe, les données sont inaccessibles. Vous pouvez ensuite générer une phrase de
récupération dans les réglages, et exporter régulièrement un fichier `.coffre`.

### Production

```bash
bun run build
bun run preview
```

Le build est généré dans `dist/`. Il peut être servi par n’importe quel
hébergement statique. Les fichiers `public/_headers` et `public/_redirects`
fournissent une CSP stricte, les en-têtes de sécurité et le repli monopage pour
Netlify et Cloudflare Pages ; ils sont copiés dans `dist/` au build. Pour les
autres hébergeurs, reprenez les en-têtes décrits dans
[docs/SECURITY.md](docs/SECURITY.md#7-déploiement-web).

### Tests de bout en bout

```bash
bun run test:e2e:install   # une seule fois : installe Chromium et WebKit
bun run test:e2e
```

Les parcours Playwright couvrent la création du coffre, un élément avec champ
personnalisé et pièce jointe, la vérification d’intégrité, le verrouillage
manuel, le verrouillage à la perte de visibilité (option active et inactive),
un import CSV, un cycle export/réimport, la corbeille (restauration et vidage),
la restauration d’une version depuis l’historique, les rappels d’échéance, la
configuration d’une phrase de récupération, la génération d’un kit d’urgence puis
la récupération avec trois parts sur cinq, un partage hors ligne exporté puis
réimporté avec sa clé, les modèles intégrés et personnalisés, les icônes de
service, un scénario de sécurité (aucune requête tierce hors HIBP simulée,
aucune adresse dangereuse rendue cliquable) et une vérification de fuites en
k-anonymat avec interception réseau. Ils tournent sur Chromium et WebKit ; ce
dernier sert de proxy pour le moteur des WebViews macOS/iOS.

### Intégration continue

Le fichier `.github/workflows/ci.yml` est réglé pour tenir dans le quota
mensuel gratuit de GitHub Actions, sans dépassement payant. Sur chaque PR et
chaque push sur `main`, il ne lance que des jobs Linux :

- **Qualité** : `bun audit --audit-level=high`, lint, vérification
  TypeScript, tests Vitest, builds PWA et extension, avec l’artefact `dist`
  conservé une semaine ;
- **Parcours** : Playwright sur Chromium, traces et rapport téléversés en cas
  d’échec ;
- **Rust** : `cargo fmt`, `clippy`, tests de l’application, du cœur, du FFI, du
  CLI et de l’agent SSH, smoke du relais natif et `cargo audit` ;
- **Extension** : smoke test Chromium avec la CSP de production.

Un lancement manuel (onglet *Actions* → *CI* → *Run workflow*) ajoute les jobs
coûteux : Playwright sur WebKit, `coffre-core` sur macOS et Windows, et les
bundles **Desktop** sur macOS, Ubuntu et Windows. Une minute macOS compte
environ 10 minutes Linux sur le quota, une minute Windows environ 2 : lancez-les
avant une release, pas à chaque modification.

Pour économiser le quota :

- un commit qui ne touche que la documentation (`*.md`, `docs/`, `LICENSE`,
  `NOTICE`) ne lance pas la CI ;
- `[skip ci]` dans le message d’un commit intermédiaire saute la CI ;
- un nouveau push annule l’exécution en cours sur la même branche ;
- vérifiez en local avant de pousser (`bun run lint`, `bun run test`,
  `bun run test:e2e`, `cargo test`) et regroupez les commits.

`.github/workflows/release.yml` prépare une release macOS signée et notariée sur
un tag `v*` : certificat Developer ID, build universel, vérification `spctl`,
DMG + SHA-256 et release GitHub en brouillon. Voir
[docs/RELEASE.md](docs/RELEASE.md).

`.github/dependabot.yml` propose chaque semaine les mises à jour npm et Cargo,
et chaque mois celles des actions GitHub. L’audit échoue au niveau `high` et
supérieur ; la seule alerte restante (`deepmerge`, faible, outil de build) est
documentée dans [docs/SECURITY.md](docs/SECURITY.md).

### Scripts

| Commande | Description |
| --- | --- |
| `bun run dev` | Serveur de développement Vite sur le port 1420 |
| `bun run build` | Vérification TypeScript puis build PWA |
| `bun run preview` | Prévisualisation du build |
| `bun run test` | Tests Vitest (562 tests) |
| `bun run test:watch` | Tests en mode surveillance |
| `bun run test:e2e` | Parcours Playwright sur Chromium et WebKit (144 exécutions) |
| `bun run test:e2e:chromium` | Parcours Playwright sur Chromium uniquement |
| `bun run test:e2e:webkit` | Parcours Playwright sur WebKit uniquement |
| `bun run test:e2e:install` | Installe Chromium et WebKit pour Playwright |
| `bun run extension:build` | Compile l’extension dans `dist-extension/` |
| `bun run extension:zip` | Compile puis crée `coffre-extension.zip` |
| `bun run extension:smoke` | Test manuel de l’extension (serveurs requis) |
| `bun run bridge:smoke` | Smoke du relais natif stdin/socket (binaire compilé) |
| `bun run core:test` | Tests de `coffre-core`, de la façade FFI, du CLI et du noyau SSH |
| `./scripts/build-coffre-core-apple.sh` | Construit localement `CoffreCore.xcframework` pour les extensions macOS (Xcode requis) |
| `bun run core:clippy` | Clippy strict de `coffre-core`, `coffre-core-ffi`, `coffre-cli` et `coffre-ssh-agent` |
| `bun run deny` | Vérifie licences, avis de sécurité et sources Cargo |
| `cargo +nightly fuzz run vault_parse` | Fuzz local du parseur (depuis `src-tauri/crates/coffre-core`) |
| `cargo +nightly fuzz run merge` | Fuzz local de la fusion |
| `bun run cli:build` | Compile `coffre-cli` en release |
| `bun run ssh:build` | Compile le binaire `coffre-ssh-agent` en release |
| `bun run typecheck` | Vérification TypeScript |
| `bun run lint` | Oxlint, contrôle des jetons de design et chaînes i18n |
| `bun run lint:i18n` | Vérifie qu’aucune chaîne d’interface n’est en dur |
| `bun run icons` | Régénère les icônes PWA |
| `bun run version:check` | Vérifie la cohérence des versions package/Tauri/extension/Cargo/cœur/CLI |
| `bun run sbom` | Génère les SBOM CycloneDX Rust et web dans `sbom/` |
| `bun run lint:security` | Vérifie `/.well-known/security.txt` |
| `bun run repro:check` | Compare deux builds Web et extension avec `SOURCE_DATE_EPOCH=0` |
| `bun run repro:desktop` | Compare deux bundles macOS après recompilation de la caisse applicative |
| `bun run desktop:dev` | Lance l’application desktop Tauri |
| `bun run desktop:build` | Produit les paquets desktop Tauri |
| `./scripts/release-macos.sh` | Build macOS universel signé et notarié (certificat requis) |
| `bun run tauri:icons` | Régénère les icônes Tauri depuis `public/icon.svg` |

Chaque modification livrée incrémente la version dans `package.json`,
`src-tauri/tauri.conf.json`, `extension/public/manifest.json` et les crates
Cargo. `bun run version:check` vérifie leur cohérence avant chaque commit.

---

## Plateformes

### Web / PWA — fonctionnel

- Application React 19 + Vite 8, installable depuis le navigateur.
- Données dans IndexedDB, préférences dans `localStorage`.
- Service worker généré par `vite-plugin-pwa` ; il ne met en cache que les
  ressources de l’application, jamais le contenu du coffre.

### Extension navigateur — Chromium et Firefox

L’extension Manifest V3 se trouve dans `extension/`. Elle ne duplique pas le
coffre : sur desktop, elle passe par le **pont natif** appairé (aucun onglet
Coffre requis) ; sinon elle interroge l’onglet Coffre déverrouillé via une
passerelle en mémoire, puis remplit la page active. Le même manifeste contient
`background.scripts` pour Firefox et `background.service_worker` pour Chromium.
Le popup inclut une **barre de recherche** permanente, un **générateur de mot
de passe local** avec copie en un clic et un **thème système/clair/sombre**.
Le générateur permet de régler la longueur, les classes de caractères et
l’exclusion des caractères ambigus ; les options sont mémorisées localement.
Un clic sur une connexion déploie ses détails (identifiant, mot de passe masqué,
code TOTP) avec copie champ par champ, y compris lorsque le remplissage
automatique échoue. Les réglages (thème, adresse de Coffre, test de connexion)
s’ouvrent directement dans le popup, sans nouvel onglet. La barre d’action et le
statut restent ancrés en bas de la fenêtre, même lorsque celle-ci ne s’ajuste
pas automatiquement à son contenu. La liste des connexions occupe toute la
hauteur disponible et défile avec le reste du panneau. Une fois le remplissage
actif dans l’onglet, le bouton d’activation laisse place à une pastille verte
dans le pied de page. Le logo Coffre est un SVG inline qui s’inverse selon le
thème clair ou sombre, dans le popup comme dans le menu des champs, et les
icônes d’action 16/32/48/128 px disposent de variantes clair/sombre.
La barre de recherche et le bouton du générateur restent ancrés en haut pendant
le défilement ; la recherche est focalisée à l’ouverture et une touche
imprimable lance immédiatement une recherche. Le bouton « Remplir » remplit la
connexion puis valide automatiquement le formulaire de connexion ; les cartes
et identités ne sont jamais soumises automatiquement.
Après une soumission de formulaire, l’extension ne propose d’enregistrer que si
les identifiants sont absents du coffre ; si le mot de passe a changé, elle
propose une mise à jour.

```bash
bun run extension:build
```

Puis, dans Chrome ou un navigateur Chromium :

1. ouvrir `chrome://extensions` et activer le mode développeur ;
2. choisir « Charger l’extension non empaquetée » et sélectionner
   `dist-extension/` ;
3. ouvrir Coffre et déverrouiller le coffre ;
4. sur un site, cliquer sur l’icône Coffre, puis « Remplir » ;
5. pour le remplissage directement dans les champs, cliquer sur « Activer le
   remplissage dans les champs » et autoriser l’accès aux sites. Un badge
   Coffre apparaît près des champs de connexion ; rechargez les onglets déjà
   ouverts si nécessaire.

Le menu s’affiche dans une iframe d’extension : la page ne peut pas lire son
contenu. Il propose trois onglets — **Connexions**, **Cartes** et **Identités** —
selon les champs détectés. Une fois un élément choisi, l’extension propose aussi
d’enregistrer ou de mettre à jour la connexion, la carte ou l’identité après la
soumission du formulaire. Les connexions en plusieurs étapes réutilisent le
dernier identifiant choisi pendant deux minutes.

**Cartes et identités.** La détection repose sur les attributs `autocomplete`
(`cc-number`, `cc-exp`, `cc-csc`, `given-name`, `postal-code`…), les types de
champs et des libellés français (« Numéro de carte », « Titulaire », « Code
postal »…). Le CVC et le PIN ne sont jamais remplis par défaut : une case
« Inclure le CVC et le PIN » doit être cochée pour chaque remplissage, et
Touch ID est demandé sur macOS lorsque la biométrie est configurée. Une carte
est refusée sur une page non HTTPS ou dans une iframe d’origine différente,
sauf pour une liste embarquée de prestataires de paiement (Stripe, Adyen,
PayPal, Braintree, Checkout.com, Worldpay, Klarna, Mollie, Square, PayPlug…).
L’origine de l’iframe et celle de la page sont affichées dans le menu. Les
formulaires de carte et d’adresse soumis peuvent être enregistrés dans le coffre
après confirmation.

**Passkeys.** Après avoir activé l’accès aux sites, l’extension intercepte
`navigator.credentials.create` et `get` dans un script de monde `MAIN`. Une
fenêtre Coffre demande confirmation avant toute création ou signature ; elle
affiche le domaine, le compte et permet toujours de choisir « utiliser un autre
appareil ». La clé privée ne quitte jamais l’application : seuls
`clientDataJSON`, `attestationObject`, `authenticatorData` et la signature
d’assertion transitent. Un `rpId` qui n’est pas le domaine de la page (ou un de
ses parents enregistrables) est refusé, de même qu’une origine HTTP autre que
`localhost`. Les passkeys créées apparaissent dans le filtre « Passkeys » du
coffre et restent lisibles, sans édition manuelle. L’import et l’export CXF 1.0
sont disponibles dans les réglages.

Dans Firefox :

1. ouvrir `about:debugging#/runtime/this-firefox` ;
2. choisir « Charger un module temporaire » ;
3. sélectionner `dist-extension/manifest.json` ;
4. ouvrir Coffre et déverrouiller le coffre, puis utiliser l’icône Coffre.

**Pont natif (desktop).** Au lancement, l’application installe les manifestes
d’hôte de messagerie native pour les navigateurs présents (Chrome, Chromium,
Edge, Brave et Firefox). Dans le popup de l’extension :

1. cliquer sur « Associer l’extension » alors que Coffre est déverrouillé ;
2. comparer le code à six chiffres affiché dans le popup et dans Coffre ;
3. cliquer sur « Autoriser l’extension » dans Coffre.

La clé de session est conservée dans le trousseau du système et dans
`chrome.storage.local` ; les échanges sont chiffrés en AES-256-GCM. Si
l’application est verrouillée, le popup propose de la ramener au premier plan.
Sans application desktop, l’extension conserve le remplissage via l’onglet
Coffre Web.

L’adresse de Coffre est configurable dans les réglages de l’extension
(`http://localhost:1420` par défaut). L’extension demande l’accès à l’onglet
actif au moment du remplissage et à l’adresse de Coffre configurée. Elle ne
stocke ni mot de passe maître, ni identifiant ; seule la clé de session du pont
natif est conservée dans le stockage local de l’extension.

Limites : le pont natif est implémenté pour macOS et Linux (socket Unix) ; le
relais Windows et la vérification de signature du binaire restent à faire. La
variante Firefox passe `web-ext lint` sans erreur, mais reste à valider
manuellement dans un Firefox réel. Les passkeys sont validées de bout en bout
sur Chromium via l’onglet Coffre ; le même code est embarqué pour le pont natif
desktop et pour Firefox, sans validation réelle à ce jour. Les passkeys ne
remplacent pas encore l’AutoFill système macOS/iOS ; la vérification utilisateur
WebAuthn (`UV`) n’est pas revendiquée et les sites qui l’exigent retombent sur
le navigateur.

### Desktop — build macOS validé

Le dossier `src-tauri/` contient une configuration Tauri v2 avec CSP stricte,
`freezePrototype`, icônes et scripts de développement/build. Prérequis :

- Rust ≥ 1.90 et Cargo ;
- sur macOS : Xcode Command Line Tools (Xcode complet non requis pour le
  desktop) ;
- sur Windows : Visual Studio C++ Build Tools et WebView2 ;
- sur Linux : dépendances WebKitGTK décrites par Tauri.

```bash
bun install
bun run desktop:dev
bun run desktop:build
```

La toolchain Rust est épinglée dans `rust-toolchain.toml` (1.99.1) et Bun
dans la CI (1.4.3).

Le build a été validé sur macOS arm64 (0.7.0, puis 0.8.0 après l’ajout du
trousseau et de la nouvelle interface) :

- `Coffre.app` (10,40 Mio) et `Coffre_0.8.0_aarch64.dmg` (3,29 Mio) générés
  dans `src-tauri/target/release/bundle/` ;
- build **universel** ad hoc (`arm64` + `x86_64`) validé :
  `Coffre.app` 20,97 Mio et `Coffre_0.8.0_universal.dmg` 6,48 Mio ;
- l’application se lance, initialise le stockage natif
  (`app_data_dir()/vault/vault.coffre`), migre automatiquement un ancien coffre
  IndexedDB et reste stable ; hors vérification optionnelle des fuites, elle
  n’ouvre aucune connexion réseau ;
- les 146 exécutions Playwright passent ou sont ignorées sur Chromium et WebKit, moteur des
  WebViews macOS/iOS ;
- `cargo test --lib` exécute 34 tests (1 ignoré) : stockage natif (rotation, permissions,
  effacement), trames et manifestes du pont natif, confinement et écritures
  atomiques du dossier de synchronisation, validation du préfixe HIBP,
  traduction des événements de session macOS/Windows/Linux et détection de
  LocalAuthentication/Touch ID sur la machine de build ;
- `cargo test -p coffre-core -p coffre-core-ffi -p coffre-cli -p coffre-ssh-agent`
  (22 + 3 + 13 + 17 tests) ouvre les fixtures TypeScript v1 à v4, crée/modifie/supprime, signe
  en v4, tourne le mot de passe, fusionne deux fichiers, exerce la façade
  UniFFI et relit les vecteurs Rust par le test TypeScript
  (`src/lib/coffreCoreVector.test.ts`).

Le crate `coffre-core-ffi` expose les opérations en JSON via UniFFI. Après
`cargo build -p coffre-core-ffi`, les bindings se génèrent depuis `src-tauri` :

```bash
# macOS : target/debug/libcoffre_core_ffi.dylib
# Linux : libcoffre_core_ffi.so — Windows : coffre_core_ffi.dll
cargo run -p coffre-core-ffi --bin uniffi-bindgen -- generate \
  --library target/debug/libcoffre_core_ffi.dylib \
  --language swift --out-dir ../bindings/swift
```

La façade S2 ajoute, en plus des mutations existantes :

- `core_open_vault_with_key` : ouverture par clé maîtresse déjà libérée par
  Touch ID ou Windows Hello, sans Argon2id ;
- `core_logins_for_service` : connexions candidates pour un domaine, avec la
  même règle de domaines que TypeScript, sans aucun secret ;
- `core_reveal_login` : mot de passe et code TOTP du seul élément demandé ;
- `core_credential_identities` : identités `(élément, utilisateur, domaine)`
  pour le magasin d’identités du système, sans secret ;
- `core_passkey_assert` et `core_passkey_create` : assertions et créations de
  passkeys ES256, avec les mêmes validations de RP ID que `src/lib/passkeys.ts`.

Pour les extensions macOS, `scripts/build-coffre-core-apple.sh` construit
localement `CoffreCore.xcframework` (arm64 + x86_64) et les bindings Swift. Le
script exige Xcode et n’est jamais exécuté par la CI.

La commande Tauri `core_merge_files` fusionne des fichiers chiffrés sans
recevoir de mot de passe ni exposer de contenu clair.

### CLI locale `coffre-cli`

Le crate `src-tauri/crates/coffre-cli` fournit un binaire de lecture pour les
scripts et le terminal. Il ouvre le même format v1 à v4 via `coffre-core`, ne
modifie jamais le fichier et n’ouvre aucune connexion réseau.

```bash
cargo build --manifest-path src-tauri/Cargo.toml -p coffre-cli --release
./src-tauri/target/release/coffre-cli --help

# Le mot de passe est demandé sur le terminal, sans écho.
./src-tauri/target/release/coffre-cli ~/Documents/vault.coffre list
./src-tauri/target/release/coffre-cli ~/Documents/vault.coffre get GitHub
./src-tauri/target/release/coffre-cli ~/Documents/vault.coffre get GitHub --field username
./src-tauri/target/release/coffre-cli ~/Documents/vault.coffre totp GitHub

# Pour un script : mot de passe sur stdin, jamais en argument.
printf '%s\n' "$MASTER_PASSWORD" |
  ./src-tauri/target/release/coffre-cli ~/Documents/vault.coffre --password-stdin list

# Injection de secrets dans l’environnement d’une commande.
./src-tauri/target/release/coffre-cli ~/Documents/vault.coffre run \
  --env DB_PASSWORD=prod-db \
  --env DB_USER=prod-db::username \
  -- ./migrate.sh
```

`--field` accepte `password` (par défaut), `username`, `notes` ou `json`.
`run --env` accepte `NOM=RECHERCHE` ou `NOM=RECHERCHE::CHAMP`, transmet les
valeurs uniquement par l’environnement du processus enfant et propage son code
de sortie. Le mot de passe maître n’apparaît jamais dans `argv`. Les secrets ne
sont écrits sur stdout que pour `get`, `totp` et la commande lancée par `run`.

**Fichiers `.env`.** `run --env-file` lit des références
`coffre://<coffre>/<élément>/<champ>` sans jamais écrire les valeurs sur disque.
`*` remplace le nom du coffre pour chercher dans tous les coffres ; le champ
peut être `password`, `username`, `notes`, `url` ou le libellé d’un champ
personnalisé.

```bash
cat > .env.coffre <<'EOF'
API_KEY=coffre://Personnel/API%20interne/password
API_USER=coffre://*/API%20interne/username
EOF
./src-tauri/target/release/coffre-cli ~/Documents/vault.coffre run \
  --env-file .env.coffre -- ./dev.sh
```

**Signature SSH.** `ssh-sign <clé> <fichier> --namespace git` produit une
signature `SSHSIG` compatible `ssh-keygen -Y verify`, sans écrire la clé privée
sur disque. Elle peut servir à signer un commit ou un tag hors de Git.

```bash
coffre-cli ~/vault.coffre ssh-sign deploy commit.txt --namespace git
```

Pour Git :

```bash
export COFFRE_VAULT=~/Documents/vault.coffre
git config --global gpg.format ssh
git config --global gpg.ssh.program /chemin/coffre-git-sign
git config --global user.signingkey deploy
git commit -S -m "commit signé"
```

Le programme lit `COFFRE_VAULT` et, si présent, `COFFRE_PASSWORD` ; sinon il
demande le mot de passe sur le terminal.

**Configuration SSH.** `ssh-config --agent <socket>` imprime un bloc `Host`
par clé SSH du coffre, avec `IdentityAgent` et `IdentitiesOnly yes`. Le socket
doit être servi par l’agent SSH Coffre ; aucun fichier de clé privée n’est
écrit.

```bash
./src-tauri/target/release/coffre-cli ~/Documents/vault.coffre \
  ssh-config --agent ~/.coffre/ssh-agent.sock
```

**Assistant Git.** `git-credential get --approve` lit `host`/`url` et
`username` sur stdin et renvoie `username=` / `password=` pour un élément de
connexion dont l’URL correspond à l’hôte. Sans `--approve`, aucune valeur n’est
divulguée. `store` et `erase` ne modifient pas le coffre.

```bash
git config --global credential.helper \
  '!f() { ./src-tauri/target/release/coffre-cli ~/Documents/vault.coffre git-credential "$1" --approve; }; f'
```

Cette première version lit le mot de passe dans le terminal. Le déverrouillage
via le socket de l’application desktop (L4) reste à raccorder dans une tranche
ultérieure de L11.

### Noyau de l’agent SSH

Le crate `src-tauri/crates/coffre-ssh-agent` prépare l’agent `SSH_AUTH_SOCK` :
protocole agent, liste d’identités, signatures ed25519 et RSA (2048 bits
minimum), socket Unix créé en `0600` dans un dossier `0700`, et callback
d’approbation obligatoire pour chaque signature. Les clés chiffrées et les
algorithmes non pris en charge sont refusés.

Dans l’application desktop, **Réglages → Sécurité → Agent SSH** démarre
l’agent à la demande. Rust ouvre le fichier local avec la clé maîtresse déjà
déverrouillée et ne renvoie jamais les clés privées à la WebView. Chaque
signature ouvre une modale d’approbation avec la clé, l’empreinte,
l’algorithme, la taille, l’empreinte SHA-256 des données et un aperçu lorsqu’elles
sont textuelles ; sans réponse sous 60 secondes, elle est refusée.
L’agent s’arrête au verrouillage, à la fermeture de l’interface ou via le bouton
**Arrêter l’agent**. Le socket est créé dans
`app_data_dir()/ssh/agent.sock` ; aucun socket n’est ouvert par défaut.

Lorsque le déverrouillage par Touch ID est activé, l’approbation d’une
signature demande aussi une authentification biométrique réussie. Une case
optionnelle, décochée par défaut, permet d’autoriser la même clé pendant
15 secondes pour les opérations qui enchaînent plusieurs signatures. Le named
pipe Windows reste à implémenter. Les clés FIDO2 (`sk-ssh-ed25519`, `sk-ecdsa-*`) sont refusées avec
un message explicite : leur signature exige le matériel, que le noyau ne pilote
pas encore. La génération de `~/.ssh/config` par hôte reste à implémenter.

Le binaire `coffre-ssh-agent` permet de l’utiliser dès maintenant dans un
terminal :

```bash
cargo build --manifest-path src-tauri/Cargo.toml -p coffre-ssh-agent --release
./src-tauri/target/release/coffre-ssh-agent ~/Documents/vault.coffre --list
./src-tauri/target/release/coffre-ssh-agent ~/Documents/vault.coffre
# puis, dans un autre terminal :
export SSH_AUTH_SOCK=/chemin/indiqué/par/l-agent
ssh-add -l
```

Chaque signature affiche la clé, son empreinte et le nombre d’octets, puis
demande une confirmation explicite. Sans terminal interactif, la signature est
refusée. Sous Windows, le named pipe reste à implémenter.

**Git.** Git peut aussi signer avec l’agent via `ssh-keygen -Y sign` :

```bash
export SSH_AUTH_SOCK=/chemin/indiqué/par/l-agent
git config --global gpg.format ssh
git config --global user.signingkey /chemin/vers/la/clé.pub
git config --global commit.gpgsign true
git commit -S -m "commit signé"
```

La clé privée reste dans le coffre ; chaque signature passe par la modale
d’approbation (et Touch ID si activé).

Le déverrouillage rapide par le trousseau est optionnel (Réglages → Trousseau du
système). La clé maîtresse encodée en base64 est rangée sous le service
`app.coffre.desktop`, avec l’identifiant du fichier `.coffre` comme compte, puis
supprimée au verrouillage. Sur un appareil partagé, laissez l’option désactivée.

Sur macOS, l’option **Touch ID** remplace ce trousseau silencieux : la clé est
rangée dans le service séparé `app.coffre.desktop.biometric` et la commande
`biometric_load` commence par une authentification Touch ID avant de la
libérer. Le dialogue s’ouvre automatiquement sur l’écran de verrouillage dès
que la fenêtre Coffre est activée. La clé
biométrique reste en place pendant le verrouillage, sinon le déverrouillage
rapide serait impossible ; elle est supprimée quand l’option est désactivée ou
le coffre réinitialisé. Voir
[docs/SECURITY.md](docs/SECURITY.md#71-tauri).

L’interface desktop utilise une disposition en deux colonnes : liste des
éléments et détail persistant, dans une barre latérale de navigation. La
création, la lecture et l’édition se font dans ce même panneau ; les modales
sont réservées aux confirmations, au générateur, à l’historique et aux
réglages. Sous 1100 px, le détail remplace la liste et un bouton retour ramène
à la liste d’origine. Sous 640 px, une barre d’onglets basse regroupe Tout,
Favoris, Récents, Sécurité et Réglages, et une barre d’actions basse expose les
actions principales de l’élément. Les jetons, échelles et règles sont décrits
dans [docs/DESIGN.md](docs/DESIGN.md).

Sur macOS, la barre de titre native est remplacée par une **surcouche
transparente** (`titleBarStyle: "Overlay"`, `hiddenTitle: true`) : les feux de
circulation flottent au-dessus de la barre latérale et le contenu occupe toute
la fenêtre. Une zone de glissement en haut, ainsi que l’en-tête de la barre
latérale et la barre supérieure, permettent de déplacer la fenêtre. Les autres
systèmes conservent leur barre de titre native.

Le bundle macOS local est **signé ad hoc** (`signingIdentity: "-"`, identifiant
`app.coffre.desktop`) mais ni notarisé : Gatekeeper affichera un avertissement
au premier lancement. macOS associe l’autorisation « Always Allow » du trousseau
à la signature : une signature ad hoc change à chaque compilation, donc
l’autorisation peut être redemandée après un nouveau build.

La chaîne de release signée est prête : `scripts/release-macos.sh` construit
une version universelle, vérifie la signature Developer ID et le hardened
runtime, contrôle l’agrafage, puis produit le DMG et son SHA-256. Le workflow
`.github/workflows/release.yml` fait la même chose sur un tag `v*` et crée une
release GitHub en brouillon. Il manque seulement le certificat Apple et les
secrets de notarisation ; la procédure complète est dans
[docs/RELEASE.md](docs/RELEASE.md).

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: …" \
APPLE_ID="…" APPLE_PASSWORD="mot-de-passe-application" APPLE_TEAM_ID="…" \
./scripts/release-macos.sh
```

La compilation Windows et Linux reste à valider.

### Intégration macOS AutoFill — analysée

Coffre ne peut pas déposer d’entrées dans l’app **Mots de passe** d’Apple : elle
n’expose pas d’API publique pour cela. Une intégration système passe par une
**extension AutoFill native** (`ASCredentialProviderViewController`), embarquée
dans `Coffre.app`, avec App Group, identités `ASCredentialIdentityStore`,
signature Developer ID et notarisation. Tauri ne sait pas générer cette
extension seul ; le coffre utilise désormais un fichier natif, qu’il reste à
partager avec l’extension via un App Group. L’architecture, les entitlements,
le partage du coffre, la signature
et la feuille de route sont décrits dans
[docs/MACOS-AUTOFILL.md](docs/MACOS-AUTOFILL.md).

L’**export CSV compatible Mots de passe** est disponible dans les réglages,
sans Xcode ni signature. Le format Apple ne contient que les connexions
actives ; le format « Coffre complet » inclut les autres types d’éléments mais
pas les pièces jointes.

### Mobile — à initialiser

Tauri v2 permet de cibler iOS et Android avec la même interface. Il faut :

- Android : SDK/NDK Android, Java 17+, `tauri android init` ;
- iOS : Xcode, CocoaPods, compte de signature, `tauri ios init`.

```bash
bun run mobile:android:init
bun run mobile:android:dev
bun run mobile:ios:init
bun run mobile:ios:dev
```

Le mobile n’a pas été testé dans cet environnement. Les limites de stockage et
de presse-papiers propres aux WebViews mobiles devront être validées.

---

## Architecture

```text
src/
  components/     Interface React (auth, coffres, éléments, générateur, réglages)
  hooks/          Verrouillage automatique
  lib/            Crypto, format de coffre, import/export CSV, stockage, TOTP, générateur
  state/          Providers React (coffre, réglages, notifications)
  styles/         CSS par domaine, jetons dans tokens.css
  assets/         Liste EFF des 7 776 mots
src-tauri/        Socle desktop/mobile Tauri v2
  crates/coffre-core/  Format/crypto, mutations, fusion et vecteurs
  crates/coffre-core-ffi/  Façade UniFFI JSON pour mobile/CLI
  crates/coffre-cli/  Lecture locale : list, get, totp, run --env
  crates/coffre-ssh-agent/  Noyau de l’agent SSH_AUTH_SOCK
extension/        Extension navigateur Manifest V3 (Chromium + Firefox)
docs/             Sécurité, audit, préparation grand public, release, AutoFill macOS
scripts/          Génération des icônes PWA, test manuel de l’extension
```

### Hiérarchie de clés

```text
mot de passe maître
        │  Argon2id (64 Mio, 3 itérations, 4 threads, sel de 16 octets)
        ▼
   clé maîtresse (32 octets)
        │  AES-256-GCM, AAD « vault-key »
        ▼
   clé de coffre (32 octets, aléatoire)
        │  AES-256-GCM, AAD « item-key »
        ▼
   clé d’élément (32 octets, aléatoire)
        │  AES-256-GCM, AAD « item-content »
        ▼
   contenu de l’élément (JSON)
         ├─ versions : AES-256-GCM, AAD
         │  « item-version:<vaultId>:<itemId>:<versionId> »
         └─ pièces jointes : AES-256-GCM, AAD
            « item-attachment:<vaultId>:<itemId>:<attachmentId> »
```

Changer le mot de passe maître régénère le sel et la clé maîtresse, puis
ré-enveloppe uniquement les clés de coffre. Les éléments, leurs versions et les
pièces jointes ne sont pas réchiffrés.

```text
phrase de récupération (10 mots EFF)
        │  Argon2id (paramètres propres, sel distinct)
        ▼
   clé de phrase (32 octets)
        │  AES-256-GCM, AAD « recovery-key »
        ▼
   clé de récupération (32 octets, aléatoire)
        │  AES-256-GCM, AAD « recovery-vault-key:<vaultId> »
        ▼
   clés de coffre (les mêmes que ci-dessus)

   clé maîtresse ──AES-GCM, AAD « recovery-guard »──► clé de récupération
```

L’enveloppe est facultative. Elle est stockée dans le fichier `.coffre` et dans
le stockage local (fichier natif ou IndexedDB), jamais la phrase elle-même.

### Stockage

- **Desktop (Tauri)** : `app_data_dir()/vault/vault.coffre`, plus trois
  sauvegardes `vault.coffre.bak1` à `bak3` et `state.json` (révision maximale
  vue). Écritures atomiques, dossier en `0700`, fichiers en `0600`, plafond de
  100 Mo. Un ancien coffre IndexedDB est migré automatiquement au premier
  lancement.
- **Web** : base IndexedDB `coffre`, magasin `vault` ; clé `current` pour le
  coffre courant (déjà chiffré), clés `backup`, `backup:2`, `backup:3` pour les
  trois générations précédentes et clé `state` pour la plus haute révision vue.
- Préférences : `localStorage`, clé `coffre:settings:v1` (aucune donnée
  sensible) ;
- Export : fichier JSON `.coffre`, chiffré, **format v4** (les fichiers v1 à v3
  sont lus puis migrés en v4 à la première écriture) ; export CSV en clair pour
  les migrations (Mots de passe Apple ou format complet Coffre).

Le format complet et les garanties sont documentés dans
[docs/SECURITY.md](docs/SECURITY.md).

---

## Sécurité en bref

- Argon2id pour la dérivation, AES-256-GCM pour le chiffrement authentifié.
- Nonce aléatoire de 12 octets par chiffrement, tag de 128 bits.
- AAD de domaine pour lier chaque ciphertext à son coffre, son élément et son
  rôle.
- Pièces jointes chiffrées séparément avec la clé de l’élément et une AAD
  dédiée.
- Versions historiques chiffrées avec la clé de l’élément et une AAD liée à
  l’identifiant de version ; une version ne peut pas être substituée au contenu
  courant ni à une autre version.
- Date de mise à la corbeille comprise dans le contenu chiffré, donc invisible
  dans les métadonnées du fichier.
- Enveloppe de récupération optionnelle : la phrase n’est jamais stockée, la clé
  qu’elle protège est scellée par Argon2id et chaque clé de coffre dispose d’une
  AAD dédiée.
- Clés maîtresse, de coffre et de récupération uniquement en mémoire ; jamais
  persistées en clair.
- MAC global HMAC-SHA-256 par fichier (format 4) : toute suppression,
  substitution ou rejeu d’un enregistrement est détecté ; un MAC invalide
  ouvre le coffre en lecture seule. La révision maximale vue est conservée hors
  du fichier pour signaler un retour en arrière.
- Verrouillage immédiat lorsque l’onglet passe en arrière-plan (par défaut) et
  à la fermeture de la page.
- Stockage natif atomique sur desktop, ou IndexedDB persistant sur le Web, avec
  contrôle d’intégrité complet à la demande.
- Aucune requête réseau par défaut : polices système, icônes locales, aucune
  analytique. Seule la vérification optionnelle des fuites, déclenchée
  manuellement, envoie un préfixe SHA-1 de 5 caractères.
- Le presse-papiers est effacé au mieux après le délai choisi.
- L’extension navigateur ne stocke aucun secret : elle lit les identifiants
  depuis l’onglet Coffre déverrouillé, en mémoire, et ne dispose que de l’accès
  temporaire à l’onglet actif. Sur desktop, le pont natif appairé remplace
  l’onglet : clé de session ECDH/HKDF, messages AES-256-GCM, socket `0600` et
  contrôle du domaine dans l’application.
- **Le bundle desktop macOS produit localement n’est ni signé ni notarisé.** La chaîne de release signée est prête, mais le certificat Apple et les secrets de notarisation manquent.
- **Le projet n’a pas fait l’objet d’un audit de sécurité indépendant.**

Le modèle de menace, les limites et les recommandations de déploiement sont
détaillés dans [docs/SECURITY.md](docs/SECURITY.md).

---

## Limites connues

- L’extension navigateur est disponible pour Chromium et Firefox ; la variante
  Firefox est construite mais n’est pas encore validée en exécution réelle. Le
  pont natif desktop est implémenté sur macOS et Linux ; Windows, la
  vérification de signature du relais et le remplissage automatique à
  l’ouverture de page restent à faire. Sans pont appairé, l’onglet Coffre doit
  rester ouvert et déverrouillé.
- La synchronisation par dossier est disponible dans l’application desktop
  (macOS/Linux validés, Windows à valider) et dans Chromium via File System
  Access API. Safari/Firefox utilisent la sauvegarde manuelle par fichier
  `.coffre`. Le dossier est choisi par l’utilisateur et reste hors de tout
  serveur Coffre ; la synchronisation Web est manuelle (pas de watcher).
- Pas d’import direct depuis un export chiffré : les exports en clair JSON
  (Bitwarden, Proton Pass, Enpass), les CSV et les archives 1Password `.1pux`
  non chiffrées sont pris en charge. Les sauvegardes `.enpassbackup` et les
  exports chiffrés ne sont pas lues.
- Les pièces jointes sont limitées à 5 Mo par fichier, 10 par élément, 25 Mo par
  élément et 50 Mo par coffre.
- L’historique est plafonné à 20 versions par élément et 2 000 versions par
  coffre ; les plus anciennes sont écartées silencieusement.
- La purge de la corbeille n’a lieu qu’à l’ouverture du coffre, après un import
  ou une restauration de sauvegarde, pas pendant que le coffre reste ouvert.
- La récupération est optionnelle : sans phrase configurée, perdre le mot de
  passe maître revient à perdre les données. Une phrase compromise et un fichier
  `.coffre` obtenu suffisent à ouvrir le coffre.
- Les trois sauvegardes locales vivent sur le même appareil et le même disque :
  elles ne protègent ni d’une panne matérielle, ni d’une perte de l’appareil, ni
  d’un effacement du stockage. Exportez régulièrement un fichier `.coffre`.
- L’export CSV est **en clair** : il doit être importé puis supprimé, sans être
  ouvert dans un tableur (des champs peuvent commencer par `=`, `+`, `-` ou
  `@`). Le format Apple ne contient que les connexions actives ; les pièces
  jointes ne sont jamais incluses dans un CSV. Le `.coffre` reste la sauvegarde
  complète.
- L’enveloppe de récupération est incluse dans chaque export `.coffre` ; elle
  protège les clés par la phrase, mais révèle qu’une récupération est configurée.
- Les identifiants, dates et nombres d’éléments restent visibles dans le
  fichier chiffré (métadonnées non chiffrées).
- Les secrets sont en clair dans la mémoire du navigateur pendant que le coffre
  est déverrouillé. Les effacements en JavaScript sont au mieux.
- L’estimation de robustesse est heuristique, pas un modèle de dictionnaire
  complet.
- Pas de protection contre un OS compromis, un keylogger, une extension
  malveillante ou une injection de code dans la page.
- Le chargement initial complet (application, React, validation et crypto)
  représente environ 895 Ko minifiés (277 Ko gzip) répartis en chunks ; les
  dialogues d’élément, de réglages, de sécurité et le générateur sont chargés
  à l’ouverture, ce qui diffère aussi les importeurs et le parseur KDBX. Aucun
  chunk ne dépasse 305 Ko ; le worker KDF pèse 28 Ko.
- Les tests de bout en bout utilisent Chromium et WebKit ; Firefox et les
  WebViews Android/iOS réelles doivent encore être validés.
- Le bundle macOS local est non signé et non notarisé ; les builds Windows et
  Linux n’ont pas été testés.

---

## Feuille de route

1. ~~Interopérabilité : import Proton Pass (export JSON) et déduplication.~~ Fait
   en 0.5.0.
2. ~~Extension navigateur Manifest V3 et remplissage automatique.~~ Fait en
   0.6.0 pour Chromium ; variante Firefox ajoutée en 0.8.0, validation réelle à
   faire.
3. ~~Import Enpass (JSON) et compatibilité avec les CSV traditionnels
   (1Password, LastPass, Chrome, Firefox, Safari, Dashlane, KeePass, NordPass,
   Keeper, RoboForm, SafeInCloud).~~ Fait en 0.7.0.
4. ~~Trousseau natif desktop et interface en colonnes proche de 1Password.~~
   Fait en 0.8.0 pour macOS ; Windows/Linux et le mobile restent à valider.
5. Audit de sécurité externe et revue cryptographique.
6. Validation des builds Windows/Linux, puis initialisation et tests des cibles
   mobiles iOS/Android.
7. Synchronisation chiffrée optionnelle de bout en bout : implémentée sur
   desktop et Chromium ; Safari/Firefox et mobile restent en manuel ou à faire.
8. Optimisation du bundle et du temps de déverrouillage.

---

La recette des jalons restants (deux machines, permissions système, mobile, audit) est décrite dans [`docs/QA-FINAL.md`](docs/QA-FINAL.md).

## Licence et attributions

Coffre est distribué sous **GNU GPL v3.0 seulement** (`GPL-3.0-only`). Voir
[LICENSE](LICENSE).

Coffre est un projet indépendant, **sans affiliation avec Proton AG**.
L’architecture et les choix cryptographiques sont inspirés de Proton Pass,
publié sous GPL-3.0. La liste de mots de passe est la *EFF Large Wordlist*
(7 776 mots), créée par l’Electronic Frontier Foundation et publiée sous
CC BY 3.0 ; elle a été reprise du dépôt `protonpass/proton-pass-common`.

Voir [NOTICE](NOTICE) pour les attributions complètes et
[docs/PROTON-PASS.md](docs/PROTON-PASS.md) pour l’analyse des dépôts.
