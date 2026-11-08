# Vecteurs de test croisés

- `rust-v4.coffre.json` est produit par `coffre-core` avec des clés et des
  nonces fixes. Il est relu par `src/lib/coffreCoreVector.test.ts` avec le code
  TypeScript de production.
- Les fichiers `src/lib/__fixtures__/v1..v4.coffre.json` sont produits par le
  code TypeScript historique. Ils sont relus par
  `src-tauri/crates/coffre-core/tests/fixtures.rs`.

Pour régénérer le vecteur Rust :

```bash
cargo run --manifest-path src-tauri/Cargo.toml -p coffre-core \
  --example generate_vector > test-vectors/rust-v4.coffre.json
```

Ne jamais régénérer les fixtures `src/lib/__fixtures__` : elles représentent des
octets historiques.
