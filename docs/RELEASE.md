# Release macOS signée et notariée

**État :** la chaîne de build est prête, mais aucune release signée n’a encore
été produite : le certificat **Developer ID Application** et les secrets Apple
ne sont pas disponibles dans le dépôt. Ce document décrit la procédure complète.

## 1. Prérequis

- Compte **Apple Developer** payant.
- Certificat **Developer ID Application** (pas Apple Distribution, réservé à
  l’App Store).
- Identifiant d’équipe Apple (`APPLE_TEAM_ID`).
- Mot de passe d’application Apple ID pour la notarisation, ou une clé API
  App Store Connect.
- macOS avec Xcode Command Line Tools, Rust, Bun et `gh` authentifié.

Le bundle desktop local reste signé ad hoc (`signingIdentity: "-"`) pour le
développement. Le script de release fournit `APPLE_SIGNING_IDENTITY`, qui prend
le dessus pour la signature Developer ID.

## 2. Créer et installer le certificat

1. Créer une demande de signature (CSR) depuis **Trousseau d’accès** ou
   [le portail Apple Developer](https://developer.apple.com/account/resources/certificates/list).
2. Créer un certificat **Developer ID Application** et télécharger le `.cer`.
3. Ouvrir le `.cer` pour l’installer dans le trousseau `login`.
4. Vérifier l’identité :

```bash
security find-identity -v -p codesigning
```

L’identité ressemble à :

```text
Developer ID Application: Prénom Nom (TEAMID)
```

## 3. Préparer les secrets GitHub

Exporter le certificat et sa clé privée depuis **Trousseau d’accès** :
clic droit sur l’entrée → **Exporter** → fichier `.p12` avec un mot de passe.

Convertir le `.p12` en base64 :

```bash
openssl base64 -A -in certificat.p12 -out certificat-base64.txt
```

Créer les secrets du dépôt :

```bash
gh secret set APPLE_CERTIFICATE < certificat-base64.txt
gh secret set APPLE_CERTIFICATE_PASSWORD
gh secret set APPLE_SIGNING_IDENTITY
gh secret set APPLE_ID
gh secret set APPLE_PASSWORD
gh secret set APPLE_TEAM_ID
```

- `APPLE_CERTIFICATE` : contenu base64 du `.p12`.
- `APPLE_CERTIFICATE_PASSWORD` : mot de passe choisi à l’export.
- `APPLE_SIGNING_IDENTITY` : nom exact affiché par `security find-identity`.
- `APPLE_PASSWORD` : **mot de passe d’application** Apple ID, pas le mot de
  passe du compte. Il se génère sur
  [appleid.apple.com](https://appleid.apple.com) → Connexion et sécurité.
- `APPLE_TEAM_ID` : identifiant d’équipe à 10 caractères.

Supprimer ensuite les fichiers locaux :

```bash
rm -f certificat.p12 certificat-base64.txt
```

## 4. Construire une release locale

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Prénom Nom (TEAMID)" \
APPLE_ID="adresse@exemple.fr" \
APPLE_PASSWORD="mot-de-passe-application" \
APPLE_TEAM_ID="TEAMID" \
./scripts/release-macos.sh
```

Le script :

1. vérifie l’identité et les identifiants de notarisation ;
2. installe les cibles Apple si nécessaire ;
3. construit une version **universelle** (`arm64` + `x86_64`) ;
4. vérifie la signature Developer ID et le hardened runtime ;
5. vérifie l’agrafage ; si le DMG n’est pas agrafé, le soumet à `notarytool` ;
6. vérifie le bundle avec `spctl` ;
7. produit le DMG et son empreinte SHA-256.

Pour construire uniquement l’architecture de la machine :

```bash
COFFRE_TARGET=aarch64-apple-darwin ./scripts/release-macos.sh
```

## 5. Publier via GitHub Actions

Le workflow `.github/workflows/release.yml` se déclenche sur un tag `v*` :

```bash
# La version doit être identique dans package.json, Cargo.toml,
# tauri.conf.json et le manifeste de l’extension.
bun run version:check
git tag v0.9.0
git push origin v0.9.0
```

Le workflow :

- vérifie que le tag correspond à la version du projet ;
- importe le certificat dans un trousseau temporaire ;
- construit, signe et notarie le bundle universel ;
- archive le `.app` et produit le DMG + SHA-256 ;
- crée une **release GitHub en brouillon**, à relire puis publier manuellement.

Le trousseau temporaire est supprimé même en cas d’échec.

## 6. Vérifier une release

Sur une machine vierge ou après téléchargement :

```bash
spctl --assess --type execute --verbose=4 Coffre.app
xcrun stapler validate Coffre.app
xcrun stapler validate Coffre_0.9.0_universal.dmg
shasum -a 256 Coffre_0.9.0_universal.dmg
```

Le résultat attendu de `spctl` mentionne `accepted` et
`source=Notarized Developer ID`. Comparer l’empreinte avec le fichier
`.sha256` publié.

## 7. Dépannage

- **`identity not found`** : le certificat n’est pas dans le trousseau par
  défaut, ou l’identité ne correspond pas exactement. Relancer
  `security find-identity -v -p codesigning`.
- **Notarisation refusée** : vérifier que `APPLE_PASSWORD` est un mot de passe
  d’application et que `APPLE_TEAM_ID` correspond au certificat.
- **`spctl` refuse le bundle** : la signature n’est pas Developer ID, le
  hardened runtime est absent, ou l’agrafage n’a pas été fait.
- **DMG non agrafé** : le script le soumet automatiquement à `notarytool` et
  l’agrafe. La première soumission peut prendre plusieurs minutes.
- **Tag refusé par le workflow** : la version du tag et celle de
  `package.json` diffèrent.

## 8. Limites actuelles

- La release signée n’est produite que pour **macOS** ; Windows et Linux sont
  compilés par la CI mais pas encore empaquetés/signés pour une release.
- Aucun mécanisme de **mise à jour signée** n’est encore intégré (B-02). La
  release GitHub permet le téléchargement manuel, pas la mise à jour
  automatique.
- L’AutoFill macOS, le mobile et l’audit externe restent des chantiers séparés.
- Les secrets Apple ne doivent jamais être commités dans le dépôt.
