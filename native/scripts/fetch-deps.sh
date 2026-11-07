#!/bin/sh
# Récupère nanoui dans native/vendor/nanoui si le dossier est absent.
# Le dépôt est épinglé sur la version testée ; le build reste hors ligne
# une fois le clone effectué.
set -eu
cd "$(dirname "$0")/.."
if [ -d vendor/nanoui/src ]; then
  echo "nanoui déjà présent dans vendor/nanoui"
  exit 0
fi
git clone --depth 1 --branch v0.11.0 https://github.com/justrach/nanoui.git vendor/nanoui
rm -rf vendor/nanoui/.git
echo "nanoui v0.11.0 installé dans vendor/nanoui"
