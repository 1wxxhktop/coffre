# Boucle de développement rapide

Objectif : tester une fonctionnalité en **quelques secondes ou minutes**, sans
attendre la CI complète. La CI reste la validation finale ; elle ne doit pas
être dans la boucle d’édition.

## 1. Tests unitaires

```bash
bun run test:watch                 # relance les tests modifiés
bun run test:changed               # une passe sur les tests impactés
bunx vitest run src/lib/ma-fonction.test.ts
```

`test:watch` est la boucle principale pour `src/lib`, les providers et les
utilitaires. `test:coverage` est réservé à la vérification avant PR : il ajoute
le calcul de couverture et vérifie les seuils.

## 2. Tests e2e ciblés

Installer **Chromium seulement** (suffisant pour la boucle locale, beaucoup
plus léger que Chromium + WebKit) :

```bash
bunx playwright install chromium
```

Puis lancer uniquement le parcours concerné :

```bash
bun run test:e2e:one e2e/ma-fonction.spec.ts
bun run test:e2e:one e2e/ma-fonction.spec.ts --headed
bun run test:e2e:ui                # mode interactif Playwright
```

Avant un push, un smoke court :

```bash
bun run test:e2e:smoke
```

Il couvre l’authentification, le coffre, les types d’éléments et la corbeille.
La suite complète reste exécutée par la CI.

## 3. Test manuel

```bash
bun run dev
```

Playwright démarre aussi Vite automatiquement lorsqu’on lance un parcours
e2e : inutile de garder un serveur séparé pour les tests.

## 4. Avant un push

Le minimum utile, en dehors de la CI :

```bash
bun run typecheck
bun run lint
bun run test
```

Pour une PR qui touche le stockage, la crypto ou un format :

```bash
bun run test:coverage
bun run version:check
```

## 5. Rust

La première compilation est longue ; ensuite Cargo est incrémental :

```bash
cargo check --manifest-path src-tauri/Cargo.toml -p coffre-core
cargo test --manifest-path src-tauri/Cargo.toml -p coffre-core mon_filtre
```

Éviter `bun run clean:all` avant une session Rust : il supprime
`src-tauri/target`. `bun run clean` conserve la cible et `release/`.

## 6. Travailler pendant que la CI tourne

- Ouvrir une **PR en brouillon** dès le premier commit.
- Continuer sur une autre branche : la CI est parallèle par branche.
- Ne pas relancer la CI à chaque micro-commit : pousser quand un lot est
  cohérent.
- Utiliser le label `full-ci` (ou la CI de `main`) pour la validation lourde.

## 7. Récapitulatif

| Besoin | Commande | Ordre de grandeur |
| --- | --- | --- |
| Boucle unitaire | `bun run test:watch` | secondes |
| Un fichier unitaire | `bunx vitest run src/lib/x.test.ts` | secondes |
| Un parcours e2e | `bun run test:e2e:one e2e/x.spec.ts` | 1-2 min |
| Smoke e2e | `bun run test:e2e:smoke` | quelques minutes |
| Gate PR complet | CI | ~5-6 min après sharding |
| Suite e2e complète | CI `main` / label `full-ci` | ~9 min Chromium, ~18 min WebKit avant sharding |

Le sharding Playwright divise la CI e2e en quatre jobs par navigateur ; la
boucle locale, elle, ne lance que ce qui est utile.
