# Captures du plan design

Ces captures accompagnent la PR `design/d1-d9`. Elles comparent l’état de
`main` avant le lot design (HEAD `10de4a9`) à l’état de la branche.

## Contenu

Cinq écrans communs, plus le tableau de bord et les modèles dans l’état
« après » :

| Écran | Fichier |
| --- | --- |
| Authentification | `auth-*.jpg` |
| Liste des éléments | `list-*.jpg` |
| Détail d’un élément | `detail-*.jpg` |
| Réglages | `settings-*.jpg` |
| Tableau de bord Sécurité | `security-*.jpg` |
| Tableau de bord (après uniquement) | `dashboard-*.jpg` |
| Modèles (après, desktop uniquement) | `models-*.jpg` |

Combinaisons : sombre et clair à **1280 × 800**, sombre et clair à
**375 × 812**. Soit 20 captures avant et 26 après.

- `before/` : `main` à `10de4a9`, avant le lot design.
- `after/` : branche `design/d1-d9` avec le système de jetons, le panneau de
  détail unique, les réglages en pages, le tableau de bord Sécurité révisé et
  les barres mobiles.

Les captures sont des JPEG Playwright (qualité 82, Chromium headless). Elles
servent de preuve visuelle, pas de baseline de régression automatique : les
polices et le rendu peuvent varier selon le système.

## Régénérer

Depuis un serveur de prévisualisation du code concerné :

```bash
# Avant, depuis un worktree sur 10de4a9
BASE_URL=http://127.0.0.1:4200 node scripts/capture-design-before.mjs

# Après, depuis la branche design
BASE_URL=http://127.0.0.1:4201 node scripts/capture-design-after.mjs
```

Les scripts créent un coffre de test, ajoutent une connexion faible et
parcourent les cinq écrans. Ils ne contiennent aucun secret réel.
