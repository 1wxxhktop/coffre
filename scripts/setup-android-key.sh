#!/usr/bin/env bash
# Crée la clé de signature fixe des APK Android de Coffre et la déclare dans
# GitHub (une seule fois). Voir docs/ANDROID.md § « Signature et bêtas ».
#
#   ./scripts/setup-android-key.sh
#
# Le mot de passe est saisi par vous, dans le terminal, sans être affiché. Il
# n’est écrit dans aucun fichier : openssl et GitHub le reçoivent directement.
# Seul openssl est nécessaire (fourni avec macOS) ; Java n’est pas requis.
#
# Une même clé doit signer toutes les versions : Android refuse d’installer une
# mise à jour signée par une autre clé, sauf à désinstaller l’application (et
# perdre son coffre local). Ne la remplacez jamais.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REPO="${COFFRE_REPO:-1wxxhktop/coffre}"
KEYSTORE="${COFFRE_ANDROID_KEYSTORE_FILE:-$HOME/.coffre/coffre-android.p12}"
ALIAS=coffre

fail() {
  echo "Erreur : $*" >&2
  exit 1
}

command -v gh >/dev/null 2>&1 || fail "gh (GitHub CLI) est requis."
command -v openssl >/dev/null 2>&1 || fail "openssl est requis."
gh auth status >/dev/null 2>&1 || fail "gh n’est pas connecté : lancez gh auth login."

if [[ -e "$KEYSTORE" ]]; then
  fail "une clé existe déjà ($KEYSTORE). Elle n’est pas remplacée : une autre clé empêcherait les téléphones d’installer les mises à jour."
fi
if gh secret list --repo "$REPO" 2>/dev/null | grep -q '^ANDROID_KEYSTORE_BASE64'; then
  fail "le secret ANDROID_KEYSTORE_BASE64 existe déjà dans $REPO. Il n’est pas remplacé."
fi

mkdir -p "$(dirname "$KEYSTORE")"
chmod 700 "$(dirname "$KEYSTORE")"

cat <<'EOF'
Étape 1/3 — Mot de passe de la clé.
Choisissez un mot de passe long (par exemple une phrase de passe générée par
Coffre). Rien ne s’affiche pendant la saisie.

EOF
read -r -s -p "Mot de passe : " PASSWORD
echo
read -r -s -p "Confirmez : " CONFIRM
echo
[[ "$PASSWORD" == "$CONFIRM" ]] || fail "les deux saisies diffèrent."
unset CONFIRM
(( ${#PASSWORD} >= 12 )) || fail "mot de passe trop court (12 caractères minimum)."

echo
echo "Étape 2/3 — Création de la clé ($KEYSTORE)."
# La clé privée n’existe en clair à aucun moment sur le disque : openssl
# l’écrit chiffrée par le mot de passe, lu dans une variable d’environnement
# propre à chaque commande (jamais dans la ligne de commande).
WORK="$(mktemp -d "$(dirname "$KEYSTORE")/.cle-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
COFFRE_KEY_PASSWORD="$PASSWORD" openssl req -x509 -newkey rsa:4096 -sha256 \
  -days 10000 -subj "/CN=Coffre/O=Coffre" \
  -keyout "$WORK/cle.pem" -passout env:COFFRE_KEY_PASSWORD \
  -out "$WORK/certificat.pem" 2>/dev/null
COFFRE_KEY_PASSWORD="$PASSWORD" openssl pkcs12 -export -name "$ALIAS" \
  -inkey "$WORK/cle.pem" -passin env:COFFRE_KEY_PASSWORD \
  -in "$WORK/certificat.pem" \
  -out "$KEYSTORE" -passout env:COFFRE_KEY_PASSWORD \
  -keypbe AES-256-CBC -certpbe AES-256-CBC -macalg sha256
chmod 600 "$KEYSTORE"
[[ -s "$KEYSTORE" ]] || fail "la clé n’a pas été créée."

CERT="$(openssl x509 -in "$WORK/certificat.pem" -noout -fingerprint -sha256 \
  | sed 's/^.*=//')"
rm -rf "$WORK"
[[ -n "$CERT" ]] || fail "empreinte du certificat introuvable."

echo
echo "Étape 3/3 — Enregistrement dans GitHub ($REPO)."
base64 < "$KEYSTORE" | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO"
printf '%s' "$PASSWORD" | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$REPO"
unset PASSWORD
gh variable set COFFRE_ANDROID_CERT_SHA256 --repo "$REPO" --body "$CERT"

cat <<EOF

Terminé.
  Clé : $KEYSTORE (lisible par vous seul)
  Empreinte du certificat : $CERT
  (publiée dans la variable COFFRE_ANDROID_CERT_SHA256 ; la CI refuse tout APK
  signé par une autre clé)

À FAIRE MAINTENANT : sauvegardez la clé ET son mot de passe hors de cet
ordinateur, par exemple dans Coffre (pièce jointe d’une note sécurisée) et sur
un support hors ligne. Sans eux, plus aucune mise à jour Android ne pourra être
installée par-dessus les versions existantes.
EOF
