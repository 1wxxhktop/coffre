#!/usr/bin/env bash
# Construit CoffreCore.xcframework pour les extensions macOS (S2).
#
# Ce script tourne uniquement en local sur un Mac avec Xcode ; il n’est pas
# appelé par la CI, conformément au quota GitHub Actions. Les bibliothèques
# statiques et les bindings Swift générés ne sont pas versionnés.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-$ROOT/build/CoffreCore}"
TARGETS=(aarch64-apple-darwin x86_64-apple-darwin)

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild est requis (Xcode Command Line Tools)." >&2
  exit 1
fi

rustup target add "${TARGETS[@]}" >/dev/null

for target in "${TARGETS[@]}"; do
  cargo build \
    --manifest-path src-tauri/Cargo.toml \
    -p coffre-core-ffi \
    --release \
    --target "$target"
done

mkdir -p "$OUT/Headers" "$OUT/Swift"
case "$(uname -m)" in
  arm64) HOST_TARGET=aarch64-apple-darwin ;;
  x86_64) HOST_TARGET=x86_64-apple-darwin ;;
  *) echo "Architecture hôte non prise en charge : $(uname -m)" >&2; exit 1 ;;
esac

rm -rf "$OUT/bindings"
(
  cd src-tauri
  cargo run \
    -p coffre-core-ffi \
    --bin uniffi-bindgen \
    -- generate \
    --library "target/$HOST_TARGET/release/libcoffre_core_ffi.dylib" \
    --language swift \
    --out-dir "$OUT/bindings"
)

cp "$OUT/bindings"/*.swift "$OUT/Swift/"
cp "$OUT/bindings"/*.h "$OUT/Headers/"
if compgen -G "$OUT/bindings/*.modulemap" >/dev/null; then
  cp "$OUT/bindings"/*.modulemap "$OUT/Headers/module.modulemap"
fi

rm -rf "$OUT/CoffreCore.xcframework"
xcodebuild -create-xcframework \
  -library "src-tauri/target/aarch64-apple-darwin/release/libcoffre_core_ffi.a" \
  -headers "$OUT/Headers" \
  -library "src-tauri/target/x86_64-apple-darwin/release/libcoffre_core_ffi.a" \
  -headers "$OUT/Headers" \
  -output "$OUT/CoffreCore.xcframework"

echo "CoffreCore.xcframework : $OUT/CoffreCore.xcframework"
echo "Bindings Swift : $OUT/Swift/"
