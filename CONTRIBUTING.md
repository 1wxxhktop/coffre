# Contribuer à Coffre

Coffre est un projet local-first, sans backend ni télémétrie. Les contributions
doivent préserver ces contraintes et la compatibilité du format `.coffre`.

## Installation

```bash
bun install
bun run dev
```

## Vérifications avant une contribution

```bash
bun run typecheck
bun run lint
bun run test:coverage
bun run test:e2e
bun run build
bun run extension:build
bun run version:check
```

`test:coverage` exécute les tests unitaires et vérifie les seuils de couverture
du domaine (`src/lib`). Une baisse sous les seuils fait échouer la CI.

Pour le desktop :

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --lib
cargo audit
```

## Processus de PR

1. Partir du dernier `origin/main` et créer une branche courte
   (`feature/…`, `fix/…`, `docs/…`, `audit/…`).
2. Un lot = une branche = une PR. Découper si la PR dépasse ~800 lignes
   modifiées.
3. Décrire dans la PR ce qui est fait, les vérifications exécutées et ce qui
   reste à tester à la main (le template est fourni).
4. `main` est protégée : les 9 checks CI doivent passer, aucun push direct,
   aucun force-push. Le mainteneur relit et fusionne.
5. Toute correction de sécurité ou de format doit inclure son test de
   non-régression.
6. **Après chaque fusion, mise à jour ou release, nettoyer le poste** (voir
   ci-dessous).

Pour la boucle d’édition, ne pas attendre la CI : voir
[docs/DEV-FAST.md](docs/DEV-FAST.md) (tests ciblés, e2e Chromium, mode UI).

## Nettoyage

Le dossier **`release/` n’est jamais supprimé** : il doit toujours contenir la
dernière version collectée.

Après chaque fusion sur `main` (une fois la CI verte) et après chaque
finalisation de release :

```bash
bun run post-merge
```

Cette commande actualise `release/` avec la dernière CI réussie, vérifie qu’une
seule version est présente, puis nettoie les artefacts de build. Pour ne faire
que la mise à jour :

```bash
bun run release:update
bun run release:status
```

`release:update` télécharge les artefacts de la dernière CI réussie sur `main`
et remplace les versions précédentes : `release/` ne contient qu’une seule
version, pointée par `release/latest`.

Nettoyages ciblés :

- `bun run clean` : builds, tests, couverture, rapports, extension stagée,
  `.DS_Store` ;
- `bun run clean:build` : + cible Rust et caches locales après un build desktop ;
- `bun run clean:all` : + caches globaux Bun/Playwright/Cargo et navigateurs ;
- `bun run clean:worktrees` : worktrees Git propres sous `.claude/worktrees`.

Le script ne supprime **jamais** les sources, les fichiers `.coffre`, les
secrets ni `node_modules` ; si un dossier cible en contient, il est conservé et
signalé. Utiliser `bun run clean -- --dry-run` pour vérifier avant suppression.
Après `clean:all`, réinstaller les navigateurs avec
`bun run test:e2e:install` avant de relancer les parcours Playwright.

## Règles

- Interface et messages en français.
- Aucun appel réseau, aucune télémétrie, aucune dépendance distante à l’exécution.
- Toute modification du format `.coffre` doit rester rétrocompatible ou être
  accompagnée d’une migration et de fixtures.
- Les secrets ne doivent jamais être journalisés ni écrits en clair.
- Ajoutez un test pour chaque correction de sécurité ou de format.
- Licence GPL-3.0-only ; les contributions sont acceptées sous cette licence.
