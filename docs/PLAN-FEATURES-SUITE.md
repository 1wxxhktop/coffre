# Plan de fonctions complémentaires — après `PLAN-IMPLEMENTATION.md`

Document destiné à un agent de développement, à traiter **une fois les lots
L1 à L12 de `docs/PLAN-IMPLEMENTATION.md` terminés**. Le premier plan amène
Coffre au niveau des meilleurs gestionnaires ; celui-ci le **différencie**, en
s’appuyant sur ce qui le rend unique : local-first, sans compte, sans serveur,
format ouvert.

Les règles de la section 0 du premier plan s’appliquent intégralement
(principes non négociables, une PR par lot, contrôles obligatoires,
documentation, définition de « terminé »).

Prérequis supposés disponibles : format v4 avec horloges et MAC global (L1),
cœur Rust `coffre-core` (L2), synchronisation par dossier (L3), pont natif
extension ↔ desktop (L4), content scripts de remplissage (L5), passkeys (L6),
clés matérielles (L7), apps mobiles (L8), identités X25519/Ed25519 (L10),
CLI (L11).

---

## 1. Vue d’ensemble

| Lot | Fonction | Valeur | Taille |
| --- | --- | --- | --- |
| F1 | Compatibilité KeePass (KDBX 4) en lecture et écriture | Très haute | L |
| F2 | Synchronisation directe entre appareils sur le réseau local, sans cloud | Très haute | L |
| F3 | Kit d’urgence papier et sauvegarde fractionnée (Shamir) | Haute | M |
| F4 | Assistant de changement de mots de passe et santé avancée | Haute | M |
| F5 | Remplissage des cartes, identités et adresses dans les formulaires | Haute | M |
| F6 | Mode voyage et coffres masqués | Moyenne | M |
| F7 | Alias e-mail : adresses « plus » hors ligne et services d’alias en opt-in | Moyenne | M |
| F8 | Coffre de fichiers chiffrés en flux (gros fichiers) | Moyenne | L |
| F9 | Saisie automatique dans les applications de bureau (auto-type) | Moyenne | M |
| F10 | Rappels d’échéance (cartes, documents, mots de passe) | Moyenne | S |
| F11 | Journal d’activité local chiffré | Moyenne | S |
| F12 | Imports et exports étendus (LastPass, Dashlane, Chrome, KeePassXC…) | Haute | M |
| F13 | Partage ponctuel hors ligne (fichier ou QR chiffré à usage unique) | Moyenne | S |
| F14 | Outils développeur : assistant Git, `.env`, intégration SSH avancée | Moyenne | M |
| F15 | Internationalisation (anglais d’abord) et accessibilité certifiée | Haute | M |
| F16 | Modèles et types d’éléments personnalisés | Moyenne | M |

Ordre recommandé : **F15 → F1 → F12 → F5 → F2 → F3 → F4 → F10 → F6 → F16 →
F11 → F13 → F14 → F9 → F7 → F8**.

F15 vient en premier : chaque lot suivant ajoute du texte d’interface, autant
le rendre traduisible dès le départ.

---

## F1 — Compatibilité KeePass (KDBX 4)

### Pourquoi
Les utilisateurs local-first viennent souvent de KeePass/KeePassXC. Lire et
écrire leur format supprime le principal frein à la migration et permet
d’utiliser Coffre à côté de KeePassXC sur un poste où Coffre n’existe pas.

### Conception
- Implémentation dans `coffre-core` (Rust) : en-tête KDBX 4, KDF Argon2d/
  Argon2id et AES-KDF (lecture seule), chiffrement ChaCha20 et AES-256-CBC,
  blocs HMAC-SHA-256, flux interne protégé (ChaCha20), XML interne.
- Fichier de clé (`.keyx`, XML v2 et binaire) et clé composite mot de passe +
  fichier.
- Correspondance des données : groupes → étiquettes ou coffres (au choix),
  champs standard et personnalisés, champs protégés → champs `hidden`, pièces
  jointes, historique → versions, `otp` (plugin KeePassXC) → TOTP, passkeys
  KeePassXC → type `passkey`.
- Export KDBX 4 depuis Coffre (Argon2id par défaut) ; import avec aperçu et
  déduplication existants (`import.ts`).
- Plafonds identiques aux autres imports ; refus des paramètres KDF
  déraisonnables (mêmes bornes que `KDF_LIMITS`).

