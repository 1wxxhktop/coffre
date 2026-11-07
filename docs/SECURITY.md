# Sécurité de Coffre

Ce document décrit le modèle de menace, la conception cryptographique, le
stockage local et les limites connues de Coffre 0.8.0.

> **Avertissement.** Coffre n’a pas fait l’objet d’un audit de sécurité
> indépendant. Ne l’utilisez pas comme unique copie de secrets critiques sans
> sauvegarde vérifiée. Les choix décrits ici peuvent évoluer avant la version
> 1.0.

---

## 1. Objectifs et périmètre

Coffre vise à protéger des secrets stockés sur un appareil personnel contre :

- la lecture du stockage au repos (vol de disque, sauvegarde système, accès
  physique à un appareil verrouillé) ;
- la modification ou la substitution de fichiers chiffrés ;
- l’exposition accidentelle par un service en ligne, puisqu’aucune donnée du
  coffre n’est transmise ;
- l’accès après inactivité grâce au verrouillage automatique.

Coffre **ne prétend pas** protéger contre :

- un système d’exploitation compromis, un logiciel espion, un keylogger ou une
  attaque par canal auxiliaire ;
- une extension de navigateur malveillante, un gestionnaire de mots de passe
  concurrent, ou tout script injecté dans la page ;
- un accès physique à l’appareil pendant que le coffre est déverrouillé ;
- la capture d’écran, l’enregistrement de la mémoire ou l’analyse forensique de
  la RAM ;
- un serveur web ou une chaîne de build compromis qui servirait du code
  malveillant ;
- une personne qui connaît le mot de passe maître et l’accès à l’appareil.

L’application est un client statique. Elle ne fait aucune requête réseau pour
lire ou écrire le coffre. Le service worker peut vérifier la disponibilité d’une
mise à jour de l’application et mettre en cache ses ressources, mais il ne
transmet jamais le contenu du coffre.

---

## 2. Cryptographie

### 2.1 Primitives

| Usage | Primitive | Paramètres |
| --- | --- | --- |
| Dérivation du mot de passe | Argon2id (`hash-wasm`) | 64 Mio, 3 itérations, 4 threads, clé de 32 octets |
| Sel KDF | Aléatoire | 16 octets, base64 |
| Chiffrement authentifié | AES-256-GCM (WebCrypto) | Clé 32 octets, nonce 12 octets, tag 128 bits |
| Aléa | `crypto.getRandomValues` | 16 octets pour les identifiants, 32 pour les clés, 12 pour les nonces |
| TOTP | HMAC SHA-1/256/512 (WebCrypto) | RFC 6238, période et chiffres configurables |
| Générateur | `crypto.getRandomValues` | Mots de passe et phrases de passe |

Chaque chiffrement utilise un nonce aléatoire distinct. Le nonce et le
ciphertext (tag inclus) sont stockés en base64 dans un objet `Sealed` :

```json
{ "n": "<nonce base64>", "c": "<ciphertext + tag base64>" }
```

### 2.2 Hiérarchie de clés

```text
mot de passe maître
        │  Argon2id(salt, 64 Mio, 3, 4)
        ▼
   clé maîtresse (32 octets, en mémoire)
        │  AES-256-GCM, AAD coffre:v1:vault-key:<vaultId>
        ▼
   clé de coffre (32 octets, aléatoire)
        │  AES-256-GCM, AAD coffre:v1:item-key:<vaultId>:<itemId>
        ▼
   clé d’élément (32 octets, aléatoire)
        │  AES-256-GCM, AAD coffre:v1:item-content:<vaultId>:<itemId>
        ▼
   contenu de l’élément (JSON)
         ├─ version : AES-256-GCM, AAD
         │  coffre:v1:item-version:<vaultId>:<itemId>:<versionId>
         └─ pièce jointe : AES-256-GCM, AAD
            coffre:v1:item-attachment:<vaultId>:<itemId>:<attachmentId>
```

Les AAD (Associated Authenticated Data) lient chaque ciphertext à son rôle et à
ses identifiants. Déplacer un ciphertext d’un coffre, d’un élément, d’une
version ou d’une pièce jointe à un autre fait échouer le déchiffrement. Une
version ne peut donc pas être substituée au contenu courant. Le préfixe `v1`
est celui du domaine AAD : il est indépendant de la version du format de
fichier.

#### Enveloppe de récupération optionnelle

