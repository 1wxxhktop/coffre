#!/usr/bin/env bash
# Crée la clé de signature des mises à jour de Coffre et la déclare dans
# GitHub (une seule fois). Voir docs/RELEASE.md § 3.1.
#
#   ./scripts/setup-updater-key.sh
#
# Le mot de passe est saisi par vous, dans le terminal, sans être affiché :
# ce script ne le lit pas et ne l’écrit nulle part. GitHub le reçoit
# directement par `gh secret set`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REPO="${COFFRE_REPO:-1wxxhktop/coffre}"
KEY="${COFFRE_UPDATER_KEY:-$HOME/.tauri/coffre-updater.key}"

fail() {
  echo "Erreur : $*" >&2
  exit 1
}

command -v gh >/dev/null 2>&1 || fail "gh (GitHub CLI) est requis."
command -v bun >/dev/null 2>&1 || fail "bun est requis."
gh auth status >/dev/null 2>&1 || fail "gh n’est pas connecté : lancez gh auth login."

if [[ -e "$KEY" || -e "$KEY.pub" ]]; then
  fail "une clé existe déjà ($KEY). Elle n’est pas remplacée : la remplacer empêcherait les applications installées d’accepter les mises à jour."
fi

mkdir -p "$(dirname "$KEY")"
chmod 700 "$(dirname "$KEY")"

cat <<'EOF'
Étape 1/3 — Création de la clé.
Choisissez un mot de passe long (par exemple une phrase de passe générée par
Coffre). Il vous sera demandé deux fois ; rien ne s’affiche pendant la saisie.

EOF
bun tauri signer generate -w "$KEY"
chmod 600 "$KEY"
[[ -s "$KEY" && -s "$KEY.pub" ]] || fail "la clé n’a pas été créée."

echo
echo "Étape 2/3 — Enregistrement de la clé dans GitHub ($REPO)."
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" < "$KEY"
gh variable set COFFRE_UPDATER_PUBKEY --repo "$REPO" < "$KEY.pub"

cat <<'EOF'

Étape 3/3 — Mot de passe de la clé.
Saisissez à nouveau le même mot de passe : GitHub le garde comme secret pour
signer les mises à jour pendant les releases.
EOF
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$REPO"

cat <<EOF

Terminé.
  Clé privée : $KEY (lisible par vous seul)
  Clé publique : $KEY.pub (publiée dans la variable COFFRE_UPDATER_PUBKEY)

À FAIRE MAINTENANT : sauvegardez la clé privée ET son mot de passe hors de cet
ordinateur, par exemple dans Coffre (pièce jointe d’une note sécurisée) et sur
un support hors ligne. Sans eux, plus aucune mise à jour ne pourra être
publiée pour les applications déjà installées.
EOF
