# Niveau de préparation grand public — Coffre 0.8.0

**Date :** 8 novembre 2026
**Conclusion :** le socle de sécurité est solide et aucun défaut critique de
confidentialité n’a été trouvé lors de la re-vérification. En revanche, Coffre
n’est **pas encore prêt pour une distribution grand public**. C’est une
**bêta technique utilisable localement** sur Web/PWA, Chromium et macOS arm64.

Le mot « grand public » implique ici : installation sans avertissement
Gatekeeper, mises à jour, AutoFill système, mobile, support multi-plateforme et
assurance externe. Ces points ne sont pas tous du code : ils demandent des
certificats Apple, une infrastructure de release, du matériel de test et un
audit externe. Le stockage natif desktop, lui, est désormais implémenté.

---

## 1. Verdict par plateforme

| Plateforme | État | Verdict |
| --- | --- | --- |
| Web / PWA | Fonctionnelle, 46/46 E2E, CSP stricte, Lighthouse 1,0 | **Bêta publique possible** |
| Extension Chromium / Firefox | Fonctionnelle sur Chromium (remplissage et passkeys) ; variante Firefox lintée, non publiée ; pont natif macOS/Linux implémenté | **Bêta technique** |
| Desktop macOS arm64 | Compile, stockage natif, se lance, Touch ID, synchronisation par dossier, signé ad hoc | **Bêta technique locale** |
| Desktop macOS Intel | Non testé | **Non validé** |
| Windows | Build CI, pas de test d’exécution | **Non validé** |
| Linux | Build CI, pas de test d’exécution | **Non validé** |
| iOS / Android | Non initialisé | **Non disponible** |
| Safari / AutoFill système | Non implémenté | **Non disponible** |

---

## 2. Ce qui est déjà au niveau attendu

- **Cryptographie** : Argon2id 64 Mio, AES-256-GCM, AAD par usage, hiérarchie
  de clés claire, nonces aléatoires, clés éphémères par élément.
- **Format** : `.coffre` v4 validé par Zod, MAC global et révisions hors
  fichier, compatibilité v1 à v3, migrations à l’écriture, pierres tombales
  plafonnées, historique et pièces jointes.
- **Intégrité** : HMAC-SHA-256 sur un manifeste canonique, clé scellée par la
  clé maîtresse et tournée avec l’époque des clés ; un fichier altéré s’ouvre
  en lecture seule.
- **Extension** : remplissage depuis l’onglet Coffre déverrouillé, secours
  conservé ; pont natif desktop appairé (ECDH P-256, HKDF, AES-256-GCM,
  compteurs anti-rejeu) avec installation automatique des hôtes de messagerie
  native et contrôle de domaine dans l’application.
- **Passkeys** : création et assertion ES256 dans l’application, interception
  WebAuthn dans le monde `MAIN`, confirmation dans une fenêtre d’extension,
  validation de l’origine et du RP ID, clé privée absente des messages. Les
  sites exigeant `UV` ou un authentificateur externe utilisent le navigateur ;
  l’export FIDO CXF reste à faire.
- **Fuites connues** : vérification optionnelle, désactivée par défaut, en
  k-anonymat (préfixe SHA-1 de 5 caractères, `Add-Padding`). Résultats en
  mémoire uniquement, intégrés au score et aux catégories ; desktop via Rust,
  Web via un hôte CSP dédié.
- **Déverrouillage FIDO2/PRF** : enveloppe optionnelle de la clé maîtresse,
  dérivation HKDF et AES-GCM liées au fichier, révocation et suppression lors
  des rotations. Validation matérielle YubiKey encore à faire.
- **Cœur Rust partagé** : crate `coffre-core` v1 à v4, crypto identique,
  manifeste/MAC v4, mutations, signature v4, rotation de mot de passe et fusion
  L3 ; façade UniFFI JSON, CLI `list`/`get`/`totp`/`run --env`, commande Tauri
  de fusion, buffers `Zeroizing`, vecteurs croisés TypeScript ↔ Rust et CI
  Linux/macOS/Windows, builds Web/extension reproductibles, bundle macOS
  reproductible après recompilation de la caisse applicative, SBOM CycloneDX et
  contrôle cargo-deny.
- **Synchronisation** : dossier choisi par l’utilisateur, un fichier par
  appareil, fusion v4 par horloges et pierres tombales, vérification du MAC
  distant, adoption d’une nouvelle époque de clés, archivage des conflits et
  surveillance `notify` sur desktop. Chromium utilise la File System Access API
  avec handle persistant ; Safari/Firefox restent en export/import manuel.
