# Coffre natif

Portage expérimental de Coffre en Zig, avec l’interface native
[nanoui](https://github.com/justrach/nanoui). Le cœur (`src/core/`) lit les
fichiers `.coffre` v1, v2 et v3 et sait en créer de nouveaux ; l’interface
(`src/app.zig`) permet de déverrouiller un fichier, de consulter les coffres et
les éléments, de créer un coffre, de créer ou de modifier des connexions et des
notes, d’importer un export Bitwarden, Proton Pass, Enpass ou CSV, de générer
des mots de passe et d’afficher les codes TOTP.

> Les pièces jointes, l’historique et la récupération ne sont pas encore
> disponibles. Voir [`docs/NATIVE.md`](../docs/NATIVE.md) pour l’architecture,
> les limites et la feuille de route.

```sh
cd native
./scripts/fetch-deps.sh        # si vendor/nanoui est absent
./.tools/zig/zig build         # Zig 0.17.0 dans .tools/zig
./.tools/zig/zig build test    # cœur + interface hors écran
./.tools/zig/zig build demo    # jeu d’essai v3, mot de passe public
```

Le binaire principal est `zig-out/bin/coffre`. La démonstration est
`zig-out/bin/coffre-demo`.

## Écriture

- Création d’un fichier v3 : sel Argon2id aléatoire, identifiants aléatoires,
  clé de coffre scellée avec la clé maîtresse.
- Chaque élément reçoit sa propre clé, scellée avec la clé du coffre ; son
  contenu JSON est scellé avec cette clé d’élément.
- Écriture atomique : fichier temporaire dans le même dossier, synchronisation,
  puis renommage sur la destination.
- Trois sauvegardes tournantes (`.bak1` à `.bak3`).
- Permissions `0600` sur macOS et Linux.
- Les champs propres au type sont écrits comme chaînes vides, pour rester
  lisibles par le validateur de l’application web.

## Import

- JSON non chiffré : Bitwarden, Proton Pass et Enpass.
- CSV : détection des colonnes courantes, en français ou en anglais.
- Les dossiers et coffres d’origine deviennent des étiquettes ; les catégories
  inconnues sont importées comme notes ; les pièces jointes et les éléments en
  corbeille sont ignorés.
- Les doublons (type, titre, identifiant, mot de passe) sont ignorés.
- Le fichier d’origine n’est jamais conservé ni modifié ; seuls les éléments
  retenus sont chiffrés dans le coffre sélectionné.

## Générateur et TOTP

- Mots de passe de 8 à 64 caractères, classes sélectionnables, exclusion des
  caractères ambigus, tirage sans biais modulo.
- Phrases de passe à partir de la liste EFF embarquée.
- Codes TOTP RFC 6238 (SHA-1/256/512), lus depuis une URI `otpauth://`,
  rafraîchis chaque seconde et copiables depuis le détail.

## Verrouillage et raccourcis

- Verrouillage automatique réglable (jamais, 1, 5, 15 ou 60 minutes), mémorisé
  entre les lancements.
- Le verrouillage efface les clés, le contenu déchiffré, les formulaires et le
  presse-papiers si le dernier copié provenait de Coffre.
- `Cmd/Ctrl+L` verrouille, `Cmd/Ctrl+N` crée un élément, `Cmd/Ctrl+F` cherche,
  `Cmd/Ctrl+I` importe, `Échap` annule le formulaire.
