#!/usr/bin/env bash
# Rassemble dans un dossier local tous les exécutables de Coffre produits par
# la CI GitHub sur main : applications desktop macOS, Windows et Linux, outils
# en ligne de commande, extension navigateur, application Web et SBOM.
#
# Usage :
#   ./scripts/collect-release.sh                 # dernière CI réussie sur main
#   ./scripts/collect-release.sh --run 1234567   # une exécution précise
#   ./scripts/collect-release.sh --out ~/Coffre  # autre dossier de sortie
#
# Résultat : release/coffre-<version>-<commit>/ (et release/latest), avec
# SHA256SUMS et LISEZMOI.txt. Les artefacts de la CI sont conservés 30 jours ;
# au-delà, relancer la CI : gh workflow run ci.yml --ref main
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REPO="${COFFRE_REPO:-1wxxhktop/coffre}"
OUT="$ROOT/release"
RUN_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN_ID="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

fail() {
  echo "Erreur : $*" >&2
  exit 1
}

command -v gh >/dev/null 2>&1 || fail "gh (GitHub CLI) est requis."
command -v shasum >/dev/null 2>&1 || fail "shasum est requis."
command -v zip >/dev/null 2>&1 || fail "zip est requis."

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="$(gh run list --repo "$REPO" --workflow ci.yml --branch main \
    --event push --status success --limit 1 --json databaseId \
    --jq '.[0].databaseId // empty')"
  [[ -n "$RUN_ID" ]] || fail "aucune CI réussie trouvée sur main."
fi

SHA="$(gh run view "$RUN_ID" --repo "$REPO" --json headSha --jq .headSha)"
SHORT="${SHA:0:7}"
VERSION="$(gh api "repos/$REPO/contents/package.json?ref=$SHA" --jq .content \
  | base64 --decode | sed -n 's/^  "version": "\(.*\)",$/\1/p')"
[[ -n "$VERSION" ]] || fail "version introuvable pour le commit $SHORT."

ARTIFACTS="$(gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts" \
  --jq '[.artifacts[] | select(.expired == false) | .name] | join(" ")')"
for needed in coffre-dist coffre-desktop-macos-latest coffre-desktop-ubuntu-22.04 coffre-desktop-windows-latest; do
  if [[ " $ARTIFACTS " != *" $needed "* ]]; then
    fail "artefact « $needed » absent ou expiré pour l’exécution $RUN_ID. Relancez la CI : gh workflow run ci.yml --ref main"
  fi
done

DEST="$OUT/coffre-$VERSION-$SHORT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Exécution $RUN_ID · commit $SHORT · version $VERSION"
echo "Téléchargement des artefacts…"
# Téléchargement des zips par l’API puis extraction sans les dossiers de
# travail AppImage (Coffre.png et coffre.png y entrent en conflit sur un disque
# insensible à la casse) : fonctionne aussi pour les anciennes exécutions.
while IFS=$'\t' read -r artifact_id artifact_name; do
  [[ -n "$artifact_id" ]] || continue
  mkdir -p "$TMP/$artifact_name"
  gh api "repos/$REPO/actions/artifacts/$artifact_id/zip" > "$TMP/$artifact_name.zip"
  exclude=()
  if [[ "$artifact_name" == coffre-desktop-ubuntu* ]] \
    && unzip -Z1 "$TMP/$artifact_name.zip" | grep -q '\.AppDir/'; then
    exclude=(-x '*.AppDir/*')
  fi
  # Forme compatible avec le bash 3.2 de macOS sous `set -u` (liste vide).
  unzip -q -o "$TMP/$artifact_name.zip" -d "$TMP/$artifact_name" ${exclude[@]+"${exclude[@]}"}
  rm -f "$TMP/$artifact_name.zip"
