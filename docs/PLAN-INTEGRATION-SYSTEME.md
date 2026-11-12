# Plan d’intégration au système — desktop

Document destiné à un agent de développement. Il décrit, lot par lot, comment
faire de Coffre un gestionnaire **intégré au système d’exploitation**, comme
1Password, Bitwarden ou l’app Mots de passe d’Apple : remplissage automatique
dans Safari et les apps natives, passkeys proposées par le système, extension
Safari, Windows Hello, verrouillage avec la session.

Les règles de la section 0 de `docs/PLAN-IMPLEMENTATION.md` s’appliquent
intégralement (principes non négociables, une PR par lot, contrôles
obligatoires, documentation, définition de « terminé »).

`docs/MACOS-AUTOFILL.md` reste le document d’architecture détaillé pour macOS.
Il mentionne encore le format v3 : la cible est désormais le format **v4**
(MAC global, révisions), et le crate `coffre-core` qu’il recommande existe.

Base de départ : `main` au 9 novembre 2026 (0.8.0, L1 à L7, L9, L11, L12 faits).

---

## 0. Contraintes propres à ce plan

### 0.1 Coûts et comptes

| Besoin | Coût | Lots concernés |
| --- | --- | --- |
| Compte Apple Developer (Developer ID, App Group, entitlements AutoFill, notarisation) | 99 $ / an | S0, S3, S4, S5 |
| Signature de code Windows (SmartScreen, éventuel MSIX) | Optionnel, variable | S6 |
| GitHub Actions | Gratuit sur dépôt public (runners standard) | Tous |

**Aucun achat n’est fait par l’agent.** Les lots S1 et S2 se font sans compte
payant. À partir de S0, l’agent s’arrête et demande à l’utilisateur de créer le
compte Apple et de fournir l’identifiant d’équipe.

### 0.2 CI et nettoyage

- Le dépôt est public : les runners GitHub standard sont gratuits. Les jobs
  macOS, Windows et Xcode peuvent tourner sur `pull_request` et `push` si le
  besoin de validation le justifie.
- Les tests Rust du code partagé (S2) tournent sur Linux, macOS et Windows.
- Les extensions natives se compilent et se testent en local sur le Mac de
  l’utilisateur ; la PR liste les tests manuels effectués.
- **Après chaque fusion, mise à jour ou release**, exécuter `bun run
  post-merge` : il met à jour `release/`, vérifie qu’une seule version est
  présente, puis nettoie les artefacts. Utiliser `bun run clean:build` après un
  build desktop et `bun run clean:all` pour les caches globaux. Le dossier
  `release/` n’est jamais supprimé.

### 0.3 Principes de sécurité spécifiques

1. **Le secret ne transite que dans la réponse au système.** Une extension
   AutoFill déchiffre l’élément demandé, appelle `completeRequest`, puis efface
   ses tampons. Rien en clair sur disque, dans les journaux ou dans
   `UserDefaults`.
2. **Les métadonnées publiées au système sont un choix explicite.** Publier des
   identités dans `ASCredentialIdentityStore` (utilisateur + domaine) les rend
   lisibles hors du coffre chiffré. C’est **désactivé par défaut**, activé dans
   les réglages, documenté dans `docs/SECURITY.md`. Sans cette option,
   l’AutoFill fonctionne quand même, mais l’utilisateur ouvre la liste Coffre
   au lieu de voir une suggestion directe.
3. **Une seule règle de correspondance de domaines.** Le choix des connexions
   pour un domaine doit donner le même résultat dans l’app (TypeScript,
   `loginAllowsHost`), dans l’extension navigateur et dans les extensions
   natives (Rust). Vecteurs de test croisés obligatoires.
4. **Le verrouillage de l’app s’applique partout.** Verrouiller Coffre, changer
   le mot de passe maître, activer le mode voyage ou révoquer Touch ID
   invalide aussi l’accès des extensions natives.
5. **Rôles et mode voyage respectés.** Les coffres retirés par le mode voyage
   disparaissent du magasin d’identités ; un coffre partagé en lecture seule
   reste utilisable pour remplir, jamais pour enregistrer.

