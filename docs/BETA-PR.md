# Bêta automatique par PR

Chaque PR interne publie automatiquement une **bêta macOS** dans le canal bêta.
Elle sert à tester la fonctionnalité depuis l’application installée, sans
attendre la suite complète ni créer une release locale.

## Ce qui tourne sur une PR normale

Le workflow **Bêta PR** exécute uniquement :

- `bun run version:check` ;
- `bun run typecheck` ;
- `bun run lint` ;
- `bun run test` ;
- la compilation du bundle macOS arm64 et la publication de la bêta.

La suite complète (Playwright Chromium/WebKit, Rust, `coffre-core` macOS et
Windows, smoke extension, desktop trois OS, SBOM, build reproductible) tourne :

- sur chaque push vers `main` ;
- sur une PR portant le label **`full-ci`** ou **`stable`** ;
- à la demande (`workflow_dispatch`) ;
- dans `release.yml` avant une release stable.

## Version de la bêta

Le dépôt garde la version stable (`package.json`, `Cargo.toml`, etc.). La bêta
reçoit une version **calculée au build** :

```text
<major>.<minor+1>.0-beta.<numéro de run>.<tentative>
```

Exemple : depuis `0.14.2`, la bêta est `0.15.0-beta.123.1`. Elle est injectée :

- dans la configuration Tauri (`version`) ;
- dans `__APP_VERSION__` via `COFFRE_BUILD_VERSION` ;
- dans `latest.json`.

Elle n’est pas commitée : pas de conflit de version entre PR, et
`bun run version:check` reste valable sur le dépôt.

L’ordre SemVer garantit :

- `0.15.0-beta.123.1 > 0.14.2` → l’application 0.14.2 la propose ;
- `0.15.0-beta.124.1 > 0.15.0-beta.123.1` → un nouveau push remplace l’ancienne ;
- `0.15.0 > 0.15.0-beta.124.1` → la stable 0.15.0 remplace la bêta.

## Comment tester depuis l’application

1. Installer au préalable une version 0.14.2 ou plus récente.
2. Dans Coffre : **Réglages → Mises à jour**.
3. Choisir le canal **Bêta (préversions)**.
4. Cliquer sur **Rechercher maintenant** (ou activer une recherche
   automatique).
5. La version `0.15.0-beta.<run>.<tentative>` doit être proposée ; l’installer.

Le coffre est verrouillé et les écritures terminées avant le redémarrage. La
signature minisign du paquet est vérifiée par l’application.

## Artefacts publiés

La release technique `canal-beta` contient toujours trois fichiers, écrasés à
chaque bêta :

- `Coffre_beta_aarch64.app.tar.gz` ;
- `Coffre_beta_aarch64.app.tar.gz.sig` ;
- `latest.json`.

Une seule bêta est donc disponible : la dernière publiée. Aucune accumulation
d’anciennes versions.

Manifeste :

```text
https://github.com/1wxxhktop/coffre/releases/download/canal-beta/latest.json
```

Contrôle rapide :

```bash
curl -fsSL https://github.com/1wxxhktop/coffre/releases/download/canal-beta/latest.json
```

## Passer sur le canal stable

1. Ajouter le label **`stable`** à la PR (ou lancer la CI complète à la main).
2. Attendre les suites complètes : Playwright, Rust, desktop, SBOM,
   reproductibilité.
3. Fusionner.
4. Préparer la version stable (`bun run version:check`, `CHANGELOG.md`), taguer
   et laisser `release.yml` refaire toute la gate avant signature.
5. Publier avec `publish-update.yml`.

La stable devient `latest` ; le canal bêta bascule aussi dessus puisqu’elle est
plus récente que la dernière bêta.

## Limites

- Publication automatique réservée aux **PR du dépôt** : les secrets de
  signature ne sont pas disponibles pour les forks. Une PR de fork doit être
  recréée sur une branche interne pour produire une bêta.
- Bêta **macOS arm64** uniquement pour l’instant. Une bêta Intel ou Windows
  demanderait une cible et un manifeste supplémentaires.
- La bêta est signée ad hoc (pas de Developer ID/notarisation). L’installation
  par la mise à jour intégrée fonctionne, mais une première installation
  manuelle reste soumise à Gatekeeper.
- Une PR qui ne compile pas ne publie rien : le workflow échoue avant
  l’upload.
