#!/usr/bin/env bash
# Construit et vérifie une release macOS de Coffre.
#
# Deux modes :
#
#   - ad hoc (par défaut, sans compte Apple) : bundle signé ad hoc
#     (`signingIdentity: "-"`), ni Developer ID ni notarisation. macOS affiche
#     l’avertissement Gatekeeper à la première ouverture (voir docs/RELEASE.md).
#     Les mises à jour automatiques fonctionnent : elles sont signées par la clé
#     de mise à jour de Coffre, indépendante d’Apple.
#
#   - Developer ID (optionnel) : si APPLE_SIGNING_IDENTITY est fourni, avec les
#     identifiants de notarisation, le bundle est signé, notarié et agrafé.
#
# Exemples :
#   ./scripts/release-macos.sh
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
need_command shasum

# Les secrets absents arrivent comme chaînes vides depuis GitHub Actions :
# Tauri les prendrait pour des valeurs. On les retire de l’environnement.
for name in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID \
  APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH APPLE_CERTIFICATE \
  APPLE_CERTIFICATE_PASSWORD TAURI_SIGNING_PRIVATE_KEY \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD COFFRE_UPDATER_PUBKEY; do
  if [[ -z "${!name:-}" ]]; then
    unset "$name"
  fi
done

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  MODE="developer-id"
  need_command security
  need_command spctl
  need_command xcrun
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
else
  MODE="ad-hoc"
  # Aucune notarisation possible sans compte Apple : Tauri ne doit pas tenter.
  unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
  echo "Mode ad hoc : bundle signé ad hoc, sans Developer ID ni notarisation."
fi

if [[ "$TARGET" == universal-apple-darwin ]]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
elif [[ "$TARGET" != "$(rustc -vV | sed -n 's/^host: //p')" ]]; then
  rustup target add "$TARGET"
fi

bun run version:check

# Mises à jour : avec la clé privée de signature (TAURI_SIGNING_PRIVATE_KEY),
# Tauri produit aussi Coffre.app.tar.gz et sa signature minisign. La clé
# publique correspondante (COFFRE_UPDATER_PUBKEY) est intégrée au binaire :
# sans elle, l’application refuserait toute mise à jour.
BUILD_ARGS=(--target "$TARGET")
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  [[ -n "${COFFRE_UPDATER_PUBKEY:-}" ]] || fail \
    "COFFRE_UPDATER_PUBKEY est requis avec TAURI_SIGNING_PRIVATE_KEY (clé publique des mises à jour)."
  # Tauri contrôle aussi la clé publique de tauri.conf.json en produisant le
  # paquet : elle y est vide (le binaire la reçoit par COFFRE_UPDATER_PUBKEY),
  # on la fournit donc dans la configuration du build.
  UPDATER_CONFIG="$(node -e 'console.log(JSON.stringify({
    bundle: { createUpdaterArtifacts: true },
    plugins: { updater: { pubkey: process.env.COFFRE_UPDATER_PUBKEY.trim() } },
  }))')"
  BUILD_ARGS+=(--config "$UPDATER_CONFIG")
  echo "Paquet de mise à jour signé : activé."
else
  echo "Avertissement : TAURI_SIGNING_PRIVATE_KEY absent, aucun paquet de mise à jour ne sera produit." >&2
fi

echo "Construction de la release macOS ($TARGET, $MODE)…"
cargo fetch --manifest-path src-tauri/Cargo.toml --locked
export CARGO_NET_OFFLINE=true
bun run tauri build "${BUILD_ARGS[@]}"

APP="$TARGET_DIR/release/bundle/macos/Coffre.app"
DMG_DIR="$TARGET_DIR/release/bundle/dmg"
VERSION="$(node -p "require('./package.json').version")"
[[ -d "$APP" ]] || fail "bundle introuvable : $APP"
DMG="$(find "$DMG_DIR" -maxdepth 1 -name "Coffre_${VERSION}_*.dmg" -print -quit)"
[[ -n "$DMG" ]] || fail "DMG de la version $VERSION introuvable dans $DMG_DIR"

echo "Vérification de la signature et du hardened runtime…"
codesign --verify --deep --strict --verbose=2 "$APP"
SIGN_INFO="$(codesign -dv --verbose=4 "$APP" 2>&1)"
# « flags=0x10000(runtime) » en Developer ID, « flags=0x10002(adhoc,runtime) » en ad hoc.
grep -Eq 'flags=0x[0-9a-f]+\([^)]*runtime' <<<"$SIGN_INFO" \
  || fail "le hardened runtime n’est pas activé."

if [[ "$MODE" == "developer-id" ]]; then
  grep -Fq "Authority=Developer ID Application" <<<"$SIGN_INFO" \
    || fail "le bundle n’est pas signé par un certificat Developer ID Application."
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
else
  grep -Fq "Signature=adhoc" <<<"$SIGN_INFO" \
    || fail "le bundle devait être signé ad hoc."
fi

(
  cd "$DMG_DIR"
  shasum -a 256 "$(basename "$DMG")" > "$(basename "$DMG").sha256"
)

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  UPDATE_BUNDLE="$TARGET_DIR/release/bundle/macos/Coffre.app.tar.gz"
  [[ -f "$UPDATE_BUNDLE" && -f "$UPDATE_BUNDLE.sig" ]] \
    || fail "paquet de mise à jour ou signature introuvable : $UPDATE_BUNDLE(.sig)"
  echo "Paquet de mise à jour : $UPDATE_BUNDLE"
fi

echo
echo "Release prête ($MODE) :"
echo "  $DMG"
echo "  $DMG.sha256"
echo
cat "$DMG.sha256"