---

## 1. Vue d’ensemble

| Lot | Fonction | Plateforme | Compte payant | Taille |
| --- | --- | --- | --- | --- |
| S1 | Intégration de base : verrouillage avec la session, icône de barre de menus, démarrage à l’ouverture, Windows Hello | macOS, Windows, Linux | Non | M |
| S2 | Cœur natif pour extensions : ouverture par clé, recherche par domaine, passkeys en Rust, bindings Swift | Toutes | Non | M |
| S0 | Socle Apple : Developer ID, App Group, Keychain Access Group, `.appex` embarqués dans le bundle Tauri, notarisation | macOS | **Oui** | M |
| S3 | Extension AutoFill macOS : mots de passe et codes TOTP dans Safari et les apps natives | macOS 14+ | Oui | L |
| S4 | Passkeys système macOS : Coffre fournisseur de passkeys pour Safari, Chrome et les apps | macOS 14+ | Oui | L |
| S5 | Extension Safari : menu dans les champs, cartes, identités, enregistrement | macOS | Oui | M |
| S6 | Windows : pont natif, fournisseur de passkeys Windows 11 | Windows 11 | Optionnel | L |
| S7 | Linux : fournisseur Secret Service (optionnel) | Linux | Non | M |

> **Décision du 10 novembre 2026 : pas de compte Apple Developer.** S0, S3, S4
> et S5 sont **hors programme** : ils exigent un certificat Developer ID, des
> entitlements (App Group, AutoFill) et une notarisation qu’on ne peut pas
> obtenir sans compte payant. Ne pas les commencer. Les releases macOS sont
> signées ad hoc (voir `docs/RELEASE.md`). S1 et S2 sont faits ; restent S6
> (Windows) et S7 (Linux). Le cœur natif S2 reste utile au CLI et à de futures
> intégrations hors App Store.

Ordre retenu : **S6 → S7** (S1 et S2 terminés ; S0, S3, S4, S5 hors programme).

S1 et S2 commencent tout de suite et n’attendent aucun achat. S3 est le cœur du
plan : c’est lui qui fait apparaître Coffre à côté de Mots de passe et de
1Password dans Safari. S5 vient après S3 et S4, car l’AutoFill système couvre
déjà les mots de passe et les passkeys dans Safari ; l’extension ajoute le
reste (cartes, identités, proposition d’enregistrement).

---

## S1 — Intégration de base

### Pourquoi
Ce que les utilisateurs attendent d’une app desktop de mots de passe, sans
dépendance à un compte payant : Coffre se verrouille quand l’ordinateur se
verrouille, reste accessible depuis la barre de menus, et se déverrouille par
biométrie aussi sous Windows.

### Conception
- **Verrouillage avec la session** (nouveau module
  `src-tauri/src/session_watch.rs`) :
  - macOS : notification distribuée `com.apple.screenIsLocked` et
    `NSWorkspaceWillSleepNotification` (via `objc2`, déjà en dépendance) ;
  - Windows : `WTSRegisterSessionNotification` (`WTS_SESSION_LOCK`) et
    `WM_POWERBROADCAST` (`PBT_APMSUSPEND`) ;
  - Linux : signaux D-Bus de logind `PrepareForSleep` et `Session.Lock`.

  Chaque événement émet `coffre://system-lock` ; `VaultProvider` appelle
  `lock()`. Deux réglages, actifs par défaut : « Verrouiller à la mise en
  veille » et « Verrouiller avec la session ».
- **Icône de barre de menus / zone de notification** (Tauri `tray-icon`) :
  ouvrir Coffre, recherche rapide (même action que `⌘⇧Espace`), générateur,
  verrouiller. Le menu n’affiche **aucun** nom d’élément ni secret. Option
  « Garder Coffre dans la barre de menus à la fermeture de la fenêtre ».
- **Démarrage à l’ouverture de session** (`tauri-plugin-autostart`),
  désactivé par défaut ; Coffre démarre verrouillé et masqué.