```text
phrase de récupération (10 mots EFF, ~129 bits)
        │  Argon2id(salt distinct, 64 Mio, 3, 4)
        ▼
   clé de phrase (32 octets)
        │  AES-256-GCM, AAD coffre:v1:recovery-key
        ▼
   clé de récupération (32 octets, aléatoire)
        │  AES-256-GCM, AAD coffre:v1:recovery-vault-key:<vaultId>
        ▼
   clés de coffre

   clé maîtresse ──AES-256-GCM, AAD coffre:v1:recovery-guard──► clé de récupération
```

La phrase n’est jamais stockée. L’enveloppe contient la clé de récupération
scellée par la clé de phrase, une copie de cette clé scellée par la clé
maîtresse (`guard`) et les clés de coffre scellées par la clé de récupération.
Le `guard` permet de maintenir l’enveloppe lors d’un ajout de coffre ou d’un
changement de mot de passe sans redemander la phrase. Sans le fichier `.coffre`
(ou la base IndexedDB) et sans la phrase, l’enveloppe ne révèle rien.

### 2.3 Corbeille et historique

La corbeille est une suppression logique : l’élément reste dans le fichier et sa
date de mise à la corbeille (`deletedAt`) est écrite **dans le contenu
chiffré**. Un fichier `.coffre` ne révèle donc pas quels éléments sont dans la
corbeille.

- La restauration remet `deletedAt` à `null` sans changer le contenu.
- La suppression définitive retire l’élément, ses pièces jointes et toutes ses
  versions.
- La purge automatique compare `deletedAt` au délai de rétention configuré
  (30 jours par défaut, 0 = jamais). Elle s’exécute à l’ouverture du coffre,
  après un import de coffre ou une restauration de sauvegarde.

L’historique conserve le contenu **précédent** d’un élément à chaque
modification réelle :

- chaque version est chiffrée avec la clé de l’élément et une AAD incluant son
  propre identifiant ;
- une modification sans changement effectif, un changement de favori, un ajout
  ou une suppression de pièce jointe, ou un passage en corbeille ne crée pas de
  version ;
- restaurer une version archive d’abord le contenu courant, ce qui rend
  l’opération réversible ;
- limites : 20 versions par élément et 2 000 versions par coffre.

### 2.4 Pièces jointes

Chaque pièce jointe est chiffrée séparément avec la clé de son élément et une
AAD qui inclut le coffre, l’élément et l’identifiant de la pièce jointe. Le
contenu binaire n’est jamais stocké en clair.

- Le nom, le type MIME, la taille et la date de la pièce jointe sont conservés
  dans le contenu chiffré de l’élément.
- Le contenu binaire est stocké dans une entrée séparée du fichier `.coffre`.
- Limites : 5 Mo par fichier, 10 pièces jointes par élément, 25 Mo par élément
  et 50 Mo par coffre.
- À la suppression d’un élément ou d’un coffre, les pièces jointes associées
  sont supprimées du fichier.
- Une pièce jointe orpheline (référencée par aucun élément) est rejetée à la
  validation du fichier.

Le nom d’un coffre est chiffré avec la clé du coffre et l’AAD
`coffre:v1:vault-meta:<vaultId>`.

### 2.5 Changement de mot de passe maître

Le changement de mot de passe :

1. génère un nouveau sel et de nouveaux paramètres Argon2id ;
2. dérive une nouvelle clé maîtresse ;
3. ré-enveloppe chaque clé de coffre avec la nouvelle clé maîtresse ;
4. remplace la clé maîtresse en mémoire et efface l’ancienne.

