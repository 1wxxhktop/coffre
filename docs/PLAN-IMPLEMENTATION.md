# Plan d’implémentation — Coffre au niveau des meilleurs gestionnaires

Document destiné à un agent de développement. Il décrit, lot par lot, ce qu’il
faut construire, dans quel ordre, avec quels fichiers, quels critères
d’acceptation et quels tests. Chaque lot est conçu pour aboutir à **une PR
autonome**, fusionnable et testée.

Base de départ : branche `main` après fusion de la PR #3 (corrections de
l’audit du 8 novembre 2026), version 0.8.0.

---

## 0. Règles pour l’agent (à respecter dans tous les lots)

### 0.1 Principes non négociables

1. **Local-first.** Aucun compte, aucun serveur Coffre. Toute fonction réseau
   est **désactivée par défaut**, activée explicitement par l’utilisateur, et
   documentée dans `docs/SECURITY.md`.
2. **Aucune baisse de sécurité.** Ne jamais affaiblir : Argon2id et ses
   plafonds (`KDF_LIMITS`), AES-256-GCM avec AAD par usage (`crypto.ts`), CSP
   Tauri et Web, capability Tauri minimale, `freezePrototype`, garde de
   navigation, permissions minimales de l’extension.
3. **Écritures contrôlées.** Toute mutation passe par `persist(base, next)` puis
   `commit(epoch, file, update)` dans `VaultProvider.tsx`. Ne jamais appeler
   `saveVaultFile` directement depuis une mutation. Toute opération qui change
   des clés passe par `RekeyedVault` (`install` après écriture réussie,
   `discard` sinon).
4. **Compatibilité ascendante.** Un fichier `.coffre` existant (v1 à v3) doit
   toujours s’ouvrir. Chaque nouvelle version de format a sa migration et ses
   tests (fixtures dans `src/lib/__fixtures__`).
5. **Secrets en mémoire.** Effacer (`wipe`) tout tampon de clé ou de secret dès
   qu’il n’est plus utile. Ne jamais journaliser un secret. Ne jamais placer un
   secret dans une URL, `localStorage`, un message d’erreur ou un événement.
6. **Interface et documentation en français**, ton actuel du projet.

### 0.2 Méthode de travail

- Une branche et une PR par lot (ou sous-lot si le lot est gros). Titre et
  description en français ; la description liste ce qui est vérifié et ce qui
  ne l’est pas.
- Avant d’écrire du code : lire les fichiers cités dans le lot, puis écrire un
  court document de conception dans la PR (format, flux, menaces).
- Toute affirmation de sécurité nouvelle est prouvée par un test (unitaire ou
  e2e) ; tout bug corrigé reçoit un test de non-régression.
- Mettre à jour `README.md`, `docs/SECURITY.md`, `docs/RELEASE-READINESS.md` et
  `CHANGELOG.md` (section « Non publié ») dans la même PR.

### 0.3 Contrôles obligatoires avant chaque PR

```bash
bun run typecheck          # inclut tsconfig.e2e.json
bun run lint               # 0 erreur
bun run test               # Vitest
bun run test:e2e           # Chromium + WebKit
bun run build
bun run extension:build
bun run version:check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Le smoke de l’extension (`bun run extension:smoke`) exige l’application sur
`127.0.0.1:1420` et `node scripts/smoke-target.mjs` sur `127.0.0.1:8099`.

### 0.4 Carte du code actuel

| Domaine | Fichiers |
| --- | --- |
| Primitives crypto, AAD, KDF | `src/lib/crypto.ts`, `src/lib/kdf.worker.ts` |
| Format, hiérarchie de clés, mutations, rotation | `src/lib/vault.ts`, `src/lib/types.ts` |
| Stockage Web (IndexedDB) et natif | `src/lib/storage.ts`, `src-tauri/src/vault_store.rs` |
| État applicatif, verrouillage, écritures | `src/state/VaultProvider.tsx`, `src/hooks/useAutoLock.ts` |
| Commandes natives (trousseau, Touch ID, presse-papiers, raccourci) | `src-tauri/src/lib.rs` |
| Extension MV3 (Chromium, Firefox) | `extension/background.ts`, `extension/popup.ts`, `src/lib/extensionProtocol.ts`, `src/components/ExtensionBridge.tsx` |
| Imports et exports | `src/lib/import.ts`, `src/lib/onePassword.ts`, `src/lib/export.ts` |
| Robustesse, santé du coffre | `src/lib/strength.ts`, `src/lib/security.ts` |
| CI et release | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/release-macos.sh` |