- **Windows Hello** : équivalent de Touch ID. La clé maîtresse est protégée
  par une clé `KeyCredentialManager` (Windows Hello) ou, à défaut, par DPAPI
  avec vérification `UserConsentVerifier` avant chaque libération. Même
  contrat que le module Touch ID actuel : service de trousseau séparé, raison
  fixée côté Rust, suppression au verrouillage explicite, à la rotation et à
  la récupération.

### Critères d’acceptation
- Verrouiller la session macOS ou Windows, ou mettre en veille, verrouille
  Coffre en moins d’une seconde et efface le presse-papiers géré.
- Une écriture en cours au moment du verrouillage n’est pas perdue (même
  garantie que `drainingRef` dans `VaultProvider`).
- Le menu de la barre ne révèle aucun contenu du coffre, verrouillé ou non.
- Windows Hello : refus de l’empreinte ou du PIN → aucune clé libérée ;
  changement de mot de passe maître → l’enveloppe Hello est supprimée.

### Tests
- Unitaires Rust : traduction des événements système en `system-lock`
  (événements simulés).
- Vitest : `VaultProvider` reçoit `coffre://system-lock` pendant une écriture.
- Manuel : macOS (verrouillage `⌃⌘Q`, veille), Windows 11 (`⊞L`, Hello).

---

## S2 — Cœur natif pour les extensions

### Pourquoi
Les extensions AutoFill et passkeys sont des processus séparés, écrits en
Swift (ou C++ sous Windows). Elles doivent déchiffrer le coffre avec **le même
code** que l’app, pas avec une réimplémentation.

### Conception
Dans `coffre-core` et `coffre-core-ffi` (aujourd’hui : `core_open_vault`,
`core_verify_vault`, mutations, rotation, fusion) :
- `core_open_vault_with_key(file, master_key)` : ouverture par la clé
  maîtresse libérée par Touch ID ou Hello, sans Argon2id.
- `core_logins_for_service(file, keys, service)` : connexions candidates pour un
  domaine ou un identifiant d’app, **même règle que `loginAllowsHost`**
  (domaine enregistrable, sous-domaines, ports, `http` refusé si l’élément
  est en `https`). Retourne des métadonnées, jamais de secret.
- `core_reveal_login(file, keys, item_id)` : mot de passe et code TOTP du seul
  élément choisi, dans un tampon `Zeroizing`.
- `core_credential_identities(file, keys)` : liste `(item_id, utilisateur,
  service)` pour le magasin d’identités du système (S3, S4).
- `core_passkey_assert` et `core_passkey_create` : signature ES256 (crate
  `p256`) avec les mêmes validations de RP ID et le même format PKCS#8 que
  `src/lib/passkeys.ts`.
- Bindings Swift générés par UniFFI, empaquetés en `CoffreCore.xcframework`
  par `scripts/build-coffre-core-apple.sh` (local, pas en CI).

### Critères d’acceptation
- Vecteurs croisés TypeScript ↔ Rust pour la correspondance de domaines
  (au moins 40 cas : sous-domaines, IDN, ports, IP, `localhost`, apps) et pour
  les passkeys (une signature Rust vérifiée par le code TS et inversement).
- Aucun secret dans les types de retour de `core_logins_for_service` et
  `core_credential_identities`.
- `cargo test -p coffre-core -p coffre-core-ffi` passe sur Linux.

---

## S0 — Socle Apple

### Prérequis
Compte Apple Developer créé **par l’utilisateur**, identifiant d’équipe fourni.

### Conception
- Identifiants : app `app.coffre.desktop`, App Group (préfixé par l’équipe sur
  macOS, `TEAMID.app.coffre.desktop`), Keychain Access Group partagé.
- Déplacer `vault.coffre`, ses sauvegardes et les fichiers de synchronisation
  dans le conteneur App Group, avec une migration unique depuis
  `Application Support` (même logique que la migration IndexedDB → natif).