Les éléments ne sont pas réchiffrés : leurs clés et leurs contenus restent
inchangés. Cette opération est atomique du point de vue du fichier produit, mais
la sauvegarde IndexedDB peut encore contenir la version précédente. Voir
[§ 5.2](#52-sauvegarde-locale).

### 2.6 Ce qui est visible dans un fichier `.coffre`

Le fichier exporté est du JSON. Les champs suivants sont **en clair** :

- le format et la version ;
- l’identifiant aléatoire du fichier ;
- les dates de création et de modification ;
- les paramètres KDF et le sel ;
- les identifiants aléatoires des coffres, des éléments, des versions et des
  pièces jointes ;
- les dates des coffres, des éléments, des versions et des pièces jointes ;
- les ciphertexts (noms de coffres, clés, contenus, versions, pièces jointes) ;
- si elle est configurée, l’enveloppe de récupération : sel et paramètres
  Argon2id, date de création, clé de récupération et clés de coffre scellées.

Les titres, identifiants, mots de passe, notes, cartes, identités, étiquettes,
URL, secrets TOTP, champs personnalisés, noms de fichiers, tailles, types MIME,
dates de mise à la corbeille et contenus des pièces jointes sont **chiffrés**. Un
attaquant peut néanmoins déduire le nombre de coffres, d’éléments, de versions et
de pièces jointes, ainsi que leurs dates — mais pas quels éléments sont dans la
corbeille.

### 2.7 Validation à l’import

Le fichier importé est validé avec Zod :

- format `coffre`, version `1`, `2` ou `3` (les fichiers v1 et v2 sont lus puis
  migrés en v3 à la première écriture) ;
- paramètres KDF dans des bornes acceptées ;
- identifiants de coffres, d’éléments, de versions et de pièces jointes uniques ;
- élément rattaché à un coffre existant ;
- pièce jointe et version rattachées à un élément existant et au bon coffre ;
- enveloppe de récupération, si présente : une clé scellée par coffre, sans
  doublon ni coffre inconnu, et couvrant tous les coffres du fichier ;
- schémas de contenu par type ;
- champs personnalisés, pièces jointes, versions et enveloppe de récupération
  optionnels (rétrocompatibilité avec les fichiers antérieurs).

Un fichier peut néanmoins spécifier des paramètres Argon2id plus faibles que les
valeurs par défaut (le format accepte une mémoire minimale de 8 Mio, notamment
pour les tests). N’importez que des fichiers dont vous connaissez la provenance.

### 2.8 Import depuis un autre gestionnaire

L’import externe accepte un export JSON non chiffré de Bitwarden, Proton Pass ou
Enpass, ou un fichier CSV (1Password, LastPass, Chrome, Firefox, Safari,
Dashlane, KeePass/KeePassXC, NordPass, Keeper, RoboForm, SafeInCloud, Enpass). Le
fichier est lu localement, analysé, converti en brouillons, puis chiffré par le
coffre de destination.

- Le fichier source n’est ni conservé ni transmis.
- La taille du fichier est limitée à 20 Mo et l’import à 5 000 éléments par
  opération.
- Les exports chiffrés (Bitwarden, Proton Pass, `.enpassbackup`) et les archives
  propriétaires (`.1pux`) sont refusés.
- Les doublons sont détectés localement (même type et mêmes informations
  d’identification) et peuvent être ignorés avant l’import.
- Les données importées restent en clair dans la mémoire du navigateur pendant
  l’opération ; supprimez le fichier source après l’import.
- Un fichier `.coffre` doit être importé avec son mot de passe via « Importer un
  coffre », et non via l’import externe.

### 2.9 Extension navigateur

L’extension Manifest V3 (`extension/`) ne stocke ni coffre ni secret. Elle
interroge l’onglet Coffre déverrouillé via `window.__coffreExtension`, une
passerelle en mémoire supprimée au verrouillage.

- L’extension ne peut lire que l’onglet Coffre configuré (permission d’hôte) et
  l’onglet actif au moment du clic (`activeTab`).
- Les identifiants transitent en mémoire entre l’onglet Coffre, le service
  worker et la page active ; ils ne sont ni journalisés ni persistés.
- Le remplissage est déclenché par un clic ; aucun formulaire n’est soumis
  automatiquement.
- Tout code exécuté dans l’onglet Coffre pendant le déverrouillage peut appeler
  la passerelle. Le risque est équivalent à celui d’un XSS dans l’application :
  verrouillez le coffre après usage et n’installez que des extensions de
  confiance.
- L’extension n’est ni signée ni publiée : chargez uniquement un dossier
  `dist-extension/` construit localement.

---

## 3. Stockage local

### 3.1 IndexedDB

Les données sont stockées dans la base IndexedDB `coffre`, magasin `vault` :

| Clé | Contenu |
| --- | --- |
| `current` | Fichier de coffre courant, déjà chiffré |
| `backup` | Version précédente du fichier, déjà chiffrée |
| `backup:2` | Version antérieure à `backup`, déjà chiffrée |
| `backup:3` | Version la plus ancienne conservée, déjà chiffrée |

Aucune clé, aucun mot de passe et aucun contenu en clair ne sont écrits dans
IndexedDB. Le fichier stocké est identique à celui exporté. Il peut contenir une
enveloppe de récupération optionnelle, elle aussi chiffrée (voir 2.2).

### 3.2 Préférences

Les préférences non sensibles sont dans `localStorage` sous
`coffre:settings:v1` : délai de verrouillage automatique, verrouillage lorsque
l’onglet passe en arrière-plan, délai d’effacement du presse-papiers, durée de
conservation de la corbeille et activation du trousseau ou de Touch ID. Elles
ne contiennent aucun secret.

L’historique « Récents » est stocké séparément sous `coffre:usage:v1` : une
table d’identifiants aléatoires d’éléments et d’horodatages, plafonnée à 500
entrées. Aucun titre, identifiant de compte ni secret n’y figure, mais le rythme
d’utilisation reste visible pour un tiers ayant accès au profil du navigateur.
La table est effacée à la réinitialisation du coffre ; elle n’est jamais incluse
dans un export `.coffre`.

### 3.3 Cycle de vie

- Au chargement, Coffre lit `current` et valide le format.
- Le déverrouillage dérive la clé maîtresse et ouvre les clés de coffre en
  mémoire ; si une enveloppe existe, sa clé de récupération est également
  ouverte via le `guard` et conservée en mémoire. La purge de la corbeille est
  appliquée avant l’affichage.
- À chaque mutation, le fichier courant est remplacé ; les trois versions
  précédentes glissent de `backup` vers `backup:2` puis `backup:3`, la plus
  ancienne étant écrasée.
- Le verrouillage efface les clés en mémoire et vide l’état React.
- Un rechargement de page, un `pagehide` ou une fermeture d’onglet verrouille le
  coffre : les clés ne sont jamais persistées. Un retour depuis le cache
  d’arrière-plan (bfcache) retrouve donc un coffre verrouillé.
- La vérification d’intégrité déchiffre tous les enregistrements — contenus,
  versions et pièces jointes — et compare la taille des pièces jointes à leurs
  métadonnées ; elle ne modifie pas le fichier.

### 3.4 Limites du stockage navigateur

- Le navigateur peut évincer les données d’un site. Les réglages permettent de
  demander `navigator.storage.persist()` et d’afficher le statut obtenu ainsi que
  l’espace utilisé ; le navigateur reste libre d’accorder ou de refuser.
- Le mode privé, la navigation restreinte ou certains WebViews peuvent refuser
  IndexedDB.
- Les données sont liées à l’origine (schéma + domaine + port). Changer de
  domaine ou de port crée un coffre vide distinct.
- Une sauvegarde système ou une synchronisation de profil navigateur peut
  copier la base chiffrée sur un autre support. Le chiffrement reste la
  protection principale.

---

## 4. Verrouillage et presse-papiers

### 4.1 Verrouillage automatique

- Délai par défaut : 5 minutes, configurable (jamais, 1, 5, 15, 30, 60).
- L’activité est détectée par `pointerdown`, `pointermove`, `keydown`, `wheel`,
  `touchstart` et `focus`.
- Un intervalle vérifie l’inactivité toutes les 5 secondes.
- **Verrouillage à la perte de visibilité** : actif par défaut, il efface les
  clés dès que `document.hidden` devient vrai. Il s’applique même si le délai
  d’inactivité est désactivé. L’option peut être décochée dans les réglages.
- Si l’option est désactivée, le temps passé hors écran est mesuré au retour :
  un onglet resté en arrière-plan plus longtemps que le délai se verrouille.
- `pagehide` et `beforeunload` verrouillent également la session.
- Les minuteurs peuvent être ralentis par le navigateur lorsque l’onglet est en
  arrière-plan ; le verrouillage peut donc survenir au retour plutôt qu’à la
  seconde près.
- Le verrouillage manuel et le bouton « Verrouiller maintenant » sont toujours
  disponibles.

### 4.2 Presse-papiers

La copie utilise `navigator.clipboard.writeText` lorsque disponible, sinon un
repli `execCommand('copy')`. L’effacement automatique :

- lit le presse-papiers après le délai configuré ;
- tente aussi un effacement immédiat au verrouillage ;
- n’écrit une chaîne vide que si le contenu est **toujours identique** à la
  valeur copiée ;
- ne fait rien si la lecture est refusée par le navigateur.

Conséquences : si l’utilisateur copie autre chose, le secret n’est pas effacé
(comportement voulu) ; si la lecture est refusée, le secret peut rester dans le
presse-papiers. Le presse-papiers est partagé avec les autres applications.

---

## 5. Sauvegardes et récupération

### 5.1 Export

L’export produit un fichier JSON `.coffre` contenant le coffre chiffré complet.
Il ne contient pas le mot de passe maître. Sans ce mot de passe, le fichier est
inutilisable.

Recommandations :

- exporter après chaque ajout important ;
- conserver plusieurs copies sur des supports distincts ;
- vérifier régulièrement qu’un export s’importe et se déverrouille ;
- ne pas envoyer le fichier par un canal non maîtrisé sans chiffrement
  supplémentaire.

### 5.2 Sauvegardes locales

IndexedDB conserve automatiquement les **trois versions précédentes** du fichier
chiffré (`backup`, `backup:2`, `backup:3`). Si le fichier courant est corrompu
ou illisible, l’écran d’erreur liste les générations disponibles — date et
nombre d’éléments, sans contenu — et permet d’en restaurer une après saisie du
mot de passe maître. La génération restaurée redevient `current` et la rotation
reprend normalement.

Limites :

- ce ne sont pas des sauvegardes hors appareil : elles partagent le même profil
  de navigateur, le même appareil et la même origine ;
- la plus ancienne est écrasée à chaque nouvelle écriture ;
- après un changement de mot de passe maître, les générations antérieures
  restent protégées par l’**ancien** mot de passe jusqu’à leur écrasement ;
- effacer le coffre local supprime `current` et les trois générations ;
- une écriture réussie mais logiquement erronée (par exemple un import massif
  involontaire) est répliquée dans les générations suivantes après trois
  enregistrements : un export `.coffre` reste indispensable.

### 5.3 Phrase de récupération optionnelle

Il n’existe ni question secrète, ni compte, ni récupération par un tiers. Une
**phrase de récupération** peut être configurée dans les réglages :

- elle est générée localement (dix mots EFF, ~129 bits) et affichée une seule
  fois ;
- seule une enveloppe chiffrée est enregistrée dans le fichier, jamais la
  phrase ;
- elle permet de rouvrir le coffre et d’imposer un nouveau mot de passe maître ;
- elle reste valable après un changement de mot de passe, un ajout de coffre ou
  un export/réimport ;
- la remplacer ou la supprimer invalide immédiatement l’ancienne.

Sans phrase configurée, perdre le mot de passe maître revient à perdre les
données. Avec une phrase, la sécurité repose sur deux secrets : le fichier
`.coffre` et la phrase. Un attaquant qui obtient les deux peut ouvrir le coffre ;
conservez la phrase sur un support distinct, à l’abri des regards.

### 5.4 Vérification d’intégrité

Le bouton « Vérifier le coffre » (section Sauvegarde) déchiffre et authentifie :

- le nom de chaque coffre ;
- la clé, le contenu et le schéma de chaque élément ;
- chaque version référencée, déchiffrée avec son AAD dédiée ;
- chaque pièce jointe référencée, avec comparaison de taille ;
- l’enveloppe de récupération : `guard` avec la clé maîtresse et chaque `wrap`
  avec la clé de récupération ;
- l’absence de version et de pièce jointe orpheline.

Toute erreur AES-GCM, incohérence de taille ou référence manquante produit un
rapport d’échec. La vérification est en lecture seule : elle ne répare ni ne
réécrit le coffre. En cas d’échec, exportez immédiatement une sauvegarde et
n’effectuez plus de modification avant investigation.

**Limite d’intégrité globale.** Chaque enregistrement est authentifié, mais le
fichier complet ne possède ni MAC ni signature ni compteur anti-rétrogradation.
Un attaquant capable d’écrire le fichier peut supprimer proprement un élément et
ses dépendances, ou remplacer le fichier par une version antérieure complète.
La vérification détecte les références orphelines et les altérations, pas une
suppression cohérente ni un rollback. Conservez un export hors appareil et
comparez les dates si cette menace fait partie de votre modèle.

---

## 6. Surface d’attaque applicative

### 6.1 Pas de réseau

Le code de l’application ne contient ni `fetch`, ni `XMLHttpRequest`, ni
WebSocket vers un service. Les polices sont système, les icônes sont des
composants SVG locaux, la liste EFF est embarquée. L’import lit un fichier local
via l’API `File` du navigateur et ne l’envoie nulle part.

Le build PWA ajoute un service worker Workbox qui :

- précache les ressources statiques de l’application ;
- peut contacter le serveur d’origine pour mettre à jour ces ressources ;
- ne met jamais le contenu du coffre dans le cache HTTP.

### 6.2 Rendu

React échappe les valeurs affichées. Le code n’utilise pas
`dangerouslySetInnerHTML`, `eval` ni `new Function`. Les URL des éléments et
des champs personnalisés de type « adresse web » sont rendues comme liens
externes avec `rel="noreferrer noopener"` et `target="_blank"`, et uniquement
si le schéma est `http` ou `https`. La validation `safeExternalUrl`
(`src/lib/url.ts`) refuse explicitement tout autre schéma — `javascript:`,
`data:`, `file:`, `vbscript:`, `blob:`, `mailto:` — et est couverte par des tests
unitaires ainsi qu’un parcours Playwright.

### 6.3 Dépendances

Le projet dépend de React, Vite, `hash-wasm`, `idb`, Zod, Lucide,
`vite-plugin-pwa`/Workbox et Tauri. Une compromission d’une de ces dépendances
ou de la chaîne de build peut compromettre l’application. Verrouillez les
versions (`bun.lock`) et auditez les mises à jour avant de publier.

Le portage natif ajoute nanoui v0.11.0 (MIT), vendorisé dans
`native/vendor/nanoui` et épinglé dans `native/build.zig.zon`. Il n’est pas
encore couvert par `bun audit` ; sa mise à jour passe par
`native/scripts/fetch-deps.sh` et les tests du dossier `native/`.

La CI exécute `bun audit --audit-level=high` à chaque poussée et Dependabot
propose les mises à jour chaque semaine. Dernier état connu (0.8.0) : aucune
vulnérabilité `high` ou `critical`, mais trois alertes de gravité inférieure,
toutes transitives et limitées à la chaîne de build
`vite-plugin-pwa > workbox-build` : `deepmerge@4.3.1` (faible),
`glob@11.1.0` (modérée) et `minimatch@10.2.6`/`5.1.9` (modérées). Ces paquets ne
sont pas inclus dans le bundle livré. Les alertes sont acceptées et doivent être
réévaluées à chaque montée de version. Le workflow échoue si une vulnérabilité de
gravité `high` ou `critical` apparaît.

### 6.4 Mémoire

Les clés sont stockées dans des `Uint8Array` et effacées avec `fill(0)` au
verrouillage ou après usage. JavaScript ne garantit pas l’effacement réel :
le ramasse-miettes, les copies internes du moteur et le système d’exploitation
peuvent conserver des traces. Utilisez un appareil de confiance et verrouillez
le coffre lorsque vous vous absentez.

---

## 7. Déploiement web

Servez Coffre exclusivement en **HTTPS** (ou sur `localhost`). Ajoutez des
en-têtes de sécurité au niveau du serveur ou de l’hébergeur. Le fichier
`public/_headers` fourni contient la politique suivante :

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; upgrade-insecure-requests
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), midi=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

