#!/usr/bin/env bash
# Vérifie que deux compilations du bundle macOS produisent les mêmes octets.
#
# Le front-end est construit une fois, puis le bundle .app est assemblé deux
# fois. Entre les deux, les artefacts de la caisse applicative sont supprimés
# pour forcer une recompilation et un nouveau lien. Les dépendances Cargo
# restent en cache : la toolchain et le lockfile sont épinglés, et le front-end
# est déjà couvert par `check-reproducible-build.sh`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Ce contrôle de reproductibilité desktop nécessite macOS." >&2
  exit 1
fi

export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}"
export CARGO_INCREMENTAL=0

TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"
APP="$TARGET_DIR/release/bundle/macos/Coffre.app"
TMP1="$(mktemp -d)"
TMP2="$(mktemp -d)"
trap 'rm -rf "$TMP1" "$TMP2"' EXIT

# Le front-end est déjà construit de façon reproductible par le script Web ;
# on le construit une seule fois ici pour que les deux bundles embarquent
# exactement les mêmes fichiers.
echo "Construction du front-end…"
bun run build

# Tauri relancerait `beforeBuildCommand` à chaque bundle : on le neutralise
# pour comparer uniquement la compilation Rust, la signature ad hoc et
# l’assemblage du .app.
TAURI_CONFIG='{"build":{"beforeBuildCommand":""}}'

echo "Premier bundle…"
bun run tauri build --bundles app --config "$TAURI_CONFIG"
cp -R "$APP" "$TMP1/Coffre.app"

echo "Recompilation de la caisse applicative…"
rm -rf "$APP"
rm -f "$TARGET_DIR/release/coffre"
rm -f "$TARGET_DIR"/release/deps/coffre-* "$TARGET_DIR"/release/deps/libcoffre_lib-*

echo "Second bundle…"
bun run tauri build --bundles app --config "$TAURI_CONFIG"
cp -R "$APP" "$TMP2/Coffre.app"

diff -r "$TMP1/Coffre.app" "$TMP2/Coffre.app"
cmp "$TMP1/Coffre.app/Contents/MacOS/coffre" "$TMP2/Coffre.app/Contents/MacOS/coffre"
echo "Bundle desktop macOS reproductible."
