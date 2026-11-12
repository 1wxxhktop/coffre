# Release macOS

**Mode retenu : sans compte Apple.** Les releases sont signées **ad hoc**
(hardened runtime, sans Developer ID ni notarisation). Les mises à jour
automatiques fonctionnent quand même : elles sont signées par la clé de mise à
jour de Coffre (§ 3.1), indépendante d’Apple.

Conséquence pour les utilisateurs : à la **première** installation, macOS
refuse d’ouvrir une application non notariée. Il faut :

1. vérifier l’empreinte du DMG (`shasum -a 256 Coffre_*.dmg`, à comparer au
   fichier `.sha256` de la release) ;
2. glisser Coffre dans Applications et l’ouvrir une première fois ;
3. ouvrir Réglages Système → Confidentialité et sécurité, puis cliquer sur
   « Ouvrir quand même ».

Les mises à jour suivantes sont téléchargées par l’application elle-même et
installées sans cet avertissement. Ce texte est ajouté aux notes de chaque
release ad hoc.

Les sections 2 à 4 (certificat Developer ID, notarisation) restent valables si
un certificat est un jour disponible : le script et le workflow basculent
alors automatiquement en mode Developer ID. Sans eux, ces étapes sont ignorées.

## 1. Prérequis

- macOS avec Xcode Command Line Tools, Rust, Bun et `gh` authentifié.
- La clé de signature des mises à jour (§ 3.1).
- Optionnel : compte **Apple Developer**, certificat **Developer ID
  Application**, identifiant d’équipe et identifiants de notarisation.

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

### 3.1 Clé de signature des mises à jour

Les mises à jour automatiques sont signées par une clé minisign, distincte du
certificat Apple. **Elle se crée une seule fois et ne doit jamais être perdue** :
sans elle, plus aucune mise à jour ne peut être publiée pour les applications
déjà installées (il faudrait les réinstaller à la main).

**État : clé créée le 10 novembre 2026** (`~/.tauri/coffre-updater.key`),
secrets et variable enregistrés dans GitHub.

Le script `scripts/setup-updater-key.sh` fait tout en une fois : il refuse de
remplacer une clé existante, crée la clé (mot de passe demandé deux fois, sans
affichage), enregistre la clé privée et la clé publique dans GitHub, puis
demande une troisième fois le mot de passe pour le secret correspondant. Le
mot de passe n’est jamais lu ni écrit par le script.

```bash
./scripts/setup-updater-key.sh
```

Équivalent manuel :

```bash
bun tauri signer generate -w ~/.tauri/coffre-updater.key
```