`'wasm-unsafe-eval'` est requis par `hash-wasm` pour compiler Argon2id.
`style-src 'unsafe-inline'` est nécessaire pour les styles calculés par React et
les transitions. `img-src` et `media-src` autorisent `blob:` pour les aperçus et
téléchargements de pièces jointes. Ne ajoutez aucun script tiers, aucune police
distante, aucun outil d’analytique et aucune régie publicitaire.

Le fichier `public/_redirects` fournit le repli monopage (`/* /index.html 200`).
Les deux fichiers sont copiés dans `dist/` par Vite. Pour les hébergeurs qui ne
lisent pas `_headers`, configurez les en-têtes dans le reverse proxy ou le CDN.

### 7.1 Tauri

La configuration `src-tauri/tauri.conf.json` applique une CSP stricte en
production (avec `'wasm-unsafe-eval'` et `blob:` pour les pièces jointes),
désactive la CSP en développement (pour Vite/HMR) et active `freezePrototype`.
La WebView ne peut appeler que trois commandes IPC, toutes dédiées au trousseau
du système :

| Commande | Rôle |
| --- | --- |
| `keychain_store(account, secret)` | enregistre la clé maîtresse encodée en base64 |
| `keychain_load(account)` | relit la clé, ou `null` si l’entrée est absente |
| `keychain_delete(account)` | supprime l’entrée ; une absence n’est pas une erreur |

