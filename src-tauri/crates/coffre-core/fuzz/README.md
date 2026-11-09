# Fuzzing de `coffre-core`

Ces cibles vérifient que le parseur et la fusion ne paniquent pas sur des
entrées arbitraires. Elles ne doivent jamais être exécutées avec un fichier
réel : les entrées sont générées par libFuzzer.

```bash
cd src-tauri/crates/coffre-core
cargo +nightly fuzz run vault_parse -- -max_total_time=120
cargo +nightly fuzz run merge -- -max_total_time=120
```

La CI hebdomadaire exécute les deux cibles. Les corpus et artefacts locaux ne
sont pas versionnés.