- Projet Xcode minimal `macos/Coffre.xcodeproj` contenant les cibles natives
  (S3, S4, S5) ; `scripts/build-macos-extensions.sh` produit les `.appex`
  signés, copiés dans `Coffre.app/Contents/PlugIns/` via `bundle.macOS.files`
  de `tauri.conf.json`, puis re-signature de l’ensemble.
- Notarisation (`notarytool`) et agrafage dans `release.yml` uniquement.
- Entitlements séparés par cible ; hardened runtime conservé.

### Critères d’acceptation
- L’app signée Developer ID et notarisée s’ouvre sans avertissement
  Gatekeeper.
- Le coffre existant est migré dans l’App Group sans perte, sauvegardes
  comprises ; retour en arrière documenté.
- `spctl --assess` et `codesign --verify --deep --strict` passent.

---

## S3 — Extension AutoFill macOS

### Pourquoi
C’est ce qui fait apparaître Coffre dans Réglages Système → Mots de passe →
Remplissage automatique, et proposer ses identifiants dans Safari et dans
toutes les apps natives.

### Conception
Architecture détaillée dans `docs/MACOS-AUTOFILL.md` § 3. Points à respecter :
- Cible `CoffreAutoFill`, sous-classe de `ASCredentialProviderViewController` :
  `prepareCredentialList(for:)`, `provideCredentialWithoutUserInteraction`
  (seulement si une clé Touch ID est disponible et que l’app n’a pas été
  verrouillée explicitement), `prepareInterfaceToProvideCredential`.
- Déverrouillage : Touch ID via un élément de trousseau partagé
  (`kSecAttrAccessGroup`, `SecAccessControl` avec
  `kSecAccessControlBiometryCurrentSet`), sinon mot de passe maître (Argon2id
  dans l’extension, avec les plafonds `KDF_LIMITS`).
- Codes à usage unique : `ASOneTimeCodeCredential` sur les versions de macOS
  qui le proposent, à partir du TOTP de l’élément.
- Magasin d’identités (principe 0.3-2) : l’app appelle
  `ASCredentialIdentityStore` après chaque création, modification,
  suppression, import, synchronisation et activation du mode voyage, via
  `objc2-authentication-services` côté Rust. Désactiver l’option vide le
  magasin.
- Verrouillage partagé : l’app écrit un marqueur d’époque de session dans
  l’App Group ; un verrouillage explicite ou une rotation de clés force
  l’extension à redemander Touch ID ou le mot de passe.
- Interface de l’extension en français, sobre, cohérente avec les jetons de
  design (SwiftUI, pas de WebView).

### Critères d’acceptation
- Coffre apparaît dans les réglages du remplissage automatique et propose les
  bonnes connexions dans Safari et dans au moins deux apps natives.
- Un domaine non correspondant ne propose rien sans recherche explicite.
- Option d’identités désactivée : aucun nom d’utilisateur ni domaine n’est
  visible hors du coffre.
- Verrouiller l’app → la requête AutoFill suivante exige une authentification.
- Mode voyage → les éléments des coffres retirés ne sont plus proposés.

### Tests
- Tests unitaires Swift sur le pont vers `CoffreCore` (fichier de test v4).
- Liste de contrôle manuelle dans la PR : Safari, Chrome (via AutoFill
  système), une app native, Touch ID refusé, mot de passe maître, mode voyage.

---

## S4 — Passkeys système macOS

### Conception
- Même cible que S3, avec les API passkeys de macOS 14+ :
  `ASPasskeyCredentialIdentity`, `prepareInterface(forPasskeyRegistration:)`,
  assertion via `ASPasskeyAssertionCredential`.
- Signature et création déléguées à `core_passkey_assert` et
  `core_passkey_create` (S2) ; même type d’élément « passkey » que l’app et
  l’extension navigateur.
- L’extension navigateur continue d’intercepter WebAuthn dans Chromium et
  Firefox ; un réglage permet de laisser le système gérer les passkeys à la
  place, pour éviter deux fenêtres concurrentes.
