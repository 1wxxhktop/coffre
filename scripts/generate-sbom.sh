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
bun scripts/complete-web-sbom.mjs "$OUT/web.cdx.json"
bun scripts/check-sbom.mjs "$OUT"
find src-tauri -name "*.cdx.json" -delete
(
  cd "$OUT"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum ./*.cdx.json > SHA256SUMS
  else
    shasum -a 256 ./*.cdx.json > SHA256SUMS
  fi
)
echo "SBOM générés dans $OUT"