Le service est `app.coffre.desktop` et le compte est l’identifiant du fichier
`.coffre` (`file.id`). Le backend est fourni par la caisse `keyring` 3.6, avec
`apple-native` sur macOS, `windows-native` sur Windows et `sync-secret-service`
sur Linux. Aucune autre commande n’est ouverte à la WebView, et le trousseau
n’est jamais utilisé pour les coffres ouverts dans un navigateur.

La seule permission Tauri supplémentaire est
`core:window:allow-start-dragging`, nécessaire pour déplacer la fenêtre macOS
sans barre de titre. Elle n’ouvre aucun accès aux fichiers, au réseau ou au
trousseau.

Le déverrouillage par empreinte (macOS) ajoute quatre commandes :
`biometric_available`, `biometric_store`, `biometric_delete` et
`biometric_load`. Les clés biométriques sont rangées dans le service
`app.coffre.desktop.biometric`, distinct de `app.coffre.desktop` :
`keychain_load` ne peut donc pas les lire. `biometric_load` exécute
`LocalAuthentication` avec `LAPolicyDeviceOwnerAuthenticationWithBiometrics` et
ne renvoie la clé qu’après un succès ; une annulation renvoie
`authenticated: false`. L’écran de verrouillage déclenche ce dialogue
automatiquement lorsque la fenêtre est activée (avec un délai de refroidissement
pour éviter une boucle après annulation). La clé biométrique est conservée pendant le
verrouillage — sinon le déverrouillage rapide serait impossible — et supprimée
à la désactivation de l’option, à la réinitialisation ou au changement de
coffre.

