#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/sbom}"
cd "$ROOT"
mkdir -p "$OUT"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}"

for crate in \
  src-tauri \
  src-tauri/crates/coffre-core \
  src-tauri/crates/coffre-core-ffi \
  src-tauri/crates/coffre-cli \
  src-tauri/crates/coffre-ssh-agent
do
  rm -f "$crate"/*.cdx.json
  (
    cd "$crate"
    cargo cyclonedx --format json --describe crate >/dev/null
  )
  for file in "$crate"/*.cdx.json; do
    [ -e "$file" ] || continue
    name="$(basename "$crate")"
    mv "$file" "$OUT/rust-$name.cdx.json"
  done
done

env -u npm_execpath ./node_modules/.bin/cyclonedx-npm \
  --ignore-npm-errors --output-reproducible \
  --output-format JSON --output-file "$OUT/web.cdx.json" >/dev/null
find src-tauri -name "*.cdx.json" -delete
echo "SBOM générés dans $OUT"
