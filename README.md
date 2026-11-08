# Coffre

**Gestionnaire de mots de passe local-first, chiffré et hors ligne.**

Coffre conserve vos identifiants, notes, cartes et identités dans un fichier
chiffré sur votre appareil. Aucun compte, aucun serveur, aucune synchronisation,
aucune télémétrie. L’interface est en français.

> **État du projet — 0.8.0 (trousseau natif et interface desktop).**
> La version web/PWA est fonctionnelle et couverte par 157 tests unitaires et
> 17 parcours Playwright exécutés sur Chromium et WebKit (34 exécutions). Une
> intégration continue vérifie lint, types, tests, build et bundles desktop. Le
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

- **Coffres multiples** : création, renommage, suppression, filtre par coffre.
- **Quatre types d’éléments** : connexion, note sécurisée, carte bancaire,
  identité.
- **Champs personnalisés** : texte, texte masqué, adresse web et texte long,
  jusqu’à 30 champs par élément.
- **Pièces jointes chiffrées** : ajout, téléchargement et suppression de
  fichiers, avec chiffrement séparé par la clé de l’élément.
- **Import** : exports JSON non chiffrés de Bitwarden, Proton Pass et Enpass, et
  CSV de Bitwarden, 1Password, LastPass, Chrome/Edge/Brave, Firefox, Safari,
  Dashlane, KeePass/KeePassXC, NordPass, Keeper, RoboForm, SafeInCloud et Enpass,
  avec détection des colonnes, aperçu et déduplication avant import.
- **Extension navigateur** (Manifest V3, Chromium) : remplissage automatique des
  connexions et des codes TOTP depuis l’onglet Coffre déverrouillé. L’extension
  ne stocke aucun secret et ne copie rien dans le presse-papiers.
- **Recherche** insensible aux accents, filtres par type et favoris, étiquettes ;
  elle inclut les champs personnalisés et les noms de pièces jointes.
- **Tri de la liste** : utilisation récente, nom, date de création, date de
  modification ou type. Les filtres (récents, favoris, types, corbeille) restent
  dans la barre latérale pour éviter les doublons.
- **Générateur** de mots de passe et de phrases de passe (liste EFF de
  7 776 mots), avec réglages et estimation d’entropie.
- **TOTP** (RFC 6238) : import d’une URI `otpauth://`, codes SHA-1/256/512,
  compte à rebours.
- **Copie temporaire** : effacement du presse-papiers après un délai et au
  verrouillage, si son contenu n’a pas changé.
- **Verrouillage automatique** après inactivité, verrouillage immédiat lorsque
  l’onglet passe en arrière-plan (option active par défaut) et verrouillage
  manuel.
- **Corbeille** : suppression réversible, restauration, suppression définitive
  et purge automatique configurable.
- **Historique des versions** : chaque modification réelle conserve le contenu
  précédent, consultable et restaurable depuis la fiche de l’élément.
- **Stockage durable** : fichier natif atomique et trois sauvegardes tournantes
  dans l’application desktop ; sur le Web, IndexedDB avec stockage persistant
  demandé au navigateur, statut et espace utilisé affichés dans les réglages.
- **Vérification d’intégrité** à la demande : déchiffre chaque coffre, élément,
  version, pièce jointe et enveloppe de récupération pour détecter une
  altération locale.
- **Changement de mot de passe maître** sans réchiffrer tous les éléments.
- **Phrase de récupération optionnelle** : dix mots générés localement,
  enveloppe séparée des clés de coffre, déverrouillage d’urgence avec choix
  d’un nouveau mot de passe maître.
- **Sauvegarde** : export/import d’un fichier `.coffre` chiffré et trois
  générations de copie locale de secours, restaurables depuis l’écran de
  récupération. Export CSV en clair au format **Mots de passe (Apple)** pour les
  connexions, ou au format **Coffre complet** pour tous les types d’éléments.
- **PWA installable** : fonctionnement hors ligne, icônes, service worker.
- **Interface desktop en colonnes** : barre latérale, liste compacte et panneau
  de détail persistant, avec édition sur place et navigation clavier.
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
- **Thème sombre**, interface responsive, sélecteurs natifs habillés,
  accessibilité clavier et modales avec piège à focus.

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
| Dashlane | CSV | `username`, `username2`, `username3`, `title`, `password`, `note`, `url`, `category`, `otpSecret` |
| KeePass / KeePassXC | CSV | `Account`, `Login Name`, `Password`, `Web Site`, `Comments` ou `Group`, `Title`, `Username`, `Password`, `URL`, `Notes`, `TOTP` |
| NordPass | CSV | `name`, `url`, `username`, `password`, `note`, `cardholdername`, `cardnumber`, `cvc`, `expirydate`, `folder`, `type` |
| Keeper | CSV | `Folder`, `Title`, `Login`, `Password`, `Website`, `Notes` |
| RoboForm | CSV | `name`, `url`, `username`, `password`, `note` |
| SafeInCloud | CSV | `Title`, `Login`, `Password`, `URL`, `Notes` |
| Enpass | CSV | `Title`, `Username`, `Password`, `URL`, `Notes`, `Folder` |

