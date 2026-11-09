# Sécurité de Coffre

Ce document décrit le modèle de menace, la conception cryptographique, le
stockage local et les limites connues de Coffre 0.9.0.

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
| Passkeys WebAuthn | ECDSA P-256 (WebCrypto), SHA-256, CBOR | Attestation `none`, clé publique COSE ES256, signature DER |
| Pont natif | ECDH P-256, HKDF-SHA-256, AES-256-GCM | Compteurs anti-rejeu par session |
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
(ou le stockage local) et sans la phrase, l’enveloppe ne révèle rien.

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
4. génère une nouvelle clé HMAC (format 4), incrémente `keyEpoch` et recalculera
   le MAC global à l’écriture ;
5. remplace la clé maîtresse en mémoire et efface l’ancienne.

Les éléments ne sont pas réchiffrés : leurs clés et leurs contenus restent
inchangés. Cette opération est atomique du point de vue du fichier produit, mais
la sauvegarde locale (fichier natif ou IndexedDB) peut encore contenir la
version précédente. Voir [§ 5.2](#52-sauvegarde-locale).

Si l’écriture échoue après le changement de clés, la session est verrouillée :
le fichier sur disque utilise encore l’ancien mot de passe, et l’application ne
continue jamais avec des clés qui ne correspondent pas au fichier enregistré.

Limite connue : comme les clés de coffre ne changent pas, l’ancien mot de passe
associé à une **ancienne copie** du fichier (sauvegarde, export, dossier
synchronisé) ouvre toujours les clés de coffre, donc aussi le contenu ajouté
ensuite si l’attaquant obtient aussi le nouveau fichier. Une rotation des clés
de contenu n’est pas appliquée, car elle couperait l’accès des membres des
coffres partagés ([§ 2.26](#226-socle-de-partage-et-accès-durgence-l10)) ;
après une fuite de l’ancien mot de passe, créez un nouveau coffre et importez-y
les éléments.

### 2.5.1 Déplacement d’un élément entre coffres

Déplacer un élément ne recopie aucun ciphertext tel quel : la clé d’élément,
le contenu, chaque version et chaque pièce jointe sont déchiffrés puis
réchiffrés avec une nouvelle clé d’élément enveloppée par la clé du coffre de
destination. Les AAD sont recalculées avec le nouveau `vaultId`, ce qui empêche
de rejouer un enregistrement déplacé dans son ancien coffre. L’ancienne clé
d’élément et les anciens tampons sont effacés dès l’opération terminée.

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
- depuis le format 4 : l’identifiant de l’appareil écrivain, la révision du
  fichier, l’époque des clés, les pierres tombales (type, identifiant et date de
  suppression), le MAC global et la clé HMAC scellée ;
- si elle est configurée, l’enveloppe de récupération : sel et paramètres
  Argon2id, date de création, clé de récupération et clés de coffre scellées.

Les titres, identifiants, mots de passe, notes, cartes, identités, étiquettes,
URL, secrets TOTP, champs personnalisés, noms de fichiers, tailles, types MIME,
dates de mise à la corbeille, contenus des pièces jointes et entrées de
l’historique du générateur (mot de passe et domaine) sont **chiffrés**. Un
attaquant peut néanmoins déduire le nombre de coffres, d’éléments, de versions et
de pièces jointes, ainsi que leurs dates — mais pas quels éléments sont dans la
corbeille.

### 2.7 Intégrité globale et révisions (format 4)

Le format 4 ajoute au fichier :

```text
writer      identifiant aléatoire de l’appareil qui a écrit en dernier
revision    compteur monotone, incrémenté à chaque écriture signée
keyEpoch    époque des clés, incrémentée à chaque rotation
tombstones  suppressions définitives récentes (type, id, date), purgées à 180 jours
integrity   { mac: HMAC-SHA-256, key: clé HMAC scellée par la clé maîtresse }
```

Chaque coffre et chaque élément porte une horloge `{ rev, writer }` ; la
révision de l’enregistrement est incrémentée lorsqu’un ciphertext change.
Le MAC couvre un manifeste canonique (JSON à clés triées) contenant
l’identifiant du fichier, l’appareil écrivain, `revision`, `keyEpoch`,
l’empreinte SHA-256 des ciphertexts de tous les coffres (clé et nom), éléments
(clé et contenu), pièces jointes et versions, ainsi que les horloges
`{ rev, writer }` et les pierres tombales. Il ne contient aucun contenu
déchiffré.

La clé HMAC est aléatoire, scellée avec l’AAD `coffre:v1:integrity-key` et
tournée au changement de mot de passe maître ou après une récupération par
phrase ; `keyEpoch` est alors incrémenté. À l’ouverture :

- MAC valide : le coffre est ouvert normalement ;
- fichier v1 à v3 : aucun MAC, le fichier est migré et signé à la première
  écriture ;
- fichier v4 sans `integrity`, clé illisible ou MAC différent : le coffre est
  ouvert **en lecture seule** avec un avertissement bloquant, pour permettre
  l’export d’une sauvegarde. Une version 4 dégradée en v3 est refusée par le
  validateur.

La plus haute `revision` vue pour un fichier est conservée **hors du fichier**
(`vault/state.json` sur desktop, clé `state` d’IndexedDB sur le Web). Si un
fichier de même identifiant présente une révision inférieure, un avertissement
explicite est ajouté. Une restauration volontaire depuis l’écran des sauvegardes
ou un import volontaire abaisse la référence sans alerter. Cette protection
détecte une substitution accidentelle ou un remplacement par une sauvegarde
ancienne ; elle ne protège pas si l’attaquant contrôle aussi le fichier d’état.

#### Pierres tombales et fusion

Les pierres tombales sont conservées jusqu’à 180 jours, même lorsqu’un
enregistrement plus récent ressuscite le même identifiant. Le validateur accepte
cette coexistence uniquement si `deletedAt` est **antérieur** à `updatedAt` de
l’enregistrement ; une pierre tombale plus récente que l’enregistrement rend le
fichier invalide. Cette règle permet à une fusion ultérieure de savoir quels
historiques et pièces jointes précèdent une suppression définitive.

`mergeVaultFiles` (`src/lib/sync.ts`) est la couche de fusion pure :

- elle exige des fichiers v4 de même identifiant, même époque de clés et mêmes
  paramètres KDF ;
- elle choisit chaque enregistrement par `{ rev, writer }` et signale les
  conflits à révision égale sans les archiver elle-même (l’appelant possède la
  clé de l’élément) ;
- elle applique les pierres tombales, unit versions et pièces jointes, puis
  applique les plafonds ;
- elle ne vérifie ni MAC ni mot de passe et ne signe jamais : le résultat doit
  passer par `signVaultFile` avant écriture ;
- les versions et pièces jointes antérieures à une suppression définitive sont
  écartées, même si l’élément est ressuscité ; seuls les enregistrements créés
  après la suppression peuvent subsister.

### 2.8 Validation à l’import

Le fichier importé est validé avec Zod :

- format `coffre`, version `1` à `4` (les fichiers v1 à v3 sont lus puis migrés
  en v4 à la première écriture) ;
- paramètres KDF dans des bornes acceptées ;
- identifiants de coffres, d’éléments, de versions et de pièces jointes uniques ;
- élément rattaché à un coffre existant ;
- pièce jointe et version rattachées à un élément existant et au bon coffre ;
- enveloppe de récupération, si présente : une clé scellée par coffre, sans
  doublon ni coffre inconnu, et couvrant tous les coffres du fichier ;
- pour la version 4 : `writer`, `revision`, `keyEpoch`, `tombstones` et
  `integrity` obligatoires, horloge présente sur chaque coffre et chaque
  élément, pierres tombales sans doublon et sans enregistrement encore présent ;
- schémas de contenu par type ;
- champs personnalisés, pièces jointes, versions et enveloppe de récupération
  optionnels (rétrocompatibilité avec les fichiers antérieurs).

Un fichier peut néanmoins spécifier des paramètres Argon2id plus faibles que les
valeurs par défaut (le format accepte une mémoire minimale de 8 Mio, notamment
pour les tests). N’importez que des fichiers dont vous connaissez la provenance.

### 2.9 Import depuis un autre gestionnaire

L’import externe accepte un export JSON non chiffré de Bitwarden, Proton Pass ou
Enpass, un fichier CSV (1Password, LastPass, Chrome, Firefox, Safari, Dashlane,
KeePass/KeePassXC, NordPass, Keeper, RoboForm, SafeInCloud, Enpass) ou une
archive 1Password `.1pux` non chiffrée. Le fichier est lu localement, analysé,
converti en brouillons, puis chiffré par le coffre de destination.

- Le fichier source n’est ni conservé ni transmis.
- La taille du fichier est limitée à 20 Mo (50 Mo pour une archive `.1pux`) et
  l’import à 5 000 éléments par opération.
- Les exports chiffrés (Bitwarden, Proton Pass, `.enpassbackup`) sont refusés.
  Une archive `.1pux` est lue en mémoire ; ses pièces jointes binaires ne sont
  pas importées.
- Les doublons sont détectés localement (même type et mêmes informations
  d’identification) et peuvent être ignorés avant l’import.
- Les données importées restent en clair dans la mémoire du navigateur pendant
  l’opération ; supprimez le fichier source après l’import.
- Un fichier `.coffre` doit être importé avec son mot de passe via « Importer un
  coffre », et non via l’import externe.

### 2.10 Extension navigateur

L’extension Manifest V3 (`extension/`) ne stocke ni coffre ni identifiant. Sur
le Web, elle interroge l’onglet Coffre déverrouillé via
`window.__coffreExtension`, une passerelle en mémoire supprimée au
verrouillage. Sur desktop, le pont natif décrit en 2.11 est utilisé en priorité ;
l’onglet Web reste le repli. Seule la clé de session du pont natif (après
appairage) est conservée dans `chrome.storage.local`.

- L’extension ne peut lire que l’onglet Coffre configuré (permission d’hôte) et
  les pages explicitement autorisées. Le menu dans les champs est **désactivé
  par défaut** : il faut accorder `optional_host_permissions` (`http://*/*`,
  `https://*/*`) depuis le popup. Le content script n’est alors enregistré que
  par `scripting.registerContentScripts`, jamais avant.
- Détection locale des formulaires (`extension/detect.ts`) : types, attributs
  `autocomplete`, noms, libellés et position. Les champs masqués par `display`,
  `visibility`, `opacity`, `hidden` ou `aria-hidden` sont ignorés ; les
  formulaires à plusieurs mots de passe (inscription, changement) ne proposent
  pas le menu.
- Le menu est rendu dans une **iframe d’origine extension** placée dans un
  shadow root fermé. La page ne peut ni lire son DOM, ni envoyer un message
  valide : le content script vérifie `event.source` et `event.origin`. Aucun
  identifiant n’est transmis au content script avant un clic dans ce menu.
- Le remplissage vérifie l’hôte de la frame dans le content script **et** dans
  l’application (`loginAllowsHost`) ; les iframes ne sont remplies que si leur
  origine correspond à l’URL de l’élément.
- **Passkeys WebAuthn** : après activation des hôtes, un script `webauthn-main.js`
  est enregistré dans le monde `MAIN` à `document_start` et enveloppe
  `navigator.credentials.create/get`. Il ne reçoit jamais de clé privée : il
  transmet au content script les options publiques (challenge, `rpId`, `user`,
  descripteurs), qui les relaie au service worker. Le service worker déduit
  l’origine de `sender.url`, jamais d’un champ fourni par la page, et vérifie
  que le `rpId` est l’hôte ou un parent enregistrable. L’application répète ce
  contrôle avec `isValidRpId` (origine HTTPS ou `localhost`, refus des IP, des
  domaines à une étiquette et des suffixes publics courants) avant toute
  opération.
- Une **fenêtre de confirmation d’origine extension** affiche le domaine, le
  compte et le type d’opération ; aucune création ou signature n’a lieu avant un
  clic. Le refus, la fermeture de la fenêtre ou un délai de deux minutes rend la
  main au navigateur (« utiliser un autre appareil »). Une demande concurrente
  dans la même frame est refusée.
- Les clés sont générées en ECDSA P-256 dans l’application, exportées en PKCS#8
  et stockées uniquement dans le contenu chiffré de l’élément passkey. Les
  résultats transmis à l’extension sont une liste blanche de champs publics
  (`credentialId`, `clientDataJSON`, `attestationObject`, `authenticatorData`,
  signature) ; `privateKey` ne figure ni dans le protocole d’extension ni dans
  les messages du pont natif. Les drapeaux d’attestation indiquent UP, AT, BE et
  BS ; la vérification utilisateur (`UV`) n’est pas revendiquée et les sites qui
  l’exigent ne sont pas interceptés. Le compteur d’assertion reste à zéro.
- Le type `passkey` est en lecture seule dans l’interface : la création passe
  exclusivement par la fenêtre de confirmation de l’extension, ce qui évite de
  fabriquer un élément incohérent depuis le formulaire générique. Le partage
  hors ligne et la duplication sont masqués pour ne pas recopier une clé privée
  par inadvertance ; le déplacement entre coffres et la corbeille restent
  disponibles.
- Après soumission d’un formulaire, l’extension propose d’enregistrer ou de
  mettre à jour la connexion. Le mot de passe reste en mémoire du service
  worker au plus deux minutes ; il n’est jamais écrit sur disque par
  l’extension. Si la page navigue, le badge de l’extension et le popup
  conservent la proposition. La mutation réelle passe par le provider Coffre
  (desktop) ou par la passerelle de l’onglet déverrouillé.
- Le dernier identifiant utilisé pour un onglet est mémorisé deux minutes pour
  les connexions en plusieurs étapes ; ce n’est qu’un identifiant, pas un
  secret.
- Les identifiants transitent en mémoire entre l’onglet Coffre, le service
  worker et la page active ; ils ne sont ni journalisés ni persistés. Le pont
  natif les chiffre en AES-256-GCM sur le socket local.
- Le remplissage est déclenché par un clic ; aucun formulaire n’est soumis
  automatiquement.
- Tout code exécuté dans l’onglet Coffre pendant le déverrouillage peut appeler
  la passerelle. Le risque est équivalent à celui d’un XSS dans l’application :
  verrouillez le coffre après usage et n’installez que des extensions de
  confiance.
- L’extension Chromium/Firefox n’est ni signée ni publiée : chargez uniquement
  un dossier `dist-extension/` construit localement.
- Le manifeste fournit `background.scripts` pour Firefox et
  `background.service_worker` pour Chromium ; les appels passent par l’API
  `browser` (promesses) sur Firefox et `chrome` sur Chromium.
- Limites passkeys : la liste de suffixes publics est embarquée et doit être
  mise à jour à chaque release ; elle ne remplace pas la Public Suffix List
  complète. L’import/export FIDO CXF n’est pas encore disponible, et
  l’interception n’est pas revendiquée comme un authentificateur matériel.
- Limites : le menu dans les champs et l’interception WebAuthn ne sont pas
  validés en exécution réelle sur Firefox ni empaquetés pour Safari ; la
  protection contre le clickjacking repose sur le shadow root fermé, le z-index
  et la validation d’origine, mais une page qui contrôle entièrement son DOM
  peut toujours gêner l’affichage du menu.

### 2.11 Pont natif de l’extension (desktop)

Sur desktop, l’extension peut parler directement à l’application au lieu de
passer par un onglet Coffre. Le navigateur lance le binaire Coffre en mode
« hôte de messagerie native » (argument `chrome-extension://…`) ; ce mode ne
démarre pas l’interface et relaie uniquement des trames préfixées par leur
longueur entre stdin/stdout et un socket local.

- Le socket est `app_data_dir()/bridge/bridge.sock`, dans un dossier `0700`,
  avec le socket en `0600` : seul le compte de l’utilisateur peut s’y connecter.
- Les manifestes d’hôte natif sont installés par l’application pour Chrome,
  Chromium, Edge, Brave et Firefox. Chromium n’autorise que l’identifiant
  d’extension épinglé par la clé du manifeste ; Firefox n’autorise que
  `coffre@1wxxhktop.github.io`.
- **Appairage** : l’extension génère une paire ECDH P-256 et demande
  l’association. L’application affiche un code à six chiffres, l’extension
  affiche le même code, et l’utilisateur confirme explicitement dans
  l’application. La clé de session est dérivée par ECDH puis HKDF-SHA-256 et
  liée aux deux clés publiques.
- La clé de session est conservée dans le trousseau du système côté
  application et dans `chrome.storage.local` côté extension. Elle n’est jamais
  écrite dans le fichier `.coffre`.
- Après appairage, chaque requête et chaque réponse est chiffrée en
  AES-256-GCM avec un nonce aléatoire de 12 octets et une AAD qui lie
  l’identifiant de session, la direction et un compteur monotone. Un compteur
  qui recule est rejeté ; l’identifiant de session change à chaque connexion du
  pont et à chaque démarrage de l’application, ce qui invalide les anciens
  messages.
- L’application ne répond aux recherches et remplissages que lorsqu’elle est
  déverrouillée. Une demande alors qu’elle est verrouillée ramène la fenêtre au
  premier plan — et déclenche Touch ID si l’option est active — puis renvoie
  `locked` sans aucun secret.
- Le remplissage vérifie **dans l’application** que l’hôte de la page figure
  parmi les URL de l’élément (`loginAllowsHost`) ; l’extension ne peut pas
  demander les identifiants d’un autre domaine.
- Limites : la signature du binaire relais n’est pas vérifiée faute de
  certificat Developer ID ; le relais Windows (named pipe) n’est pas encore
  implémenté ; Firefox n’est pas validé en exécution réelle. Un processus du
  même compte utilisateur peut ouvrir le socket, mais ne peut ni déchiffrer les
  trames ni obtenir la clé de session sans le trousseau ou le profil du
  navigateur. L’identifiant Chromium est épinglé par la clé du manifeste ; une
  publication sur le Chrome Web Store avec un autre identifiant exigera de
  régénérer le manifeste d’hôte natif.

### 2.12 Tableau de bord Sécurité

L’analyse de sécurité est entièrement locale et ne conserve aucun résultat :

- elle ne considère que les connexions actives ; les notes, cartes, identités
  et éléments en corbeille sont ignorés ;
- les mots de passe faibles sont estimés par longueur, entropie et présence du
  titre ou de l’identifiant dans le secret ; les réutilisations exactes et les
  variantes proches sont détectées sans exposer les secrets ;
- l’ancienneté utilise la dernière modification de l’élément, l’absence de 2FA
  le champ TOTP, et les connexions incomplètes les champs identifiant, mot de
  passe et URL ;
- le score, la répartition solides/moyens/faibles et les listes ne contiennent
  que des références d’éléments et des compteurs, jamais un mot de passe ;
- l’historique du score conserve au plus une mesure par jour pendant 365 jours
  dans `localStorage` : date, score et compteurs, jamais un secret ni une URL ;
- « Changer sur le site » ouvre l’URL standard
  `https://<hôte>/.well-known/change-password` dans le navigateur système ; la
  requête est faite par le navigateur, pas par Coffre, et aucune donnée du
  coffre n’est transmise ;
- la vérification des fuites est une action explicite, désactivée par défaut
  (voir 2.12.1).

### 2.12.1 Surveillance optionnelle des fuites (HIBP)

Le réglage `breachCheck` est **désactivé par défaut**. Aucune requête n’est
émise tant que l’utilisateur n’a pas activé l’option et lancé « Vérifier
maintenant » depuis le tableau de bord Sécurité.

- Le SHA-1 est calculé localement avec WebCrypto, puis seuls les **5 premiers
  caractères hexadécimaux** sont envoyés à
  `https://api.pwnedpasswords.com/range/<préfixe>` avec l’en-tête
  `Add-Padding: true`. Le mot de passe, le hash complet et les suffixes
  recherchés ne sont jamais transmis.
- Sur le Web, `public/_headers` autorise uniquement cet hôte dans `connect-src`.
  La requête utilise `credentials: 'omit'`, `cache: 'no-store'`,
  `referrerPolicy: 'no-referrer'` et un délai maximal de 15 secondes.
- Sur desktop, la CSP Tauri reste sans `connect-src` externe : la commande Rust
  `hibp_range` valide le préfixe (`^[0-9A-F]{5}$`), impose un délai de
  10 secondes, refuse les réponses de plus de 2 Mo et ne construit que l’URL
  HIBP. Elle ne peut pas être détournée vers un autre hôte.
- La réponse HIBP (suffixes et occurrences) est parsée en mémoire ; seuls les
  identifiants d’éléments compromis sont conservés dans l’état React. Aucun
  hash, suffixe, mot de passe ou résultat n’est écrit dans `localStorage`,
  IndexedDB, le fichier `.coffre` ou les journaux. Désactiver l’option ou
  recharger l’application efface les résultats.
- Have I Been Pwned voit un préfixe partagé par de nombreux hashes : il ne peut
  pas identifier le mot de passe exact. Cela révèle néanmoins qu’une
  vérification a eu lieu à cet instant, comme toute requête réseau.
- En cas d’échec réseau, le tableau de bord affiche une erreur générique et
  aucun résultat n’est appliqué. Le score et les listes ne sont modifiés
  qu’après une réponse valide.
- Limites : couverture dépendante du service HIBP, SHA-1 de conception ancienne
  mais adapté au k-anonymat, et impossibilité de vérifier hors ligne sans base
  locale.

### 2.12.2 Historique chiffré du générateur

L’historique du générateur est un sidecar chiffré du fichier `.coffre` :

- chaque entrée est scellée par la clé maîtresse avec l’AAD
  `coffre:v1:generator-history:<id>` ; le contenu contient le mot de passe, le
  domaine éventuel, la date, l’état (`available`, `used`, `deleted`), la date
  de changement d’état et l’élément consommateur éventuel ;
- le fichier ne contient en clair que l’identifiant aléatoire de l’entrée, sa
  date de création, son horloge et son ciphertext. Un test vérifie que le mot
  de passe généré n’apparaît pas dans le JSON produit ;
- 50 entrées au maximum. La rétention est réglable (1, 7 ou 30 jours, ou
  désactivée ; défaut 7 jours) et stockée dans les préférences locales, qui ne
  contiennent aucun secret. La purge s’exécute à l’ouverture et lorsque le
  réglage change ; désactiver efface tout l’historique ;
- une entrée est marquée `used` et masquée dès qu’un élément de connexion est
  enregistré avec le même mot de passe ; « Supprimer » retire l’entrée et
  « Tout effacer » vide l’historique. La fusion de synchronisation choisit
  l’enregistrement à l’horloge la plus haute et plafonne à 50 entrées ;
- le menu de l’extension enregistre le mot de passe après une copie depuis son
  générateur ; aucun appel réseau n’est effectué. Le mot de passe n’est jamais
  écrit dans le journal d’activité ;
- les mots de passe déchiffrés restent en mémoire React tant que le coffre est
  déverrouillé, puis sont effacés au verrouillage avec le reste de l’état.

Limite d’intégrité : l’historique n’est pas inclus dans le manifeste du MAC
global. Chaque entrée est authentifiée individuellement par AES-GCM et la
révision du fichier est mise à jour à chaque mutation, mais un attaquant qui
peut écrire le fichier pourrait supprimer ou rejouer une entrée sans invalider
le MAC global ; il ne peut pas la lire. Cette limite est assumée pour ne pas
modifier le manifeste de `coffre-core`, qui ne couvre pas encore les sidecars
`activity` et `templates` ; elle devra être levée lors de l’alignement du
manifeste Rust.

### 2.13 Rappels d’échéance

Les dates d’échéance (révision d’un mot de passe, expiration d’une carte ou
d’un document d’identité) font partie du contenu chiffré de l’élément : elles ne
sont pas visibles dans les métadonnées du fichier `.coffre`.

- Le calcul des échéances et des badges `J-xx` est local, à partir des éléments
  déjà déchiffrés.
- Les notifications sont émises par l’API `Notification` du navigateur ou du
  système, au plus une fois par échéance et par jour. Le réglage est désactivé
  par défaut ; l’autorisation est demandée uniquement lorsque l’utilisateur
  l’active.
- Aucun serveur de notification, aucune télémétrie et aucune requête réseau
  propre aux rappels ne sont ajoutés. Si l’autorisation est refusée, la vue
  « Bientôt expirés » reste
  disponible dans l’application.
- La trace locale des rappels déjà affichés ne contient que des identifiants
  d’éléments, un type d’échéance et une date ; elle est conservée quatre-vingt-
  dix jours dans `localStorage`, puis purgée.

### 2.13 Kit d’urgence et parts Shamir

Le kit d’urgence découpe la **clé de récupération** (et non le mot de passe
maître) avec un partage de Shamir sur GF(256) :

- chaque part contient un seuil `k`, un index, la valeur évaluée et une somme de
  contrôle SHA-256 tronquée qui détecte une erreur de recopie sans révéler le
  secret ;
- `k` parts reconstituent la clé ; `k - 1` parts n’en révèlent rien. Une part
  isolée est statistiquement uniforme ;
- les parts sont encodées en mots de la liste EFF et en un payload compact pour
  les QR codes. Les deux formats sont relus localement ;
- la génération et l’impression se font dans le navigateur ; aucune part, aucun
  QR code et aucune clé ne sont écrits sur le disque ni envoyés sur le réseau.
  Les parts restent en mémoire tant que la boîte de dialogue est ouverte ;
- le kit contient aussi l’identifiant du coffre et des champs manuscrits. Il ne
  remplace ni le mot de passe maître ni une sauvegarde du fichier `.coffre` ;
- une personne qui réunit `k` parts peut rouvrir le coffre et imposer un nouveau
  mot de passe maître. Conservez les parts chez des personnes différentes et
  dans des lieux distincts.

Le découpage est testé par des vecteurs unitaires (reconstitution avec `k`,
échec avec `k - 1`, détection d’une part altérée, mélange de partages
incompatible) et par un parcours de bout en bout.

### 2.14 Partage ponctuel hors ligne

Le partage d’un élément produit deux secrets distincts :

- un fichier `.coffre-share` contenant l’élément chiffré en AES-256-GCM avec
  une clé aléatoire de 32 octets et une AAD liée à l’identifiant du partage ;
- la clé elle-même, encodée en mots EFF ou en QR code, à transmettre par un
  autre canal.

Le fichier seul ne permet pas de déchiffrer l’élément ; la clé seule ne contient
pas le ciphertext. Une clé incorrecte ou un fichier altéré échoue
l’authentification AES-GCM. La clé est enveloppée avec une somme de contrôle
pour détecter une recopie partielle.

- L’expiration est inscrite en clair dans le fichier et refusée par
  l’application Coffre lorsqu’elle est dépassée. Elle ne peut pas être imposée
  hors ligne : un tiers peut modifier le fichier.
- Les pièces jointes binaires ne sont pas incluses ; les métadonnées de
  l’élément et ses champs personnalisés le sont.
- Le fichier et la clé ne sont jamais envoyés sur le réseau par Coffre.
- Les dates, l’identifiant du partage et la taille approximative du ciphertext
  restent visibles dans le fichier.

---

### 2.15 Cœur Rust partagé (`coffre-core`)

Le crate `src-tauri/crates/coffre-core` porte le format et la crypto pour les
composants qui ne peuvent pas exécuter TypeScript (extensions mobiles, CLI,
agent SSH à venir). Il n’est pas encore utilisé par l’interface desktop, qui
reste sur l’implémentation TypeScript.

- crypto identique : Argon2id, AES-256-GCM, AAD par usage, HMAC-SHA-256,
  SHA-256, base64 standard ; paramètres KDF bornés aux mêmes limites ;
- clés maîtresses, de coffre, d’élément, de récupération et d’intégrité dans des
  `Zeroizing` ; `Session::lock` efface les buffers ;
- ouverture v1 à v4, déchiffrement des noms de coffres, éléments, pièces
  jointes et versions, vérification du MAC global v4 et manifeste canonique ;
- écriture v4 : création/modification/suppression d’éléments, horloges par
  enregistrement, tombstones, nouveau MAC et rotation du mot de passe maître
  avec re-enveloppe des clés et incrément de `keyEpoch` ;
- fusion L3 pure et déterministe : horloges, empreintes de ciphertexts,
  tombstones, unions de versions/pièces jointes et conflits signalés ;
- façade `coffre-core-ffi` pour UniFFI, en JSON sans état (le mot de passe est
  fourni à chaque appel, aucune session Rust n’est conservée), et commande
  Tauri `core_merge_files` qui fusionne des fichiers chiffrés sans mot de passe ;
- aucune dépendance réseau dans ce crate ;
- vecteurs croisés : les fixtures TypeScript `v1..v4` sont relues par Rust, et
  `test-vectors/rust-v4.coffre.json` est relu par le test TypeScript de
  production. Le MAC et les contenus déchiffrés sont vérifiés des deux côtés ;
- CLI `coffre-cli` : ouverture en lecture seule (`list`, `get`, `totp`,
  `run --env`), sans mutation ni réseau. Le mot de passe maître est lu sans
  écho sur le terminal (`rpassword`) ou sur stdin avec `--password-stdin` ; il
  n’est jamais accepté en argument. Les valeurs ne sont écrites sur stdout que
  pour `get`, `totp` et la commande enfant de `run` ;
- `run --env-file` n’accepte que des références
  `coffre://<coffre>/<élément>/<champ>` ; une valeur littérale est refusée pour
  éviter de stocker un secret en clair dans un fichier `.env` ;
- `git-credential get` exige `--approve` et ne renvoie que `username` et
  `password` pour un hôte correspondant ; `store` et `erase` ne modifient pas
  le coffre ;
- `ssh-sign` signe un fichier avec une clé SSH du coffre et n’écrit que la
  signature `SSHSIG` sur stdout ; la clé privée reste en mémoire ;
- `coffre-git-sign` lit `COFFRE_VAULT` et éventuellement `COFFRE_PASSWORD`
  (variable d’environnement visible par le processus Git), signe le fichier
  fourni par Git et écrit `<fichier>.sig` ; aucune clé privée n’est écrite ;
- `ssh-config` n’écrit aucun fichier et n’affiche que le commentaire,
  l’empreinte et le bloc `Host`/`IdentityAgent` ; aucune clé privée n’est
  exposée ;
- `run --env` et `run --env-file` transmettent les secrets par l’environnement
  du processus enfant, jamais par sa ligne de commande. Ce n’est pas une barrière d’isolation : un
  processus du même utilisateur peut inspecter l’environnement (par exemple
  `/proc/<pid>/environ` sous Linux) et l’enfant peut les journaliser ou les
  retransmettre. L’option vise les outils locaux de courte durée ;
- les clés et buffers cryptographiques du CLI restent en `Zeroizing` ; les
  valeurs JSON déchiffrées vivent en mémoire jusqu’à la fin du processus, comme
  dans la façade FFI ;
- la CI exécute `cargo test -p coffre-core -p coffre-core-ffi -p coffre-cli`
  sur Linux, macOS et Windows. Les bindings Swift/Kotlin sont générés avec
  `uniffi-bindgen` ; leur intégration dans les extensions mobiles relève de L8.

### 2.16 Compatibilité KeePass KDBX 4

L’import et l’export KDBX 4 sont traités localement, sans requête réseau :

- lecture des KDF Argon2d, Argon2id et AES-KDF avec des bornes de mémoire,
  d’itérations et de tours ;
- vérification de la signature, du hash et du HMAC d’en-tête, puis de chaque
  bloc HMAC-SHA-256 avant déchiffrement ;
- AES-256-CBC, ChaCha20, gzip et flux protégés internes ChaCha20/Salsa20 ;
- fichiers de clé XML v1/v2, binaires et hexadécimaux lus localement ;
- groupes convertis en étiquettes, champs protégés en champs masqués, TOTP
  conservé ;
- pièces jointes et historique KDBX signalés mais pas encore importés ;
  passkeys KeePassXC non importées ;
- export KDBX avec Argon2id, ChaCha20 et un mot de passe dédié demandé à
  l’utilisateur. Le fichier produit doit être traité comme une sauvegarde
  sensible.

AES-KDF est borné à 10 millions de tours pour éviter qu’un fichier hostile ne
bloque l’application.

### 2.17 Portabilité CXF 1.0

L’import et l’export CXF sont traités localement, sans requête réseau :

- lecture des documents CXF 1.x (version majeure 1) ; les versions majeures
  inconnues sont refusées et les justificatifs de type inconnu sont signalés ;
- les mots de passe, notes, cartes et identités sont convertis dans les deux
  sens ; les champs personnalisés deviennent un justificatif `custom-fields` ;
- les passkeys sont exportées en PKCS#8 et leur clé publique COSE est recalculée
  localement à l’import par WebCrypto, sans sortir de l’appareil ;
- les passkeys dont le compteur de signature n’est pas nul sont exclues de
  l’export, conformément à CXF 1.0 ;
- les pièces jointes et l’historique ne sont pas inclus ;
- le document CXF **n’est pas chiffré** : il contient des secrets en clair. Une
  confirmation explicite est demandée avant l’export ; le fichier doit être
  transféré uniquement vers un gestionnaire de confiance puis supprimé ;
- le protocole de transport CXP et son chiffrement ne sont pas implémentés ;
- les fichiers importés sont limités à 20 Mo et 5 000 éléments.

### 2.18 Remplissage des cartes et des identités

Le remplissage étendu de l’extension applique les règles suivantes :

- la détection est locale (attributs `autocomplete`, types et libellés) ; aucun
  sélecteur propre à un site n’est embarqué ;
- le CVC et le PIN ne sont jamais renvoyés par le pont si l’utilisateur n’a pas
  coché explicitement « Inclure le CVC et le PIN » pour ce remplissage ; le
  pont natif et la passerelle de l’onglet appliquent tous deux ce filtrage ;
- sur macOS, une confirmation Touch ID est demandée avant de livrer un CVC ou
  un PIN lorsque la biométrie est configurée ; sans biométrie, l’action
  explicite de l’utilisateur reste requise ;
- une carte n’est remplie que sur une page HTTPS ; dans une iframe d’origine
  différente, seuls les prestataires de paiement connus (Stripe, Adyen, PayPal,
  etc.) sont autorisés ; l’origine de l’iframe et celle de la page sont
  affichées dans le menu ;
- l’enregistrement d’une carte ou d’une identité après soumission demande une
  confirmation dans le menu ; les valeurs restent en mémoire au plus deux
  minutes et ne sont jamais envoyées sur le réseau ;
- les résumés de recherche ne contiennent que des métadonnées non sensibles
  (quatre derniers chiffres, titulaire, e-mail) ; le numéro complet, le CVC et
  le PIN ne sont transmis qu’après le clic de remplissage.

### 2.19 Synchronisation locale directe (F2)

La synchronisation locale est réservée aux applications desktop et désactivée
par défaut :

- chaque appareil possède une identité X25519 générée localement, stockée dans
  `lan/identity.json` avec des permissions `0600` ; le carnet de pairs est dans
  `lan/peers.json` ;
- le code d’appairage contient l’adresse locale, le port, la clé publique de
  l’appareil et un secret aléatoire à usage unique. Il expire au bout de deux
  minutes et ne doit pas être conservé après l’appairage ;
- l’appairage et la synchronisation utilisent Noise
  `XX_25519_ChaChaPoly_BLAKE2s` ; chaque côté vérifie la clé statique distante
  contre le code ou le carnet de pairs avant d’échanger le moindre fichier ;
- un appareil non appairé est refusé après la poignée de main, sans recevoir de
  fichier ni d’information sur le coffre ;
- le port TCP `47823` n’est ouvert que pendant une réception explicitement
  demandée, pendant au plus deux minutes ; aucun port n’est maintenu ouvert
  entre deux synchronisations ;
- les fichiers échangés sont déjà chiffrés par le format `.coffre` ; Noise
  ajoute la confidentialité et l’authentification du transport ;
- pendant la fenêtre de réception, l’appareil s’annonce en mDNS sous
  `_coffre._tcp.local.` avec son identifiant et son nom ; la découverte ne
  renvoie que des adresses et des identifiants, jamais de secret ;
- aucune connexion Internet et aucun serveur ne sont utilisés ; l’adresse
  initiale vient du code d’appairage.

### 2.17 Déverrouillage FIDO2/PRF

Le déverrouillage par clé de sécurité est optionnel et désactivé tant qu’aucune
enveloppe n’est configurée.

- La cérémonie WebAuthn crée un credential résident avec `userVerification:
  'required'` et l’extension `prf` ; le champ `prf.results.first` fournit
  32 octets.
- Une KEK AES-256 est dérivée par HKDF-SHA-256 avec un sel aléatoire de
  32 octets et l’identifiant du fichier. La clé maîtresse est scellée par
  AES-256-GCM avec l’AAD `coffre:v1:prf-unlock:<idFichier>`.
- Le résultat PRF ne quitte jamais la mémoire et est effacé après dérivation.
  Aucun secret PRF, aucune clé maîtresse et aucun sel ne sont journalisés.
- L’enveloppe `prf` est révocable depuis les réglages. Elle est supprimée lors
  d’un changement de mot de passe maître ou d’une récupération, car elle est
  scellée avec l’ancienne clé.
- Le MAC global ne couvre pas l’enveloppe PRF, comme l’enveloppe de récupération.
  L’AEAD et l’identifiant de fichier empêchent sa réutilisation sur un autre
  fichier ; retirer l’enveloppe ne fait que revenir au mot de passe.
- Limites : la clé doit prendre en charge PRF ; le support des WebViews
  desktop varie ; la validation avec une YubiKey 5 réelle reste à effectuer.
  Aucun repli silencieux vers un authentificateur non PRF n’est effectué.

### 2.20 Mode voyage (F6)

Le mode voyage est local à l’appareil et n’est jamais synchronisé :

- seuls les coffres marqués « sûrs pour le voyage » restent dans le fichier
  local ; les autres coffres, leurs éléments, pièces jointes et versions sont
  retirés du fichier et des trois sauvegardes locales ;
- la suppression est signée **sans pierre tombale** : les autres appareils ne
  reçoivent pas d’ordre de suppression et peuvent restaurer les coffres ;
- l’activation et la désactivation vérifient le mot de passe maître ; la
  désactivation exige une source de synchronisation par dossier contenant les
  coffres masqués et refuse de continuer si aucun fichier distant n’est trouvé ;
- pendant le mode voyage, la synchronisation par dossier normale est bloquée
  pour ne pas écraser la copie distante complète avec le fichier local réduit ;
- les pierres tombales existantes sont conservées : elles ne contiennent aucun
  ciphertext, seulement des identifiants et des dates ;
- le mode voyage protège contre l’inspection de l’appareil, **pas contre une
  contrainte exercée sur la personne** ni contre un adversaire qui obtient le
  mot de passe maître.

### 2.21 Modèles d’éléments personnalisés (F16)

Les modèles sont des métadonnées chiffrées, séparées des éléments :

- chaque modèle possède une clé aléatoire de 32 octets, scellée par la clé
  maîtresse avec l’AAD `coffre:v1:template-key:<id>` ;
- son contenu (nom, icône, champs) est chiffré avec cette clé et l’AAD
  `coffre:v1:template-content:<id>` ;
- les modèles sont couverts par le MAC global et fusionnés par horloge ; une
  suppression crée une pierre tombale `template` ;
- la clé de récupération contient une enveloppe `templateWraps` pour chaque
  modèle ; le changement de mot de passe et la récupération ré-enveloppent les
  clés sans réécrire les contenus ;
- l’éditeur propose des champs texte, secret, URL, date et texte long ; les
  champs marqués remplissables apparaissent dans l’onglet Modèles de
  l’extension et sont remplis par rapprochement de libellé, après clic ;
- aucun modèle n’est envoyé sur le réseau en dehors du fichier `.coffre`
  synchronisé ou exporté par l’utilisateur.

### 2.22 Journal d’activité local (F11)

Le journal d’activité est chiffré et local au coffre :

- chaque événement est chiffré avec la clé maîtresse et l’AAD
  `coffre:v1:activity:<id>` ; le fichier ne contient ni domaine, ni titre
  d’élément, ni détail en clair ;
- les événements sont fusionnés entre appareils par identifiant, plafonnés à
  5 000 entrées et couverts par le MAC global ;
- le journal est ré-enveloppé lors d’un changement de mot de passe ;
- une récupération par phrase ou parts réinitialise le journal, car les
  anciens événements sont scellés par l’ancienne clé maîtresse ;
- les échecs de déverrouillage ne sont pas enregistrés : aucun secret n’est
  disponible pour chiffrer l’événement tant que le coffre est verrouillé ;
- l’export JSON est une action explicite de l’utilisateur ; le fichier produit
  est en clair et doit être protégé comme une sauvegarde sensible ;
- aucun journal n’est envoyé sur le réseau en dehors du fichier `.coffre`
  synchronisé ou exporté.

### 2.22 Noyau de l’agent SSH

Le crate `src-tauri/crates/coffre-ssh-agent` fournit l’agent `SSH_AUTH_SOCK`.
L’application desktop l’active à la demande depuis **Réglages → Sécurité** ;
aucun socket n’est créé par défaut.

- l’activation transmet la clé maîtresse par l’IPC local à Rust ; Rust ouvre
  lui-même le fichier `.coffre` et ne renvoie jamais une clé privée à la
  WebView. Les identités restent en mémoire Rust tant que l’agent tourne ;
- chaque demande de signature émet un événement d’approbation ; la modale
  affiche le commentaire, l’empreinte SHA-256 de la clé, l’algorithme, la taille,
  l’empreinte SHA-256 des données et un aperçu lorsqu’elles sont textuelles.
  Sans réponse sous 60 secondes, la signature est refusée ;
- l’agent est arrêté au verrouillage, au démontage de l’interface ou via le
  bouton **Arrêter l’agent** ; les approbations en attente reçoivent un refus ;
- si le déverrouillage par Touch ID est activé, une authentification
  biométrique réussie est exigée après le clic sur **Signer**. Une annulation
  laisse la demande ouverte ; elle expire normalement après 60 secondes ;
- une case décochée par défaut permet d’autoriser la même clé pendant
  15 secondes ; les signatures suivantes avec la même empreinte sont approuvées
  sans nouvelle modale ni Touch ID. Cette mémorisation reste en mémoire,
  n’est jamais persistée et est effacée au verrouillage ;
- Git peut signer via `ssh-keygen -Y sign` et l’agent : la clé privée reste
  dans le coffre et chaque signature passe par la même approbation. Un test
  crée un commit Git réellement signé avec l’agent ;

- le socket est créé à la demande avec des permissions `0600` dans un dossier
  `0700` ; un chemin existant qui n’est pas un socket est refusé et un ancien
  socket est supprimé avant la réécoute ;
- chaque demande de signature passe par un callback d’approbation bloquant.
  Sans décision positive, la réponse est `SSH_AGENT_FAILURE` ; aucun mode
  « tout autoriser » n’est exposé par le crate ;
- l’approbation reçoit le commentaire, l’empreinte SHA-256, l’algorithme et les
  données exactes à signer, jamais la clé privée ;
- ed25519 et RSA sont pris en charge ; les clés RSA de moins de 2048 bits, les
  clés chiffrées par phrase de passe, les clés FIDO2 `sk-ssh-*` et les
  algorithmes inconnus sont refusés ;
- la clé publique stockée dans l’élément est comparée à celle dérivée de la clé
  privée avant toute utilisation ;
- les messages sont plafonnés à 256 Kio, les données à signer sont effacées
  après la demande et aucun contenu de clé ni secret n’est journalisé ;
- le binaire `coffre-ssh-agent` exige un terminal interactif (`/dev/tty`) pour
  approuver chaque signature ; sans terminal, il refuse la demande. Le mot de
  passe du coffre est lu sans écho ou sur stdin avec `--password-stdin`, jamais
  en argument ;
- l’agent supprime son socket à l’arrêt s’il est toujours propriétaire du même
  fichier (comparaison du périphérique et de l’inode), et le prochain démarrage
  nettoie un socket orphelin ;
- au plus 16 connexions simultanées sont servies ; les suivantes sont
  fermées immédiatement ;
- limites : le socket Unix n’est pas implémenté sous Windows (named pipe à
  faire), et la mémorisation porte sur une clé pendant 15 secondes, pas sur un
  hôte.

### 2.23 Saisie automatique desktop (F9)

La saisie automatique est une action explicite depuis une connexion :

- Coffre masque sa fenêtre, attend 650 ms puis identifie la fenêtre active ;
- Rust compare l’identifiant de fenêtre et le PID avant **chaque jeton** ; si
  le focus change, la séquence est interrompue avec une erreur ;
- les jetons sont limités à 4 000 caractères, les délais à 60 secondes, et les
  jetons inconnus sont refusés ;
- les valeurs `{USERNAME}`, `{PASSWORD}` et `{TOTP}` ne sont transmises que par
  l’IPC local entre la WebView et Rust ; elles ne sont jamais journalisées ni
  écrites sur disque ;
- sur macOS, la permission **Accessibilité** est requise pour envoyer les
  événements clavier ; le message d’erreur explique comment l’accorder ;
- la fenêtre active est refusée si son nom contient « Coffre », pour éviter une
  saisie dans l’application elle-même ;
- le raccourci global `Cmd+Shift+A`/`Ctrl+Shift+A` capture la fenêtre active
  avant de ramener Coffre au premier plan, puis propose les connexions
  correspondantes ; la fenêtre cible est revérifiée au moment de la frappe ;
- la saisie automatique est journalisée dans le journal d’activité chiffré
  (type `autotype`, titre de l’élément et nom de l’application cible) ;
- Windows et Linux utilisent la même bibliothèque d’entrée, mais leurs
  permissions et leur comportement n’ont pas encore été validés.

### 2.24 Alias e-mail hors ligne (F7)

Le générateur d’alias est entièrement local :

- l’adresse de base, le mode et l’étiquette sont transformés en adresse
  « plus » ou catch-all sans requête réseau ;
- l’alias est stocké dans le champ `emailAlias` de l’élément et dans le
  contenu chiffré du coffre ;
- les préférences d’adresse de base et de mode sont mémorisées dans le
  `localStorage` de l’application ; elles ne contiennent aucun secret ;
- aucun service SimpleLogin/addy.io n’est contacté sans saisie explicite d’une
  clé API et clic sur « Générer via le service » ; les URL sont fixes
  (`app.simplelogin.io`, `app.addy.io`) ; la clé peut être chiffrée dans la
  section `aliasKeys` du coffre, une entrée par service, et est ré-enveloppée
  lors d’un changement de mot de passe ; le menu de l’extension peut générer
  un alias hors ligne et le copier dans le presse-papiers, sans requête
  réseau ;
- aucun alias n’est envoyé sur le réseau en dehors du fichier `.coffre`
  synchronisé ou exporté.

### 2.25 Coffre de fichiers chiffrés en flux (F8)

Les blobs sont des fichiers chiffrés séparés du `.coffre` :

- stockage dans `vault/blobs/<id>` avec un identifiant restreint
  (`[a-zA-Z0-9_-]`, 80 caractères) pour empêcher toute traversée de chemin ;
- chiffrement AES-256-GCM par blocs de 64 Kio ; nonce de 12 octets formé d’un
  préfixe aléatoire de 7 octets, d’un compteur de 4 octets et d’un drapeau de
  dernier bloc ;
- chaque bloc est authentifié avec l’en-tête du blob, son index et le drapeau
  de dernier bloc dans l’AAD ; une troncature, un réordonnancement ou une
  substitution échoue avant écriture du clair ;
- les fichiers sont écrits atomiquement (`.tmp` puis renommage) et reçoivent
  les permissions `0600` ; le dossier `blobs` est en `0700` ;
- les aperçus sont déchiffrés en mémoire et plafonnés à 16 Mio ; aucune copie
  en clair n’est créée pour un aperçu ;
- la clé de blob est stockée dans les métadonnées de la pièce jointe, elles-mêmes
  chiffrées avec la clé de l’élément ; elle n’apparaît jamais en clair dans le
  fichier `.coffre` ;
- l’ajout et le téléchargement passent par des dialogues natifs explicites ;
  la suppression de la pièce jointe retire aussi le blob ;
- la synchronisation par dossier copie les blobs chiffrés dans
  `Coffre/<idFichier>/blobs/` et importe les blobs absents ; aucun clair n’est
  écrit ; les réglages de stockage listent les blobs et permettent de supprimer
  ceux qui ne sont référencés par aucun élément ; la synchronisation des blobs
  par le réseau local F2 transfère les blobs manquants après l’échange du
  `.coffre`, par blocs de 256 Kio et uniquement pour les identifiants
  référencés, avec un plafond de 2 Gio par transfert ; un test Rust en boucle
  locale vérifie l’échange entre deux dossiers de blobs ; un test manuel de 1 Gio vérifie le streaming en mémoire
  constante.

### 2.21 Réseaux Wi-Fi

Les identifiants Wi-Fi sont chiffrés avec le contenu de l’élément, comme les
autres types :

- le SSID, le mot de passe, la sécurité et l’indicateur de réseau masqué sont
  stockés dans le contenu chiffré de l’élément, jamais dans les métadonnées du
  fichier ;
- le QR code `WIFI:` n’est généré qu’après une action explicite, localement,
  sous forme de data URL SVG ; il n’est ni écrit sur disque ni envoyé sur le
  réseau ;
- le QR code et le mot de passe affiché contiennent le secret en clair : ne pas
  les photographier ni les partager dans un environnement observé ;
- les exports CSV de connexions n’incluent pas les réseaux Wi-Fi ; le format
  « Coffre complet » reste un export chiffré par le fichier `.coffre`.

### 2.22 Identifiants d’API

Les identifiants d’API suivent le même chiffrement que les autres éléments :

- l’identifiant de clé, le secret, l’environnement et le point de terminaison
  sont stockés dans le contenu chiffré ; les métadonnées du fichier ne les
  exposent pas ;
- le secret est masqué par défaut dans la fiche et n’est révélé ou copié que
  sur action explicite ;
- les exports CSV de connexions ne contiennent pas ces secrets ; le format
  « Coffre complet » reste un export chiffré du fichier `.coffre`.

### 2.23 Licences logicielles

Les clés de licence sont chiffrées avec le contenu de l’élément :

- la clé, le titulaire, la version, le site web et la date d’achat restent dans
  le contenu chiffré ; les métadonnées du fichier ne les exposent pas ;
- la clé est masquée par défaut et n’est révélée ou copiée que sur action
  explicite ;
- les exports CSV de connexions ne contiennent pas ces clés ; le format
  « Coffre complet » reste un export chiffré du fichier `.coffre`.

### 2.24 Documents

Les documents administratifs sont des éléments chiffrés dont la pièce jointe
principale est une pièce jointe Coffre :

- le type, l’émetteur, le numéro et la date d’émission sont chiffrés avec le
  contenu de l’élément ;
- la pièce jointe principale est chiffrée séparément, avec sa propre clé
  protégée par le contenu de l’élément ; elle n’est jamais envoyée sur le
  réseau par Coffre ;
- la fiche affiche le nom de la première pièce jointe ; les pièces jointes
  restent soumises aux mêmes limites de taille et de type que les autres
  éléments ;
- les exports CSV de connexions n’incluent pas les documents ; le format
  « Coffre complet » reste un export chiffré du fichier `.coffre`.

### 2.25 Règles de mot de passe par site

Le générateur peut appliquer les contraintes d’un site :

- le dataset Apple « Password Manager Resources » est embarqué dans
  l’application (`src/assets/password-rules.json`) ; aucune requête réseau n’est
  faite pour récupérer ou mettre à jour les règles ;
- les règles sont appliquées localement au moment de la génération ; le mot de
  passe généré n’est jamais envoyé sur le réseau ;
- le parseur accepte les classes de caractères contenant des virgules, des
  espaces ou des points-virgules ; les règles inconnues ou invalides sont
  ignorées et le générateur revient à ses options normales ;
- le dataset est distribué sous licence MIT par Apple et son attribution figure
  dans `NOTICE`.

### 2.26 Socle de partage et accès d’urgence (L10)

Les modules `src/lib/sharing.ts` et `src/lib/sharingVault.ts` portent le
partage de coffres et l’accès d’urgence. L’identité est persistée dans le champ
`sharing` du fichier `.coffre` ; l’interface est intégrée aux réglages.

- chaque identité contient une paire X25519 pour HPKE et une paire Ed25519 pour
  signer les rôles ; les clés publiques et l’empreinte sont en clair, les clés
  privées sont scellées par la clé maîtresse avec une AAD liée au fichier et aux
  deux clés publiques ;
- le ciphertext des clés privées est couvert par le MAC global v4 ; une clé
  publique modifiée fait échouer l’ouverture AEAD, et déplacer l’enveloppe vers
  un autre fichier échoue également ;
- l’identité est ré-enveloppée lors d’un changement de mot de passe et supprimée
  lors d’une récupération, car elle est scellée par l’ancienne clé maîtresse ;
  la fusion de synchronisation conserve l’identité locale si elle existe ;
- l’identité peut être créée depuis **Réglages → Sécurité → Identité de
  partage**. L’export affiché ne contient que les clés publiques et l’empreinte ;
- un paquet de partage contient la clé du coffre enveloppée pour chaque membre,
  les rôles signés et les identités publiques. Il ne contient aucune clé privée
  ni contenu déchiffré ; son import vérifie la signature du rôle et l’identité
  du destinataire avant d’ouvrir la clé. Le paquet révèle l’identifiant du
  coffre et la liste des membres : le transmettre par un canal de confiance ;
- les identités publiques et les paquets importés sont validés (forme,
  empreinte recalculée, cohérence des rôles et signatures) avant utilisation ;
- les paquets peuvent être générés et importés depuis **Réglages → Sécurité**.
  L’import ajoute un coffre local avec la clé partagée, son nom chiffré et son
  rôle. Le paquet complet contient en plus les enregistrements déjà chiffrés
  (éléments, pièces jointes, versions). L’import fusionne par identifiant et
  date de mise à jour, avec un plafond de 20 000 éléments. Les pierres tombales
  des éléments supprimés sont incluses et appliquées si elles sont plus
  récentes. Le paquet peut être copié ou téléchargé comme fichier
  `.coffre-shared.json`, puis importé par le membre ;
- synchronisation par dossier : chaque membre écrit
  `shared-<coffre>-<empreinte>.coffre-shared.json`, un bundle signé par son
  identité Ed25519. Le paquet de partage est conservé chiffré dans les
  métadonnées du coffre. À l’import, l’application vérifie la signature, que
  l’expéditeur appartient au paquet local et qu’il a le rôle `write` (ou
  administrateur). Si la clé du coffre change, elle vérifie que le paquet
  provient du même administrateur, ré-enveloppe les clés d’éléments locales et
  ré-scellle les métadonnées avec la nouvelle clé avant de fusionner. Un bundle
  non signé, altéré, d’un expéditeur inconnu, en lecture ou d’un autre
  administrateur est ignoré ;
- les mutations d’éléments vérifient le rôle local : un coffre `read` refuse
  création, modification, déplacement, corbeille, pièces jointes et suppression.
  Cette restriction est appliquée par l’application ; un membre qui modifie son
  client et possède la clé partagée peut toujours écrire. Les rôles ne sont donc
  pas une barrière cryptographique contre un membre malveillant ;
- la révocation d’un membre exige le rôle administrateur, génère une nouvelle
  clé de coffre, ré-enveloppe les clés d’éléments et les métadonnées, puis
  produit un nouveau paquet pour les membres restants. La révocation est
  **forward-only** : l’ancien membre conserve l’ancienne clé pour les contenus
  déjà reçus, mais ne peut plus lire les nouvelles écritures ;
- l’accès d’urgence enveloppe la **clé maîtresse** avec HPKE pour l’identité
  publique d’un contact. L’enveloppe est stockée dans le fichier et couverte
  par le MAC. Elle est ré-enveloppée au changement de mot de passe et après une
  récupération, car la clé maîtresse change ;
- le contact doit posséder le fichier `.coffre` et sa clé privée d’identité pour
  ouvrir l’enveloppe. Sans serveur, aucun délai ne peut être imposé : l’accès
  immédiat est immédiat ;
- le mode Shamir partage la clé maîtresse en `n` parts avec un seuil `k`
  (2/3 par défaut) ; chaque part est enveloppée pour un contact distinct. Il
  faut au moins `k` identités de contact pour reconstituer la clé. Les parts
  sont ré-générées lors d’un changement de mot de passe ou d’une récupération ;
- les enveloppes utilisent HPKE base mode avec X25519, HKDF-SHA-256 et
  AES-256-GCM ; l’information `info` lie le chiffré au coffre et au membre, ou
  au contact d’urgence ;
- les rôles `read`/`write` sont signés par Ed25519 sur une chaîne canonique
  incluant le coffre, le membre, le rôle, la date et l’émetteur ;
- les bundles de synchronisation sont signés par Ed25519 sur une sérialisation
  JSON canonique (paquet, métadonnées chiffrées, éléments, pièces jointes,
  versions, pierres tombales et date d’export). La signature ne remplace pas le
  chiffrement : la clé du coffre reste nécessaire pour lire le contenu ;
- les empreintes sont des SHA-256 des clés publiques, affichées avec le préfixe
  `SHA256:` ;
- une clé de coffre partagé peut être enveloppée pour plusieurs membres ;
  la révocation prépare une nouvelle clé et de nouvelles enveloppes pour les
  membres restants, sans réutiliser l’ancienne ;
- aucune requête réseau n’est effectuée ;
- limites : la distribution initiale des identités et des paquets reste
  manuelle ; la synchronisation par dossier est un échange de fichiers, sans
  service temps réel ni fusion des pièces jointes binaires. Les rôles restent
  appliqués par l’application : un membre `write` qui modifie son client peut
  forger des contenus avec la clé partagée. Après une révocation, le paquet
  signé par le même administrateur peut être adopté automatiquement : les
  clés d’éléments locales sont ré-enveloppées avec la nouvelle clé, les
  métadonnées et l’enveloppe de récupération sont ré-scellées, puis le contenu
  du bundle est fusionné. L’adoption est refusée si l’administrateur diffère ou
  si la clé de récupération locale est indisponible ; un import manuel du
  bundle complet reste alors possible.

### 2.27 Chaîne d’approvisionnement

- la toolchain Rust est épinglée dans `rust-toolchain.toml` (1.99.1) et Bun
  dans les workflows (1.4.3) ;
- la CI compare deux builds Web et extension avec `SOURCE_DATE_EPOCH=0` ; une
  différence fait échouer le job ;
- des SBOM CycloneDX sont générés pour chaque crate Rust et pour le projet
  npm, conservés comme artefact de CI et joints aux releases macOS avec un
  fichier `SHA256SUMS`. Ils ne sont pas encore signés séparément ;
- `cargo deny` vérifie les licences autorisées, les avis RUSTSEC et les sources
  (crates.io uniquement). Les avis temporairement ignorés sont documentés dans
  `src-tauri/deny.toml` : des crates transitoires non maintenues de la chaîne
  Tauri. L’avis `RUSTSEC-2023-0071` a été retiré après la migration de l’agent
  SSH vers `rsa` 0.10 et `ssh-key` 0.7.0-rc.12 (pré-version, en attendant une
  version stable) ;
- deux cibles de fuzzing (`vault_parse`, `merge`) sont exécutées chaque
  semaine en CI sur Rust nightly ; le corpus et les artefacts restent hors du
  dépôt ;
- les builds Web, extension et le bundle macOS sont comparés deux fois ; pour
  le desktop, la caisse applicative est recompilée entre les deux bundles et
  la signature ad hoc est incluse dans la comparaison. L’audit externe reste à
  intégrer.

### 2.28 Divulgation responsable

Le canal de signalement est public dans
`public/.well-known/security.txt` :

- **Contact** : avis de sécurité privés GitHub
  (`https://github.com/1wxxhktop/coffre/security/advisories/new`) ;
- **Policy** : ce document ;
- **Preferred-Languages** : français, anglais ;
- **Expires** : 9 novembre 2027.

Le projet ne propose pas encore de prime financière. Les signalements doivent
inclure la version, la plateforme, les étapes de reproduction et une preuve de
concept minimale, sans secret réel ni donnée personnelle. Les échanges restent
privés jusqu’à la publication d’un correctif. Le fichier est validé par
`bun run lint` (contact, politique, langues et date d’expiration).

## 3. Stockage local

### 3.1 Application desktop (Tauri)

Le coffre est un fichier JSON chiffré dans le dossier de données de
l’application :

| Chemin | Contenu |
| --- | --- |
| `vault/vault.coffre` | Fichier de coffre courant, déjà chiffré |
| `vault/vault.coffre.bak1` | Version précédente, déjà chiffrée |
| `vault/vault.coffre.bak2` | Version antérieure à `bak1` |
| `vault/vault.coffre.bak3` | Version la plus ancienne conservée |
| `vault/state.json` | Plus haute révision vue (identifiant de fichier et compteur) |

Chaque écriture passe par un fichier temporaire, `fsync`, puis un renommage
atomique. Trois générations sont conservées. Le dossier est créé en `0700` et
les fichiers en `0600` sur macOS/Linux ; les écritures sont sérialisées et la
taille est plafonnée à 100 Mo (`state.json` à 64 Kio). Aucune clé, aucun mot de
passe et aucun contenu en clair ne sont écrits sur disque. Le fichier d’état ne
contient qu’un identifiant de coffre et une révision. Un coffre IndexedDB d’une
version antérieure est migré automatiquement au premier lancement, sauvegardes
comprises.

Les sauvegardes partagent le même disque et le même compte que le fichier
courant : elles protègent d’une corruption logique, pas d’une panne matérielle,
d’un compte compromis ni d’un rançongiciel. Le chiffrement du disque
(FileVault/BitLocker/LUKS) et un export hors appareil restent recommandés.

### 3.2 Application web (IndexedDB)

Sur le Web, les données sont stockées dans la base IndexedDB `coffre`, magasin
`vault` :

| Clé | Contenu |
| --- | --- |
| `current` | Fichier de coffre courant, déjà chiffré |
| `backup` | Version précédente du fichier, déjà chiffrée |
| `backup:2` | Version antérieure à `backup`, déjà chiffrée |
| `backup:3` | Version la plus ancienne conservée, déjà chiffrée |
| `state` | Plus haute révision vue (identifiant de fichier et compteur) |

Aucune clé, aucun mot de passe et aucun contenu en clair ne sont écrits dans
IndexedDB. Le fichier stocké est identique à celui exporté. Il peut contenir une
enveloppe de récupération optionnelle, elle aussi chiffrée (voir 2.2). La clé
`state` ne contient qu’un identifiant de coffre et une révision, jamais un
secret.

### 3.3 Préférences

Les préférences non sensibles sont dans `localStorage` sous
`coffre:settings:v1` : langue de l’interface, thème, délai de verrouillage
automatique, verrouillage lorsque l’onglet passe en arrière-plan, délai
d’effacement du presse-papiers, durée de conservation de la corbeille et
activation du trousseau ou de Touch ID. Elles ne contiennent aucun secret. Le
choix de langue ne déclenche aucune requête réseau.

L’historique « Récents » est stocké séparément sous `coffre:usage:v1` : une
table d’identifiants aléatoires d’éléments et d’horodatages, plafonnée à 500
entrées. Aucun titre, identifiant de compte ni secret n’y figure, mais le rythme
d’utilisation reste visible pour un tiers ayant accès au profil du navigateur.
La table est effacée à la réinitialisation du coffre ; elle n’est jamais incluse
dans un export `.coffre`.

### 3.4 Cycle de vie

- Au chargement, Coffre lit `current` et valide le format.
- Le déverrouillage dérive la clé maîtresse et ouvre les clés de coffre en
  mémoire ; si une enveloppe existe, sa clé de récupération est également
  ouverte via le `guard` et conservée en mémoire. La purge de la corbeille est
  appliquée avant l’affichage.
- À chaque mutation, le fichier courant est remplacé ; les trois versions
  précédentes glissent de `backup` vers `backup:2` puis `backup:3`, la plus
  ancienne étant écrasée. Dans l’application desktop, la rotation est effectuée
  par Rust avant le renommage atomique du nouveau fichier.
- Dans le navigateur, chaque mutation est une écriture contrôlée : la
  transaction IndexedDB vérifie que le fichier enregistré est toujours celui à
  partir duquel la modification a été calculée. Sinon, l’écriture est refusée
  (`StorageConflictError`) au lieu d’effacer la modification d’un autre onglet.
- Chaque déverrouillage relit le fichier enregistré : une écriture terminée
  après un verrouillage, ou faite ailleurs, sert de base aux écritures suivantes.
- Le verrouillage vide immédiatement l’état React et efface les clés en
  mémoire. Si une écriture était déjà en cours, les clés restent le temps de la
  signer et de l’enregistrer (quelques centaines de millisecondes), puis sont
  effacées : la modification n’est pas perdue, et rien n’est relu en clair.
- Un rechargement de page, un `pagehide` ou une fermeture d’onglet verrouille le
  coffre et passe l’état à « verrouillé » : les clés ne sont jamais persistées.
  Un retour depuis le cache d’arrière-plan (bfcache) retrouve donc un coffre
  verrouillé. La clé du déverrouillage rapide (trousseau) est conservée dans ce
  cas, puisque c’est son rôle au relancement ; un verrouillage explicite, par
  inactivité ou en arrière-plan la retire.
- La vérification d’intégrité déchiffre tous les enregistrements — contenus,
  versions et pièces jointes — et compare la taille des pièces jointes à leurs
  métadonnées ; elle ne modifie pas le fichier.

### 3.5 Dossier de synchronisation (desktop)

Le choix du dossier est explicite ; Coffre ne synchronise rien tant que
l’utilisateur n’a pas sélectionné un dossier déjà synchronisé (iCloud Drive,
Dropbox, Syncthing, clé USB…). Rust crée `Coffre/<idFichier>/` avec un
`README.txt`, puis chaque appareil n’écrit que son propre fichier `.coffre`.

- `sync_prepare`, `sync_list`, `sync_read` et `sync_write` valident le dossier
  canonique et n’acceptent qu’un nom `[A-Za-z0-9_-]+\.coffre` : aucun séparateur,
  aucune remontée `..`, aucun fichier d’un autre type.
- La lecture refuse les liens symboliques ; l’écriture passe par un fichier
  temporaire, `fsync`, puis un renommage atomique. Fichiers en `0600`, dossiers
  en `0700` sur macOS/Linux.
- La taille d’un fichier synchronisé est plafonnée à 100 Mo.
- La surveillance utilise `notify` (événements du système de fichiers) avec un
  anti-rebond de 500 ms. L’événement `coffre:sync-changed` ne contient que le
  chemin du dossier, jamais un contenu de coffre. Il signale qu’une
  synchronisation est disponible ; la fusion reste déclenchée par l’utilisateur.
- À chaque synchronisation, chaque fichier distant est ouvert en mémoire avec la
  clé maîtresse courante et son MAC global est vérifié. Un fichier invalide est
  ignoré et signalé.
- Si un fichier distant utilise une **époque de clés plus récente**, Coffre
  demande le nouveau mot de passe maître, vérifie que les clés de coffre sont
  identiques, reconstruit une session à la nouvelle époque puis fusionne. Aucun
  ciphertext d’époques différentes n’est fusionné sans cette étape.
- Les conflits à révision égale sont archivés dans l’historique de l’élément
  avec un identifiant de version déterministe, ce qui évite les doublons lors
  des synchronisations suivantes.
- L’enveloppe de récupération d’un autre appareil n’est pas adoptée : celle de
  l’appareil local est conservée si elle couvre tous les coffres, sinon elle est
  retirée avec un avertissement. Régénérez la phrase après une fusion si
  nécessaire.
- Aucune requête réseau : le service de synchronisation est celui choisi par
  l’utilisateur, hors de Coffre.

**Sur le Web (Chromium)**, la même fusion utilise la File System Access API :

- le dossier est choisi par `showDirectoryPicker` en lecture/écriture ;
- seul un `FileSystemDirectoryHandle` est conservé dans IndexedDB
  (base `coffre-sync`), jamais un contenu de coffre ;
- la permission est vérifiée par `queryPermission` et redemandée si nécessaire ;
- les mêmes validations de noms, la même limite de 100 Mo et les mêmes fichiers
  `.coffre` signés sont utilisés ;
- Safari, Firefox et les navigateurs sans File System Access API conservent
  l’export/import manuel ; aucun cookie, compte ou service réseau n’est ajouté.
- Le watcher système n’existe pas sur le Web : la synchronisation est
  déclenchée manuellement depuis les réglages.

La fusion des fichiers (`mergeVaultFiles`) est décrite en 2.7. Les limites de
confiance restent celles du dossier partagé : un tiers qui peut lire les
fichiers obtient les métadonnées chiffrées, et un tiers qui peut les modifier
peut provoquer un déni de service ou une tentative de rejeu, détectée par le
MAC et la révision.

### 3.6 Limites du stockage local

- **Desktop** : un processus du même compte utilisateur peut lire ou modifier le
  fichier s’il contourne les permissions — comme pour tout gestionnaire de mots
  de passe local. Le fichier reste chiffré ; un malware déjà présent au moment
  du déverrouillage peut toutefois agir dans le processus de l’application.
- **Desktop** : une sauvegarde système (Time Machine, clone de disque) copie le
  fichier chiffré. Le mot de passe maître reste la protection principale.
- **Web** : le navigateur peut évincer les données d’un site. Les réglages
  permettent de demander `navigator.storage.persist()` et d’afficher le statut
  obtenu ainsi que l’espace utilisé ; le navigateur reste libre d’accorder ou de
  refuser.
- Le mode privé, la navigation restreinte ou certains WebViews peuvent refuser
  IndexedDB.
- Sur le Web, les données sont liées à l’origine (schéma + domaine + port).
  Changer de domaine ou de port crée un coffre vide distinct.
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
- **Perte de focus (desktop)** : option dédiée qui verrouille dès que la fenêtre
  Tauri n’est plus active. Désactivée par défaut pour ne pas gêner les dialogues
  système.
- `pagehide` et `beforeunload` verrouillent également la session.
- Les minuteurs peuvent être ralentis par le navigateur lorsque l’onglet est en
  arrière-plan ; le verrouillage peut donc survenir au retour plutôt qu’à la
  seconde près.
- Le verrouillage manuel et le bouton « Verrouiller maintenant » sont toujours
  disponibles.

### 4.2 Presse-papiers

Dans l’application desktop, la copie passe par une commande Rust
(`clipboard_copy_secret`) qui marque le contenu comme secret pour les
gestionnaires d’historique du système ; l’effacement différé
(`clipboard_clear_if`) lit le presse-papiers côté natif, sans dépendre d’un
geste de l’utilisateur, et n’efface que si le contenu est toujours le secret
copié. La WebView ne reçoit aucune permission `clipboard-manager`.

Dans le navigateur, la copie utilise `navigator.clipboard.writeText` lorsque
disponible, sinon un repli `execCommand('copy')`. L’effacement automatique :

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

L’export CSV est une option de migration : il contient des secrets **en clair**
et ne doit être conservé que le temps de l’import. Le format Apple
(`Title,URL,Username,Password,Notes,OTPAuth`) ne contient que les connexions
actives ; le format complet Coffre inclut tous les types d’éléments et les
champs personnalisés, mais jamais les pièces jointes. Le fichier `.coffre`
reste la sauvegarde chiffrée de référence.

Recommandations :

- exporter après chaque ajout important ;
- conserver plusieurs copies sur des supports distincts ;
- vérifier régulièrement qu’un export s’importe et se déverrouille ;
- ne pas envoyer le fichier par un canal non maîtrisé sans chiffrement
  supplémentaire.

### 5.2 Sauvegardes locales

Le stockage local conserve automatiquement les **trois versions précédentes**
du fichier chiffré : `vault.coffre.bak1` à `bak3` dans l’application desktop,
clés `backup`, `backup:2` et `backup:3` dans IndexedDB sur le Web. Si le fichier
courant est corrompu ou illisible, l’écran d’erreur liste les générations
disponibles — date et nombre d’éléments, sans contenu — et permet d’en restaurer
une après saisie du mot de passe maître. La génération restaurée redevient le
fichier courant et la rotation reprend normalement.

Limites :

- ce ne sont pas des sauvegardes hors appareil : elles partagent le même
  appareil, le même compte et le même disque ;
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
- le MAC global du format 4 : manifeste canonique, tous les ciphertexts et
  pierres tombales ;
- la cohérence des pierres tombales (pas de doublon, pas d’entrée encore
  présente) ;
- l’absence de version et de pièce jointe orpheline.

Toute erreur AES-GCM, incohérence de taille, MAC différent ou référence
manquante produit un rapport d’échec. La vérification est en lecture seule :
elle ne répare ni ne réécrit le coffre. En cas d’échec, exportez immédiatement
une sauvegarde et n’effectuez plus de modification avant investigation.

**Limites d’intégrité.** Depuis le format 4, le MAC global et la révision hors
fichier détectent une suppression cohérente, une substitution d’enregistrement
ou un remplacement par un fichier antérieur. Un attaquant qui contrôle à la fois
le fichier de coffre et le fichier d’état local (`state.json` ou clé IndexedDB
`state`) peut toujours rejouer un fichier complet ancien : cette barrière
protège contre une substitution accidentelle ou partielle, pas contre un
attaquant disposant durablement du compte de l’utilisateur. Conservez un export
hors appareil et comparez les dates si cette menace fait partie de votre
modèle.

---

## 6. Surface d’attaque applicative

### 6.1 Réseau minimal et explicite

Le coffre n’utilise ni `XMLHttpRequest` ni WebSocket vers un service. Les
polices sont système, les icônes sont des composants SVG locaux et la liste EFF
est embarquée. L’import lit un fichier local via l’API `File` du navigateur et
ne l’envoie nulle part.

Deux fonctions optionnelles peuvent utiliser le réseau, jamais pour le contenu
du coffre :

- la synchronisation par dossier choisie par l’utilisateur, qui lit et écrit des
  fichiers `.coffre` chiffrés dans un dossier déjà synchronisé par un autre
  outil ;
- la vérification des fuites, désactivée par défaut et déclenchée manuellement,
  qui n’envoie qu’un préfixe SHA-1 de 5 caractères à Have I Been Pwned
  (voir 2.12.1). Sur desktop, cette requête passe par Rust ; sur le Web, seul
  `api.pwnedpasswords.com` est ajouté à `connect-src`.

Le build PWA ajoute un service worker Workbox qui :

- précache les ressources statiques de l’application ;
- peut contacter le serveur d’origine pour mettre à jour ces ressources ;
- ne met jamais le contenu du coffre dans le cache HTTP.

Le pont natif desktop n’ouvre aucune connexion réseau : il utilise uniquement
un socket Unix local dans le dossier de données de l’application. Aucune
donnée du coffre n’est envoyée à un service, même pendant l’appairage de
l’extension. La seule requête sortante possible est la plage HIBP optionnelle
décrite en 2.12.1.

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

La CI exécute `bun audit --audit-level=high` à chaque poussée et Dependabot
propose les mises à jour chaque semaine. Dernier état connu (0.9.0) : aucune
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
La WebView n’accède au système que par des commandes IPC explicites :

| Groupe | Rôle |
| --- | --- |
| `keychain_store`, `keychain_load`, `keychain_delete` | trousseau de session |
| `biometric_available`, `biometric_confirm`, `biometric_store`, `biometric_delete`, `biometric_load` | Touch ID macOS |
| `vault_read`, `vault_write`, `vault_backup_read`, `vault_backup_write`, `vault_clear` | stockage natif du coffre |
| `lan_identity`, `lan_pair_start`, `lan_pair_join`, `lan_peers`, `lan_forget_peer`, `lan_sync_serve`, `lan_sync_pull` | synchronisation locale |
| `open_external_url` | ouverture contrôlée de liens http(s) |

Le service du trousseau est `app.coffre.desktop` et le compte est l’identifiant
du fichier `.coffre` (`file.id`). Le backend est fourni par la caisse `keyring`
3.6, avec `apple-native` sur macOS, `windows-native` sur Windows et
`sync-secret-service` sur Linux. Le trousseau n’est jamais utilisé pour les
coffres ouverts dans un navigateur. Aucun accès générique aux fichiers, au
réseau ou au shell n’est exposé.

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

Le desktop Tauri utilise un fichier natif dans le dossier de données de
l’application (`vault/vault.coffre`). Le stockage est propre à l’application et
à l’identifiant Tauri ; un ancien coffre IndexedDB est migré au premier
lancement. Un raccourci global (`⌘⇧Espace` sur macOS, `Ctrl+Shift+Espace`
ailleurs) affiche la fenêtre et place le curseur dans la recherche ; il est
enregistré côté Rust et ne donne aucun accès supplémentaire à la WebView.

Le build macOS arm64 a été validé : l’application démarre, initialise le
stockage natif, migre un éventuel coffre IndexedDB, reste stable et n’ouvre
aucune connexion réseau. Les parcours Playwright passent sur WebKit, moteur des
WebViews macOS/iOS. Le bundle produit n’est ni signé ni notarisé, et les cibles
Windows/Linux restent à valider.

## 8. Risques résiduels

| Risque | Impact | Atténuation actuelle |
| --- | --- | --- |
| Mot de passe maître faible | Déchiffrement hors ligne | Argon2id, minimum 12 caractères, indicateur de robustesse |
| XSS ou code servi compromis | Vol des secrets pendant le déverrouillage | Réseau minimal (HIBP optionnel), CSP fournie, dépendances verrouillées, Tauri CSP |
| Extension malveillante | Lecture du DOM, du presse-papiers, des frappes | Navigateur/profil dédié, désactivation des extensions |
| Extension Coffre compromise | Lecture des identifiants pendant le remplissage | Aucun stockage, accès limité à l’onglet actif, verrouillage après usage |
| Appareil compromis | Keylogging, mémoire, écran | Hors périmètre ; utiliser un OS à jour |
| Presse-papiers non effacé | Fuite vers une autre application | Effacement au mieux, délai court |
| Perte du mot de passe | Perte définitive sans phrase configurée | Phrase de récupération optionnelle (~129 bits) ; exports réguliers |
| Phrase de récupération compromise | Ouverture du coffre avec le fichier | Phrase non stockée, à conserver séparément ; remplacement immédiat en cas de doute |
| Corruption du stockage | Perte du coffre courant | Trois générations `backup`, validation, vérification d’intégrité, export |
| Fichier d’import malveillant ou volumineux | Déni de service, import partiel | Limite de 20 Mo (50 Mo pour `.1pux`) et 5 000 éléments, validation, aperçu avant import |
| Pièce jointe malveillante | Exécution à l’ouverture hors de Coffre | Type MIME et extension non fiables ; ouvrir avec prudence, aucune exécution dans l’application |
| Métadonnées visibles | Fuite d’information limitée | Chiffrement du contenu ; métadonnées assumées |
| Rejeu d’un fichier complet ancien | Retour à un état antérieur du coffre | MAC global et révision hors fichier (format 4) ; limite si l’attaquant contrôle aussi l’état local |
| Historique et corbeille conservés | Données supprimées encore présentes dans le fichier | Chiffrés, plafonnés (20 versions/élément), purge configurable |
| Dépendance compromise | Exécution arbitraire | Versions verrouillées, revue, build reproductible à venir |

---

## 9. Signalement d’une vulnérabilité

Coffre n’a pas encore de programme de divulgation coordonnée. Si le dépôt est
publié, utilisez de préférence un avis de sécurité privé (GitHub Security
Advisory) plutôt qu’une issue publique. Indiquez la version, la plateforme, les
étapes de reproduction et l’impact estimé. Ne joignez jamais un vrai coffre ni
un vrai mot de passe.

---

## 10. Feuille de route sécurité

- audit cryptographique et test d’intrusion externes, y compris du cœur
  Rust/Tauri ;
- augmentation et calibration des paramètres Argon2id selon l’appareil ;
- extension du trousseau natif au mobile (iOS/Android) et validation des backends Windows/Linux ;
- extension des tests de bout en bout à Firefox et aux WebViews Android/iOS ;
- protection mémoire renforcée (WebAssembly, workers isolés) ;
- politique de divulgation et builds reproductibles ;
- import/export interopérable avec chiffrement supplémentaire optionnel.
