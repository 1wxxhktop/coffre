# Politique de versioning de Coffre

**Date :** 11 novembre 2026  
**Version de référence :** 0.14.2  
**Portée :** version produit, format `.coffre`, manifeste d’intégrité, protocoles
locaux et stockage navigateur.

Ce document définit ce qui change quand une version change, ce qui reste
compatible et ce que l’utilisateur doit faire lors d’une mise à jour. Il est la
référence pour les releases et pour `scripts/check-versions.mjs`.

---

## 1. Principes

- **Une seule version produit** pour l’application web/PWA, la coque Tauri,
  l’extension, le CLI, l’agent SSH, le FFI et les crates Rust.
- **Chaque couche a sa propre version** : format de fichier, manifeste,
  protocoles, clés de stockage local. Une version produit ne les remplace pas.
- **Aucun changement silencieux.** Toute rupture de compatibilité est annoncée
  dans `CHANGELOG.md`, dans les notes de release et, si nécessaire, dans
  l’interface.
- **En phase 0.x, une rupture est une version mineure** (`0.13.0 → 0.14.0`).
  Un correctif purement compatible reste un patch (`0.14.1`).
- **Lecture large, écriture étroite.** Une version récente lit les anciens
  formats ; elle n’écrit que le format courant.
- **Les anciennes applications ne doivent jamais corrompre un fichier récent.**
  Si elles ne peuvent pas vérifier une nouveauté, elles ouvrent en lecture seule
  ou refusent explicitement le fichier.

---

## 2. Versions actuelles

| Élément | Version | Emplacement |
| --- | --- | --- |
| Application | `0.14.2` | `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json` |
| Extension | `0.14.2` | `extension/public/manifest.json` |
| Crates | `0.14.2` | `src-tauri/crates/*/Cargo.toml` |
| Format `.coffre` | `4` | `VAULT_FILE_VERSION`, `format.rs` |
| Manifeste d’intégrité | `3` (lecture `3`, `2`, `1`) | `VAULT_MANIFEST_VERSION`, `format.rs` |
| Pont natif | `2` (0.14) | `BRIDGE_PROTOCOL_VERSION` |
| Extension ↔ application | `2` (0.14) | `EXTENSION_BRIDGE_VERSION` |
| LAN | `2` (0.14) | `LAN_PROTOCOL_VERSION` |
| Bundle partagé | `1` | `format: 'coffre-shared-vault'` |

> Le manifeste `3` est introduit par le correctif de sécurité `AUD-01`. Il
> couvre l’identité publique complète des contacts d’urgence. Les protocoles
> passent à `2` avec le lot Tauri/extension de la release `0.14.0`.

---

## 3. Politique par couche

### 3.1 Version produit (SemVer 0.x)

- **Patch** `0.14.x` : corrections sans changement de format, de manifeste ou
  de protocole. Un fichier produit par `0.14.1` reste lisible par `0.14.0`.
- **Mineure** `0.14.0`, `0.15.0` : changement de manifeste, de protocole ou de
  format, même si la lecture des anciens fichiers reste assurée. C’est le cas
  des releases de sécurité qui durcissent un contrat.
- **Majeure** `1.0.0` : format et protocoles stables, politique de support
  écrite, audit externe réalisé.
- Les préversions suivent SemVer : `0.14.0-beta.1 < 0.14.0`.
- Le tag Git `vX.Y.Z` doit correspondre exactement à la version produit.
  `bun run version:check` vérifie cette cohérence avant publication.

### 3.2 Format `.coffre`

- **0.14.0 reste en format `4`.** Les correctifs P0/P1 ne créent pas de champ
  obligatoire : le manifeste couvre davantage de données, mais la structure du
  fichier ne change pas.
- **0.15.0 passera en format `5`** pour les nouvelles pierres tombales
  (pièces jointes, historique du générateur, clés d’alias) et les éventuels
  champs non ignorables.
- Une version lit tous les formats qu’elle connaît (`v1` à `v5` selon la
  version) et n’écrit que son format courant.
- Un fichier dont le format est **supérieur** à celui de l’application est
  refusé ou ouvert en lecture seule, jamais migré à l’aveugle.
- Une dégradation `v4 → v3` avec perte des champs de sécurité est refusée
  lorsque l’état local connaît déjà une révision `v4`.

### 3.3 Manifeste d’intégrité

- Le manifeste `3` couvre l’identité publique complète de chaque contact
  d’urgence : `encryptionPublicKey`, `signingPublicKey`, `fingerprint` et
  l’enveloppe scellée.
- **Écriture :** manifeste `3` à partir de `0.14.0`.
- **Lecture :** essayer `3`, puis `2`, puis `1`. Un fichier ancien reste
  ouvrable et est réécrit en manifeste `3` à la première mutation signée.
- **Ancienne application + manifeste `3` :** le MAC ne correspond pas. Le
  fichier est ouvert en lecture seule, avec un avertissement explicite. Aucune
  écriture n’est acceptée.
- **Fichier ancien avec accès d’urgence :** l’application vérifie que
  l’empreinte correspond aux clés publiques avant tout changement de mot de
  passe ou récupération. Une incohérence bloque le reseal ; l’accès d’urgence
  doit être reconfiguré.
- Le domaine AAD reste `coffre:v1:*` : la cryptographie des enveloppes ne
  change pas, seule la couverture d’intégrité s’étend.

### 3.4 Protocoles locaux

Trois protocoles indépendants, versionnés séparément :

