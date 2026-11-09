#!/usr/bin/env bash
# Construit CoffreCore.xcframework pour les extensions macOS (S2).
#
# Ce script tourne uniquement en local sur un Mac avec les outils Rust et les
# Command Line Tools ; il n’exige pas Xcode complet et n’est pas appelé par la
# CI, conformément au quota GitHub Actions. Les bibliothèques statiques et les
# bindings Swift générés ne sont pas versionnés.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-$ROOT/build/CoffreCore}"
TARGETS=(aarch64-apple-darwin x86_64-apple-darwin)

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

# Xcode n’est pas requis : un xcframework est un dossier contenant une
# bibliothèque et ses en-têtes par architecture, plus un Info.plist.
XCF="$OUT/CoffreCore.xcframework"
rm -rf "$XCF"
mkdir -p "$XCF"

for target in "${TARGETS[@]}"; do
  case "$target" in
    aarch64-apple-darwin)
      slice="macos-arm64"
      arch="arm64"
      ;;
    x86_64-apple-darwin)
      slice="macos-x86_64"
      arch="x86_64"
      ;;
  esac
  mkdir -p "$XCF/$slice/Headers"
  cp "src-tauri/target/$target/release/libcoffre_core_ffi.a" \
    "$XCF/$slice/libcoffre_core_ffi.a"
  cp "$OUT/Headers"/* "$XCF/$slice/Headers/"
  cat > "$XCF/$slice/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>LibraryIdentifier</key>
  <string>$slice</string>
  <key>LibraryPath</key>
  <string>libcoffre_core_ffi.a</string>
  <key>SupportedArchitectures</key>
  <array>
    <string>$arch</string>
  </array>
  <key>SupportedPlatform</key>
  <string>macos</string>
</dict>
</plist>
EOF
done

cat > "$XCF/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>AvailableLibraries</key>
  <array>
    <dict>
      <key>LibraryIdentifier</key>
      <string>macos-arm64</string>
      <key>LibraryPath</key>
      <string>libcoffre_core_ffi.a</string>
      <key>SupportedArchitectures</key>
      <array>
        <string>arm64</string>
      </array>
      <key>SupportedPlatform</key>
      <string>macos</string>
    </dict>
    <dict>
      <key>LibraryIdentifier</key>
      <string>macos-x86_64</string>
      <key>LibraryPath</key>
      <string>libcoffre_core_ffi.a</string>
      <key>SupportedArchitectures</key>
      <array>
        <string>x86_64</string>
      </array>
      <key>SupportedPlatform</key>
      <string>macos</string>
    </dict>
  </array>
  <key>CFBundlePackageType</key>
  <string>XFWK</string>
  <key>XCFrameworkFormatVersion</key>
  <string>1.0</string>
</dict>
</plist>
EOF

plutil -lint "$XCF/Info.plist" >/dev/null

echo "CoffreCore.xcframework : $XCF"
echo "Bindings Swift : $OUT/Swift/"
