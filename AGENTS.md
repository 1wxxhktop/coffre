# Travailler sur Coffre — guide pour les agents

Ce fichier s’adresse à tout agent (Claude Code, OpenCode, Codex, Cursor…) qui
reprend le dépôt. Il dit **comment démarrer, comment travailler et comment
finir** une tâche. Les détails sont dans les documents liés ; ne pas les
recopier ici.

Plusieurs agents peuvent travailler **en même temps** sur ce dépôt. Partez
toujours du principe que `main` a bougé depuis votre dernière lecture.

---

## 1. Avant de commencer

1. **Relire l’état réel**, jamais de mémoire :

   ```bash
   git fetch origin main --tags
   git log origin/main --oneline -15
   gh pr list --state open
   gh release list --limit 5
   ```

   La version courante est dans `package.json`. La dernière version publiée
   est la release marquée `Latest`.

2. **Travailler dans un worktree**, jamais directement dans le dossier
   principal : un autre agent peut l’utiliser.

   ```bash
   git worktree add .claude/worktrees/<nom> -b <type>/<sujet> origin/main
   ```

   Types de branche : `feature/`, `fix/`, `docs/`, `perf/`, `audit/`,
   `release/`. Une tâche = une branche = une PR.

3. **Lire avant d’écrire** : [CONTRIBUTING.md](CONTRIBUTING.md) (processus de
   PR, nettoyage, règles), [docs/VERSIONING.md](docs/VERSIONING.md) (quelle
   version pour quel changement), et le plan concerné dans `docs/`
   (`ROADMAP.md`, `PLAN-*.md`).

---

## 2. Règles permanentes

Elles viennent du mainteneur ; elles ne se négocient pas au fil d’une tâche.

- **Aucune ligne d’attribution** dans les commits ni les PR : pas de
  `Co-Authored-By: <agent>`, pas de « Generated with … ». Chaque agent
  ajouterait son compte à la liste des contributeurs.
- **Aucune fusion, aucun tag, aucune publication sans accord explicite** du
  mainteneur pour cette action précise. Une approbation ne vaut que pour ce
  qu’elle nomme.
- **Pas de compte développeur Apple, et aucun achat.** Signature ad hoc
  seulement ; pas de notarisation, pas de magasin d’extensions payant. Le
  travail qui en dépend (AutoFill macOS, passkeys système, Safari, iOS) est
  hors programme.
- **Le mot de passe de la clé de signature des mises à jour** est tapé par le
  mainteneur lui-même ; un agent ne le voit ni ne le manipule jamais.
- **Espace disque limité** : ne pas laisser de cache de build ni de copie de
  release derrière soi (voir § 5).
- **Jamais `git stash` nu** : la pile est partagée entre worktrees. Préférer
  un commit temporaire.
- **Jamais de force-push sur `main`**, jamais de réécriture d’historique sans
  demande explicite.
- Interface et messages **en français** ; aucune télémétrie ; aucun appel
  réseau non désactivé par défaut et documenté.

---

## 3. Pendant le travail

Boucle rapide décrite dans [docs/DEV-FAST.md](docs/DEV-FAST.md) :

```bash
bunx vitest run src/lib/x.test.ts          # un fichier unitaire
bun run test:e2e:one e2e/x.spec.ts         # un parcours, Chromium
bun run typecheck && bun run lint && bun run test   # avant chaque push
```

Pièges déjà rencontrés, à vérifier systématiquement :

| Piège | Garde-fou |
| --- | --- |
| Nouvelle commande Tauri appelée par l’interface mais refusée à l’exécution | La déclarer dans `src-tauri/build.rs`, l’autoriser dans `src-tauri/capabilities/default.json` et l’enregistrer dans `generate_handler!`. `bun run lint` le vérifie (`scripts/check-tauri-commands.mjs`), y compris via une fonction intermédiaire dont le premier paramètre s’appelle `command`. |
| Données liées à la signature de l’app (trousseau macOS) perdues à chaque mise à jour | La signature ad hoc change à chaque version : ne rien stocker dans le trousseau qui doive survivre à une mise à jour, sauf la clé maîtresse (redemandée au déverrouillage). |
| Lignes du CHANGELOG déplacées sous une version déjà publiée après un rebase | Relire `CHANGELOG.md` après chaque rebase : tout ce qui n’est pas publié reste sous **Non publié**. |
| Version incohérente entre `package.json`, `Cargo.toml`, `tauri.conf.json`, manifeste de l’extension | `bun run version:check`. |
| Formatage de fichiers entiers par un outil mal configuré | Pas de Prettier global : le dépôt n’en a pas la configuration. Ne reformater que ses propres lignes. |
| SHA tapé à la main dans une commande | Toujours `git rev-parse HEAD`. |
| Test « vert » qui ne prouve rien (rien n’a tourné, appli non lancée) | Dire explicitement ce qui n’a pas été vérifié, dans la PR et dans le compte rendu. |

