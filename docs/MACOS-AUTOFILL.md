# Intégration macOS : AutoFill et app Mots de passe

> **Statut : document d’architecture.** Aucune extension native n’est encore
> implémentée. Ce document décrit ce qu’il faudrait construire pour que Coffre
> propose ses identifiants dans le remplissage automatique de macOS, comme
> 1Password ou l’app Mots de passe d’Apple.

## 1. Ce que « comme Mots de passe » signifie

L’app **Mots de passe** d’Apple n’expose pas d’API publique permettant à un
tiers de déposer des entrées dans sa base. La seule intégration système possible
consiste à devenir soi-même un **fournisseur d’identifiants AutoFill** :

- une extension macOS de type *AutoFill Credential Provider* ;
- une interface présentée par le système quand Safari ou une app demande un
  mot de passe ;
- un enregistrement préalable des identifiants auprès de
  `ASCredentialIdentityStore` pour que le système sache quoi proposer ;
- une authentification (Touch ID ou mot de passe maître) avant de livrer un
  secret.

Une fois cette extension installée et activée dans Réglages Système →
Mots de passe → Remplissage automatique, Coffre apparaît à côté de Mots de passe,
1Password, Bitwarden, etc.

## 2. Les deux niveaux d’intégration

| Niveau | Ce que ça donne | Complexité |
| --- | --- | --- |
| Import/export CSV | L’utilisateur exporte Coffre puis importe dans Mots de passe | Faible, réalisable sans Xcode |
| Extension AutoFill | Coffre proposé directement dans Safari et les apps | Élevée, extension native signée |
| Extension Safari | Remplissage dans Safari uniquement | Moyenne, Xcode requis |

L’**export CSV compatible Mots de passe** est l’option immédiate : elle ne
demande ni extension ni signature, mais elle est manuelle et ne remplace pas
l’AutoFill.

## 3. Architecture cible