Le trousseau du login affiche son propre dialogue d’autorisation lors du premier
accès à l’entrée biométrique. macOS mémorise « Always Allow » en l’associant à
la signature de l’application. Le bundle est signé ad hoc (identifiant
`app.coffre.desktop`) : une signature ad hoc dépend du contenu du binaire, donc
l’autorisation peut être oubliée après chaque recompilation. Une signature
Developer ID stable, avec notarisation, est nécessaire pour une confiance
durable. Ce dialogue keychain est distinct de Touch ID.

Limite assumée : le trousseau reste celui de la session utilisateur et
l’authentification est imposée par l’application. Un processus disposant déjà
des droits de l’utilisateur pourrait tenter de lire l’entrée biométrique ;
le modèle de menace exclut un OS compromis. Sur un appareil partagé, préférez
le mot de passe maître seul.

Le déverrouillage rapide est **optionnel et désactivé par défaut**
(`keychainUnlock`). La clé n’est enregistrée que si l’utilisateur active
l’option, puis elle est supprimée au verrouillage, à la réinitialisation et au
changement de coffre. Une clé périmée est détectée à l’ouverture : l’entrée est
effacée et l’application revient à la saisie du mot de passe maître. Cette
protection réduit les ressaisies après un rechargement, mais elle élargit la
surface d’attaque : tout code exécuté dans la WebView, ou tout processus
capable de lire le trousseau de la session, peut demander la clé. Laissez
l’option désactivée sur un appareil partagé.