### Critères d’acceptation
- Aller-retour Coffre → KDBX → KeePassXC → KDBX → Coffre sans perte sur un
  coffre de référence (tous types, pièces jointes, historique, TOTP).
- Corpus de fichiers KDBX réels (KeePass 2.x, KeePassXC, KeeWeb) ouverts.
- Fuzzing du parseur KDBX en CI de nuit.

---

## F2 — Synchronisation directe sur le réseau local

### Pourquoi
L3 synchronise via un dossier cloud. Beaucoup d’utilisateurs de Coffre ne
veulent **aucun** cloud : synchroniser téléphone et ordinateur directement,
sur le Wi-Fi de la maison, est un argument fort.

### Conception
- **Appairage** par QR code affiché sur un appareil et scanné par l’autre :
  il contient l’empreinte de la clé Ed25519 de l’appareil (L10) et un secret
  d’appairage à usage unique ; vérification mutuelle (protocole Noise `XX` ou
  `IK`, crate `snow`).
- **Découverte** : mDNS/DNS-SD (`_coffre._tcp`) limitée au réseau local ;
  aucune connexion sortante vers Internet.
- **Transport** : TCP avec Noise, ou QUIC ; messages = fichiers v4 ou deltas
  d’enregistrements, puis fusion par `mergeVaultFiles` (L3) ; même règle sur
  les époques de clés.
- Desktop et mobile uniquement (pas le Web). Désactivé par défaut ; l’écoute
  réseau ne démarre que pendant une synchronisation demandée ou programmée.

### Critères d’acceptation
- Deux appareils appairés convergent sans Internet (test en réseau isolé).
- Un appareil non appairé ne peut ni se connecter ni obtenir d’information
  (pas même le nombre d’éléments).
- Pare-feu : aucun port ouvert en dehors des fenêtres de synchronisation.

---

## F3 — Kit d’urgence papier et sauvegarde fractionnée

### Conception
- **Kit d’urgence PDF** généré localement : instructions, identifiant du
  coffre, emplacement des sauvegardes, champ manuscrit pour le mot de passe,
  phrase de récupération si l’utilisateur le demande, QR code de restauration.
- **Shamir (k parmi n)** sur la clé de récupération : chaque part est imprimée
  (QR + mots) et confiée à une personne différente ; `k` parts reconstituent la
  clé. Implémentation dans `coffre-core` (GF(256), parts avec somme de
  contrôle), vecteurs de test et compatibilité SLIP-39 envisagée.
- **Sauvegarde papier complète** d’un petit coffre : fichier `.coffre`
  compressé découpé en QR codes numérotés, relisibles par la caméra (mobile).

### Critères d’acceptation
- Restauration réussie avec exactement `k` parts, échec avec `k - 1`.
- Aucune part, seule, ne révèle d’information sur la clé (test statistique sur
  les octets des parts).

---

## F4 — Assistant de changement de mots de passe et santé avancée

### Conception
- **Tableau de santé** (`security.ts`) enrichi :
  - sites qui proposent la double authentification ou les passkeys (jeu de
    données 2fa.directory et passkeys.directory **embarqué** et mis à jour à
    chaque release, aucune requête) ;
  - comptes inactifs depuis longtemps, mots de passe jamais changés depuis une
    fuite connue (L9), identifiants partagés entre plusieurs sites.
- **Assistant** : file d’attente « à corriger », ouverture de
  `https://<site>/.well-known/change-password` (RFC proposée par le W3C) ou de
  l’URL connue, génération d’un mot de passe conforme aux règles du site (L11),
  détection du nouveau mot de passe soumis (L5) et mise à jour de l’élément
  avec conservation de l’ancien dans l’historique.
- Score de santé dans le temps (historique local des scores, graphique).

### Critères d’acceptation
- Parcours complet en e2e sur un site de test : faible → changement →
  élément mis à jour, ancienne valeur dans l’historique.

---

## F5 — Remplissage des cartes, identités et adresses

### Conception
- Détection des champs de paiement et d’adresse (`autocomplete="cc-number"`,
  `cc-exp`, `cc-csc`, `given-name`, `postal-code`, etc., plus heuristiques
  françaises : « Code postal », « Titulaire »).
- Menu en ligne (L5) qui propose les cartes et identités ; le CVC et le PIN ne
  sont jamais remplis sans action explicite et Touch ID/Face ID.
- Refus de remplir une carte sur une page non HTTPS ou dans une iframe dont
  l’origine diffère du haut de page, sauf prestataires de paiement connus
  (liste embarquée : Stripe, Adyen, PayPal…), avec affichage de l’origine.
