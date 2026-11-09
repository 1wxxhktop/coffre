# Vecteurs de test croisés

- `rust-v4.coffre.json` est produit par `coffre-core` avec des clés et des
  nonces fixes. Il est relu par `src/lib/coffreCoreVector.test.ts` avec le code
  TypeScript de production.
- `rust-mutated-v4.coffre.json` est produit en ouvrant le précédent, en créant
  un élément puis en signant en v4. Le même test TypeScript vérifie le nouvel
  élément, les horloges et le MAC.
- Les fichiers `src/lib/__fixtures__/v1..v4.coffre.json` sont produits par le
  code TypeScript historique. Ils sont relus par
  `src-tauri/crates/coffre-core/tests/fixtures.rs`.
- `manifest-v2-sidecars.file.json` et `manifest-v2-sidecars.manifest.json`
  forment un vecteur croisé du manifeste 2 : les sidecars sont sérialisés par
  TypeScript puis relus par Rust, qui doit produire exactement le même JSON
  canonique. Le fichier n’est pas déchiffrable (valeurs scellées fictives).
- `domain-matching.json` contient les cas de correspondance de domaines
  (sous-domaines, IDN, ports, IP, localhost, identifiants d’app). Il est relu
  par `src/lib/domainVectors.test.ts` et
  `src-tauri/crates/coffre-core/tests/domain.rs`.
- `passkeys.json` contient une signature produite par TypeScript et une
  signature produite par Rust pour la même clé de test, ainsi qu’une
  attestation créée par chaque implémentation. Il est relu par
  `src/lib/passkeyVectors.test.ts` et
  `src-tauri/crates/coffre-core/tests/passkey.rs`.

Pour régénérer le vecteur Rust :

```bash
cargo run --manifest-path src-tauri/Cargo.toml -p coffre-core \
  --example generate_vector > test-vectors/rust-v4.coffre.json
cargo run --manifest-path src-tauri/Cargo.toml -p coffre-core \
  --example generate_mutation > test-vectors/rust-mutated-v4.coffre.json
bun test-vectors/generate-sidecars-vector.ts
```

Pour régénérer les signatures Rust de `passkeys.json`, partez du JSON contenant
la clé privée de test et les signatures TypeScript, puis :

```bash
cargo run --manifest-path src-tauri/Cargo.toml -p coffre-core \
  --example generate_passkey_vectors -- entree.json > test-vectors/passkeys.json
```

Ne jamais régénérer les fixtures `src/lib/__fixtures__` : elles représentent des
octets historiques.
