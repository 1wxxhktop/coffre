#!/usr/bin/env bash
# Construit, signe, notarie et vérifie une release macOS de Coffre.
#
# Prérequis :
#   - certificat « Developer ID Application » dans le trousseau ;
#   - variables APPLE_SIGNING_IDENTITY et identifiants de notarisation ;
#   - Bun, Rust et les cibles Apple installées (le script les ajoute).
#
# Exemple :
#   APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)" \
#   APPLE_ID="…" APPLE_PASSWORD="mot-de-passe-application" APPLE_TEAM_ID="TEAMID" \
#   ./scripts/release-macos.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET="${COFFRE_TARGET:-universal-apple-darwin}"
TARGET_DIR="src-tauri/target/$TARGET"

fail() {
  echo "Erreur : $*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "commande requise introuvable : $1"
}

need_command bun
need_command cargo
need_command rustup
need_command codesign
need_command security
need_command spctl
need_command xcrun
need_command shasum

[[ -n "${APPLE_SIGNING_IDENTITY:-}" ]] || fail \
  "APPLE_SIGNING_IDENTITY est requis (certificat Developer ID Application)."

if ! security find-identity -v -p codesigning | grep -Fq "$APPLE_SIGNING_IDENTITY"; then
  fail "identité de signature introuvable dans le trousseau : $APPLE_SIGNING_IDENTITY"
fi

if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  NOTARIZATION="Apple ID"
elif [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
  NOTARIZATION="App Store Connect API"
else
  fail "identifiants de notarisation manquants : APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID ou APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH."
fi

if [[ "$TARGET" == universal-apple-darwin ]]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
elif [[ "$TARGET" != "$(rustc -vV | sed -n 's/^host: //p')" ]]; then
  rustup target add "$TARGET"
fi

bun run version:check

echo "Construction de la release macOS ($TARGET)…"
bun run tauri build --target "$TARGET"

APP="$TARGET_DIR/release/bundle/macos/Coffre.app"
DMG_DIR="$TARGET_DIR/release/bundle/dmg"
[[ -d "$APP" ]] || fail "bundle introuvable : $APP"
DMG="$(find "$DMG_DIR" -maxdepth 1 -name '*.dmg' -print -quit)"
[[ -n "$DMG" ]] || fail "DMG introuvable dans $DMG_DIR"

echo "Vérification de la signature et du hardened runtime…"
codesign --verify --deep --strict --verbose=2 "$APP"
SIGN_INFO="$(codesign -dv --verbose=4 "$APP" 2>&1)"
grep -Fq "Authority=Developer ID Application" <<<"$SIGN_INFO" \
  || fail "le bundle n’est pas signé par un certificat Developer ID Application."
grep -Eq 'flags=.*\(runtime\)' <<<"$SIGN_INFO" \
  || fail "le hardened runtime n’est pas activé."
grep -Eq '^TeamIdentifier=[A-Z0-9]+' <<<"$SIGN_INFO" \
  || fail "TeamIdentifier absent : la signature n’est pas une signature Developer ID."

echo "Vérification de la notarisation et de l’agrafage ($NOTARIZATION)…"
xcrun stapler validate "$APP"

if ! xcrun stapler validate "$DMG" >/dev/null 2>&1; then
  echo "Le DMG n’est pas encore agrafé ; soumission à Apple…"
  if [[ "$NOTARIZATION" == "Apple ID" ]]; then
    xcrun notarytool submit "$DMG" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait
  else
    xcrun notarytool submit "$DMG" \
      --key "$APPLE_API_KEY_PATH" \
      --key-id "$APPLE_API_KEY" \
      --issuer "$APPLE_API_ISSUER" \
      --wait
  fi
  xcrun stapler staple "$DMG"
fi

xcrun stapler validate "$DMG"
spctl --assess --type execute --verbose=4 "$APP"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG"

(
  cd "$DMG_DIR"
  shasum -a 256 "$(basename "$DMG")" > "$(basename "$DMG").sha256"
)

echo
echo "Release prête :"
echo "  $DMG"
echo "  $DMG.sha256"
echo
cat "$DMG.sha256"