---

## 4. Finir une tâche

Une tâche n’est **terminée** que lorsque toutes ces cases sont cochées
(définition complète : [docs/ROADMAP.md § 1.2](docs/ROADMAP.md)) :

1. **Tests** : unitaires pour la logique, e2e ou smoke pour l’interface, Rust
   pour le natif. Un correctif de sécurité ou de format a son test de
   non-régression.
2. **Vérifications locales** (liste exacte dans le
   [modèle de PR](.github/PULL_REQUEST_TEMPLATE.md)) :

   ```bash
   bun run typecheck && bun run lint && bun run test:coverage
   bun run version:check
   cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
   cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
   cargo test --manifest-path src-tauri/Cargo.toml --workspace --lib
   ```

3. **Documentation** : `CHANGELOG.md` (section **Non publié**), `README.md`,
   `docs/SECURITY.md` si la surface change, traductions anglaises
   (`src/lib/i18n-text.ts`, `extension/public/_locales/`).
4. **PR** remplie avec le modèle : ce qui est fait, ce qui a été vérifié, et
   **ce qui ne l’a pas été** (section « Non vérifié »). Une PR qui touche
   l’interface, le natif ou l’extension prend le label **`full-ci`**.
5. **CI verte**. `main` exige `Qualité` et `Bêta macOS` ; la suite complète
   tourne avec `full-ci`/`stable` et sur `main`. Chaque PR publie une bêta
   macOS ([docs/BETA-PR.md](docs/BETA-PR.md)).
6. **Demander l’accord de fusion** au mainteneur. Ne jamais fusionner sans.
7. **Après la fusion** : `bun run post-merge` (actualise `release/`, nettoie),
   puis supprimer sa branche et son worktree.

---

## 5. Releases

Procédure complète : [docs/RELEASE.md](docs/RELEASE.md) et
[docs/VERSIONING.md](docs/VERSIONING.md). En bref :

1. Choisir le numéro selon `VERSIONING.md` (correctif sans changement de
   format ni de protocole → patch ; sinon mineure selon le planning).
2. PR de version : versions produit, `Cargo.lock`
   (`cargo update --workspace`), CHANGELOG daté, README, `VERSIONING.md`.
3. Après accord : fusion, tag annoté `vX.Y.Z` sur le commit de fusion, push
   du tag. `release.yml` construit un **brouillon**.
4. Vérifier le brouillon (fichiers présents, version de `latest.json`,
   contenu du paquet si un changement le touche).
5. Après accord : `gh workflow run publish-update.yml -f tag=vX.Y.Z`, puis
   vérifier que
   `https://github.com/1wxxhktop/coffre/releases/latest/download/latest.json`
   annonce la nouvelle version.
6. `bun run release:update` : le dossier **`release/` à la racine du dépôt**
   contient alors cette seule version. Ne jamais garder de copie ailleurs.

**Une seule release à la fois** : avant de préparer une version, vérifier
qu’aucun autre agent n’en a une en cours (PR `release/…` ouverte, tag récent,
brouillon existant).

---

## 6. Nettoyage

- `bun run clean` après une session, `bun run clean:build` après un build
  desktop local (la cible Rust pèse plusieurs Go par worktree).
- `bun run clean:worktrees` retire les worktrees propres.
- Le dossier `release/` de la racine n’est jamais supprimé.
- Branches : supprimer celle de sa PR une fois fusionnée. Ne pas supprimer
  une branche sans PR sans demander : son contenu peut être unique.

---

## 7. Passer la main

Si la tâche n’est pas finie, laisser l’état lisible pour le suivant :

- tout ce qui compte est **commité et poussé** sur la branche, avec une PR en
  brouillon décrivant ce qui reste ;
- rien d’important dans un stash, un dossier temporaire ou une note locale ;
- la description de la PR liste les étapes restantes et ce qui n’a pas été
  vérifié.