---

## 1. Vue d’ensemble et ordre des lots

| Lot | Sujet | Dépend de | Taille |
| --- | --- | --- | --- |
| L1 | Format v4 : métadonnées de synchronisation, pierres tombales, intégrité globale | — | M |
| L2 | Cœur Rust partagé (`coffre-core`) avec vecteurs de test croisés | L1 | L |
| L3 | Synchronisation chiffrée par dossier utilisateur | L1 (L2 recommandé) | L |
| L4 | Pont natif extension ↔ application desktop | — | M |
| L5 | Remplissage enrichi (menu dans les champs, enregistrement, iframes) | L4 recommandé | L |
| L6 | Passkeys (WebAuthn) dans l’extension | L1, L5 | L |
| L7 | Protection matérielle (Secure Enclave / Windows Hello / FIDO2 PRF) | certificat Developer ID pour macOS | M |
| L8 | Applications mobiles iOS et Android avec remplissage système | L2, L3 | XL |
| L9 | Surveillance des fuites (opt-in, k-anonymat) | — | S |
| L10 | Partage de coffres et accès d’urgence | L1, L3 | L |
| L11 | Nouveaux types d’éléments, agent SSH, CLI | L2 | M |
| L12 | Confiance : audit externe, builds reproductibles, SBOM, bug bounty | toutes | continu |

Ordre recommandé : **L1 → L4 → L3 → L5 → L6 → L9 → L2 → L7 → L8 → L11 → L10**,
L12 en continu (la préparation de l’audit commence dès L1).

Tailles : S ≈ 2-4 jours, M ≈ 1-2 semaines, L ≈ 3-5 semaines, XL ≈ 2-3 mois
(estimations pour un développeur ; à affiner dans chaque PR).

---

## L1 — Format v4 : synchronisation et intégrité

### Objectif
Préparer le fichier `.coffre` à la fusion entre appareils et à la détection
des retours en arrière (rollback), limites connues du format v3 (pas de MAC
global, suppressions non tracées).

### Conception
Nouveaux champs (en clair sauf mention) :

```ts
interface VaultFileV4 extends VaultFile {
  version: 4
  /** Identifiant aléatoire de l’appareil qui a écrit en dernier. */
  writer: string
  /** Compteur monotone du fichier, incrémenté à chaque écriture. */
  revision: number
  /** Époque des clés : incrémentée à chaque rotation (mot de passe, phrase). */
  keyEpoch: number
  /** Suppressions définitives, conservées N jours pour la synchronisation. */
  tombstones: Array<{ kind: 'item' | 'vault'; id: string; deletedAt: string }>
  /** MAC global (HMAC-SHA-256) sur un manifeste canonique, voir ci-dessous. */
  integrity: { mac: string; key: Sealed }
}
// Ajout par enregistrement d’élément et de coffre :
interface RecordClock { rev: number; writer: string }
```

- **Horloge par enregistrement** : `rev` (compteur de Lamport) + `writer`.
  Chaque mutation d’un élément incrémente `rev = max(rev connus) + 1`.
- **Pierres tombales** : `deleteItems` et `deleteVault` ajoutent une entrée au
  lieu de simplement retirer l’enregistrement. Purge après 180 jours (réglable).
- **MAC global** : clé MAC aléatoire de 32 octets, scellée par la clé maîtresse
  (AAD `coffre:v1:integrity-key`) et tournée avec les autres clés. Le MAC porte
  sur un manifeste canonique (JSON trié) : identifiant du fichier, `revision`,
  `keyEpoch`, et pour chaque enregistrement `(type, id, vaultId, rev, SHA-256
  du ciphertext)`, plus les pierres tombales. À l’ouverture : MAC invalide →
  avertissement bloquant (« fichier altéré ») avec possibilité d’ouvrir en
  lecture seule.
- **Anti-rollback local** : mémoriser la plus haute `revision` vue pour ce
  fichier (desktop : fichier `vault/state.json` ; Web : IndexedDB, clé
  `state`). Un fichier dont la `revision` est inférieure déclenche un
  avertissement explicite (restauration volontaire de sauvegarde exceptée).

### Étapes
1. `types.ts` : types v4 ; `vault.ts` : schéma Zod v4, migration v3 → v4 à
   l’écriture (horloges initialisées à `rev = 1`, `keyEpoch = 1`).
