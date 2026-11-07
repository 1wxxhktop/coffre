#!/usr/bin/env bash
# Build macOS signé et notarié. Requiert un certificat Developer ID et les
# variables Apple attendues par Tauri.
set -euo pipefail

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "APPLE_SIGNING_IDENTITY est requis (Developer ID Application)." >&2
  exit 1
fi

bun run version:check
bun run desktop:build

APP="src-tauri/target/release/bundle/macos/Coffre.app"
DMG_DIR="src-tauri/target/release/bundle/dmg"

codesign --verify --deep --strict "$APP"
echo "Signature vérifiée : $APP"

if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  echo "Tauri a notarié le bundle via APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID."
else
  echo "Notarisation non configurée : définissez APPLE_ID, APPLE_PASSWORD et APPLE_TEAM_ID." >&2
fi

ls -lh "$DMG_DIR"/*.dmg
