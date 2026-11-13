# Corpus de détection de formulaires (E12)

Ce dossier contient des pages HTML statiques qui reconstituent les structures
rencontrées sur des sites réels : connexion, inscription, changement de mot de
passe, paiement, adresse et formulaires sans rapport. Les marques, textes
complets et ressources distantes ont été retirés ; les hôtes de test utilisent
`.test`.

Le corpus ne teste pas le réseau, les stores ni le rendu visuel : il mesure la
détection de champs de `extension/detect.ts` dans JSDOM. Les parcours complets
de l’extension restent couverts par `scripts/smoke-extension.mjs` et les specs
Playwright.

## Contenu

- `pages/*.html` : 50 pages autonomes, sans script ni requête externe.
- `expected/*.expected.json` : comportement attendu pour chaque page.
- `baseline.json` : taux de référence, revu manuellement après chaque
  amélioration du détecteur.

| Catégorie | Pages | Attendu |
| --- | ---: | --- |
| `login` | 16 | `login` |
| `signup` | 7 | `signup` |
| `change` | 5 | `signup` (nouveau mot de passe et confirmation) |
| `card` | 6 | `card` |
| `identity` | 6 | `identity` |
| `negative` | 10 | `null` |

Les champs ciblés portent un attribut neutre `data-corpus-ref`. Cet attribut
n’est jamais lu par le détecteur : les pages ne doivent pas utiliser d’`id`,
de `name` ou de `placeholder` artificiels pour forcer un résultat.

## Schéma d’une attente

```json
{
  "schema": 1,
  "case": "login-autocomplete-basic",
  "category": "login",
  "environments": ["jsdom"],
  "expected": {
    "kind": "login",
    "fields": {
      "username": "email",
      "password": "password",
      "otp": null
    },
    "visible": ["email", "password"],
    "hidden": []
  }
}
```

- `kind` vaut `login`, `signup`, `card`, `identity` ou `null`.
- `fields` associe chaque propriété du type détecté à une référence, ou `null`.
- `visible` et `hidden` vérifient `isVisible` sur des champs de la page.
- `environments` indique les moteurs applicables. Toutes les pages actuelles
  sont statiques et s’exécutent dans JSDOM.

## Ajouter un cas

1. Créer `pages/mon-cas.html` en conservant une structure réaliste.
2. Créer `expected/mon-cas.expected.json` avec le comportement **visé**, jamais
   en recopiant la sortie du détecteur.
3. Vérifier les références : chaque `data-corpus-ref` doit être unique dans la
   page et présent dans `fields`, `visible` ou `hidden`.
4. Lancer `bun run test:corpus`.
5. Si le taux progresse, mettre à jour `baseline.json` après revue. Une baisse
   fait échouer la CI.

## Limites connues

- Le Shadow DOM, les iframes et les formulaires créés après un délai ne sont
  pas encore représentés : le détecteur travaille sur un `Document` unique et
  l’injection `allFrames` couvre les iframes.
- JSDOM ne calcule pas la mise en page. La visibilité est testée avec
  `hidden`, `aria-hidden`, `display`, `visibility` et `opacity`.
- L’échantillon Playwright dédié au corpus reste à ajouter ; le smoke de
  l’extension couvre déjà un parcours de connexion réel.
