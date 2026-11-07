# Application native (Zig + nanoui)

> **Projet mis de côté.** Le portage Zig + nanoui n’est plus la cible produit :
> le travail desktop continue sur **Tauri**. Le code reste dans `native/`, compile
> et passe ses 58 tests, mais il n’est plus maintenu activement et ne doit pas
> servir de coffre principal. Cette page est conservée comme archive technique.

Coffre possède une seconde implémentation, **expérimentale**, de son
gestionnaire de mots de passe : une application desktop native écrite en Zig,
dont l’interface est rendue par [nanoui](https://github.com/justrach/nanoui).
Elle vit dans le dossier [`native/`](../native) et ne remplace pas encore
l’application web, l’extension ni la coque Tauri.

> **État : création, édition et import.** Cette version ouvre et déchiffre les
> fichiers `.coffre` v1, v2 et v3, affiche les coffres et les éléments, crée des
> coffres neufs, permet de créer ou de modifier des connexions et des notes, et
> importe les exports Bitwarden, Proton Pass, Enpass et CSV. Chaque
> enregistrement passe par une écriture atomique et conserve trois sauvegardes.
> Les pièces jointes, l’historique et la récupération restent à venir : elle ne
> doit pas encore servir de coffre principal avant l’audit cryptographique.

## Pourquoi une version native ?

- Une fenêtre native, sans WebView, sur macOS, Windows, Linux, iOS et Android
  à terme.
- Un cœur réutilisable en Zig, indépendant de l’interface, pour le desktop et
  le mobile.
- Des binaires petits (quelques mégaoctets) et un démarrage immédiat.
- Le même format `.coffre`, les mêmes primitives et les mêmes AAD que
  l’application web : un fichier reste lisible partout.

L’application web et sa coque Tauri restent la version de référence. La
version native est développée par étapes, sans toucher au reste du dépôt.

## Architecture

```
native/
├── build.zig              compilation, tests et binaire de démonstration
├── build.zig.zon          dépendance `path` vers nanoui vendorisé
├── scripts/fetch-deps.sh  clone nanoui v0.11.0 si absent
├── src/
│   ├── main.zig           entrée de l’application (fenêtre, dernier coffre)
│   ├── app.zig            état et vue immédiate (verrou, liste, détail)
│   ├── demo.zig           démonstration avec le jeu d’essai v3
│   ├── tests.zig          tests de l’interface hors écran
│   └── core/
│       ├── crypto.zig     Argon2id, AES-256-GCM, base64, effacement
│       ├── format.zig     types et parse/validate/serialize v1/v2/v3
│       ├── vault.zig      déverrouillage, clés de coffre, éléments
│       ├── items.zig      création et mise à jour des éléments chiffrés
│       ├── import.zig     analyse des exports et déduplication
│       ├── write.zig      création d’un coffre, écriture atomique, sauvegardes
│       ├── tests.zig      tests du cœur sur fixtures figées
│       └── fixtures/      fichiers v1, v2 et v3 figés
└── vendor/nanoui/         nanoui v0.11.0 (MIT), vendorisé
```

Le cœur ne dépend ni de nanoui ni de l’interface. Il peut être testé seul avec
`zig build test-core`.

## Compatibilité du format

Le format et les AAD sont identiques à ceux de `src/lib/vault.ts` :

| Élément | AAD |
| --- | --- |
| Clé de coffre | `coffre:v1:vault-key:{id}` |
| Métadonnées de coffre | `coffre:v1:vault-meta:{id}` |
| Clé d’élément | `coffre:v1:item-key:{vault}:{item}` |
| Contenu d’élément | `coffre:v1:item-content:{vault}:{item}` |
| Garde de récupération | `coffre:v1:recovery-guard` |

- Argon2id, sel de 16 octets, clé de 32 octets ; paramètres lus dans le
  fichier (65 536 Kio, 3 itérations, parallélisme 4 par défaut).
- AES-256-GCM avec nonce de 12 octets ; le tag de 16 octets est concaténé au
  ciphertext, comme WebCrypto.
- Les fichiers v1 et v2 sont lus puis migrés en v3 en mémoire ; la création
  écrit directement en v3.
- L’enregistrement passe par un fichier temporaire du même dossier, est
  synchronisé sur disque, puis renommé sur la destination. Les trois versions
  précédentes sont conservées en `.bak1`, `.bak2` et `.bak3`.
- Le contenu déchiffré vit dans une arène ; le verrouillage efface les clés,
  vide l’arène et remet le champ de mot de passe à zéro.
- Chaque élément possède sa propre clé de 32 octets, scellée avec la clé du
  coffre, puis son contenu JSON est scellé avec cette clé. Les champs propres
  au type sont écrits comme chaînes vides, comme le fait l’application web.
- L’import accepte les exports JSON non chiffrés de Bitwarden, Proton Pass et
  Enpass, ainsi que les CSV à en-têtes courants (français ou anglais). Les
  dossiers et les coffres d’origine deviennent des étiquettes ; les catégories
  inconnues sont importées comme notes ; les pièces jointes, les passkeys et
  les éléments en corbeille sont ignorés. Les doublons (même type, même titre,
  même identifiant et même mot de passe) ne sont pas réajoutés.

## Générateur et TOTP

- Le générateur reprend les règles de `src/lib/generator.ts` : tirage uniforme
  par rejet, longueur de 8 à 64 caractères, quatre classes sélectionnables,
  exclusion des caractères ambigus et au moins un caractère de chaque classe
  active. La phrase de passe utilise la liste EFF embarquée (7 776 mots),
  avec séparateur, capitalisation et nombre final.
- Le panneau « Générer » du formulaire d’élément affiche l’entropie estimée et
  insère le mot de passe directement dans le champ, révélé.
- Les codes TOTP suivent la RFC 6238 (SHA-1, SHA-256, SHA-512) avec période et
  nombre de chiffres lus dans l’URI `otpauth://`. Le détail affiche le code
  masqué par défaut, un compte à rebours et un bouton de copie ; la vue
  demande une nouvelle trame chaque seconde. Une URI invalide retombe sur
  l’affichage brut du champ.
- Le secret TOTP décodé et les tampons HMAC sont effacés après usage ; seul le
  code affiché ou copié quitte la mémoire.

## Verrouillage, presse-papiers et raccourcis

- Le verrouillage automatique est réglable dans la barre latérale : jamais,
  1, 5, 15 ou 60 minutes. Le choix est mémorisé dans `nanoui.kv`.
- L’inactivité est mesurée sur les événements de la fenêtre (pointeur, clavier,
  molette, dépôt). Une trame est programmée à l’échéance, sans réveil continu.
- Le verrouillage efface les clés, l’arène déchiffrée, les tampons du
  formulaire, le texte d’import et la recherche. Il efface aussi le
  presse-papiers si le dernier contenu copié provenait de Coffre.
- Les boutons de copie marquent le contenu comme sensible. nanoui ne permet
  pas de relire le presse-papiers : l’effacement a donc lieu au verrouillage,
  et non après un délai qui pourrait détruire un contenu copié entre-temps.
- Raccourcis : `Cmd/Ctrl+L` verrouille, `Cmd/Ctrl+N` crée un élément,
  `Cmd/Ctrl+F` place le curseur dans la recherche, `Cmd/Ctrl+I` ouvre l’import
  et `Échap` annule le formulaire. Le menu « Fichier » expose les mêmes
  commandes.

## Construire et lancer

Prérequis : Zig **0.17.0** et, sur macOS, les frameworks système fournis par
Xcode Command Line Tools. Le dépôt ne contient pas la toolchain.

```sh
# Toolchain locale (non suivie par Git)
cd native
mkdir -p .tools
# puis placer Zig 0.17.0 dans native/.tools/zig/zig

# Dépendance vendorisée (déjà présente dans ce dépôt)
./scripts/fetch-deps.sh

# Compiler et lancer
./.tools/zig/zig build
./.tools/zig/zig build run

# Démonstration avec le jeu d’essai v3 (mot de passe public)
./.tools/zig/zig build demo     # compile et lance la démonstration
./zig-out/bin/coffre-demo       # ou lance le binaire installé
```

Sans outil graphique, nanoui peut rendre une fenêtre hors écran :

```sh
./zig-out/bin/coffre --nanoui-snapshot=/tmp/coffre.png
./zig-out/bin/coffre-demo --nanoui-snapshot=/tmp/coffre-detail.png
```

Le dernier fichier ouvert est mémorisé dans les préférences de l’application
(`nanoui.kv`) et proposé au lancement suivant.

## Tests

```sh
./.tools/zig/zig build test-core   # crypto, format, fixtures v1/v2/v3
./.tools/zig/zig build test        # cœur + interface hors écran
```

Les tests du cœur vérifient notamment :

- le déverrouillage des trois fixtures avec la phrase
  `phrase de passe de test solide` ;
- le refus d’un mauvais mot de passe ;
- la migration v1/v2 en v3 à la lecture ;
- l’aller-retour sérialisation → relecture ;
- la conservation de la clé de récupération v3 ;
- la création et la mise à jour d’éléments (clé d’élément, contenu scellé,
  conservation de l’identifiant et de la date de création) ;
- la présence des champs requis par le validateur web (`totp`, `favorite`) ;
- l’import d’un export Enpass et d’un CSV, la détection du format et la
  déduplication ;
- le générateur de mots de passe (longueur, classes, caractères ambigus) et de
  phrases de passe (liste EFF, options) ;
- les codes TOTP sur les vecteurs de la RFC 6238, l’analyse des URI
  `otpauth://` et le compte à rebours.

Les tests de l’interface utilisent `nanoui.ui.Tester` : rendu hors écran, clics
et saisie simulés, sans fenêtre ni accès au presse-papiers système. Ils
couvrent l’écran de verrouillage, la saisie de la phrase de passe, l’affichage
du détail, le masquage et la révélation du mot de passe, la recherche, la
corbeille, le verrouillage, le formulaire de création d’un coffre, le
formulaire d’élément (connexion ou note), l’ouverture d’un coffre créé sans
redériver Argon2id, la création et la modification d’éléments relues depuis le
disque, l’import d’un export Enpass écrit sur disque et le refus d’un second
import identique, le générateur inséré dans le formulaire, l’affichage masqué
puis révélé d’un code TOTP, le verrouillage automatique, les raccourcis et
l’effacement du presse-papiers au verrouillage.

Les tests d’écriture vérifient qu’un fichier créé est relu par le même cœur et
que les sauvegardes tournent sur trois générations. Une vérification manuelle
avec `bun` a confirmé qu’un fichier produit par la version native, y compris
un élément chiffré, est déverrouillable par `src/lib/vault.ts` (format v3, nom
du coffre et champs de l’élément relus).

## Sécurité et limites actuelles

- Aucun réseau, aucune télémétrie, aucune synchronisation.
- Les clés, le contenu déchiffré et les tampons intermédiaires sont effacés
  avec `std.crypto.secureZero` avant la libération de l’arène au verrouillage.
- La lecture d’un fichier est plafonnée à 128 Mo, au-delà des 50 Mo de pièces
  jointes autorisées par le format.
- Le déverrouillage bloque le fil de l’interface pendant la dérivation
  Argon2id ; une version ultérieure déplacera la dérivation hors du fil de
  rendu avec un indicateur de progression.
- La création, l’édition et l’import écrivent le fichier avec les permissions
  `0600` sur macOS et Linux et conservent trois sauvegardes. Les connexions et
  les notes sont entièrement modifiables ; pour les cartes et les identités,
  seuls le titre et les notes sont éditables pour l’instant, les autres champs
  étant conservés. L’import analyse le fichier dans une arène temporaire
  effacée à la sortie ; seules les copies des éléments retenus rejoignent
  l’arène de session. Le texte brut du fichier est effacé au verrouillage, et
  le fichier d’origine n’est jamais modifié.
- L’import place les éléments dans le coffre sélectionné (ou le premier). Il ne
  crée pas de coffres à partir des dossiers de la source et s’exécute sur le
  fil de l’interface, comme le déverrouillage. La phrase de récupération et la
  rotation de clé ne sont pas encore disponibles. Le presse-papiers n’est
  effacé qu’au verrouillage, faute d’API de lecture dans nanoui.
- Les pièces jointes et l’historique des versions ne sont pas encore affichés ;
  le détail montre le contenu courant des éléments.
- Aucun audit de sécurité externe n’a été réalisé sur cette implémentation.
  Le format et les primitives sont ceux de l’application web, mais le code
  natif doit être revu indépendamment.
- nanoui est en version 0.x : son API peut changer, et l’accessibilité reste
  limitée hors macOS/iOS.

## Étapes suivantes

1. ~~Socle Zig, format `.coffre`, crypto et fixtures.~~ Fait.
2. ~~Écran de verrouillage et vue détaillée en lecture seule.~~ Fait.
3. ~~Écriture atomique (`fichier.tmp` puis renommage), sauvegardes tournantes
   et création d’un coffre depuis l’application.~~ Fait.
4. ~~Création et modification d’éléments (clé d’élément, contenu scellé,
   `updatedAt`).~~ Fait pour les connexions et les notes.
5. ~~Import Enpass/Proton Pass/CSV et déduplication, en réutilisant les règles
   de `src/lib/import.ts`.~~ Fait ; les cartes et les identités importées
   restent en lecture seule hors titre et notes.
6. ~~Générateur de mots de passe et TOTP interactif.~~ Fait. Phrase de
   récupération et rotation restent à faire.
7. ~~Verrouillage automatique, effacement du presse-papiers au verrouillage,
   menu et raccourcis clavier.~~ Fait.
8. Tests de non-régression sur les fichiers produits par la version web,
   audit cryptographique externe, puis builds signés macOS/Windows/Linux.
9. Cibles iOS et Android (nanoui les prend en charge ; les SDK sont absents de
   l’environnement de développement actuel).

## Mettre à jour nanoui

```sh
cd native
rm -rf vendor/nanoui
./scripts/fetch-deps.sh
./.tools/zig/zig build test
```

La version épinglée est `v0.11.0`. Toute mise à jour doit être accompagnée
d’une passe de tests et d’une capture des écrans de verrouillage et de détail.