- Enregistrement d’une nouvelle carte ou adresse saisie dans un formulaire.

### Critères d’acceptation
- Remplissage correct sur un corpus de formulaires de paiement et d’adresse
  (dont des sites français) ; tests adverses (champ caché, iframe tierce).

---

## F6 — Mode voyage et coffres masqués

### Conception
- Chaque coffre peut être marqué « sûr pour le voyage ». En mode voyage,
  les autres coffres sont **retirés de l’appareil** : leurs enregistrements
  sont supprimés du fichier local (pas seulement masqués), puis restaurés depuis
  la synchronisation (L3 ou F2) quand le mode est désactivé.
- Activation et désactivation exigent le mot de passe maître ; la
  désactivation n’est possible qu’en se reconnectant à une source de
  synchronisation.
- Documentation honnête : le mode voyage protège contre une inspection de
  l’appareil, pas contre la contrainte exercée sur la personne.

### Critères d’acceptation
- En mode voyage, le fichier local ne contient plus aucun ciphertext des
  coffres masqués (vérifié par test) ; restauration complète ensuite.

---

## F7 — Alias e-mail

### Conception
- **Hors ligne** : générateur d’adresses « plus » (`prenom+site@domaine`) et
  d’adresses catch-all pour un domaine personnel, enregistrées dans l’élément.
- **Services d’alias en opt-in** : intégration SimpleLogin et addy.io avec la
  clé d’API de l’utilisateur (stockée chiffrée dans le coffre) ; requêtes faites
  par Rust (desktop) ou par l’extension, jamais sans action explicite ;
  affichage clair du service contacté.
- Proposition d’alias dans le menu de remplissage lors d’une inscription (L5).

### Critères d’acceptation
- Aucune requête réseau tant qu’aucun service n’est configuré (test).

---

## F8 — Coffre de fichiers chiffrés en flux

### Pourquoi
Les pièces jointes sont limitées à 5 Mo et chargées entièrement en mémoire.
Un coffre de documents (passeport, contrats, scans) doit gérer des fichiers de
plusieurs centaines de Mo.

### Conception
- Stockage hors du fichier `.coffre` : un fichier chiffré par document dans
  `vault/blobs/<id>`, référencé par l’élément (hachage, taille, clé).
- Chiffrement en flux par blocs (construction STREAM, AES-256-GCM, blocs de
  64 Kio avec nonce dérivé et drapeau de dernier bloc), clé par fichier
  enveloppée par la clé de l’élément.
- Aperçu des images et PDF en mémoire, sans écriture en clair sur le disque.
- Synchronisation des blobs par L3/F2 (transfert par blocs, reprise).

### Critères d’acceptation
- Fichier de 1 Gio chiffré et déchiffré avec une mémoire constante (< 100 Mio).
- Troncature, réordonnancement ou substitution de blocs détectés (tests).

---

## F9 — Saisie automatique dans les applications de bureau (auto-type)

### Conception
- Raccourci global (réutiliser le raccourci de recherche rapide existant) :
  Coffre identifie la fenêtre active (titre, exécutable), propose les éléments
  correspondants et tape la séquence (`{USERNAME}{TAB}{PASSWORD}{ENTER}`,
  configurable par élément, syntaxe compatible KeePass).
- macOS : permission Accessibilité requise et expliquée ; Windows :
  `SendInput` ; Linux : X11 (`xdotool`-like) et portail Wayland si disponible.
- Vérification de la fenêtre cible juste avant la frappe ; annulation si le
  focus change.

### Critères d’acceptation
- Saisie correcte dans une application de test sur les trois OS ; annulation
  si la fenêtre change pendant la séquence.

---

## F10 — Rappels d’échéance

### Conception
- Champs d’échéance sur les cartes (déjà `expiry`), identités (nouveau :
  passeport, carte d’identité, permis), licences, et « mot de passe à changer
  avant ».
- Notifications locales (desktop et mobile), calculées à l’ouverture et
  périodiquement pendant que l’app tourne ; aucun serveur de notification.
- Vue « Bientôt expirés » dans la barre latérale.

---

## F11 — Journal d’activité local chiffré

### Conception
- Journal des événements sensibles : déverrouillages (méthode), échecs,
  exports, changements de mot de passe et de phrase, appairages, partages,
  remplissages par l’extension (domaine), utilisation de l’agent SSH.
