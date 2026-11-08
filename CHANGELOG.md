# Journal des changements

## Non publié

- Correction de deux pertes de données : un onglet resté ouvert relit le coffre
  avant de le déverrouiller, une écriture calculée sur une version périmée est
  refusée, et un verrouillage pendant un enregistrement conserve la
  modification. Un import interrompu par le verrouillage est annulé sans
  écriture partielle ni contenu déchiffré dans l’état verrouillé.
- Rotation complète des clés au changement de mot de passe, au remplacement ou
  à la suppression de la phrase et à la récupération ; les nouvelles clés ne
  sont installées qu’après une écriture réussie.
- Nouvel indicateur de robustesse : dictionnaires, claviers AZERTY/QWERTY,
  suites, années et leetspeak (« Marseille2024 » passe de 77 à 17 bits).
- Extension : contrôle du domaine avant remplissage, avec confirmation
  explicite ; message sur le verrouillage en arrière-plan.
- Desktop : copie et effacement natifs du presse-papiers (secret exclu des
  historiques), texte Touch ID fixé côté natif, serveur de développement refusé
  en production, migration IndexedDB sans perte de sauvegarde puis effacement
  de l’ancienne copie.
- Export CSV protégé par le mot de passe maître ; fermeture de page sans
  suppression de la clé de déverrouillage rapide (comportement déterministe).
- CI et release : actions épinglées par SHA, release sans cache partagé et
  avec tests avant signature, specs e2e vérifiées par TypeScript.

## 0.8.0 — 2026-11-07

- Stockage natif desktop : `app_data_dir()/vault/vault.coffre`, écritures
  atomiques, permissions restrictives, trois sauvegardes tournantes et
  migration automatique depuis IndexedDB.
- Retrait complet du portage expérimental Zig/nanoui et de ses dépendances
  vendorisées.
- Export CSV : format Mots de passe (Apple) pour les connexions et format
  complet Coffre pour tous les éléments, réimportable.
- Chaîne de release macOS : build universel, signature Developer ID,
  notarisation, vérification `spctl`, workflow sur tag et documentation.
- Tableau de bord Sécurité complet : score, répartition, faiblesses,
  réutilisations, variantes proches, ancienneté, 2FA, connexions incomplètes et
  doublons.
- Actions groupées : sélection multiple, favoris et corbeille.
- Thèmes sombre/clair neutres (noir et blanc) et mode système.
- Import 1Password `.1pux`.
- Variante Firefox de l’extension, avec manifeste compatible Chromium.
- Verrouillage à la perte de focus sur desktop et raccourci global de recherche.
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