- **Partage de coffres** : identités X25519/Ed25519, paquets signés et
  bundles de contenu signés, rôles `read`/`write`, révocation par rotation,
  accès d’urgence immédiat ou Shamir 2/3. Synchronisation par dossier commun,
  à la demande ou toutes les 60 secondes ; les bundles restent chiffrés et
  signés, les paquets de partage sont conservés chiffrés dans les métadonnées
  et les pièces jointes binaires chiffrées suivent le dossier sur desktop.
  L’échange manuel `.coffre-shared.json` reste disponible.
- **Sécurité applicative** : CSP stricte, `freezePrototype`, aucune requête
  réseau, aucun `innerHTML`, URL http(s) uniquement, React escaping.
- **Historique du générateur** : 50 entrées chiffrées avec AAD dédiée,
  rétention configurable, purge à l’ouverture, consommation automatique lors
  de l’enregistrement, fusion par horloges. Aucun mot de passe en clair dans le
  fichier ; le sidecar est couvert par le manifeste 2 du MAC global, avec
  lecture des fichiers signés en manifeste 1 et vecteur croisé TypeScript/Rust.
- **Verrouillage** : auto-lock, perte de visibilité, `pagehide`, Web Locks,
  instance desktop unique, effacement du presse-papiers au verrouillage.
- **Récupération** : phrase EFF de 10 mots, enveloppe séparée, vérification de
  l’enveloppe à l’intégrité.
- **Desktop** : Tauri v2, capability minimale, navigation externe contrôlée,
  Touch ID avec service de trousseau séparé, hardened runtime.
- **Stockage natif** : fichier `vault/vault.coffre` dans
  `app_data_dir()`, écritures atomiques, permissions `0600`/`0700`, trois
  sauvegardes tournantes, plafond de 100 Mo et migration automatique depuis
  IndexedDB.
- **Tests** : 492 tests unitaires (71 fichiers), 150 exécutions Playwright
  (75 parcours sur Chromium et WebKit), 30 tests Rust desktop (1 ignoré) +
  12 tests `coffre-core` + 1 test FFI + 13 tests `coffre-cli` + 17 tests agent
  SSH, smoke extension
  (recherche, remplissage, passkeys avec attestation et assertion vérifiées,
  verrouillage), vérification HIBP interceptée, relais natif simulé et
  Lighthouse accessibilité 1,0.
- **Documentation** : SECURITY, audit, AutoFill, Proton Pass, native, README.

---

## 3. Bloquants avant une diffusion grand public

### B-01 — Signature Developer ID et notarisation — **chaîne prête**

Le bundle local est encore signé **ad hoc**, mais la chaîne de release est
prête :

- `scripts/release-macos.sh` construit une version universelle, vérifie la
  signature Developer ID et le hardened runtime, notarie/agrafe le DMG si
  nécessaire et produit son SHA-256 ;
- `.github/workflows/release.yml` exécute cette chaîne sur un tag `v*`, importe
  le certificat dans un trousseau temporaire et crée une release GitHub en
  brouillon ;
- [docs/RELEASE.md](RELEASE.md) décrit la création du certificat, les secrets Apple, la
  publication et la vérification `spctl`.

Il manque le certificat **Developer ID Application** et les secrets de
notarisation. Sans eux, un utilisateur non technique ne peut toujours pas
installer Coffre sans manipulation.

### B-02 — Mises à jour

Aucun mécanisme de mise à jour n’est présent. Un gestionnaire de mots de passe
grand public doit pouvoir corriger une faille rapidement. Il faut un canal de
release signé (Tauri Updater ou serveur statique) et une politique de versions.

### B-03 — Stockage durable des données — **traité en 0.8.0**

Le coffre desktop ne dépend plus d’IndexedDB : il est écrit dans
`app_data_dir()/vault/vault.coffre`, avec écritures atomiques, permissions
`0600`/`0700`, trois sauvegardes (`bak1` à `bak3`), une restauration depuis
l’écran d’erreur et une migration automatique de l’ancien coffre IndexedDB. Le
code Rust est couvert par un test de rotation et le frontend par des tests de
migration, de sauvegarde et d’effacement.

Reste à valider sur une **installation réelle signée** : migration d’un coffre
0.7, redémarrage, sauvegarde Time Machine et restauration. C’est un prérequis de
l’AutoFill, qui devra partager ce fichier via un App Group.

### B-04 — AutoFill système et Safari

