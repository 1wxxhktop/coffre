# Jeux d’essai `.coffre`

Ces fichiers sont **figés** et servent de test de non-régression du format.

- `v1.coffre.json` : produit par la version 0.1.x (format 1, sans historique ni
  corbeille).
- `v2.coffre.json` : produit par la version 0.2.0 (format 2, deux versions
  d’historique et un élément en corbeille).
- `v3.coffre.json` : produit par la version 0.4.0 (format 3, un élément et une
  enveloppe de récupération).
- `v4.coffre.json` : produit par le format 4 (MAC global, deux éléments dont
  un en corbeille, une version, une pièce jointe et une enveloppe de
  récupération).

Mot de passe maître des quatre fichiers : `phrase de passe de test solide`
(paramètres Argon2id réduits pour les tests).

Phrase de récupération des fichiers v3 et v4 :
`abacus abdomen abdominal abide abiding ability abject ablaze abode abort`.

**Ne pas les régénérer** : leur intérêt est de représenter des octets produits
par une version antérieure. Pour couvrir un nouveau format, ajoutez un fichier
supplémentaire (`v3.coffre.json`) et un test dédié.