- `UV` honoré : Touch ID ou mot de passe maître avant chaque signature.

### Critères d’acceptation
- Création puis connexion sur au moins deux sites de démonstration WebAuthn
  dans Safari et dans Chrome, avec la passkey visible dans Coffre.
- Une passkey créée par le système est utilisable par l’extension
  navigateur, et inversement.
- RP ID invalide ou origine non correspondante → refus, sans fenêtre.

---

## S5 — Extension Safari

### Conception
- Conversion de l’extension MV3 existante
  (`xcrun safari-web-extension-converter`) en cible de l’app, sans dupliquer
  le code source : le build Vite produit le dossier, Xcode l’embarque.
- Safari n’utilise pas d’hôte natif en `stdio` : `SafariWebExtensionHandler`
  (dans le bundle de l’app) relaie les messages vers le même canal local que
  l’hôte natif actuel (`app.coffre.bridge`), avec le même protocole appairé
  (ECDH P-256, HKDF, AES-256-GCM, compteurs anti-rejeu).
- Les passkeys passent par S4 dans Safari ; l’interception WebAuthn de
  l’extension y est désactivée.
- Avant de commencer, vérifier les conditions de distribution d’une extension
  Safari dans une app Developer ID hors Mac App Store.

### Critères d’acceptation
- Menu dans les champs, remplissage des cartes et identités, proposition
  d’enregistrement : mêmes parcours que sur Chromium.
- Les tests Playwright WebKit existants restent verts ; liste de contrôle
  manuelle dans Safari.

---

## S6 — Windows

### Conception
- Pont natif : vérifier l’enregistrement de l’hôte `app.coffre.bridge` dans le
  registre (Chrome, Edge, Firefox) et le tester sur une vraie machine
  Windows 11.
- Fournisseur de passkeys Windows 11 : API « plugin authenticator » de
  `webauthn.dll`. **Vérifier l’état et la disponibilité de l’API au moment du
  lot** ; si elle exige un empaquetage MSIX signé, s’arrêter et demander à
  l’utilisateur.
- Même délégation à `core_passkey_*` et même validation que S4.

### Critères d’acceptation
- Remplissage via le pont natif dans Edge et Chrome sous Windows 11.
- Si le fournisseur est livré : création et connexion d’une passkey dans
  Edge sans l’extension.

---

## S7 — Linux : fournisseur Secret Service (optionnel)

### Conception
- Comme KeePassXC : Coffre peut exposer un coffre dédié via l’API D-Bus
  `org.freedesktop.secrets`, pour que d’autres apps y rangent leurs secrets.
- Désactivé par défaut ; un seul coffre exposé, choisi par l’utilisateur ;
  confirmation pour chaque nouvelle application cliente.
- Incompatible avec `gnome-keyring` actif sur le même bus : détection et
  message clair.

### Critères d’acceptation
- `secret-tool store` puis `secret-tool lookup` fonctionnent avec Coffre
  déverrouillé, et échouent quand il est verrouillé.

---

## 2. Points de vigilance transverses

- **Mémoire des extensions** : les extensions système vivent dans des
  processus courts mais réutilisables. Effacer les clés à la fin de chaque
  requête, ne jamais garder un coffre ouvert entre deux requêtes.
- **Fichier modifié pendant une requête** : l’extension lit sans modifier
  (sauf création de passkey en S4, qui passe par une écriture contrôlée avec
  la révision attendue). Une écriture concurrente de l’app est détectée.
- **Fichier en lecture seule** (MAC invalide, retour en arrière) : l’extension
  refuse de remplir et renvoie vers l’app.
- **Documentation** : chaque lot met à jour `README.md` (fonctionnalités,
  plateformes), `docs/SECURITY.md` (surface ajoutée, métadonnées exposées),
  `docs/RELEASE-READINESS.md` (tableau des plateformes) et `CHANGELOG.md`.
- **Hors périmètre** : mises à jour automatiques (lot de distribution séparé,
  à concevoir pour re-signer correctement les `.appex` embarqués) et apps
  mobiles (L8).