2. `crypto.ts` : `integrityKeyAad()`, fonction `hmacSha256` (WebCrypto).
3. `vault.ts` : `computeManifest`, `signFile`, `verifyFileMac` ; appel dans
   `persist` (signature) et à l’ouverture (vérification).
4. `rotateContentKeys` : faire tourner aussi la clé MAC et incrémenter
   `keyEpoch`.
5. `verifyVaultFile` : inclure le MAC et la cohérence des pierres tombales.
6. Stockage de la `revision` maximale vue (Web et natif) et avertissement.

### Critères d’acceptation
- Un fichier v3 s’ouvre, est migré en v4 à la première écriture, puis se
  rouvre ; les anciens tests passent.
- Supprimer, réordonner ou remplacer un enregistrement par une ancienne
  version (même ciphertext authentique) est détecté par le MAC.
- Restaurer une sauvegarde plus ancienne via l’écran prévu n’alerte pas ;
  substituer le fichier sur disque alerte.

### Tests
Unitaires : migration, manifeste canonique stable, détection de suppression,
rejeu d’un ancien enregistrement, rotation de la clé MAC. E2e : altération
du fichier IndexedDB entre deux ouvertures → avertissement visible.

---

## L2 — Cœur Rust partagé `coffre-core`

### Objectif
Une seule implémentation du format et de la crypto pour le desktop, la CLI,
l’agent SSH et les extensions mobiles (iOS/Android ne peuvent pas exécuter le
code TypeScript dans leurs extensions de remplissage).

### Conception
- Nouveau crate `crates/coffre-core` (workspace Cargo à la racine de
  `src-tauri` ou à la racine du dépôt) : `argon2`, `aes-gcm`, `hmac`, `sha2`,
  `zeroize`, `serde`, `serde_json`. Aucune dépendance réseau.
- API : `open(file, password) -> Session`, `Session::items()`, mutations,
  `rotate`, `merge` (L3), `verify`. Les secrets sont dans des types
  `Zeroizing`.
- **Vecteurs de test croisés** : un dossier `test-vectors/` produit par le code
  TypeScript (script `scripts/gen-test-vectors.ts`) et relu par Rust, et
  inversement. Le format est la seule source de vérité.
- Liaisons : `uniffi` pour Swift/Kotlin (L8), commandes Tauri pour le desktop.

### Étapes
1. Créer le crate, porter `crypto.ts` puis `vault.ts` (lecture d’abord).
2. Générer les vecteurs depuis TypeScript (fichiers v1 à v4, éléments de
   chaque type, pièces jointes, versions, enveloppe de récupération).
3. Porter les mutations, la rotation, la vérification.
4. CI : job `core` (Linux, macOS, Windows) qui exécute les vecteurs.

### Critères d’acceptation
- Rust ouvre tous les fichiers produits par TypeScript et inversement, octet
  pour octet identiques après déchiffrement.
- `cargo test -p coffre-core` vert sur les trois OS.

### Remarque
Le desktop peut continuer à utiliser le code TypeScript ; `coffre-core` sert
d’abord aux composants qui ne peuvent pas l’exécuter (L8, L11).

---

## L3 — Synchronisation chiffrée par dossier utilisateur

### Objectif
Synchroniser plusieurs appareils **sans serveur Coffre**, via un dossier que
l’utilisateur contrôle déjà : iCloud Drive, Dropbox, OneDrive, Syncthing, clé
USB.

### Conception
- Le dossier contient un fichier par appareil :
  `Coffre/<idFichier>/<idAppareil>.coffre` (évite les conflits d’écriture du
  service de synchronisation) et un `README.txt`.
- Chaque appareil écrit uniquement son propre fichier ; il **lit** les autres et
  fusionne dans son coffre local.
- **Fusion par enregistrement** (`mergeVaultFiles(local, remotes)`) :
  - même `id` : on garde l’enregistrement au `rev` le plus haut ; égalité →
    départage par `writer` (ordre lexicographique), puis signalement d’un
    conflit si les contenus diffèrent (on conserve l’autre version dans
    l’historique de l’élément) ;
  - pierre tombale plus récente que l’enregistrement → suppression ;
  - versions (`versions`) : union, plafonds appliqués après fusion ;
  - pièces jointes : union, référencées par l’élément retenu.
