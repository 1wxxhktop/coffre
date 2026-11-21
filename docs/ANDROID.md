# Android — APK alpha de test

Coffre dispose d’un premier APK Android pour **tester le coffre local** sur un
appareil. Ce n’est pas encore une application Android complète.

## Ce qui fonctionne

- Création et déverrouillage d’un coffre local.
- **Déverrouillage par empreinte digitale** (BiometricPrompt) : la clé maîtresse
  est chiffrée par Android Keystore et n’est déchiffrée qu’après authentification.
- Éléments, dossiers, recherche, générateur et TOTP.
- Premier import depuis un autre appareil sur le même réseau Wi-Fi, par code
  d’appairage, avec transfert du coffre chiffré et des pièces jointes blob.
- Restauration d’un fichier `.coffre` avec un filtre de fichier élargi
  (`application/octet-stream`, texte, ZIP).
- Stockage natif dans le dossier de données de l’application, avec les trois
  sauvegardes tournantes.
- Interface tactile et thème clair/sombre.

## Ce qui n’est pas encore là

- Autofill Android (remplissage dans les applications et le navigateur).
- Passkeys via Credential Manager.
- Tray, auto-type, mises à jour automatiques et extension navigateur.
- Publication Play Store.
- Notification « nouvelle version disponible » dans l’application : les
  bêtas et les releases se téléchargent à la main (voir ci-dessous).

L’APK reste une **alpha** : ne pas l’utiliser seul pour un coffre contenant de
vrais secrets, sans sauvegarde sur un autre appareil.

## Signature et bêtas

Android n’installe une mise à jour par-dessus l’application existante que si
elle est **signée par la même clé**. Un APK debug de la CI est signé par une
clé jetable, différente à chaque build : il faut alors désinstaller
l’application, ce qui efface son coffre local.

Coffre utilise donc une **clé fixe**, créée une seule fois par le mainteneur :

```bash
./scripts/setup-android-key.sh
```

Le script ne demande qu’`openssl` (fourni avec macOS) et `gh`. Il :

1. demande un mot de passe, sans l’afficher ;
2. crée la clé PKCS12 dans `~/.coffre/coffre-android.p12` (lisible par vous
   seul ; la clé privée n’est jamais écrite en clair) ;
3. enregistre dans GitHub les secrets `ANDROID_KEYSTORE_BASE64` et
   `ANDROID_KEYSTORE_PASSWORD`, et la variable `COFFRE_ANDROID_CERT_SHA256`
   (empreinte du certificat).

Sauvegardez la clé **et** son mot de passe hors de l’ordinateur (par exemple
dans Coffre). Sans eux, aucune version future ne pourra s’installer par-dessus
les APK déjà distribués. Le script refuse de remplacer une clé existante.

Avec la clé, le workflow `android-build.yml` produit un **build release**
(non débogable, signé par la clé fixe) au lieu d’un build debug, et vérifie que
le certificat de l’APK correspond à `COFFRE_ANDROID_CERT_SHA256`. Sans clé
(fork, Dependabot), il produit l’APK de test debug, qui n’est jamais publié.

La réduction de code (R8) est désactivée dans le build release : les règles
ProGuard du projet sont vides et l’APK ne peut pas être testé sur appareil en
CI. L’APK est un peu plus gros, mais aucune classe utilisée par la WebView ou
JNI ne risque d’être retirée.

**Changement d’identifiant.** L’APK debug s’appelait `app.coffre.desktop.debug`
; l’APK signé s’appelle `app.coffre.desktop`. Les deux coexistent sur le
téléphone : passez une fois votre coffre de l’un à l’autre (synchronisation
par le réseau local, ou export puis import), puis désinstallez l’APK debug.

### Bêtas Android

Chaque PR interne publie, en plus de la bêta macOS, une **bêta Android** dans
la release technique `canal-beta` :

- `Coffre_beta_android-arm64.apk` : l’APK signé, même version que la bêta
  macOS du même run (`<major>.<minor+1>.0-beta.<run>.<tentative>`) ;
- `android-beta.json` : version, adresse, empreinte SHA-256, PR et commit.

Adresse fixe de la dernière bêta :
`https://github.com/1wxxhktop/coffre/releases/download/canal-beta/Coffre_beta_android-arm64.apk`.
Elle s’installe par-dessus la bêta ou la release précédente. La PR reçoit un
commentaire avec le lien. Sans clé configurée, le job l’indique et ne publie
rien.

## Construire localement

Prérequis : Java 21, SDK Android (plateforme 37.0, build-tools 36) et NDK
r27c.

```sh
export JAVA_HOME=/chemin/vers/jdk-21
export ANDROID_HOME=$HOME/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973
# Sans symboles de debug : APK d’environ 50 Mo au lieu de 230 Mo.
export CARGO_PROFILE_DEV_DEBUG=0
export CARGO_PROFILE_DEV_STRIP=debuginfo
rustup target add aarch64-linux-android
bun run mobile:android:build
```

L’APK est produit dans :

```text
src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

## CI et release

- `.github/workflows/android-build.yml` installe JDK, SDK, NDK, compile et
  publie l’artefact `coffre-android-apk`.
- Le workflow de release ajoute `coffre-<version>-android-arm64.apk` (signé
  avec la clé fixe ; `…-debug.apk` sans clé) et `SHA256SUMS-android` au
  brouillon, puis à la release publiée.
- Chaque PR interne publie une bêta Android signée (voir « Bêtas Android »).
- Le job APK de la CI complète n’est lancé qu’avec le label `android` ; il
  reste un build de test debug, non publié.
- `bun run release:update` place l’APK dans `release/<version>/android/` : il
  vient du run « Android APK » du même commit ou, à défaut, de la release dont
  le tag désigne ce commit.

## Installer sur un appareil

1. Activer « Installer des applications inconnues » pour le gestionnaire de
   fichiers ou ADB.
2. Transférer l’APK et l’ouvrir, ou utiliser `adb install -r <fichier>.apk`.
   Une nouvelle version signée par la clé fixe s’installe par-dessus la
   précédente, sans perdre le coffre local.
3. Créer un coffre de test, puis vérifier création, verrouillage,
   déverrouillage, ajout d’un élément, TOTP et redémarrage de l’application.

## Validation effectuée

Le 13 novembre 2026, l’APK debug `0.16.0` a été testé sur un émulateur
**Android 15 (API 35), arm64** :

- installation de l’APK et lancement de l’application ;
- création d’un coffre avec mot de passe maître ;
- affichage du tableau de bord et de la feuille « Nouvel élément » ;
- arrêt forcé puis relance : l’écran de déverrouillage apparaît ;
- déverrouillage du coffre avec le mot de passe maître.

Aucun crash ni écran blanc n’a été observé. Le stockage natif a été sollicité
par la création du coffre et sa relecture après redémarrage.

Restent à valider sur appareil réel : les performances Argon2, le clavier
physique, l’import/export de fichiers, les gros coffres, la rotation d’écran,
le mode sombre système et la restauration après mise à jour. Le premier import
par réseau local, le filtre de fichier élargi et le déverrouillage par
empreinte digitale doivent être confirmés sur un appareil Android physique.

## Prochaines étapes

La version Android complète reste planifiée en 0.18 : Autofill Framework,
Credential Manager/passkeys, biométrie Keystore, validation multi-appareils et
publication Play Store.
