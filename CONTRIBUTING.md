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
bun run test
bun run test:e2e
bun run build
bun run extension:build
bun run version:check
```

Pour le desktop :

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --lib
cargo audit
```

## Règles

- Interface et messages en français.
- Aucun appel réseau, aucune télémétrie, aucune dépendance distante à l’exécution.
- Toute modification du format `.coffre` doit rester rétrocompatible ou être
  accompagnée d’une migration et de fixtures.
- Les secrets ne doivent jamais être journalisés ni écrits en clair.
- Ajoutez un test pour chaque correction de sécurité ou de format.
- Licence GPL-3.0-only ; les contributions sont acceptées sous cette licence.
