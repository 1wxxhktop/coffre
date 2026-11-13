# Android — APK alpha de test

Coffre dispose d’un premier APK Android pour **tester le coffre local** sur un
appareil. Ce n’est pas encore une application Android complète.

## Ce qui fonctionne

- Création et déverrouillage d’un coffre local.
- Éléments, dossiers, recherche, générateur et TOTP.
- Stockage natif dans le dossier de données de l’application, avec les trois
  sauvegardes tournantes.
- Interface tactile et thème clair/sombre.

## Ce qui n’est pas encore là

- Autofill Android (remplissage dans les applications et le navigateur).
- Passkeys via Credential Manager.
- Déverrouillage biométrique et Keystore.
- Tray, auto-type, mises à jour automatiques et extension navigateur.
- Publication Play Store et signature de production.

L’APK est **signé avec la clé de debug** de Gradle. Il est réservé aux tests :
ne pas l’utiliser pour un coffre contenant de vrais secrets, et ne pas le
distribuer comme version de production.

## Construire localement

Prérequis : Java 21, SDK Android (plateforme 37.0, build-tools 36) et NDK
r27c.

```sh
export JAVA_HOME=/chemin/vers/jdk-21
export ANDROID_HOME=$HOME/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973
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
- Le workflow de release ajoute
  `coffre-<version>-android-arm64-debug.apk` et `SHA256SUMS-android` au
  brouillon, puis à la release publiée.
- Le job de PR n’est lancé qu’avec le label `android`.

## Installer sur un appareil

1. Activer « Installer des applications inconnues » pour le gestionnaire de
   fichiers ou ADB.
2. Transférer l’APK et l’ouvrir, ou utiliser `adb install -r <fichier>.apk`.
3. Créer un coffre de test, puis vérifier création, verrouillage,
   déverrouillage, ajout d’un élément, TOTP et redémarrage de l’application.

## Prochaines étapes

La version Android complète reste planifiée en 0.18 : Autofill Framework,
Credential Manager/passkeys, biométrie Keystore, validation multi-appareils et
publication Play Store.
