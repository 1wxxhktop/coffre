## Objet

<!-- Problème, régression ou fonctionnalité. Lien vers le plan ou l’audit si applicable. -->

## Changements

-

## Vérifications

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run test:coverage`
- [ ] `bun run test:e2e`
- [ ] `bun run build`
- [ ] `bun run extension:build`
- [ ] `bun run version:check`
- [ ] `cargo fmt --all -- --check`
- [ ] `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test --workspace --lib`
- [ ] Vérification manuelle des parcours non couverts (préciser ci-dessous)

## Sécurité et compatibilité

- [ ] Aucun nouvel appel réseau, ou fonction désactivée par défaut et documentée
- [ ] Aucun secret journalisé, stocké hors du coffre ou placé dans une URL
- [ ] Format `.coffre` inchangé, ou migration + fixtures + vecteurs Rust
- [ ] Manifeste/protocoles inchangés, ou bump documenté dans `docs/VERSIONING.md`
- [ ] `CHANGELOG.md`, `README.md`, `docs/SECURITY.md` et traductions à jour si nécessaire

## Non vérifié / à tester à la main

<!-- Plateformes, matériel, scénarios manuels. Écrire « aucun » si tout est couvert. -->

## Taille de la PR

<!-- Si la PR dépasse ~800 lignes modifiées, expliquer pourquoi elle n’est pas découpée. -->