- **Époques de clés** : si `keyEpoch` distant > local (mot de passe changé sur
  un autre appareil), l’utilisateur saisit le nouveau mot de passe ; on
  déchiffre l’élément local modifié avec les anciennes clés et on le
  rechiffre sous les nouvelles avant fusion. Jamais de fusion de ciphertexts
  issus d’époques différentes sans les rechiffrer.
- Vérification du MAC global (L1) de chaque fichier distant avant fusion ; un
  fichier distant invalide est ignoré et signalé.
- Desktop : commandes Rust `sync_list(dir)`, `sync_read(path)`,
  `sync_write(dir, contents)` limitées au dossier choisi (chemin canonique
  vérifié, pas de `..`), surveillance par `notify` (crate) avec anti-rebond.
- Web : File System Access API (Chromium) avec handle persistant ; sinon
  import/export manuels.
- Interface : réglage « Synchronisation » (choix du dossier, état, dernière
  synchronisation, conflits), badge dans la barre latérale.

### Étapes
1. `src/lib/sync.ts` : `mergeVaultFiles` pur, sans entrée-sortie.
2. Tests de propriété (fast-check) : commutativité, idempotence, convergence
   de N appareils avec mutations aléatoires.
3. Commandes Rust et surveillance du dossier.
4. Intégration dans `VaultProvider` : fusion = mutation contrôlée
   (`persist` + `commit`) ; aucune fusion pendant qu’une écriture est en cours.
5. Interface et documentation.

### Critères d’acceptation
- Deux instances desktop (deux dossiers de données) pointant sur le même
  dossier convergent après des modifications concurrentes, y compris
  suppression d’un côté et modification de l’autre.
- Changement de mot de passe sur A puis modification sur B : B demande le
  nouveau mot de passe et ne perd rien.
- Un fichier distant altéré est refusé avec un message clair.

### Tests
Propriétés sur `mergeVaultFiles` ; e2e Web avec deux contextes et un dossier
simulé ; test Rust de confinement des chemins.

---

## L4 — Pont natif entre l’extension et l’application desktop

### Objectif
Aujourd’hui, l’extension ne parle qu’à un **onglet** Coffre Web déverrouillé,
qui se verrouille dès qu’il passe en arrière-plan. Les meilleurs gestionnaires
parlent à l’application de bureau. Ce lot supprime le conflit avec le
verrouillage en arrière-plan.

### Conception
- **Native messaging** : permission `nativeMessaging` ; manifeste d’hôte
  `app.coffre.bridge.json` installé par l’application desktop dans les
  dossiers de Chrome, Edge, Brave et Firefox (`allowed_origins` limité à
  l’identifiant de l’extension publiée).
- **Binaire relais** `coffre-bridge` (sidecar Tauri) : lit/écrit des messages
  préfixés par leur longueur sur stdin/stdout et les relaie vers l’application
  par un socket local (Unix : fichier `0600` dans le dossier de données ;
  Windows : named pipe avec ACL de l’utilisateur).
- **Appairage** : au premier contact, l’application affiche un code à 6
  chiffres que l’utilisateur confirme dans l’extension ; échange de clés X25519,
  dérivation d’une clé de session (HKDF) ; messages chiffrés en AES-GCM avec
  compteur anti-rejeu. La clé d’appairage est stockée dans
  `chrome.storage.local` (extension) et dans le trousseau (application).
- **Contrôle du processus appelant** (macOS) : l’application vérifie la
  signature du relais (`SecCodeCheckValidity`) ; le relais vérifie qu’il est
  lancé par un navigateur connu.
- L’application répond seulement si elle est déverrouillée ; sinon elle
  propose de se déverrouiller (fenêtre au premier plan, Touch ID).
- Le protocole reprend `extensionProtocol.ts` (`search`, `fill`) avec le
  contrôle de domaine existant, plus `status` et `unlock-request`.
- L’onglet Web reste une solution de repli.

### Critères d’acceptation
- Extension + application desktop verrouillée : clic « Remplir » → fenêtre
  Coffre, Touch ID, remplissage.
- Un autre processus local sans la clé d’appairage ne peut rien obtenir.
- Smoke test étendu au mode natif (hôte simulé en CI).

---

## L5 — Remplissage enrichi

### Objectif
Atteindre le confort des meilleurs : menu directement dans les champs,
proposition d’enregistrer un nouvel identifiant ou de mettre à jour un mot de
passe, iframes, connexions en plusieurs étapes, TOTP.