```text
┌─────────────────────────────────────────────────────────────┐
│ Coffre.app                                                  │
│                                                             │
│  ┌───────────────────────┐      ┌────────────────────────┐  │
│  │ App Tauri             │      │ Extension AutoFill     │  │
│  │ (Rust + WebView)      │      │ (.appex, Swift)        │  │
│  │                       │      │                        │  │
│  │ UI complète           │      │ ASCredentialProvider…  │  │
│  │ création/édition      │      │ ASCredentialIdentity…  │  │
│  └──────────┬────────────┘      └───────────┬────────────┘  │
│             │                               │               │
│             └───────────┬───────────────────┘               │
│                         ▼                                   │
│         App Group « group.app.coffre.desktop »              │
│         ├── vault.coffre (format v3, chiffré)               │
│         └── vault-key (trousseau partagé, Touch ID)         │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Le stockage natif est en place ; reste l’App Group

Le coffre desktop est désormais stocké dans un fichier natif chiffré
(`app_data_dir()/vault/vault.coffre`), avec écritures atomiques, permissions
restrictives, trois sauvegardes tournantes et migration automatique depuis
l’ancien coffre IndexedDB. Les commandes Rust `vault_read`, `vault_write`,
`vault_backup_read`, `vault_backup_write` et `vault_clear` sont exposées à la
WebView, et `src/lib/storage.ts` conserve IndexedDB comme backend Web/PWA.

Pour l’AutoFill, il reste à **déplacer ce fichier dans un conteneur App Group**
partagé entre l’application et l’extension native :

- signer l’application et l’extension avec la même équipe Developer ID ;
- ajouter l’entitlement App Group aux deux cibles ;
- écrire `vault.coffre` et ses sauvegardes dans le conteneur partagé ;
- conserver le même format `.coffre` v3 et les mêmes AAD ;
- migrer une dernière fois un éventuel fichier de `Application Support` vers
  l’App Group.

Le stockage natif n’est donc plus le blocage : l’App Group, la signature stable
et l’extension AutoFill elle-même restent à réaliser.

### 3.2 Extension AutoFill

Cible Xcode : `CoffreAutoFill` de type **AutoFill Credential Provider**.

Fichiers principaux :

- `AutoFillProvider.swift` : sous-classe de
  `ASCredentialProviderViewController` ;
- `CredentialListViewController.swift` : liste filtrable des éléments ;
- `UnlockViewController.swift` : mot de passe maître ou Touch ID ;
- `IdentityStore.swift` : enregistrement/mise à jour des identités ;
- `VaultBridge.swift` : lecture du fichier partagé et déchiffrement.

Flux d’utilisation :

1. Safari appelle l’extension avec un `ASCredentialServiceIdentifier`
   (domaine ou app).
2. L’extension lit le coffre partagé, le déchiffre après authentification, puis
   filtre les connexions dont une URL correspond au domaine.
3. L’utilisateur choisit une entrée ; l’extension appelle
   `completeRequest(using: ASPasswordCredential(user:password:))`.
4. Le secret n’est jamais écrit sur disque en clair.

`ASCredentialIdentityStore.shared` sert à publier les identifiants
(`user`, `serviceIdentifier`) pour que le système propose Coffre avant même
l’ouverture de l’extension. Il faut le mettre à jour après chaque import,
création, modification ou suppression.

### 3.3 Déchiffrement dans l’extension

Le cœur cryptographique actuel est en TypeScript (WebCrypto + `hash-wasm`).
Il n’est pas réutilisable tel quel dans une extension Swift.

Trois options :

1. **Bibliothèque Rust partagée** (recommandé) : exposer le cœur `native/` ou un
   nouveau crate `coffre-core` en `staticlib`/`cdylib` avec une FFI C ou
   UniFFI. L’extension et l’app Tauri utilisent le même code de déchiffrement,
   les mêmes AAD et les mêmes validations.
2. **Réimplémentation Swift** : Argon2id (aucun support natif dans CryptoKit),
   AES-GCM via CryptoKit, parsing JSON. Plus de code à auditer et risque de
   divergence de format.
3. **Déverrouillage dans l’app** : l’extension demande le secret à l’app via un
   canal partagé. macOS ne garantit pas que l’app soit lancée ; ce n’est pas
   fiable pour AutoFill.

Recommandation : option 1, avec un crate `coffre-core` sans dépendance Tauri,
exposant au minimum `unlock`, `list_items`, `open_item` et `wipe`.

### 3.4 Clé biométrique partagée

Deux stratégies :

- **Mot de passe maître à chaque AutoFill** : l’extension dérive la clé
  Argon2id (coûteux, mais sans secret persistant). Mauvais pour l’UX.
- **Clé maîtresse dans un trousseau partagé avec contrôle d’accès Touch ID** :
  l’extension lit la clé après Touch ID. C’est le modèle visé, mais il faut un
  élément de trousseau protégé par `SecAccessControl`
  (`kSecAccessControlBiometryCurrentSet`) et un **Keychain Access Group**
  partagé entre l’app et l’extension.

L’implémentation actuelle (service `app.coffre.desktop.biometric` via `keyring`)
reste dans le trousseau de session et n’est pas partagée avec une extension.
Il faudra un vrai élément `kSecClassGenericPassword` avec
`kSecAttrAccessGroup` et `kSecAttrAccessControl`, créé par l’app et lisible par
l’extension. Cela impose une signature et des entitlements cohérents.

## 4. Entitlements et configuration

### 4.1 App Group

Partager le fichier chiffré et l’état minimal :

```xml
<key>com.apple.security.application-groups</key>
<array>
  <string>group.app.coffre.desktop</string>
</array>
```

L’app et l’extension doivent avoir le même App Group. Le conteneur se trouve
dans `~/Library/Group Containers/group.app.coffre.desktop/`.

### 4.2 AutoFill Credential Provider

Entitlement de l’extension :

```xml
<key>com.apple.developer.authentication-services.autofill-credential-provider</key>
<true/>
```

`Info.plist` de l’extension :

```xml
<key>NSExtension</key>
<dict>
  <key>NSExtensionPointIdentifier</key>
  <string>com.apple.authentication-services-credential-provider-ui</string>
  <key>NSExtensionPrincipalClass</key>
  <string>$(PRODUCT_MODULE_NAME).AutoFillProvider</string>
</dict>
```

### 4.3 Keychain Access Group

```xml
<key>keychain-access-groups</key>
<array>
  <string>$(AppIdentifierPrefix)app.coffre.desktop</string>
</array>
```

L’app et l’extension doivent être signées par la même équipe et utiliser le
même groupe.

### 4.4 Signature et notarisation

- Certificat **Developer ID Application** ;
- signature « inside-out » : d’abord l’extension, puis l’app, puis le DMG ;
- hardened runtime activé pour la distribution ;
- notarisation (`notarytool`) et agrafage (`stapler`) ;
- l’extension doit être signée avec les mêmes Team ID et entitlements que
  l’app, sinon macOS refuse de la charger.

Sans Developer ID, le remplissage automatique peut être refusé ou oublié par le
système. C’est le même type de contrainte que pour « Always Allow » du
trousseau.

## 5. Empaquetage avec Tauri

Tauri ne sait pas générer ni embarquer un `.appex`. Il faut un projet Xcode
séparé et une étape de post-build :

```text
src-tauri/
  macos/
    CoffreAutoFill.xcodeproj
    CoffreAutoFill/
      AutoFillProvider.swift
      Info.plist
      CoffreAutoFill.entitlements