Les colonnes inconnues deviennent des champs personnalisés. Avant l’import,
Coffre compare les éléments au contenu actuel du coffre (même type et mêmes
informations d’identification : nom d’utilisateur et site pour une connexion,
quatre derniers chiffres pour une carte, adresse e-mail pour une identité,
contenu pour une note) et propose d’ignorer les doublons. Les exports chiffrés
(Bitwarden chiffré, Proton Pass chiffré, sauvegarde `.enpassbackup`, archive
`.1pux`) ne sont pas pris en charge : exportez d’abord en clair, puis supprimez
le fichier intermédiaire. Un fichier `.coffre` doit passer par « Importer un
coffre » avec son mot de passe.

---

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
la restauration d’une version depuis l’historique, la configuration d’une phrase
de récupération puis la récupération avec un nouveau mot de passe, ainsi qu’un
scénario de sécurité : aucune requête tierce et aucune adresse dangereuse rendue
cliquable. Ils tournent sur Chromium et WebKit ; ce dernier sert de proxy pour
le moteur des WebViews macOS/iOS.

### Intégration continue

Le fichier `.github/workflows/ci.yml` exécute plusieurs ensembles de tâches :

- **Qualité** (Ubuntu) : `bun audit --audit-level=high`, lint, vérification
  TypeScript, tests Vitest et build PWA, avec l’artefact `dist` conservé une
  semaine ;
- **Parcours** (Ubuntu) : Playwright sur Chromium et WebKit, traces et rapport
  téléversés en cas d’échec ;
- **Rust** (Ubuntu) : `cargo fmt`, `clippy`, tests et `cargo audit` ;
- **Extension** (Ubuntu) : smoke test Chromium avec la CSP de production ;
- **Desktop** (macOS, Ubuntu, Windows) : compilation du bundle Tauri, lancée
  uniquement sur `main` ou manuellement pour maîtriser le coût des runners.

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
| `bun run test` | Tests Vitest (157 tests) |
| `bun run test:watch` | Tests en mode surveillance |
| `bun run test:e2e` | Parcours Playwright sur Chromium et WebKit (34 exécutions) |
| `bun run test:e2e:chromium` | Parcours Playwright sur Chromium uniquement |
| `bun run test:e2e:webkit` | Parcours Playwright sur WebKit uniquement |
| `bun run test:e2e:install` | Installe Chromium et WebKit pour Playwright |
| `bun run extension:build` | Compile l’extension dans `dist-extension/` |
| `bun run extension:zip` | Compile puis crée `coffre-extension.zip` |
| `bun run extension:smoke` | Test manuel de l’extension (serveurs requis) |
| `bun run typecheck` | Vérification TypeScript |
| `bun run lint` | Oxlint |
| `bun run icons` | Régénère les icônes PWA |
| `bun run version:check` | Vérifie la cohérence des versions package/Tauri/extension/Cargo |
| `bun run desktop:dev` | Lance l’application desktop Tauri |
| `bun run desktop:build` | Produit les paquets desktop Tauri |
| `./scripts/release-macos.sh` | Build macOS universel signé et notarié (certificat requis) |
| `bun run tauri:icons` | Régénère les icônes Tauri depuis `public/icon.svg` |

---

## Plateformes

### Web / PWA — fonctionnel

- Application React 19 + Vite 8, installable depuis le navigateur.
- Données dans IndexedDB, préférences dans `localStorage`.
- Service worker généré par `vite-plugin-pwa` ; il ne met en cache que les
  ressources de l’application, jamais le contenu du coffre.

### Extension navigateur — Chromium

L’extension Manifest V3 se trouve dans `extension/`. Elle ne duplique pas le
coffre : elle interroge l’onglet Coffre déverrouillé via une passerelle en
mémoire, puis remplit la page active.

```bash
bun run extension:build
```

Puis, dans Chrome ou un navigateur Chromium :

1. ouvrir `chrome://extensions` et activer le mode développeur ;
2. choisir « Charger l’extension non empaquetée » et sélectionner
   `dist-extension/` ;
3. ouvrir Coffre et déverrouiller le coffre ;
4. sur un site, cliquer sur l’icône Coffre, puis « Remplir ».

L’adresse de Coffre est configurable dans les réglages de l’extension
(`http://localhost:1420` par défaut). L’extension demande l’accès à l’onglet
actif au moment du remplissage et à l’adresse de Coffre configurée. Elle ne
stocke ni mot de passe maître, ni clé, ni identifiant.

Limites : Chromium uniquement pour l’instant, onglet Coffre ouvert et déverrouillé
requis, pas de remplissage automatique à l’ouverture de page ni de soumission de
formulaire. Firefox n’est pas encore validé.

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

Le build a été validé sur macOS arm64 (0.7.0, puis 0.8.0 après l’ajout du
trousseau et de la nouvelle interface) :

- `Coffre.app` (10,25 Mio) et `Coffre_0.8.0_aarch64.dmg` (3,33 Mio) générés
  dans `src-tauri/target/release/bundle/` ;