### Conception
- **Permissions** : demander `optional_host_permissions` (`https://*/*`) au
  premier usage, avec explication ; sans elles, garder le mode actuel au clic.
- **Content script** (monde isolé) injecté sur les pages autorisées :
  - détection des formulaires (heuristiques actuelles de `fill`, extraites dans
    `extension/detect.ts`, testées sur un corpus de pages HTML enregistrées) ;
  - **menu en ligne** rendu dans un `iframe` d’extension (origine
    `chrome-extension://`), jamais dans le DOM de la page, pour que la page ne
    puisse ni le lire ni le simuler ;
  - aucun secret transmis au content script avant un clic de l’utilisateur
    dans ce menu, et seulement pour l’origine **exacte** de la frame
    (`sender.origin`), avec le contrôle `hostAllowsFill`.
- **Iframes** : `allFrames: true`, mais remplissage seulement si l’origine de la
  frame correspond à l’élément ; jamais dans une frame tierce d’un autre site.
- **Enregistrement** : à la soumission (événement `submit` + détection d’un
  champ mot de passe rempli), proposer « Enregistrer dans Coffre » ou
  « Mettre à jour » si l’identifiant existe ; la création passe par le
  provider (mutation contrôlée).
- **Plusieurs étapes** : mémoriser l’identifiant choisi le temps de la session
  d’onglet (en mémoire du service worker, 2 minutes maximum).
- **TOTP** : remplissage du champ `one-time-code` ou copie automatique, réglable.
- **Firefox** : valider en exécution réelle (web-ext + Playwright Firefox).
- **Safari** : extension Web Safari empaquetée dans l’app macOS (Xcode,
  `safari-web-extension-converter`).

### Critères d’acceptation
- Corpus de 30 pages de connexion réelles enregistrées : ≥ 90 % des champs
  détectés correctement (tableau de résultats en CI).
- Une page malveillante ne peut ni lire le menu, ni déclencher un remplissage
  sans clic, ni obtenir les identifiants d’un autre domaine (tests e2e
  adverses : clickjacking, champ caché, iframe tierce, `opacity: 0`).

---

## L6 — Passkeys (WebAuthn)

### Objectif
Créer, stocker et utiliser des passkeys depuis l’extension, puis sur mobile
(L8) et sur desktop.

### Conception
- Nouveau type d’élément `passkey` (`types.ts`) : `rpId`, `userHandle`,
  `userName`, `credentialId`, clé privée PKCS#8 (ES256), `signCount`,
  `createdAt`, éventuel lien vers un élément `login`.
- **Interception** : script en monde `MAIN` injecté à `document_start` qui
  enveloppe `navigator.credentials.create/get` ; il ne voit jamais de clé. Il
  relaie la requête au service worker, qui demande confirmation dans une
  fenêtre de l’extension ; l’utilisateur peut toujours choisir « utiliser un
  autre appareil » (appel d’origine).
- **Validation de `rpId`** : doit être l’hôte de l’origine ou un suffixe
  enregistrable (liste des suffixes publics embarquée, mise à jour à chaque
  release) ; jamais d’opération pour une origine non sécurisée.
- **Création** : `crypto.subtle.generateKey({ name: 'ECDSA', namedCurve:
  'P-256' })`, export PKCS#8 ; `authenticatorData` = SHA-256(rpId) ‖ drapeaux
  (UP, UV, AT, BE, BS) ‖ `signCount` ‖ AAGUID Coffre ‖ longueur et
  identifiant ‖ clé publique COSE ; attestation `none` ; encodeur CBOR minimal
  et testé (`src/lib/cbor.ts`).
- **Assertion** : signature ECDSA sur `authenticatorData ‖ SHA-256(clientDataJSON)` ;
  conversion de la signature WebCrypto (r‖s) en DER.
- Exportation et importation au format FIDO CXF lorsqu’il sera stabilisé.

### Critères d’acceptation
- Inscription et connexion réussies sur webauthn.io et sur un serveur de test
  local (`@simplewebauthn/server`) en e2e.
- Refus d’un `rpId` qui n’est pas un suffixe de l’origine, d’une origine HTTP,
  d’un suffixe public (`com`, `github.io`).
- La clé privée n’apparaît jamais dans le monde `MAIN` ni dans les messages.

---

## L7 — Protection matérielle

### Objectif
Faire de Touch ID une protection du **système** et non plus seulement de
l’application, et ajouter Windows Hello et les clés de sécurité FIDO2.

