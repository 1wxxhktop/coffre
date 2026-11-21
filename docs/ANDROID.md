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
- **Mises à jour intégrées** : lecture du manifeste bêta, téléchargement de
  l’APK, contrôle SHA-256 et ouverture de l’installateur Android.
- **Remplissage Android (Autofill Framework, Android 8+)** : les connexions du
  coffre sont proposées dans les formulaires web du navigateur et des
  applications. Désactivé par défaut ; le cache reste en mémoire et expire avec
  le verrouillage automatique.
- **Captures d’écran bloquées par défaut** (`FLAG_SECURE`) : captures,
  enregistrements et aperçu dans les applications récentes masqués. Désactivable
  dans Réglages → Sécurité.

## Ce qui n’est pas encore là

- Remplissage des applications natives sans domaine web (nécessite une
  correspondance par package ou des associations de domaines).
- Enregistrement d’un mot de passe saisi dans une autre application.
- Passkeys via Credential Manager.
- Tray, auto-type et extension navigateur.
- Publication Play Store.
- Mise à jour silencieuse : Android exige la confirmation de l’utilisateur
  pour installer un APK hors magasin.

L’APK reste une **alpha** : ne pas l’utiliser seul pour un coffre contenant de
vrais secrets, sans sauvegarde sur un autre appareil.

## Interface mobile

Sous 768 px, la coque desktop laisse place à une interface tactile :

- barre supérieure compacte avec menu, titre, recherche/tri et trois actions
  à droite : **générateur**, **réglages** et **badge de sécurité** ;
- navigation basse **flottante et persistante** : **Accueil**, **Coffre**,
  **Favoris**, **Récents**, avec un bouton central « Nouvel élément » ; la
  barre elle-même est translucide et les barres système Android sont
  transparentes ;
- la navigation reste visible sur le détail, les réglages, la sécurité et les
  formulaires ; les actions du haut restent visibles sur le détail ;
- groupes de dates avec en-tête dans le flux, sans masquer la première ligne
  ni créer de vide au défilement ;
- réglages, sécurité et formulaires d’élément en pages plein écran, avec
  pied d’action fixe et libellés visibles ;
- notifications au-dessus de la barre d’onglets et du bouton flottant ;
- zones sûres (`env(safe-area-inset-*)`) pour la barre d’état et la navigation
  gestuelle Android.

La grille desktop, les colonnes redimensionnables et les raccourcis clavier
restent inchangés au-dessus de 768 px. Les tests `design.spec.ts`,
`dashboard.spec.ts`, `layout.spec.ts` et `accessibility.spec.ts` couvrent les
largeurs 360, 375, 390 et 760 px, l’absence de débordement et l’accessibilité
des nouveaux onglets. Le rendu des zones sûres et de la navigation gestuelle
reste à confirmer sur un appareil physique.

### Bouton retour Android

`MainActivity` intercepte le retour système et appelle
`window.__coffreHandleBack`. L’interface ferme alors la couche la plus haute :
menu, modale, détail, tiroir, recherche, filtre ou catégorie de sécurité.
Quand il ne reste plus rien à fermer, elle renvoie `false` et l’activité
termine. Le test `mobile-back.spec.ts` couvre l’ordre de fermeture côté
WebView ; le geste et le bouton matériels restent à vérifier sur un appareil
physique.

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

### Mises à jour intégrées

Coffre peut proposer lui-même les nouvelles bêtas Android :

1. la recherche lit `android-beta.json` sur la release `canal-beta` ;
2. si la version distante est plus récente, la carte « Mise à jour » apparaît ;
3. le téléchargement écrit l’APK dans le cache de l’application et vérifie
   son SHA-256 avec l’empreinte publiée ;
4. « Installer la mise à jour » confie le fichier à l’installateur Android via
   un `FileProvider` et `REQUEST_INSTALL_PACKAGES` ;
5. Android vérifie que l’APK est signé par la même clé que l’application
   installée, puis demande confirmation.

La recherche reste **désactivée par défaut**, conformément à la règle du
projet sur les appels réseau. Après le premier déverrouillage, une proposition
unique permet de l’activer « au démarrage » ; le réglage reste modifiable dans
Réglages → Mises à jour. Aucune donnée du coffre n’est envoyée ; GitHub voit
l’adresse IP et la version de Coffre.

Un build **debug** local n’est pas signé par la clé fixe : `updater_info`
indique qu’il ne peut pas installer de mise à jour, pour éviter de télécharger
un APK qui serait refusé par Android. La première installation de la version
avec ce mécanisme reste manuelle : les bêtas antérieures ne contiennent pas le
code de mise à jour.

