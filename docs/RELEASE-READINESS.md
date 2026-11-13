# Niveau de préparation grand public — Coffre 0.16.0

**Date :** 13 novembre 2026
**Conclusion :** le socle de sécurité est solide et l’audit complet de la 0.12.0
a été remédié. La **0.14.0 est publiée** comme release de sécurité (manifeste 3,
protocoles 2) et les mises à jour signées sont opérationnelles sur macOS. Coffre
n’est **pas encore prêt pour une distribution grand public** : c’est une
**bêta technique utilisable localement** sur Web/PWA, Chromium et macOS.

Le mot « grand public » implique ici : installation sans avertissement
Gatekeeper, mises à jour, AutoFill système, mobile, support multi-plateforme et
assurance externe. Ces points ne sont pas tous du code : ils demandent des
certificats Apple, une infrastructure de release, du matériel de test et un
audit externe. Le stockage natif desktop, lui, est désormais implémenté.

> **Mise à jour du 12 novembre 2026 (0.14.0) :** la release de sécurité issue de
> l’audit de la 0.12.0 est publiée. Le manifeste d’intégrité passe à **3**, les
> protocoles pont/extension/LAN à **2**, le format `.coffre` reste **v4**. Les
> releases macOS sont signées ad hoc, attestées par GitHub et mises à jour via
> les canaux stable et bêta. Les applications 0.13 ouvrent un fichier manifeste
> 3 en lecture seule : tous les appareils et l’extension doivent être mis à jour
> ensemble. Voir [VERSIONING.md](VERSIONING.md) et [RELEASE.md](RELEASE.md).
> B-01 (Developer ID/notarisation) et B-04 à B-08 restent ouverts.

> **Correctifs 0.14.1 et 0.14.2 (12 novembre 2026) :** ces versions corrigent
> l’appairage durable de l’extension et l’autorisation des commandes du pont
> natif. Elles ne changent ni le format `.coffre`, ni le manifeste, ni les
> protocoles ; l’évaluation ci-dessous reste valable.

> **0.16.0 (13 novembre 2026) :** version de finition de l’extension
> (remplissage au chargement, fiabilité des réglages et du pont natif,
> dépendances à jour). Aucun changement de format, de manifeste ou de
> protocole ; l’évaluation ci-dessous reste valable.

---

## 1. Verdict par plateforme

| Plateforme | État | Verdict |
| --- | --- | --- |
| Web / PWA | Fonctionnelle, 170 parcours Playwright, CSP stricte, Lighthouse 1,0 | **Bêta publique possible** |
| Extension Chromium / Firefox | Fonctionnelle sur Chromium (remplissage, passkeys, jetons de menu) ; variante Firefox lintée, non publiée ; pont natif macOS/Linux implémenté | **Bêta technique** |
| Desktop macOS arm64 | 0.14.0 universelle publiée, stockage natif, Touch ID, verrouillage système, barre de menus, synchronisation par dossier, updater signé, ad hoc | **Bêta technique locale** |
| Desktop macOS Intel | Binaire universel produit et DMG vérifié, mais pas d’exécution sur Mac Intel | **Non validé** |
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
- **Intégrité** : HMAC-SHA-256 sur un manifeste canonique **version 3**,
  identité publique complète des contacts d’urgence couverte, clé scellée par
  la clé maîtresse et tournée avec l’époque des clés ; un fichier altéré
  s’ouvre en lecture seule.
- **Extension** : remplissage depuis l’onglet Coffre déverrouillé, secours
  conservé ; pont natif desktop appairé (ECDH P-256, HKDF, AES-256-GCM,
  compteurs anti-rejeu, empreinte d’appairage) avec installation automatique
  des hôtes de messagerie native et contrôle de domaine dans l’application.
  Les menus utilisent un jeton de capacité lié à l’onglet et au cadre.
- **Passkeys** : création et assertion ES256 dans l’application, interception
  WebAuthn dans le monde `MAIN`, confirmation dans une fenêtre d’extension,
  validation de l’origine et du RP ID, clé privée absente des messages. Les
  sites exigeant `UV` ou un authentificateur externe utilisent le navigateur ;
  l’export FIDO CXF est disponible.
- **Fuites connues** : vérification optionnelle, désactivée par défaut, en
  k-anonymat (préfixe SHA-1 de 5 caractères, `Add-Padding`). Résultats en
  mémoire uniquement, intégrés au score et aux catégories ; desktop via Rust,
  Web via un hôte CSP dédié.
- **Déverrouillage FIDO2/PRF** : enveloppe optionnelle de la clé maîtresse,
  dérivation HKDF et AES-GCM liées au fichier, révocation et suppression lors
  des rotations. Validation matérielle YubiKey encore à faire.