### Conception
- **macOS** :
  - clé Secure Enclave (P-256, `kSecAttrTokenIDSecureEnclave`) avec contrôle
    d’accès `SecAccessControlCreateWithFlags(.privateKeyUsage |
    .biometryCurrentSet)` ;
  - la clé maîtresse est chiffrée par ECIES vers cette clé ; le déchiffrement
    exige Touch ID au niveau du système ;
  - nécessite le trousseau « data protection » et donc une signature
    Developer ID avec l’entitlement `keychain-access-groups` (vérifier s’il
    faut un profil de provisionnement) ; prévoir la migration depuis l’entrée
    actuelle `app.coffre.desktop.biometric`.
- **Windows** : `Windows.Security.Credentials.KeyCredentialManager` (Windows
  Hello) pour signer un défi dont on dérive la clé d’enveloppe.
- **FIDO2 / PRF** (Web et desktop) : `navigator.credentials.get({ extensions:
  { prf: { eval: { first: sel } } } })` ; la sortie PRF (32 octets) passe par
  HKDF et enveloppe la clé maîtresse dans une « enveloppe de déverrouillage »
  supplémentaire du fichier (comme `recovery`), révocable.
- Ces méthodes ne remplacent jamais le mot de passe maître : il reste le
  secret racine et sert après tout changement biométrique.

### Critères d’acceptation
- Lire l’entrée du trousseau avec `security find-generic-password` ne donne
  pas la clé maîtresse.
- Ajout d’une empreinte dans les réglages système → la clé est invalidée et le
  mot de passe est redemandé.
- Déverrouillage par YubiKey 5 (PRF) dans Chrome et Safari 18.

---

## L8 — Applications mobiles iOS et Android

### Objectif
Coffre sur téléphone, avec remplissage système des mots de passe et des
passkeys.

### Conception
- **Application** : Tauri mobile (`bun run mobile:ios:init`,
  `mobile:android:init`) pour l’interface existante, adaptée au tactile.
- **Synchronisation** : L3 (dossier iCloud Drive sur iOS ; Storage Access
  Framework sur Android).
- **iOS — extension de remplissage** : cible Swift
  `ASCredentialProviderViewController` (mots de passe, codes, passkeys
  iOS 17+) ; utilise `coffre-core` via `uniffi` ; fichier du coffre partagé
  dans un conteneur App Group ; mise à jour de `ASCredentialIdentityStore`
  (domaines et identifiants seulement, jamais de secret) ; déverrouillage par
  Face ID au niveau du système (clé Secure Enclave, comme L7).
- **Android** : `AutofillService` pour les mots de passe et
  `CredentialProviderService` (Android 14+) pour les passkeys ; `coffre-core`
  via JNI/uniffi ; clé protégée par le Keystore matériel
  (`setUserAuthenticationRequired`, `BIOMETRIC_STRONG`).
- Limite mémoire des extensions iOS (environ 120 Mo) : Argon2id avec 64 Mio
  est possible mais à mesurer ; prévoir le déverrouillage par Face ID dans
  l’extension pour éviter la dérivation.

### Critères d’acceptation
- Remplissage d’un identifiant dans Safari iOS et Chrome Android, et d’une
  passkey créée sur le desktop (via la synchronisation).
- Tests sur simulateur/émulateur en CI (XCTest, Espresso) et sur au moins un
  appareil réel par plateforme.

---

## L9 — Surveillance des fuites (optionnelle)

### Conception
- Réglage désactivé par défaut : « Vérifier mes mots de passe dans les fuites
  connues (Have I Been Pwned, k-anonymat) ».
- Calcul local du SHA-1, envoi des **5 premiers caractères hexadécimaux**
  seulement à `https://api.pwnedpasswords.com/range/<préfixe>` avec l’en-tête
  `Add-Padding: true` ; comparaison locale des suffixes.
- Desktop : requête faite par une commande Rust (`hibp_range`) qui valide le
  préfixe (`^[0-9A-F]{5}$`), pour garder la CSP de la WebView sans
  `connect-src` externe. Web : ajouter cet hôte unique au `connect-src` de
  `public/_headers`, la requête n’étant faite que si l’option est active.
- Résultats intégrés au tableau de santé (`security.ts`), sans persister
  aucun hash.

### Critères d’acceptation
- Test qui intercepte le réseau : seul un préfixe de 5 caractères part, jamais
  le hash complet ni le mot de passe ; aucune requête si l’option est inactive.