| Protocole | Constante | Version 0.13 | Version 0.14 |
| --- | --- | --- | --- |
| Pont natif | `BRIDGE_PROTOCOL_VERSION` | `1` | `2` |
| Extension ↔ application | `EXTENSION_BRIDGE_VERSION` | `1` | `2` |
| LAN | `LAN_PROTOCOL_VERSION` | `1` | `2` |

- Un changement de trame, d’authentification ou de chiffrement impose un bump.
- Les versions `2` ne sont **pas** rétrocompatibles avec `0.13`. L’application
  et l’extension doivent être mises à jour ensemble ; deux appareils LAN doivent
  utiliser la même version.
- Une version inconnue est refusée avec un message actionnable (« mettez à jour
  Coffre sur cet appareil »), jamais ignorée.
- Le bundle partagé reste en version `1` tant qu’aucun champ obligatoire n’est
  ajouté. Un futur bundle `2` suivra la même règle : lecture des anciens,
  écriture du courant, refus explicite des versions futures.

### 3.5 Stockage local et migrations

- Les clés `localStorage` et IndexedDB sont versionnées (`:v1`, `v1`, etc.).
  Toute modification de forme impose un nouveau suffixe et une migration
  idempotente.
- `state.json` natif doit porter une version explicite avant toute migration.
- Une migration ne doit jamais supprimer la source avant que la cible ait été
  écrite, relue et vérifiée.
- Les migrations sont couvertes par des tests : ancienne clé → nouvelle clé,
  ancien IndexedDB → stockage natif, ancien état de synchronisation.

---

## 4. Matrice de compatibilité

### 4.1 Application et fichier

| Application | Lit `v1`–`v3` | Lit `v4` manifeste `1/2` | Lit `v4` manifeste `3` | Écrit |
| --- | --- | --- | --- | --- |
| `0.13.x` | Oui | Oui | Non → lecture seule | `v4`, manifeste `2` |
| `0.14.x` | Oui | Oui | Oui | `v4`, manifeste `3` |
| `0.15.x` | Oui | Oui | Oui | `v5`, manifeste `3` |

### 4.2 Protocoles

| Application | Pont `1` | Pont `2` | Extension `1` | Extension `2` | LAN `1` | LAN `2` |
| --- | --- | --- | --- | --- | --- | --- |
| `0.13.x` | Oui | Non | Oui | Non | Oui | Non |
| `0.14.x` | Non | Oui | Non | Oui | Non | Oui |

Le refus est explicite : pas de repli silencieux, pas de trame partiellement
comprise.

---

## 5. Planning de release

| Release | Contenu | Format | Manifeste | Protocoles |
| --- | --- | --- | --- | --- |
| `0.13.1` | Correctifs purement compatibles, si isolables | `4` | `2` | `1` |
| **`0.14.0`** | **P0 + P1** : urgence, LAN, blobs, verrouillage, mode voyage, extension | `4` | `3` | `2` |
| `0.14.x` | P2 sans changement de format | `4` | `3` | `2` |
| `0.15.0` | Tombstones, format `5`, bundle éventuel `2` | `5` | `3` | `2` |
| `1.0.0` | Après audit externe et stabilisation | `5` | `3` | `2` |

Le P0 n’est pas publié en `0.13.1` : le manifeste `3` est déjà une rupture de
contrat, donc la release de sécurité est assumée en `0.14.0`.

---

## 6. Procédure de mise à jour multi-appareils

1. Exporter une sauvegarde `.coffre` vérifiée avant la mise à jour.
2. Mettre à jour **tous** les appareils et l’extension avant la première
   synchronisation.
3. Ne pas synchroniser un appareil `0.13` avec un fichier écrit par `0.14`.
   L’ancien appareil ouvrirait le fichier en lecture seule et refuserait les
   écritures.
4. En cas de retour arrière, restaurer la sauvegarde exportée à l’étape 1.
   Un fichier manifeste `3` ne redevient pas silencieusement un fichier
   manifeste `2`.
5. Pour le LAN, vérifier que les deux appareils affichent la même version avant
   l’appairage.

---

## 7. Dépréciation et support

- La version mineure précédente reste supportée pour la lecture pendant au
  moins une release mineure.
- Les protocoles et formats dépréciés sont annoncés une release à l’avance,
  sauf correctif de sécurité critique.
- Une suppression de compatibilité est documentée dans `CHANGELOG.md` avec la
  version, la date et l’action utilisateur requise.
- Les fixtures `test-vectors/` conservent au moins un exemplaire de chaque
  format et manifeste supporté.

---

## 8. Vérification automatique

`bun run version:check` (`scripts/check-versions.mjs`) vérifie :

- l’égalité des versions produit : `package.json`, `tauri.conf.json`,
  `extension/public/manifest.json`, crates Rust ;
- l’égalité des constantes de format et de manifeste entre TypeScript et Rust ;
- la présence et la cohérence des constantes de protocole ;
- la cohérence de la politique cible (format `4`, manifeste `3` en `0.14`).

Les tests de compatibilité couvrent en plus :

- la lecture des manifestes `1`, `2` et `3` ;
- le refus en lecture seule d’un fichier manifeste `3` par l’ancien calcul ;
- la vérification des vecteurs croisés TypeScript ↔ Rust ;
- le refus explicite des protocoles inconnus.

---

*Toute modification de ce document doit être accompagnée d’une mise à jour de
`scripts/check-versions.mjs` et des tests de compatibilité.*