### Remplissage automatique

Coffre peut remplir les identifiants dans les formulaires web des autres
applications et du navigateur avec l’**Autofill Framework** d’Android 8 ou
plus récent.

1. Ouvrir **Réglages → Remplissage Android**.
2. **Désactiver « Verrouiller quand Coffre passe en arrière-plan »** : sans
   cela, le cache est vidé dès que l’on quitte Coffre, avant que le navigateur
   puisse l’utiliser. Le verrouillage automatique par inactivité reste actif
   s’il est configuré.
3. Appuyer sur **Choisir Coffre dans Android** et sélectionner **Coffre**.
4. Activer **Proposer les connexions de Coffre dans les formulaires**.
5. Laisser le coffre déverrouillé, puis ouvrir un formulaire de connexion dans
   Chrome ou une application.

Le service ne reçoit que les connexions dont une adresse correspond au domaine
du formulaire, avec la même règle que l’extension (`loginAllowsHost`) : hôte
exact, tolérance `www.` uniquement, pas de sous-domaine tiers. Un formulaire
sans domaine web (application native) ne reçoit aucune proposition. Les
formulaires à deux étapes qui ne demandent que l’identifiant reçoivent une
proposition d’identifiant seule lorsque le champ est explicitement marqué
comme identifiant (un champ e-mail générique seul peut être une newsletter).

**Garanties :**

- le cache vit **uniquement en mémoire** ; aucun mot de passe n’est écrit sur
  le disque ;
- il est publié seulement lorsque le réglage est actif et le coffre
  déverrouillé, puis vidé au verrouillage, à la désactivation ou à la fin du
  processus ;
- sa durée de validité suit le **verrouillage automatique** (plafonnée à un
  jour ; aucune expiration si le verrouillage est désactivé) et est vérifiée
  côté Rust : Android peut endormir la WebView sans prolonger le cache ;
- Coffre **ne capture pas** les mots de passe saisis dans les autres
  applications (`onSaveRequest` ne fait rien) ;
- les secrets sont plafonnés et effacés de la mémoire Rust (`zeroize`) quand
  le cache est remplacé ou vidé.

**Limites connues :**

- si Android tue le processus Coffre, le cache disparaît : rouvrir et
  déverrouiller Coffre avant de remplir ;
- le service ne propose rien pour les applications natives sans domaine web ;
- le remplissage des codes TOTP n’est pas encore pris en charge ;
- Android ne fournit jamais le port : une connexion enregistrée avec un port
  explicite (`http://localhost:3000`) ne correspond pas. Le schéma n’est
  fourni qu’à partir d’Android 9 ; sur Android 8, Coffre suppose HTTPS ;
- une application malveillante peut déclarer un domaine web qui n’est pas le
  sien dans une WebView. Android ne fournit pas de preuve cryptographique du
  domaine (Digital Asset Links) : vérifier l’application avant de choisir une
  proposition, comme avec tout gestionnaire de mots de passe ;
- deux services de remplissage peuvent coexister (build debug `…debug` et
  build signé) : sélectionner celui de l’APK installé.

### Captures d’écran

Coffre applique `WindowManager.LayoutParams.FLAG_SECURE` à la fenêtre de
l’activité. Android bloque alors les captures d’écran et les enregistrements
de cette fenêtre, et affiche un aperçu vide dans le sélecteur d’applications
récentes.

- Le blocage est **actif par défaut**.
- Le choix est mémorisé dans les préférences natives (`secure_screen`) et
  appliqué dans `MainActivity.onCreate` et réappliqué dans
  `onResume`, dès la création de l’activité.
- Il se désactive dans **Réglages → Sécurité → Captures d’écran**.
- `FLAG_SECURE` ne protège pas contre un appareil rooté, un outil de capture
  privilégié ou une caméra externe. Il empêche aussi de projeter ou partager
  l’écran de Coffre ; désactivez-le temporairement si vous en avez besoin.

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
par réseau local, le filtre de fichier élargi, le déverrouillage par empreinte
digitale, le parcours complet de mise à jour (téléchargement, SHA-256,
installateur Android, conservation du coffre), le **remplissage automatique**
(sélection du service, proposition sur un formulaire, expiration après le
délai, absence de proposition sur un domaine voisin) et le **blocage des
captures d’écran** (capture, enregistrement, aperçu des récents, désactivation
et réactivation) doivent être confirmés sur un appareil Android physique.

## Prochaines étapes

La version Android complète reste planifiée en 0.18 : validation du
remplissage et du blocage des captures sur appareils réels, Credential
Manager/passkeys, validation multi-appareils et publication Play Store.