---

## L10 — Partage de coffres et accès d’urgence

### Conception (sans serveur)
- **Identité** : paire X25519 (chiffrement) + Ed25519 (signature) par
  utilisateur, clé privée scellée par la clé maîtresse ; empreinte affichable
  (mots ou QR code) pour vérification hors bande.
- **Partage** : un coffre partagé possède sa propre clé ; elle est enveloppée
  pour chaque membre (HPKE, RFC 9180, X25519 + AES-256-GCM). Les fichiers de
  partage transitent par un dossier synchronisé commun (L3) ou par fichier.
  Les rôles (lecture, écriture) sont signés par l’administrateur.
- **Révocation** : rotation de la clé du coffre partagé et nouvelle
  distribution aux membres restants (réutiliser `rotateContentKeys`).
- **Accès d’urgence** : enveloppe de la clé maîtresse pour un contact de
  confiance. Sans serveur, le délai d’attente ne peut pas être imposé : au
  choix, une enveloppe remise immédiatement (documentée comme telle), ou une
  enveloppe avec un secret partagé de Shamir (2 sur 3 contacts). Documenter
  clairement la différence avec les services centralisés.

### Critères d’acceptation
- Deux utilisateurs partagent un coffre via un dossier commun ; la révocation
  empêche l’ancien membre de lire tout ce qui est écrit ensuite.
- Tests de propriétés sur la distribution des clés.

---

## L11 — Types d’éléments, agent SSH et CLI

### Conception
- Types : `ssh-key` (privée, publique, empreinte), `api-credential`,
  `wifi` (QR code de connexion), `document` (pièce jointe principale),
  `software-license`. Schémas Zod, formulaires, import/export.
- **Agent SSH** (desktop, Rust, `coffre-core`) : socket `SSH_AUTH_SOCK` dans le
  dossier de données (`0600`) ; protocole agent SSH ; demande d’approbation par
  utilisation (fenêtre + Touch ID, mémorisation optionnelle par hôte et durée) ;
  ed25519 et RSA.
- **CLI** `coffre` (Rust) : `coffre get`, `coffre run --env` (injection de
  secrets dans un processus), `coffre totp` ; déverrouillage via
  l’application desktop (socket de L4) plutôt que saisie du mot de passe dans le
  terminal.
- **Règles de génération par site** : longueur, classes, symboles autorisés,
  importées de la liste communautaire « password-rules » d’Apple (embarquée).

---

## L12 — Confiance et maturité (continu)

1. **Audit externe** (crypto + application + extension) par un cabinet
   reconnu ; publier le rapport et les correctifs. Préparer dès L1 : modèle de
   menace à jour, schéma de format versionné, vecteurs de test.
2. **Releases signées** : certificat Developer ID et notarisation (chaîne déjà
   prête), signature Authenticode Windows, paquets Linux signés ; extension
   publiée sur le Chrome Web Store, AMO et l’App Store (Safari).
3. **Builds reproductibles** : versions d’outils figées (`rust-toolchain.toml`,
   `bun` exact), `SOURCE_DATE_EPOCH`, comparaison de deux builds en CI.
4. **SBOM** : `cargo cyclonedx` et `@cyclonedx/cyclonedx-npm`, joints à chaque
   release ; `cargo deny` (licences et avis) en CI.
5. **Bug bounty** et `/.well-known/security.txt` ; fuzzing du parseur de
   fichier et des importeurs (`cargo-fuzz` sur `coffre-core`, `fast-check`
   côté TypeScript) en CI de nuit.
6. **Code mort et dette** : supprimer les avertissements de lint restants,
   découper le bundle (import et export chargés à la demande).

---

## 2. Définition de « terminé » pour chaque lot

- Fonction utilisable de bout en bout, sans réglage caché.
- Tests unitaires et e2e verts sur Chromium et WebKit (et Firefox à partir de
  L5) ; tests Rust verts sur Linux, macOS et Windows pour le code natif.
- Aucune requête réseau nouvelle sans option explicite ; vérifiée par un test.
- `docs/SECURITY.md` à jour : modèle de menace, nouvelles données en clair,
  limites assumées.
- `CHANGELOG.md` et `README.md` à jour ; captures d’écran si l’interface change.
- PR relue, avec la liste de ce qui n’a pas pu être vérifié (appareil réel,
  navigateur, plateforme).