Les WebViews desktop utilisent IndexedDB ; le stockage est propre à
l’application et à l’identifiant Tauri.

Le build macOS arm64 a été validé : l’application démarre, crée la base
IndexedDB `coffre` (magasin `vault`), reste stable et n’ouvre aucune connexion
réseau. Les parcours Playwright passent sur WebKit, moteur des WebViews
macOS/iOS. Le bundle produit n’est ni signé ni notarisé, et les cibles
Windows/Linux restent à valider.

### 7.2 Application native (expérimental, mis de côté)

> Le portage Zig + nanoui n’est plus la cible produit ; il est conservé à titre
> d’archive technique et ne doit pas contenir de coffre réel. Le desktop actif
> est Tauri.

Le portage `native/` (Zig + nanoui) réutilise le format, Argon2id,
AES-256-GCM et les AAD de l’application web. Il n’ouvre aucune connexion
réseau. Il lit et déchiffre un `.coffre` choisi par l’utilisateur, sait créer
un coffre neuf, modifier des connexions et des notes, et importer des exports
non chiffrés.

- La clé maîtresse, les clés de coffre et le contenu déchiffré vivent dans une
  arène libérée au verrouillage ; les clés et les tampons intermédiaires sont
  effacés avec `std.crypto.secureZero`.
- Le champ de phrase de passe et sa confirmation sont effacés après le
  déverrouillage, la création et au verrouillage.
- La lecture est plafonnée à 128 Mo ; les paramètres KDF et les identifiants
  sont validés avant tout déchiffrement.
- La création dérive une clé maîtresse et une clé de coffre aléatoires, puis
  écrit le fichier de façon atomique : fichier temporaire dans le même dossier,
  synchronisation, renommage. Les trois versions précédentes sont conservées en
  `.bak1` à `.bak3` ; les nouvelles créations reçoivent les permissions `0600`
  sur macOS et Linux.
- La création et la modification d’un élément génèrent une clé d’élément
  aléatoire, scellée avec la clé du coffre, puis scellent le contenu JSON avec
  cette clé. Les AAD d’élément sont identiques à celles de l’application web.
  Les tampons du formulaire (dont le mot de passe) sont effacés à la fermeture
  et au verrouillage.
- L’import lit le fichier choisi en mémoire, plafonné à 128 Mo, et n’en
  conserve rien : l’analyse se fait dans une arène temporaire dont les chaînes
  sont effacées à la sortie, puis seules les copies des éléments retenus sont
  chiffrées et écrites. Le texte brut du fichier est effacé au verrouillage.
  Le fichier source n’est ni copié ni modifié. Les doublons sont ignorés avant
  tout chiffrement, et les exports chiffrés ou les fichiers `.coffre` sont
  refusés.
- Le générateur utilise `std.Io.random` (source du système) avec rejet des
  valeurs hors bornes, sans biais modulo. Le mot de passe généré est copié
  dans le champ du formulaire puis effacé avec le reste des tampons.
