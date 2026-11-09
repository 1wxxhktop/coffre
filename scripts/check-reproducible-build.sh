#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}"
TMP1="$(mktemp -d)"
TMP2="$(mktemp -d)"
trap 'rm -rf "$TMP1" "$TMP2"' EXIT

rm -rf dist dist-extension node_modules/.vite
bun run build
bun run extension:build
cp -R dist "$TMP1/dist"
cp -R dist-extension "$TMP1/dist-extension"

rm -rf dist dist-extension node_modules/.vite
bun run build
bun run extension:build
cp -R dist "$TMP2/dist"
cp -R dist-extension "$TMP2/dist-extension"

diff -ru "$TMP1" "$TMP2"
echo "Builds Web et extension reproductibles."