done < <(gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts" \
  --jq '.artifacts[] | select(.expired == false) | "\(.id)\t\(.name)"')

rm -rf "$DEST"
mkdir -p "$DEST"/{macos,windows,linux,extension,web,sbom}

copy_matching() {
  # copy_matching <dossier source> <dossier cible> <motif>…
  local source="$1" target="$2"
  shift 2
  local pattern
  for pattern in "$@"; do
    find "$source" -type f -name "$pattern" -exec cp {} "$target/" \;
  done
}

copy_tools() {
  # Les zips d’artefacts GitHub ne conservent pas le bit exécutable.
  local source="$1" target="$2"
  local tools
  tools="$(find "$source" -type d -name outils -print -quit)"
  [[ -n "$tools" ]] || return 0
  mkdir -p "$target/outils"
  cp "$tools"/* "$target/outils/"
  chmod +x "$target/outils/"* 2>/dev/null || true
}

# macOS : le DMG garde l’app intacte (le .app seul perdrait ses permissions).
copy_matching "$TMP/coffre-desktop-macos-latest" "$DEST/macos" '*.dmg'
copy_tools "$TMP/coffre-desktop-macos-latest" "$DEST/macos"

copy_matching "$TMP/coffre-desktop-windows-latest" "$DEST/windows" '*.msi' '*-setup.exe'
copy_tools "$TMP/coffre-desktop-windows-latest" "$DEST/windows"

copy_matching "$TMP/coffre-desktop-ubuntu-22.04" "$DEST/linux" '*.deb' '*.rpm' '*.AppImage'
chmod +x "$DEST/linux/"*.AppImage 2>/dev/null || true
copy_tools "$TMP/coffre-desktop-ubuntu-22.04" "$DEST/linux"

(cd "$TMP/coffre-dist/dist-extension" && zip -qr "$DEST/extension/coffre-extension-$VERSION.zip" .)
(cd "$TMP/coffre-dist/dist" && zip -qr "$DEST/web/coffre-web-$VERSION.zip" .)

if [[ -d "$TMP/coffre-sbom" ]]; then
  cp "$TMP/coffre-sbom/"* "$DEST/sbom/" 2>/dev/null || true
fi

# Dossiers vides retirés (artefact sans le type de paquet attendu).
find "$DEST" -mindepth 1 -type d -empty -delete

cat > "$DEST/LISEZMOI.txt" <<EOF
Coffre $VERSION — commit $SHORT
Construit par la CI GitHub : https://github.com/$REPO/actions/runs/$RUN_ID

macOS/     DMG de l’application (Apple Silicon) et outils en ligne de commande.
           Signée ad hoc, non notariée : à la première ouverture, Réglages
           Système → Confidentialité et sécurité → « Ouvrir quand même ».
windows/   Installateurs MSI et NSIS (.exe), outils en ligne de commande.
           Non signés : Windows SmartScreen demande « Exécuter quand même ».
linux/     Paquets .deb, .rpm et AppImage, outils en ligne de commande.
extension/ Extension navigateur (Chromium) à charger en mode développeur
           (chrome://extensions → « Charger l’extension non empaquetée »).
web/       Application Web (PWA) à servir en HTTPS.
sbom/      Nomenclatures logicielles CycloneDX.

outils/    coffre-cli (lecture, TOTP, coffre run --env), coffre-git-sign
           (signature Git) et, hors Windows, coffre-ssh-agent.

Ces fichiers sont des builds de développement (CI), pas une release publiée :
ils ne contiennent pas le paquet de mise à jour signé. Vérifiez les empreintes
avec : shasum -a 256 -c SHA256SUMS
EOF

(
  cd "$DEST"
  find . -type f ! -name SHA256SUMS ! -name LISEZMOI.txt | sed 's|^\./||' | sort \
    | while read -r file; do shasum -a 256 "$file"; done > SHA256SUMS
)

ln -sfn "$(basename "$DEST")" "$OUT/latest"

echo
echo "Dossier prêt : $DEST"
(cd "$DEST" && find . -type f ! -name SHA256SUMS ! -name LISEZMOI.txt | sed 's|^\./|  |' | sort)