```

Pseudo-étape de build :

```bash
xcodebuild -project src-tauri/macos/CoffreAutoFill.xcodeproj \
  -scheme CoffreAutoFill -configuration Release \
  -derivedDataPath target/autofill build

mkdir -p "Coffre.app/Contents/PlugIns"
cp -R target/autofill/Build/Products/Release/CoffreAutoFill.appex \
  "Coffre.app/Contents/PlugIns/"

codesign --force --options runtime --timestamp \
  --entitlements CoffreAutoFill.entitlements \
  --sign "$DEVELOPER_ID" \
  "Coffre.app/Contents/PlugIns/CoffreAutoFill.appex"

codesign --force --options runtime --timestamp \
  --entitlements Coffre.entitlements \
  --sign "$DEVELOPER_ID" "Coffre.app"
```

Cette étape doit s’exécuter **avant** la création du DMG. Tauri peut lancer un
script via un wrapper autour de `tauri build` ou via un `beforeBundleCommand`
si la version utilisée le permet.

## 6. Modifications côté application

### 6.1 Stockage natif

- `src-tauri/src/storage.rs` : lecture/écriture atomique du `.coffre` dans
  l’App Group ;
- commandes `vault_read`, `vault_write`, `vault_list_backups`,
  `vault_restore_backup` ;
- permissions Tauri correspondantes.

### 6.2 Synchronisation des identités

Après chaque opération qui change les éléments :

- recalculer la liste `(domaine, identifiant)` ;
- appeler `ASCredentialIdentityStore.shared.saveCredentialIdentities`
  (via une petite commande Rust/Swift ou un helper natif) ;
- supprimer les identités des éléments mis à la corbeille.

### 6.3 Verrouillage

- l’extension ne doit jamais garder la clé en mémoire au-delà de la requête ;
- verrouillage après inactivité ou à la fermeture de la feuille AutoFill ;
- effacement des tampons (mêmes règles que le cœur actuel).

## 7. Sécurité et limites

- Une extension est un processus distinct : toute faille dans l’extension
  expose le coffre. Le cœur Rust partagé doit être audité une seule fois pour
  les deux cibles.
- L’App Group est lisible par l’app et l’extension, pas par les autres apps,
  mais un processus avec les droits de l’utilisateur peut lire le conteneur.
  Le fichier reste chiffré ; la clé doit être protégée par le trousseau.
- L’AutoFill système peut demander une authentification à chaque appel selon la
  configuration de l’utilisateur ; prévoir un délai de réutilisation Touch ID
  raisonnable, sans jamais stocker le mot de passe maître en clair.
- Apple peut modifier les contraintes d’extension et de signature d’une version
  de macOS à l’autre ; tester sur la dernière version et sur la précédente.
- L’app Mots de passe d’Apple ne peut pas être remplie par un tiers : Coffre
  restera un fournisseur concurrent, pas une source d’entrées pour Mots de
  passe.

## 8. Feuille de route proposée

1. **Export CSV compatible Mots de passe** — court terme, sans Xcode.
2. **App Group** : déplacer le fichier natif déjà en place dans le conteneur
   partagé, avec le même format v3 et les mêmes sauvegardes.
3. **Crate `coffre-core`** partagé, avec FFI C/UniFFI et tests de vecteurs
   communs.
4. **Squelette de l’extension** : `ASCredentialProviderViewController`,
   déverrouillage, liste filtrée, `completeRequest`.
5. **Identités AutoFill** : `ASCredentialIdentityStore`, mise à jour après
   chaque mutation.
6. **Touch ID partagé** : élément de trousseau avec `SecAccessControl` et
   Keychain Access Group.
7. **Signature Developer ID + notarisation**, tests manuels dans Safari et
   dans au moins une app native.
8. **Audit externe** avant diffusion large.

## 9. Alternatives immédiates

- **Extension Safari** : réutilise le protocole de l’extension Chromium
  (`extension/`), mais reste un projet Xcode et ne couvre que Safari.
- **Export CSV** : `Mots de passe` importe les CSV ; c’est la passerelle la
  plus simple, sans prétendre à l’AutoFill.
- **Copier/coller assisté** : l’extension Chromium existante couvre déjà
  Chrome/Edge/Brave ; Safari reste le trou principal.

## 10. Références Apple

- `ASCredentialProviderViewController`
- `ASCredentialIdentityStore`
- `ASPasswordCredential`
- `ASCredentialServiceIdentifier`
- App Groups et Keychain Access Groups
- Developer ID, hardened runtime et `notarytool`