- **Cœur Rust partagé** : crate `coffre-core` v1 à v4, crypto identique,
  manifeste/MAC v4, mutations, signature v4, rotation de mot de passe et fusion
  L3 ; façade UniFFI JSON, ouverture par clé maîtresse, recherche AutoFill par
  domaine, révélation du seul élément, identités sans secret, passkeys
  ES256, CLI `list`/`get`/`totp`/`run --env`, commande Tauri de fusion, buffers
  `Zeroizing`, vecteurs croisés TypeScript ↔ Rust (domaines et passkeys) et CI
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
- **Anti-hameçonnage** : analyse locale des domaines au remplissage et à
  l’enregistrement, bandeau d’alerte, journalisation chiffrée du choix. Un
  remplissage sur un hôte différent de celui de l’élément est refusé même après
  l’alerte ; « Continuer » ne reste proposé que pour l’enregistrement, qui
  n’expose aucun secret. Jeux de données embarqués (Apple MIT, Chrome UX Report
  CC BY 4.0, Unicode UTS #39), aucune API de réputation ni requête réseau à
  l’exécution.
- **Disponibilité 2FA et passkeys** : instantanés 2FA Directory (MIT) et
  Passkeys Directory (CC BY 4.0), chargés dans un chunk séparé, catégories
  « Passkey disponible » et « Site sans HTTPS », méthodes de 2FA et
  documentation dans la fiche. Aucune requête réseau, aucun ajout au bundle de
  l’extension.
- **Codes de secours 2FA** : type d’élément dédié, import par collage, état
  « utilisé » daté, alerte à deux codes restants, copie avec proposition de
  marquage. Codes chiffrés dans le contenu de l’élément ; export `.coffre`
  fidèle, colonne `recovery_codes` dans le CSV complet et champ texte long
  documenté pour CXF/KDBX.
- **Historique du générateur** : 50 entrées chiffrées avec AAD dédiée,
  rétention configurable, purge à l’ouverture, consommation automatique lors
  de l’enregistrement, fusion par horloges. Aucun mot de passe en clair dans le
  fichier ; le sidecar est couvert par le manifeste 2 du MAC global, avec
  lecture des fichiers signés en manifeste 1 et vecteur croisé TypeScript/Rust.
- **Sauvegardes planifiées** : copies datées du `.coffre` chiffré dans un
  dossier choisi, écriture atomique et contrôle SHA-256, vérification du MAC
  lorsque le coffre est déverrouillé, test de restauration en lecture seule,
  rétention 7 / 4 / 12 réglable, alerte si le dossier disparaît ou si la
  dernière réussite est trop ancienne, suspension en mode voyage et rappel
  d’export sur le Web. Aucun déchiffrement ni requête réseau.
- **Verrouillage** : auto-lock, perte de visibilité, `pagehide`, Web Locks,
  instance desktop unique, verrouillage avec la session et à la mise en veille,
  effacement du presse-papiers au verrouillage.
- **Intégration système desktop** : icône de barre de menus sans contenu du
  coffre, recherche rapide, générateur et verrouillage depuis le menu, démarrage
  à l’ouverture de session désactivé par défaut (lancement masqué et verrouillé),
  et déverrouillage Windows Hello à côté de Touch ID.
- **Récupération** : phrase EFF de 10 mots, enveloppe séparée, vérification de
  l’enveloppe à l’intégrité.
- **Desktop** : Tauri v2, capability minimale, navigation externe contrôlée,
  Touch ID avec service de trousseau séparé, hardened runtime.
- **Stockage natif** : fichier `vault/vault.coffre` dans
  `app_data_dir()`, écritures atomiques, permissions `0600`/`0700`, trois
  sauvegardes tournantes, plafond de 100 Mo et migration automatique depuis
  IndexedDB.
- **Accessibilité et anglais** : notifications rendues hors de `#root`, focus
  restitué après une modale imbriquée, palette de commandes inerte, menu mobile
  stable, libellés `tt()` vérifiés par le lint, navigation clavier et lien
  d’évitement. La revue manuelle avec lecteur d’écran reste à faire.
- **Chaîne de release** : actions GitHub épinglées par SHA, gate
  fmt/clippy/tests/deny/audit, release macOS universelle, attestation de
  provenance GitHub, SBOM CycloneDX complété et vérifié, `glob`/`minimatch`
  forcés vers des versions corrigées. La 0.14.0 est publiée sur le canal stable
  et le canal bêta.
- **Tests** : 785 tests unitaires (99 fichiers), 170 parcours Playwright
  (Chromium et WebKit), tests Rust workspace (`coffre-core`, FFI, CLI, agent
  SSH), smoke extension (recherche, remplissage, passkeys avec attestation et
  assertion vérifiées, verrouillage), vérification HIBP interceptée, relais
  natif simulé et Lighthouse accessibilité 1,0.
- **Documentation** : SECURITY, audit, suivi de remédiation, versioning,
  AutoFill, Proton Pass, native, release, README.

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

### B-02 — Mises à jour — **traité en 0.13.0, 0.14.0 publiée**

La version desktop utilise le **Tauri Updater** avec un manifeste
`latest.json` publié dans les releases GitHub. Chaque paquet est signé
(minisign) par la clé de mise à jour de Coffre ; la clé publique est intégrée
au binaire à la compilation, et l’application vérifie la signature et la
version avant toute installation. Le canal **stable** lit la dernière release
publiée, le canal **bêta** lit la release roulante `canal-beta`. La 0.14.0 est
publiée sur les deux canaux, avec DMG universel, paquet de mise à jour signé,
attestation de provenance et SBOM.

La chaîne de publication est documentée dans [RELEASE.md](RELEASE.md) :
création du tag `v*`, build macOS universel et release en brouillon par
`release.yml`, puis publication par `publish-update.yml` qui marque la version
stable comme « latest » et met à jour le canal bêta. La vérification
automatique est **désactivée par défaut** : l’utilisateur peut cliquer sur
« Rechercher maintenant » ou choisir une fréquence dans les réglages.

Il reste à valider le parcours complet sur une installation réelle (mise à
jour d’une version précédente, redémarrage et intégrité du coffre), à packager
les mises à jour Windows/Linux et à formaliser la conservation et la rotation
de la clé minisign.

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

L’audit interne de la 0.12.0 (186 constats) a été remédié et la 0.14.0 publiée,
mais aucun audit cryptographique ni test d’intrusion **externe** n’a été
réalisé. Pour un produit qui contient tous les mots de passe d’une personne,
c’est un prérequis de confiance, même avec 785 tests.

### B-08 — Validation Windows/Linux et macOS Intel

La CI compile Windows/Linux, mais aucune exécution réelle, aucun test
d’installation, aucun test de trousseau ni de WebView n’a été réalisé. Le DMG
**universel** (arm64 + x86_64) de la 0.14.0 a été monté et vérifié localement
(version, architecture, signature ad hoc, `codesign --verify`), mais le binaire
Intel n’a pas été exécuté sur un Mac Intel. Le code Windows Hello et la
surveillance de session Windows (`WTSRegisterSessionNotification`,
`WM_POWERBROADCAST`) sont présents mais n’ont pas été exécutés sur une machine
Windows 11 ; la liste de contrôle manuelle figure dans la PR S1.

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
perte de focus desktop est désormais explicite. La 0.14.0 a corrigé les
notifications inertes, la restitution de focus des modales imbriquées, l’inertie
de la palette et le focus du menu mobile. Une revue manuelle avec VoiceOver/NVDA,
zoom 200 % et navigation tactile complète reste à faire.

---

## 4. Critères de sortie proposés pour une 1.0 grand public

1. Bundle macOS signé Developer ID, notarié, agrafé et validé `spctl`
   (chaîne prête ; certificat et secrets à fournir).
2. ~~Mécanisme de mise à jour signé et documenté.~~ Fait en 0.13.0 ; release
   0.14.0 publiée sur les canaux stable et bêta, reste à valider le parcours
   réel 0.13 → 0.14.
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

- **Aujourd’hui** : distribuer comme **bêta technique 0.14.0**, avec un
  avertissement clair sur Gatekeeper, l’absence d’AutoFill système et l’absence
  d’audit externe. Les mises à jour signées sont disponibles sur macOS ; la
  compatibilité manifeste 3 / protocoles 2 impose une mise à jour coordonnée de
  tous les appareils et de l’extension.
- **Prochaine étape recommandée** : valider le parcours réel de mise à jour
  0.13 → 0.14, puis fournir le certificat Developer ID et les secrets Apple,
  exécuter la release signée et notariée, traiter l’AutoFill macOS et l’audit
  externe.
- **Ne pas présenter** Coffre comme un remplaçant grand public de 1Password ou
  Mots de passe d’Apple tant que les bloquants restants (B-01, B-04 à B-08 et
  B-10) ne sont pas traités.

La sécurité du coffre local, de la cryptographie, du format et des tests est
déjà d’un bon niveau. Les bloquants restants sont principalement des sujets de
**distribution, d’intégration OS et d’assurance**, pas des failles de
confidentialité connues dans le code actuel.