- Stocké chiffré dans le fichier (nouvelle section, AAD dédiée), plafonné et
  synchronisé ; visible dans les réglages, exportable.
- Utile pour détecter un usage inattendu (appareil volé, extension
  compromise).

---

## F12 — Imports et exports étendus

### Conception
- Imports : LastPass (CSV), Dashlane (CSV/JSON), Chrome/Edge/Firefox (CSV),
  Safari/Mots de passe (CSV, déjà en export), KeePassXC (CSV et KDBX via F1),
  NordPass, RoboForm, Keeper, Apple Passwords avec passkeys (format CXF de la
  FIDO Alliance dès qu’il est stable).
- Export CXF (identifiants et passkeys) pour la portabilité entre
  gestionnaires.
- Fixtures anonymisées pour chaque format dans `src/lib/__fixtures__`.

### Critères d’acceptation
- Chaque format couvert par des tests sur des exports réels anonymisés, avec
  rapport des champs ignorés affiché à l’utilisateur.

---

## F13 — Partage ponctuel hors ligne

### Conception
- Partager un élément avec quelqu’un qui n’a pas Coffre : fichier `.coffre-share`
  ou QR code contenant l’élément chiffré avec une clé aléatoire ; la clé est
  transmise séparément (mots à dicter ou second QR).
- Variante entre utilisateurs Coffre : chiffrement vers la clé publique du
  destinataire (L10), sans clé à transmettre.
- Expiration indiquée dans le partage (le destinataire Coffre la respecte ;
  documenter qu’elle ne peut pas être imposée hors ligne).
- Page d’ouverture statique (PWA, hors ligne) pour les destinataires sans
  Coffre.

---

## F14 — Outils développeur

### Conception
- **Assistant d’identifiants Git** (`git credential` helper) adossé à la CLI
  (L11), avec approbation par utilisation.
- **Fichiers `.env`** : `coffre run --env-file .env.coffre` remplace des
  références `coffre://<coffre>/<élément>/<champ>` par les valeurs au
  lancement, sans les écrire sur disque.
- **SSH avancé** : signature de commits Git avec les clés SSH du coffre,
  configuration par hôte (`~/.ssh/config` généré à la demande), clés FIDO
  (`sk-ssh-ed25519`).

---

## F15 — Internationalisation et accessibilité

### Conception
- Extraction de toutes les chaînes (application, extension, Rust, documents)
  vers des catalogues (ICU MessageFormat) ; français par défaut, anglais
  ensuite, puis espagnol et allemand ; pluriels et dates localisés (le code
  actuel construit parfois des pluriels à la main).
- Audit d’accessibilité WCAG 2.2 AA : lecteur d’écran (VoiceOver, NVDA),
  navigation clavier complète, contraste des deux thèmes, tailles de texte ;
  tests automatisés (`@axe-core/playwright`) dans la CI.

### Critères d’acceptation
- Aucune chaîne en dur dans l’interface (règle de lint) ; parcours e2e
  rejoués en anglais.
- 0 violation axe de niveau A et AA sur les écrans principaux.

---

## F16 — Modèles et types d’éléments personnalisés

### Conception
- Éditeur de modèles : l’utilisateur définit un type (nom, icône, champs avec
  leur nature : texte, secret, URL, date, TOTP, fichier) ; les éléments créés
  depuis ce modèle gardent une référence au modèle.
- Modèles stockés chiffrés dans le coffre (section dédiée, AAD propre),
  synchronisés et exportables.
- Les types intégrés (connexion, carte, identité…) restent prioritaires pour
  le remplissage ; un modèle peut déclarer quels champs sont remplissables.

---

## 2. Points de vigilance transverses

- **Surface réseau** : F2, F7 et F4 (données embarquées) ne doivent jamais
  ajouter de requête implicite. Chaque nouvelle connexion est listée dans
  `docs/SECURITY.md`, avec un test qui la bloque quand l’option est inactive.
- **Format** : F8, F11, F13 et F16 ajoutent des sections au fichier ;
  regrouper les évolutions dans une version de format v5 avec migration et
  vecteurs de test, plutôt que de multiplier les versions.
- **Audit** : F1, F2, F3 et F8 ajoutent de la cryptographie ou des parseurs ;
  les inclure dans le périmètre d’un nouvel audit externe avant publication.
- **Mobile** : vérifier pour chaque lot le comportement dans les extensions de
  remplissage iOS et Android (limites mémoire, absence de réseau).