L’extension Chromium fonctionne, mais il n’existe pas de fournisseur AutoFill
macOS/iOS ni d’extension Safari. Pour un usage grand public, le remplissage doit
être disponible dans Safari et les apps, comme 1Password. Le pont natif
extension ↔ application desktop est implémenté (messagerie native, appairage
chiffré), mais il ne remplace pas l’AutoFill système. Voir
[docs/MACOS-AUTOFILL.md](MACOS-AUTOFILL.md).

### B-05 — Mobile

iOS et Android ne sont pas initialisés. Les SDK, la signature et les tests
manquent. Un gestionnaire de mots de passe grand public doit au minimum couvrir
iOS et Android ou assumer explicitement un périmètre desktop.

### B-06 — Touch ID de niveau OS

Touch ID est une barrière applicative : la clé est dans le trousseau classique
et peut provoquer un second dialogue ACL. Le modèle cible est un élément
`SecAccessControl` (`kSecAccessControlBiometryCurrentSet`) ou une clé Secure
Enclave qui chiffre la clé maîtresse. Cela demande une évolution native et une
signature stable.

### B-07 — Audit externe

Aucun audit cryptographique ni test d’intrusion externe n’a été réalisé. Pour un
produit qui contient tous les mots de passe d’une personne, c’est un prérequis
de confiance, même avec 167 tests.

### B-08 — Validation Windows/Linux et macOS Intel

La CI compile Windows/Linux, mais aucune exécution réelle, aucun test
d’installation, aucun test de trousseau ni de WebView n’a été réalisé. Le build
local arm64 et le build **universel** (arm64 + x86_64) ont été validés, mais le
binaire Intel n’a pas été exécuté sur un Mac Intel.

### B-09 — Portabilité des données — **traité en 0.8.0**

L’import est très large et Coffre exporte désormais en CSV :
- format **Mots de passe (Apple)**, avec les colonnes
  `Title,URL,Username,Password,Notes,OTPAuth` pour les connexions actives ;
- format **Coffre complet**, avec tous les types d’éléments et les champs
  personnalisés, réimportable par Coffre.

Le CSV est un fichier en clair et ne contient pas les pièces jointes ; l’export
`.coffre` reste la sauvegarde chiffrée complète. Il reste à valider un import
réel dans Mots de passe sur une machine Apple.

### B-10 — Détails d’accessibilité et de finition

Lighthouse est à 1,0. Les textes ont été remontés à **10,5 px minimum**, un lien
d’évitement et `prefers-reduced-motion` ont été ajoutés, et le verrouillage à la
perte de focus desktop est désormais explicite. Une revue manuelle avec lecteur
d’écran et navigation clavier complète reste à faire.

---

## 4. Critères de sortie proposés pour une 1.0 grand public

1. Bundle macOS signé Developer ID, notarié, agrafé et validé `spctl`
   (chaîne prête ; certificat et secrets à fournir).
2. Mécanisme de mise à jour signé et documenté.
3. Stockage natif atomique + sauvegardes + export/restauration validés sur une
   installation réelle (code et tests unitaires déjà en place).
4. AutoFill macOS/iOS et Safari (ou périmètre officiellement limité).
5. Applications iOS/Android initialisées et testées.
6. Touch ID protégé au niveau du trousseau/Secure Enclave.
7. Audit externe et correction des constats.
8. Tests d’installation/exécution Windows, Linux, macOS Intel.
9. Export CSV et migration sortante (implémenté ; valider l’import réel dans
   Mots de passe).
10. Revue d’accessibilité manuelle et documentation utilisateur.

---

## 5. Recommandation

- **Aujourd’hui** : distribuer comme **bêta technique 0.8**, avec un avertissement
  clair sur Gatekeeper, l’absence d’AutoFill système et l’absence d’audit
  externe.
- **Prochaine étape recommandée** : fournir le certificat Developer ID et les
  secrets Apple, exécuter la release signée, puis intégrer les mises à jour
  signées, l’AutoFill macOS et l’audit externe.
- **Ne pas présenter** Coffre comme un remplaçant grand public de 1Password ou
  Mots de passe d’Apple tant que les bloquants restants (B-01, B-02, B-04 à
  B-08 et B-10) ne sont pas traités.

La sécurité du coffre local, de la cryptographie, du format et des tests est
déjà d’un bon niveau. Les bloquants restants sont principalement des sujets de
**distribution, d’intégration OS et d’assurance**, pas des failles de
confidentialité connues dans le code actuel.