- l’application se lance, initialise le stockage natif
  (`app_data_dir()/vault/vault.coffre`), migre automatiquement un ancien coffre
  IndexedDB, reste stable et n’ouvre aucune connexion réseau ;
- les 34 exécutions Playwright passent sur Chromium et WebKit, moteur des
  WebViews macOS/iOS ;
- `cargo test --lib` exécute 3 tests : stockage natif (rotation, permissions,
  effacement) et détection de LocalAuthentication/Touch ID sur la machine de
  build.

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

L’interface desktop utilise une disposition en trois colonnes : navigation,
liste des éléments et détail persistant. La création et l’édition réutilisent le
même formulaire que le Web ; sur une fenêtre étroite, le détail s’affiche en
surcouche et `Échap` revient à la liste.

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
  styles/         CSS par domaine
  assets/         Liste EFF des 7 776 mots
src-tauri/        Socle desktop/mobile Tauri v2
extension/        Extension navigateur Manifest V3 (Chromium)
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
  sauvegardes `vault.coffre.bak1` à `bak3`. Écritures atomiques, dossier en
  `0700`, fichiers en `0600`, plafond de 100 Mo. Un ancien coffre IndexedDB est
  migré automatiquement au premier lancement.
- **Web** : base IndexedDB `coffre`, magasin `vault` ; clé `current` pour le
  coffre courant (déjà chiffré) et clés `backup`, `backup:2`, `backup:3` pour
  les trois générations précédentes.
- Préférences : `localStorage`, clé `coffre:settings:v1` (aucune donnée
  sensible) ;
- Export : fichier JSON `.coffre`, chiffré, **format v3** (les fichiers v1 et
  v2 sont lus puis migrés à l’écriture) ; export CSV en clair pour les
  migrations (Mots de passe Apple ou format complet Coffre).

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
- Verrouillage immédiat lorsque l’onglet passe en arrière-plan (par défaut) et
  à la fermeture de la page.
- Stockage natif atomique sur desktop, ou IndexedDB persistant sur le Web, avec
  contrôle d’intégrité complet à la demande.
- Aucune requête réseau : polices système, icônes locales, aucune analytique.
- Le presse-papiers est effacé au mieux après le délai choisi.
- L’extension navigateur ne stocke aucun secret : elle lit les identifiants
  depuis l’onglet Coffre déverrouillé, en mémoire, et ne dispose que de l’accès
  temporaire à l’onglet actif.
- **Le bundle desktop macOS produit localement n’est ni signé ni notarisé.** La chaîne de release signée est prête, mais le certificat Apple et les secrets de notarisation manquent.
- **Le projet n’a pas fait l’objet d’un audit de sécurité indépendant.**

Le modèle de menace, les limites et les recommandations de déploiement sont
détaillés dans [docs/SECURITY.md](docs/SECURITY.md).

---

## Limites connues

- L’extension navigateur est disponible pour Chromium ; Firefox n’est pas encore
  validé. Elle exige l’onglet Coffre ouvert et déverrouillé, et ne remplit ni ne
  soumet les formulaires automatiquement.
- Pas de synchronisation entre appareils : la sauvegarde passe par un fichier
  `.coffre` que vous transportez vous-même.
- Pas d’import direct depuis un export chiffré ou une archive propriétaire : les
  exports en clair JSON (Bitwarden, Proton Pass, Enpass) et les CSV sont pris en
  charge. Les sauvegardes `.enpassbackup` et les archives 1Password `.1pux` ne
  sont pas lues.
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
- Le bundle initial fait environ 660 Ko minifiés (207 Ko gzip), plus un worker KDF de 28 Ko ; la liste EFF et
  `hash-wasm` pourront être chargés à la demande dans une version ultérieure.
- Les tests de bout en bout utilisent Chromium et WebKit ; Firefox et les
  WebViews Android/iOS réelles doivent encore être validés.
- Le bundle macOS local est non signé et non notarisé ; les builds Windows et
  Linux n’ont pas été testés.

---

## Feuille de route

1. ~~Interopérabilité : import Proton Pass (export JSON) et déduplication.~~ Fait
   en 0.5.0.
2. ~~Extension navigateur Manifest V3 et remplissage automatique.~~ Fait en
   0.6.0 pour Chromium ; Firefox reste à valider.
3. ~~Import Enpass (JSON) et compatibilité avec les CSV traditionnels
   (1Password, LastPass, Chrome, Firefox, Safari, Dashlane, KeePass, NordPass,
   Keeper, RoboForm, SafeInCloud).~~ Fait en 0.7.0.
4. ~~Trousseau natif desktop et interface en colonnes proche de 1Password.~~
   Fait en 0.8.0 pour macOS ; Windows/Linux et le mobile restent à valider.
5. Audit de sécurité externe et revue cryptographique.
6. Validation des builds Windows/Linux, puis initialisation et tests des cibles
   mobiles iOS/Android.
7. Synchronisation chiffrée optionnelle de bout en bout (hors périmètre actuel).
8. Optimisation du bundle et du temps de déverrouillage.

---

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