La commande demande un mot de passe et affiche la clé publique. Puis :

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/coffre-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
gh variable set COFFRE_UPDATER_PUBKEY < ~/.tauri/coffre-updater.key.pub
```

- `TAURI_SIGNING_PRIVATE_KEY` : clé privée chiffrée (secret).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : son mot de passe (secret).
- `COFFRE_UPDATER_PUBKEY` : clé publique (variable, non secrète), intégrée au
  binaire à la compilation. Sans elle, Réglages → Mises à jour indique que la
  fonction n’est pas disponible dans ce build.

Sauvegarder `~/.tauri/coffre-updater.key` et son mot de passe hors de la
machine (par exemple dans Coffre lui-même et sur un support hors ligne).
Changer de clé impose une version de transition signée par l’ancienne clé et
contenant la nouvelle clé publique.

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
- avec la clé de mise à jour (3.1), produit `Coffre_<version>_universal.app.tar.gz`,
  sa signature `.sig` et le manifeste `latest.json` ;
- crée une **release GitHub en brouillon** (marquée préversion si la version
  contient un suffixe, par exemple `1.3.0-beta.1`).

Le trousseau temporaire est supprimé même en cas d’échec.

### 5.1 Publier la mise à jour

Une fois le brouillon relu, lancer **Actions → Publier une mise à jour**
(`publish-update.yml`) avec le tag. En ligne de commande :

```bash
gh workflow run publish-update.yml -f tag=v0.13.0
```

Ce workflow Linux, court :

- vérifie que `latest.json` annonce bien la version du tag ;
- publie la release : version stable marquée « latest » (canal stable), ou
  préversion jamais « latest » ;
- copie le manifeste dans la release roulante `canal-beta` (canal bêta), sauf
  si celle-ci annonce déjà une version plus récente.

Les applications installées voient la mise à jour à leur prochaine recherche.
La vérification automatique est **désactivée par défaut** : il faut cliquer sur
« Rechercher maintenant » ou choisir une fréquence dans les réglages. Publier le
brouillon à la main dans l’interface GitHub fonctionne pour le canal stable,
mais ne met pas à jour le canal bêta.

## 6. Vérifier une release

Sur une machine vierge ou après téléchargement. En mode **ad hoc** (sans compte
Apple), `spctl` refuse le bundle et la première ouverture demande « Ouvrir quand
même » : c’est attendu. En mode **Developer ID**, vérifier :

```bash
spctl --assess --type execute --verbose=4 Coffre.app
xcrun stapler validate Coffre.app
xcrun stapler validate Coffre_0.9.0_universal.dmg
shasum -a 256 Coffre_0.9.0_universal.dmg
```

Le résultat attendu de `spctl` mentionne `accepted` et
`source=Notarized Developer ID`. En mode ad hoc, cette vérification échoue :
comparer au minimum l’empreinte SHA-256 du DMG avec le fichier `.sha256` publié
et vérifier la signature du paquet de mise à jour par l’application.

### 6.1 Vérifier une mise à jour depuis l’application

Cette vérification se fait avec une **installation macOS empaquetée**, jamais
avec `bun run desktop:dev` : les builds de développement n’intègrent pas la clé
publique de mise à jour et affichent « non configurée ».

1. Installer la version précédente (par exemple 0.12.0), puis ouvrir Coffre.
2. Dans **Réglages → Mises à jour**, vérifier que l’état est « configuré » et
   que la version affichée correspond à la version installée.
3. Cliquer sur **« Rechercher maintenant »**. La nouvelle version doit être
   proposée avec ses notes.
4. Télécharger puis installer. L’application vérifie la signature, verrouille
   le coffre, s’arrête et redémarre sur la nouvelle version.
5. Après redémarrage, vérifier la version affichée, l’intégrité du coffre et
   l’ouverture d’un élément.
6. Refaire le test sur le **canal bêta** : Réglages → Mises à jour → canal bêta,
   puis « Rechercher maintenant ». Le manifeste lu doit être celui de
   `canal-beta`.

Les manifestes publics peuvent être contrôlés sans l’application :

```bash
curl -fsSL https://github.com/1wxxhktop/coffre/releases/latest/download/latest.json
curl -fsSL https://github.com/1wxxhktop/coffre/releases/download/canal-beta/latest.json
```

Ils doivent annoncer la version attendue, une URL
`Coffre_<version>_universal.app.tar.gz` et une signature non vide. Une version
déjà installée, ou ignorée par l’utilisateur, n’est pas proposée. Les retours
en arrière ne sont pas installés : la signature doit couvrir la version
annoncée.

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

- Les mises à jour signées sont disponibles pour l’application **macOS**
  empaquetée. Windows et Linux sont compilés par la CI mais pas encore
  empaquetés/signés pour une release.
- Les builds de développement (`bun run desktop:dev`) n’ont pas la clé publique
  et affichent « non configurée ».
- La vérification des mises à jour est **désactivée par défaut** : l’utilisateur
  doit cliquer sur « Rechercher maintenant » ou choisir une fréquence. La clé
  minisign doit être conservée : sa perte impose une réinstallation manuelle.
- L’AutoFill macOS, le mobile et l’audit externe restent des chantiers séparés.
- Les secrets Apple ne doivent jamais être commités dans le dépôt.

## 9. Nettoyage après release

Une fois la release publiée et les artefacts vérifiés, supprimer les fichiers
générés pour éviter de saturer le disque :

```bash
bun run clean:all
```

Cela retire `dist/`, `coverage/`, `src-tauri/target/`, les caches
Bun/Playwright/Cargo et les fichiers temporaires. Les sources, les coffres
`.coffre`, les secrets et le dossier **`release/`** sont conservés. Pour
épargner les caches globaux, plus longs à reconstruire, utiliser
`bun run clean:build`.

### 9.1 Toujours conserver la dernière version dans `release/`

`release/` n’est **jamais** supprimé par le nettoyage. Après chaque fusion sur
`main` (une fois la CI verte) et après chaque finalisation de release,
l’actualiser :

```bash
bun run post-merge
```

Cette commande enchaîne `release:update`, `release:status` et `clean` : elle
remplace `release/` par la dernière version, vérifie qu’une seule version est
présente, puis nettoie le reste sans toucher à `release/`.

`release:update` récupère les artefacts de la dernière CI réussie sur `main`,
remplace la version précédente et met à jour le lien `release/latest` : une
seule version reste sur le disque. `release:status` vérifie que ce dossier
existe, qu’il ne contient qu’une version et qu’elle correspond à
`package.json`.

Après un simple merge ou une mise à jour, `bun run clean` suffit. Vérifier
l’espace restant avec `du -sh .` et `df -h .`.

`clean:all` supprime aussi les navigateurs Playwright ; les réinstaller avec
`bun run test:e2e:install` avant de relancer les parcours e2e. Un worktree Git
propre et inutilisé se retire avec `bun run clean:worktrees`.
