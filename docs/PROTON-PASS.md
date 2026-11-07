# Proton Pass et Coffre : analyse et filiation

Ce document explique pourquoi Coffre n’est pas un fork de Proton Pass, ce qui a
été étudié dans les dépôts publics, ce qui a inspiré l’architecture de Coffre et
ce qui n’a pas été repris. Il sert aussi de trace pour les questions de licence
et d’attribution.

> **Date de l’étude :** 25 octobre 2026.
> **Portée :** dépôts publics de l’organisation
> [`protonpass`](https://github.com/orgs/protonpass/repositories), examinés par
> lecture du code, des schémas et des fichiers de licence. Aucun code Proton
> Pass n’est exécuté par Coffre.

---

## 1. Résumé

Proton Pass est un gestionnaire de mots de passe **en ligne, à chiffrement de
bout en bout**, adossé à un compte Proton et à une API propriétaire. Ses clients
publics sont des interfaces autour de ce service : ils authentifient l’utilisateur
auprès de Proton, récupèrent les coffres chiffrés depuis l’API et les déchiffrent
localement.

Coffre poursuit un objectif différent : **aucun compte, aucun serveur, aucune
synchronisation**. Toutes les données vivent dans le stockage local de
l’appareil. Un fork littéral des clients Proton Pass ne permettrait pas
d’atteindre cet objectif sans réécrire la couche réseau, l’authentification, le
stockage et une partie du modèle de clés. Le résultat aurait fort peu de code en
commun avec l’amont.

Coffre est donc un **projet indépendant**, écrit depuis zéro, qui reprend des
**idées** d’architecture et d’ergonomie, pas du code. Les sections suivantes
détaillent ce choix.

---

## 2. Dépôts examinés

Les dépôts suivants ont été clonés et lus. Les commits indiqués sont ceux
présents dans les clones au moment de l’étude ; ils ne prétendent pas être la
tête de développement actuelle de chaque dépôt.

| Dépôt | Rôle | Technologies | Licence | Commit examiné |
| --- | --- | --- | --- | --- |
| [`proton-pass-common`](https://github.com/protonpass/proton-pass-common) | Bibliothèque commune aux clients : types, TOTP, partage, utilitaires | Rust, UniFFI (mobile), WASM (web) | GPL-3.0-or-later | `b0c9fd0` (14/10/2026) |
| [`pass-cli`](https://github.com/protonpass/pass-cli) | Interface en ligne de commande | Rust | GPL-3.0-or-later | `5d0cfbf` (21/10/2026) |
| [`android-pass`](https://github.com/protonpass/android-pass) | Application Android | Kotlin, Gradle | GPL-3.0-or-later | `d03bd11` (15/10/2026) |
| [`pass-contents-proto-definition`](https://github.com/protonpass/pass-contents-proto-definition) | Schémas Protocol Buffers des coffres, dossiers et éléments | Protobuf | Aucun fichier `LICENSE` dans le clone | `8c88394` (25/03/2026) |

Constats principaux :

- `proton-pass-common` n’est pas une application autonome. C’est une
  bibliothèque exportée vers Android/iOS via UniFFI et vers le web via
  `wasm-pack`. Le dossier `proton-pass-web` contient la glue WASM, pas un
  client web complet.
- `pass-cli` se connecte à un compte Proton (`pass-cli login`) et dépend de
  crates distribuées par le registre Proton (`muon`, `proton-crypto`,
  `proton-crypto-account`). Sa commande d’export produit une archive HTML
  autonome, mais l’outil reste conçu pour fonctionner avec le service Proton.
- `android-pass` est le client Android officiel (`applicationId`
  `proton.android.pass`). Il s’appuie sur le compte et l’API Proton.
- `pass-contents-proto-definition` décrit le format des objets. Le contenu d’un
  élément est un `oneof` couvrant : note, connexion, alias, carte bancaire,
  identité, clé SSH, réseau Wi-Fi et élément personnalisé.
- La liste de mots utilisée par le générateur, `eff_large_wordlist.txt`
  (7 776 mots, 108 800 octets), est présente dans `proton-pass-common`.

### 2.1 Modèle de données observé

Le type `ItemData` de `proton-pass-common` comporte notamment : un titre, une
note, un identifiant d’élément, un contenu typé, des champs supplémentaires, des
données spécifiques à la plateforme et une icône personnalisée. Les coffres
(`VaultData`) ont un nom, une description et des préférences d’affichage.

Le format est versionné et sérialisé en Protocol Buffers (`item_v1.proto`,
`vault_v1.proto`, `folder_v1.proto`, `file_v1.proto`). Cette sérialisation
binaire est conçue pour l’échange avec le service Proton et pour la
compatibilité entre clients.

### 2.2 Cryptographie observée

- La CLI dépend de `proton-crypto` avec la fonctionnalité `rustpgp`, ce qui
  confirme l’ancrage de l’écosystème Proton dans OpenPGP pour les clés de
  compte et de partage.
- Chaque coffre possède une clé aléatoire de 32 octets. Chaque élément possède
  sa propre clé de 32 octets, chiffrée avec la clé du coffre ; les clés de
  coffre sont enveloppées avec la clé utilisateur via OpenPGP (courbe
  Curve25519). Le modèle public de Proton Pass décrit cette hiérarchie
  compte → coffre → élément.
- Le crate `proton-pass-totp` implémente les codes TOTP (RFC 6238) avec SHA-1,
  SHA-256 et SHA-512.
- La liste EFF est embarquée pour les phrases de passe.

Coffre reprend l’**idée** d’une hiérarchie de clés par coffre et par élément,
mais avec des primitives et un format qui lui sont propres (voir § 5).

---

## 3. Pourquoi un fork littéral est incompatible avec le mode local

### 3.1 Le service est le centre de gravité

Les clients publics supposent l’existence d’un compte Proton, d’une API et
d’un stockage distant. L’authentification, la récupération des coffres, le
partage, les alias e-mail et la distribution des clés passent par ce service.
Il n’existe pas d’option « mode local » ou « mode hors ligne autonome » dans
ces dépôts.

### 3.2 Le backend n’est pas open source

L’API, la gestion des comptes, le partage de coffres, la distribution des clés
et les fonctions de service (alias, surveillance de fuites, etc.) ne sont pas
publiés. Même en modifiant les clients, il manquerait le serveur qui donne un
sens à leur modèle de données.

### 3.3 Les formats sont liés à Proton

Les schémas Protobuf, les enveloppes de clés, les identifiants et les
vérifications d’intégrité sont conçus pour le service Proton. Les réutiliser
tels quels imposerait de réimplémenter le cycle de vie des clés Proton, les
partages et les invitations, sans le backend correspondant.

### 3.4 Le chantier dépasse le fork

Pour obtenir une application 100 % locale à partir d’un client Proton, il
faudrait au minimum :

- remplacer toute la couche réseau et l’authentification ;
- concevoir un stockage local et un format de fichier autonome ;
- redéfinir la hiérarchie de clés et les enveloppes sans le service ;
- retirer le partage, les alias, les passkeys et les fonctions liées au compte ;
- réécrire la synchronisation et la gestion des conflits ;
- supprimer la télémétrie et les intégrations de service ;
- refaire l’identité visuelle et les textes.

À ce stade, le « fork » ne conserverait que des fragments d’interface et des
types de données, tout en héritant de la complexité et du rythme de
maintenance de l’amont. Un projet indépendant est plus simple à comprendre, à
auditer et à maintenir.

### 3.5 Marque et affiliation

« Proton » et « Proton Pass » sont des marques de Proton AG. Coffre ne les
utilise pas comme nom de produit et n’est **pas affilié à Proton AG**. Cette
distinction est explicitement indiquée dans le README et le `NOTICE`.

---

## 4. Ce que Coffre reprend

Coffre reprend des **idées générales**, toutes réimplémentées avec ses propres
types, son propre format et son propre code.

| Idée | Chez Proton Pass | Dans Coffre |
| --- | --- | --- |
| Typologie des éléments | Note, connexion, alias, carte, identité, clé SSH, Wi-Fi, personnalisé | Connexion, note, carte, identité, avec champs personnalisés typés |
| Champs libres | Champs supplémentaires par élément | Jusqu’à 30 champs texte, masqué, URL ou texte long |
| Import | Export/import propriétaire | JSON Bitwarden, Proton Pass et Enpass non chiffrés, CSV de 13 gestionnaires/navigateurs |
| Coffres et identifiants stables | Coffres, dossiers, éléments identifiés par des UUID | Coffres et éléments identifiés par des identifiants aléatoires |
| Clés par coffre et par élément | Clés de coffre, clés d’élément, enveloppes | Clé maîtresse → clé de coffre → clé d’élément → contenu |
| Séparation de domaine | Contexte cryptographique propre à chaque usage | AAD explicites : `coffre:v1:vault-key`, `item-key`, `item-content`, `item-version`, `vault-meta`, `recovery-key`, `recovery-guard`, `recovery-vault-key:<vaultId>` |
| Dérivation du mot de passe | Argon2id dans la chaîne de déverrouillage Proton | Argon2id local (64 Mio, 3 itérations, 4 threads) |
| Chiffrement authentifié | AES-256-GCM / constructions de l’écosystème Proton | AES-256-GCM avec nonce aléatoire de 12 octets |
| TOTP | RFC 6238, SHA-1/256/512 | RFC 6238, SHA-1/256/512, import `otpauth://` |
| Phrases de passe | Liste EFF Large Wordlist | Même liste, embarquée et attribuée |
| Ergonomie | Barre latérale, coffres, recherche, générateur, thème sombre | Mêmes principes, interface et composants originaux |

Ce qui **n’a pas** été repris : code source, composants, styles, icônes,
textes, schémas Protobuf, format de fichier, identifiants, API, structure de
compte et logique de partage.

---

## 5. Ce que Coffre fait différemment

| Sujet | Proton Pass | Coffre 0.8.0 |
| --- | --- | --- |
| Compte | Compte Proton obligatoire | Aucun compte |
| Backend | Service Proton | Aucun serveur |
| Synchronisation | Chiffrée de bout en bout via Proton | Aucune ; export/import manuel `.coffre` |
| Stockage | Serveur + cache local | IndexedDB local, fichier chiffré |
| Format | Protobuf + enveloppes Proton | JSON versionné + AES-256-GCM |
| Partage | Coffres partagés, invitations | Absent |
| Alias e-mail | Intégrés au service | Absents |
| Passkeys | Pris en charge | Absents |
| Extension navigateur | Disponible | Absente (feuille de route) |
| Remplissage automatique | Disponible | Absent |
| Types d’éléments | 8 types | 4 types et champs personnalisés |
| Import | Depuis Proton Pass et formats propriétaires | JSON Bitwarden, Proton Pass et Enpass non chiffrés, CSV de 13 gestionnaires/navigateurs |
| Pièces jointes | Chiffrées et synchronisées | Chiffrées localement, sans synchronisation |
| Historique et corbeille | Historique de versions et corbeille côté service | Historique et corbeille locaux, chiffrés et plafonnés |
| Plateformes | Web, extension, Android, iOS | Web/PWA, extension Chromium, socle desktop Tauri, mobile à initialiser |
| Récupération | Pas de récupération du mot de passe, mais compte et assistance | Phrase de 10 mots optionnelle, sans compte ni serveur |
| Licence | GPL-3.0-or-later | GPL-3.0-only |
| Audit | Produit commercial maintenu par Proton | MVP non audité |

Ces différences sont assumées : Coffre n’essaie pas d’être compatible avec
Proton Pass, ni de lire ses fichiers, ni de se faire passer pour lui.

---

## 6. Licence et attribution

### 6.1 Code

Coffre est distribué sous **GNU GPL v3.0 seulement** (`GPL-3.0-only`). Le texte
complet se trouve dans [`LICENSE`](../LICENSE).

Aucun fichier source de Proton Pass n’a été copié dans Coffre. Les idées,
interfaces et principes généraux ne sont pas soumis au droit d’auteur ; les
éléments expressifs (code, textes, graphismes) ne sont pas réutilisés. Coffre
n’est donc pas une œuvre dérivée de Proton Pass au sens du droit d’auteur.

Si du code Proton Pass devait être réutilisé dans une version future, il
faudrait :

- vérifier que la licence du fichier concerné est compatible ;
- conserver les mentions de copyright et la licence d’origine ;
- documenter l’ajout dans `NOTICE` et ce document ;
- ne pas introduire de dépendance à l’API ou au compte Proton.

### 6.2 Liste EFF

La liste `eff_large_wordlist.txt` est la *EFF Large Wordlist* de
l’Electronic Frontier Foundation, publiée sous **Creative Commons Attribution
3.0** (CC BY 3.0). Elle a été reprise du dépôt `protonpass/proton-pass-common`.
L’attribution complète figure dans [`NOTICE`](../NOTICE).

### 6.3 Marques

Proton, Proton Pass et les logos associés sont des marques de Proton AG.
Coffre n’utilise ni ces marques ni ces logos comme identité de produit. Toute
mention de Proton Pass est descriptive et vise à créditer l’inspiration.

---

## 7. Références

- Organisation Proton Pass : <https://github.com/orgs/protonpass/repositories>
- Bibliothèque commune : <https://github.com/protonpass/proton-pass-common>
- CLI : <https://github.com/protonpass/pass-cli>
- Client Android : <https://github.com/protonpass/android-pass>
- Schémas Protobuf : <https://github.com/protonpass/pass-contents-proto-definition>
- Présentation de Proton Pass : <https://proton.me/pass>
- Modèle de sécurité de Proton Pass :
  <https://proton.me/blog/proton-pass-security-model>
- Licence GPL v3 : <https://www.gnu.org/licenses/gpl-3.0.html>
- Licence CC BY 3.0 : <https://creativecommons.org/licenses/by/3.0/>
- Liste EFF : <https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt>

---

## 8. Mise à jour de ce document

Lorsqu’un dépôt Proton Pass est réexaminé :

1. noter la date et le commit examinés ;
2. vérifier les fichiers `LICENSE` et les en-têtes de copyright ;
3. ne pas copier de code sans mettre à jour `NOTICE` et la section 6 ;
4. conserver la distinction entre inspiration conceptuelle et réutilisation de
   code ;
5. vérifier qu’aucune nouvelle fonctionnalité de Coffre ne dépend d’un service
   Proton.