- Le code TOTP est calculé en mémoire à partir du secret de l’URI ; le secret
  décodé et les tampons HMAC sont effacés après usage. Seul le code affiché
  ou copié quitte la mémoire. Aucun secret n’est journalisé.
- Le verrouillage automatique est réglable (jamais, 1, 5, 15 ou 60 minutes) et
  mémorisé dans les préférences. À l’échéance, il efface les clés, l’arène
  déchiffrée, les tampons du formulaire, le texte d’import et la recherche.
- Les copies de secrets sont effacées du presse-papiers au verrouillage.
  nanoui n’expose pas de lecture du presse-papiers : un effacement différé
  risquerait de détruire un contenu copié ensuite par l’utilisateur. Cette
  limite est assumée et documentée.
- Les raccourcis clavier (`Cmd/Ctrl+L`, `N`, `F`, `I`, `Échap`) et le menu
  « Fichier » n’accèdent qu’aux actions déjà exposées par l’interface.
- Une vérification manuelle a confirmé qu’un fichier créé par le portage natif,
  y compris un élément chiffré, est relu par `src/lib/vault.ts`.
- Le déverrouillage bloque le fil de l’interface pendant Argon2id. Ce n’est
  pas une faille, mais une limite d’ergonomie à corriger.
- **Cette implémentation n’a pas été auditée.** Elle ne doit pas encore
  contenir le seul exemplaire d’un coffre réel.

---

## 8. Risques résiduels

| Risque | Impact | Atténuation actuelle |
| --- | --- | --- |
| Mot de passe maître faible | Déchiffrement hors ligne | Argon2id, minimum 12 caractères, indicateur de robustesse |
| XSS ou code servi compromis | Vol des secrets pendant le déverrouillage | Pas de réseau, CSP fournie, dépendances verrouillées, Tauri CSP |
| Extension malveillante | Lecture du DOM, du presse-papiers, des frappes | Navigateur/profil dédié, désactivation des extensions |
| Extension Coffre compromise | Lecture des identifiants pendant le remplissage | Aucun stockage, accès limité à l’onglet actif, verrouillage après usage |
| Appareil compromis | Keylogging, mémoire, écran | Hors périmètre ; utiliser un OS à jour |
| Presse-papiers non effacé | Fuite vers une autre application | Effacement au mieux, délai court |
| Perte du mot de passe | Perte définitive sans phrase configurée | Phrase de récupération optionnelle (~129 bits) ; exports réguliers |
| Phrase de récupération compromise | Ouverture du coffre avec le fichier | Phrase non stockée, à conserver séparément ; remplacement immédiat en cas de doute |
| Corruption du stockage | Perte du coffre courant | Trois générations `backup`, validation, vérification d’intégrité, export |
| Fichier d’import malveillant ou volumineux | Déni de service, import partiel | Limite de 20 Mo et 5 000 éléments, validation, aperçu avant import |
| Pièce jointe malveillante | Exécution à l’ouverture hors de Coffre | Type MIME et extension non fiables ; ouvrir avec prudence, aucune exécution dans l’application |
| Métadonnées visibles | Fuite d’information limitée | Chiffrement du contenu ; métadonnées assumées |
| Historique et corbeille conservés | Données supprimées encore présentes dans le fichier | Chiffrés, plafonnés (20 versions/élément), purge configurable |
| Dépendance compromise | Exécution arbitraire | Versions verrouillées, revue, build reproductible à venir |
| Implémentation native non auditée | Défaut cryptographique ou mémoire | Même format et mêmes primitives que le web ; lecture seule ; audit avant usage réel |

---

## 9. Signalement d’une vulnérabilité

Coffre n’a pas encore de programme de divulgation coordonnée. Si le dépôt est
publié, utilisez de préférence un avis de sécurité privé (GitHub Security
Advisory) plutôt qu’une issue publique. Indiquez la version, la plateforme, les
étapes de reproduction et l’impact estimé. Ne joignez jamais un vrai coffre ni
un vrai mot de passe.

---

## 10. Feuille de route sécurité

- audit cryptographique et test d’intrusion externes, y compris du cœur natif
  en Zig ;
- augmentation et calibration des paramètres Argon2id selon l’appareil ;
- extension du trousseau natif au mobile (iOS/Android) et validation des backends Windows/Linux ;
- extension des tests de bout en bout à Firefox et aux WebViews Android/iOS ;
- protection mémoire renforcée (WebAssembly, workers isolés) ;
- politique de divulgation et builds reproductibles ;
- import/export interopérable avec chiffrement supplémentaire optionnel.
