# Journal des changements

## 0.8.0 — 2026-11-07

- Stockage natif desktop : `app_data_dir()/vault/vault.coffre`, écritures
  atomiques, permissions restrictives, trois sauvegardes tournantes et
  migration automatique depuis IndexedDB.
- Retrait complet du portage expérimental Zig/nanoui et de ses dépendances
  vendorisées.
- Trousseau natif macOS/Windows/Linux et déverrouillage rapide optionnel.
- Déverrouillage Touch ID sur macOS, avec service de trousseau séparé.
- Interface desktop en colonnes (navigation, liste, détail persistant).
- Filtre « Récents », tri de la liste, sélecteurs habillés.
- Page de connexion compacte sans défilement aux hauteurs usuelles.
- Fenêtre macOS sans barre de titre native (feux de circulation en surcouche).
- Durcissements d’audit : clé de session après déverrouillage rapide, plafond
  KDF, vérification de l’enveloppe de récupération, liens externes Tauri,
  `strict` TypeScript, verrou multi-onglets, single-instance, effacement du
  presse-papiers au verrouillage, tests Rust/CI.

## 0.7.0

- Import Enpass et CSV de gestionnaires courants.
- Corbeille, historique des versions, sauvegardes locales, phrase de récupération.
- Extension Chromium et socle desktop Tauri.

## 0.6.0

- Extension navigateur Manifest V3 et remplissage automatique.

## 0.5.0

- Import Proton Pass et déduplication.
