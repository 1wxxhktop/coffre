# Niveau de préparation grand public — Coffre 0.8.0

**Date :** 7 novembre 2026  
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
| Extension Chromium / Firefox | Fonctionnelle sur Chromium ; variante Firefox lintée, non publiée | **Bêta technique** |
| Desktop macOS arm64 | Compile, stockage natif, se lance, Touch ID, signé ad hoc | **Bêta technique locale** |
| Desktop macOS Intel | Non testé | **Non validé** |
| Windows | Build CI, pas de test d’exécution | **Non validé** |
| Linux | Build CI, pas de test d’exécution | **Non validé** |
| iOS / Android | Non initialisé | **Non disponible** |
| Safari / AutoFill système | Non implémenté | **Non disponible** |

---

## 2. Ce qui est déjà au niveau attendu

- **Cryptographie** : Argon2id 64 Mio, AES-256-GCM, AAD par usage, hiérarchie
  de clés claire, nonces aléatoires, clés éphémères par élément.
- **Format** : `.coffre` v3 validé par Zod, compatibilité v1/v2, migrations à
  l’écriture, plafonds d’import, versions et pièces jointes.
- **Sécurité applicative** : CSP stricte, `freezePrototype`, aucune requête
  réseau, aucun `innerHTML`, URL http(s) uniquement, React escaping.
- **Verrouillage** : auto-lock, perte de visibilité, `pagehide`, Web Locks,
  instance desktop unique, effacement natif du presse-papiers sur desktop.
- **Cohérence des écritures** : rechargement du fichier au déverrouillage,
  écriture refusée si un autre onglet a modifié le coffre, fichier enregistré
  conservé même si le verrouillage survient pendant l’écriture, import annulé
  sans écriture partielle s’il est interrompu.
- **Rotation des clés** : changement de mot de passe, remplacement ou
  suppression de la phrase et récupération régénèrent toutes les clés de
  contenu.
- **Récupération** : phrase EFF de 10 mots, enveloppe séparée, vérification de
  l’enveloppe à l’intégrité.
- **Desktop** : Tauri v2, capability minimale, navigation externe contrôlée,
  Touch ID avec service de trousseau séparé, hardened runtime.
- **Stockage natif** : fichier `vault/vault.coffre` dans
  `app_data_dir()`, écritures atomiques, permissions `0600`/`0700`, trois
  sauvegardes tournantes, plafond de 100 Mo et migration automatique depuis
  IndexedDB.
- **Tests** : 182 tests unitaires (17 fichiers), 50 exécutions Playwright
  (dont les scénarios multi-onglets et verrouillage pendant l’écriture), 5 tests
  Rust (4 sur toutes les plateformes), smoke extension en CI sur le serveur de
  développement (contrôle de domaine compris), Lighthouse accessibilité 1,0.
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
être disponible dans Safari et les apps, comme 1Password. Voir
[docs/MACOS-AUTOFILL.md](MACOS-AUTOFILL.md).

### B-05 — Mobile

iOS et Android ne sont pas initialisés. Les SDK, la signature et les tests
manquent. Un gestionnaire de mots de passe grand public doit au minimum couvrir
iOS et Android ou assumer explicitement un périmètre desktop.

### B-06 — Touch ID de niveau OS

Touch ID est une barrière applicative : la clé est dans le trousseau classique
et peut provoquer un second dialogue ACL. Un programme qui obtient l’accès au
trousseau de session la lit sans empreinte ; l’interface et le README le disent
désormais explicitement. Le modèle cible est un élément
`SecAccessControl` (`kSecAccessControlBiometryCurrentSet`) ou une clé Secure
Enclave qui chiffre la clé maîtresse. Cela demande une évolution native et une
signature stable.

### B-07 — Audit externe

Aucun audit cryptographique ni test d’intrusion externe n’a été réalisé. Pour un
produit qui contient tous les mots de passe d’une personne, c’est un prérequis
de confiance, même avec 182 tests.

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
