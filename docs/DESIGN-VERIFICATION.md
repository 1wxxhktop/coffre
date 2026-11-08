# Vérification du lot design D1–D9

Date : 8 novembre 2026. État vérifié le 8 novembre 2026 sur `main`. Ce rapport
accompagne les captures de [`design-captures/`](design-captures/).

## Résultats

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| TypeScript | `bun run typecheck` | OK |
| Lint + jetons | `bun run lint` | OK, 0 erreur ; seuls des avertissements `oxlint` préexistants |
| Jetons seuls | `bun run lint:design` | OK, aucune valeur littérale hors jetons |
| Tests unitaires | `bun run test` | 60 fichiers, 434 tests |
| E2E Chromium + WebKit | `bun run test:e2e` | 118 tests passés, 6 ignorés (124 exécutions) |
| Régression visuelle | `bun run test:visual` | 14 captures, Chromium/macOS, 7 écrans × 2 thèmes |
| Build PWA | `bun run build` | OK |
| Build extension | `bun run extension:build` | OK |
| Versions | `bun run version:check` | 0.8.0 cohérente |
| Rust format | `cargo fmt -- --check` | OK |
| Rust lint | `cargo clippy --all-targets -- -D warnings` | OK |
| Rust tests | `cargo test --lib` + `cargo test -p coffre-core` | 28 tests desktop (1 ignoré) + 12 tests cœur + 1 test FFI + 9 tests CLI + 17 tests agent SSH |
| axe A/AA | `e2e/accessibility.spec.ts` | 0 violation sur les écrans scannés |

## Couverture e2e design

`e2e/design.spec.ts` vérifie :

- l’absence de débordement horizontal et vertical à 1280, 1024, 768 et 375 px, y compris en 480 px de haut ;
- l’inertie et la non-focalisation du menu latéral fermé ;
- le retour contextuel et la barre d’actions mobile ;
- le menu « … » du détail (historique, duplication, suppression) ;
- le thème clair et la couleur d’état de sécurité ;
- la navigation aux flèches dans la liste ;
- le parcours créer en modale → lire et modifier dans le panneau de détail ;
- la génération d’un mot de passe depuis le bandeau de sécurité ;
- le glissement vers la droite pour revenir à la liste ;
- la navigation en pages des réglages sur mobile ;
- la navigation sticky des réglages pendant le défilement du contenu ;
- les captures de régression visuelle optionnelles (`e2e/visual.spec.ts`).

`e2e/layout.spec.ts` vérifie le redimensionnement de la barre latérale et de la
liste, la mémorisation des largeurs après rechargement, le repli en rail
d’icônes, sa persistance, et l’absence de poignées sur mobile.
`e2e/dashboard.spec.ts` vérifie que le tableau de bord est la vue par défaut,
l’ouverture des catégories, des éléments et de la création, l’état du stockage,
ainsi que son comportement mobile sans débordement.

`e2e/accessibility.spec.ts` vérifie en plus les noms accessibles, le piège à
focus des modales, `prefers-reduced-motion` et l’audit axe sur
l’authentification, la liste, le détail, les réglages et le tableau de bord
Sécurité, en sombre et clair, à 1280 et 375 px.

## Captures

- `docs/design-captures/before/` : `main` à `10de4a9`.
- `docs/design-captures/after/` : branche `design/d1-d9`.
- 5 écrans × 2 thèmes × 2 tailles = 20 images avant ; 24 images après avec le tableau de bord.

Les captures ont été relues manuellement. Elles ne constituent pas une
baseline de régression : les rendus de police varient entre macOS et Linux.

## Limites connues

- La vérification manuelle **VoiceOver/NVDA**, le zoom 200 %, le tactile réel
  et Safari/iOS n’ont pas été réalisés dans cet environnement ; l’audit axe
  automatisé et les tests de focus la complètent sans la remplacer. La
  checklist à exécuter est dans
  [`ACCESSIBILITY-MANUAL.md`](ACCESSIBILITY-MANUAL.md).
- La régression visuelle `toHaveScreenshot` est optionnelle (`VISUAL=1`) et
  les baselines versionnées sont spécifiques à macOS/Chromium. Les baselines
  Linux se génèrent avec le workflow manuel **Baselines visuelles Linux**
  (`.github/workflows/visual-baselines.yml`), qui publie les fichiers
  `*-linux.png` en artefact. Il reste à les committer avant d’activer le test
  dans la CI générale.
- Le working tree contient aussi des chantiers en cours (synchronisation,
  pont natif, partage hors ligne, kit d’urgence, échéances). Ils sont verts et
  inclus dans les tests, mais le découpage en PR doit être revu avant fusion :
  les fichiers `VaultApp.tsx`, `ItemDialog.tsx`, `SettingsDialog.tsx`,
  `VaultProvider.tsx`, `vault.ts` et `security.ts` sont partagés entre le
  design et ces fonctionnalités.

## Carte des fichiers design

| Domaine | Fichiers principaux |
| --- | --- |
| Jetons et thèmes | `src/styles/tokens.css`, `light.css`, `index.css` |
| Feuilles | `base.css`, `app.css`, `auth.css`, `item.css`, `settings.css`, `emergency-kit.css`, `offline-share.css` |
| Primitives | `src/components/Menu.tsx`, `src/components/ColumnResizer.tsx`, `src/hooks/useMediaQuery.ts`, `src/hooks/useLayoutPreferences.ts` |
| Détail et édition | `ItemDialog.tsx`, `ItemRow.tsx`, `VaultApp.tsx` |
| Navigation | `Sidebar.tsx`, `AuthScreen.tsx`, `Modal.tsx` |
| Sécurité | `SecurityDialog.tsx`, `src/lib/security.ts` |
| Réglages | `SettingsDialog.tsx` |
| Déplacement entre coffres | `src/lib/vault.ts`, `src/state/VaultProvider.tsx` |
| Contrôle des jetons | `scripts/check-design-tokens.mjs`, `package.json` |
| Tests | `e2e/design.spec.ts`, `e2e/layout.spec.ts`, `e2e/dashboard.spec.ts`, `e2e/accessibility.spec.ts`, `e2e/visual.spec.ts`, adaptations des specs existantes |
| Documentation | `docs/DESIGN.md`, `README.md`, `CHANGELOG.md`, `docs/SECURITY.md` |
