# Suivi de remédiation — audit du 11 novembre 2026

**Audit source :** [`AUDIT-2026-11-11.md`](AUDIT-2026-11-11.md), Coffre `0.12.0`,
commit `9b06689`.  
**Release de sécurité :** `0.14.0` — manifeste `3`, protocoles pont/extension/LAN
`2`, format `.coffre` maintenu en `v4`.  
**Politique :** [`VERSIONING.md`](VERSIONING.md).

La 0.13.0 ayant été publiée avant la fin de la remédiation, les changements de
manifeste et de protocoles sortent en 0.14.0 (rupture mineure en phase 0.x). Le
format `v5` est reporté à la 0.15.0.

## Lots empilés

| Lot | PR | Périmètre principal |
| --- | --- | --- |
| 0 | [#60](https://github.com/1wxxhktop/coffre/pull/60) | AUD-01, manifeste 3, politique de versioning, rapport d’audit |
| 1 | [#61](https://github.com/1wxxhktop/coffre/pull/61) | Sync, partage, bundles, rôles, blobs, fusion, rotation |
| 2 | [#62](https://github.com/1wxxhktop/coffre/pull/62) | Tauri, LAN Noise v2, blobs natifs, auto-type, FFI/SSH, CSP, noms Windows |
| 3 | [#63](https://github.com/1wxxhktop/coffre/pull/63) | Verrouillage, époques, presse-papiers, mode voyage, exports, reset local |
| 4 | [#64](https://github.com/1wxxhktop/coffre/pull/64) | Extension, pont web, menu, passkeys, autofill, pending saves, protocoles 2 |
| 5 | [#65](https://github.com/1wxxhktop/coffre/pull/65) | CI/release : actions épinglées, gate complet, bêta fail-closed, lockfile, DMG, `.gitignore` |
| 6 | [#67](https://github.com/1wxxhktop/coffre/pull/67) | Imports/exports, domaines, AppManifest, rôles, TOTP, biométrie, provenance, SBOM, i18n, accessibilité, release 0.14.0 |

Les détails constat par constat figurent dans le corps de chaque PR et dans le
`CHANGELOG.md`.

## Constats structurants couverts

- **AUD-01** : identité publique d’urgence couverte par le MAC, empreinte
  vérifiée avant reseal, vecteurs TS/Rust.
- **Transport LAN** : protocole 2, trames post-handshake chiffrées et
  authentifiées par Noise, anciennes versions refusées.
- **Blobs** : dialogues natifs, aucun chemin arbitraire depuis la WebView,
  fichiers temporaires `0600`, nettoyage et plafonds.
- **Verrouillage** : barrière d’époque sur les opérations longues, sidecars
  effacés, presse-papiers et mode voyage fail-safe.
- **Partage/sync** : validation complète des bundles, administrateur épinglé,
  rôles lecture, fusion des enveloppes, refus de rotation non prise en charge.
- **Extension** : hôte obligatoire, senders filtrés, jetons de menu, révocation
  au verrouillage, confirmation passkey, contrôle d’origine dans le document.
- **Tauri** : AppManifest des 67 commandes, origines exactes, auto-type refusé
  dans la fenêtre Coffre, agent SSH/FFI en lecture seule sur MAC invalide.
- **Imports/exports** : neutralisation CSV, bornes KDBX/1PUX, ré-authentification
  des exports en clair.
- **Domaines** : correspondance exacte, seule exception `www` ↔ domaine nu.
- **Chaîne de release** : actions épinglées par SHA, gate fmt/clippy/tests/deny/
  audit, attestation de provenance, SBOM complété et vérifié.
- **Accessibilité** : notifications hors `#root`, focus des modales imbriquées,
  palette inerte, menu mobile stable.
- **Anglais** : libellés `tt()` couverts et vérifiés par `check-i18n.mjs`.

## Vérifications de la pile

- `bun run typecheck`, `bun run lint`, `bun run build`, `bun run version:check`.
- 785 tests unitaires / 99 fichiers.
- Parcours Playwright Chromium et WebKit, smoke extension complet.
- `cargo fmt --check`, `cargo clippy -D warnings`, tests cœur/FFI/CLI/SSH.
- Vecteurs croisés TypeScript ↔ Rust (domaines, manifeste 3, signatures).
- Génération et contrôle des SBOM.

## Reste hors code

- Audit de sécurité externe indépendant.
- Validation réelle VoiceOver/NVDA, zoom 200 %, tactile.
- Validation Windows/Linux et macOS Intel, notarisation Developer ID.
- Migration PSL complète et stabilisation `ssh-key`.
