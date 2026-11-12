# Plan de fonctions du quotidien — sécurité, confort, fiabilité

Document destiné à un agent de développement. Il complète
`docs/PLAN-IMPLEMENTATION.md`, `docs/PLAN-FEATURES-SUITE.md` et
`docs/PLAN-INTEGRATION-SYSTEME.md` avec des fonctions qui n’existent pas
encore sur `main` au 9 novembre 2026 et qu’aucun de ces plans ne couvre.

Les règles de la section 0 de `docs/PLAN-IMPLEMENTATION.md` s’appliquent
intégralement (principes non négociables, une PR par lot, contrôles
obligatoires, documentation, définition de « terminé »).

Toutes ces fonctions sont **locales** : aucune ne demande de serveur Coffre,
aucune n’ajoute de requête réseau. Les jeux de données externes sont
**embarqués** dans l’application et mis à jour avec les versions, comme les
règles de mots de passe Apple déjà intégrées (`src/lib/passwordRules.ts`).

---

## 0. Règles propres à ce plan

1. **Aucune requête réseau nouvelle.** Un test vérifie, pour chaque lot, que
   la fonction ne fait aucun appel `fetch` ni commande Rust réseau.
2. **Jeux de données embarqués** : licence vérifiée et citée dans `NOTICE`,
   script de mise à jour reproductible dans `scripts/`, fichier versionné
   (date de l’instantané), taille raisonnable pour le bundle Web. Ils ne vont
   **pas** dans le bundle de l’extension s’ils ne lui servent pas.
3. **Données sensibles chiffrées.** Tout nouvel état qui révèle des usages
   (historique du générateur, codes de secours, conflits) est stocké dans le
   contenu chiffré du coffre, jamais dans `localStorage` ou des métadonnées
   en clair.
4. **Format du fichier.** Un nouveau type d’élément ou un nouveau champ suit
   la procédure de format : schéma Zod, migration, fixtures dans
   `src/lib/__fixtures__`, vecteurs `coffre-core` si le cœur Rust doit le
   lire, et compatibilité ascendante des fichiers existants.
5. **CI et nettoyage.** Le dépôt est public : les runners standard sont
   gratuits, sans quota. Les nouvelles actions sont épinglées par SHA. Après
   chaque fusion ou release, exécuter `bun run post-merge` : il met à jour
   `release/` avec la dernière version, vérifie qu’une seule version est
   présente, puis nettoie les artefacts. `release/` n’est jamais supprimé.

---

## 1. Vue d’ensemble

| Lot | Fonction | Thème | Valeur | Taille |
| --- | --- | --- | --- | --- |
| Q1 | Protection anti-hameçonnage au remplissage | Sécurité | Très haute | M |
| Q2 | Disponibilité de la 2FA et des passkeys par site | Sécurité | Haute | S |
| Q3 | Historique chiffré du générateur | Confort | Haute | S |
| Q4 | Sauvegardes planifiées avec rétention | Fiabilité | Haute | M |
| Q5 | Codes de secours 2FA | Sécurité | Moyenne | S |
| Q6 | Alerte « TOTP et mot de passe au même endroit » | Sécurité | Moyenne | S |
| Q7 | Palette de commandes `⌘K` | Confort | Haute | M |
| Q8 | Mini-fenêtre d’accès rapide (desktop) | Confort | Haute | M |
| Q9 | Résolution visuelle des conflits de synchronisation | Fiabilité | Moyenne | M |
| Q10 | Notes en Markdown | Confort | Moyenne | S |
| Q11 | `coffre scan` : détection de secrets dans les fichiers | Développeurs | Moyenne | M |
| Q12 | Signature des commits Git par l’agent SSH | Développeurs | Moyenne | S |

Ordre recommandé : **Q1 → Q2 → Q3 → Q4 → Q5 → Q6 → Q7 → Q8 → Q9 → Q10 →
Q11 → Q12**.

Q1 à Q4 sont rapides et visibles pour tous les utilisateurs. Q8 touche la
fenêtre desktop : à coordonner avec le lot S1 de
`PLAN-INTEGRATION-SYSTEME.md` (icône de barre de menus), à faire après lui si
les deux sont en cours.

---

## Q1 — Protection anti-hameçonnage au remplissage

### Pourquoi
Un gestionnaire de mots de passe protège déjà en refusant de remplir sur un
domaine différent. Mais l’utilisateur peut forcer le remplissage, ou
enregistrer un identifiant directement sur un faux site. Les meilleurs
gestionnaires avertissent quand un domaine **ressemble** à un domaine connu.

### Conception
- Nouveau module `src/lib/phishing.ts`, utilisé par l’app (contrôle avant
  remplissage, à côté de `loginAllowsHost` dans `extensionProtocol.ts`) et
  par l’extension (proposition d’enregistrement).
- Signaux, chacun avec un code et un niveau (`avertissement`, `danger`) :
  - **Domaine Unicode / punycode** (`xn--`) dont le squelette de confusables
    (Unicode TR39, table embarquée réduite) correspond à un domaine du
    coffre ou de la liste des sites populaires ;
  - **Faute de frappe proche** : distance de Damerau-Levenshtein ≤ 2 avec un
    domaine du coffre, à partir de 6 caractères, en ignorant les domaines
    enregistrables identiques ;
  - **Marque en sous-domaine** : `paypal.com.secure-login.io`, un domaine
    connu apparaît comme libellé à gauche d’un autre domaine enregistrable ;
  - **IP brute, port inhabituel, HTTP** sur une page qui demande un mot de
    passe ;
  - **Domaine jamais vu** pour un identifiant déjà enregistré ailleurs (même
    nom d’utilisateur, autre domaine) : avertissement doux à l’enregistrement.
- Liste des sites populaires : les domaines du jeu « Password Manager
  Resources » déjà embarqué, plus une liste publique des domaines les plus
  visités (licence à vérifier), limitée à quelques milliers d’entrées.
- Interface : avant un remplissage forcé ou un enregistrement, un bandeau
  explique le signal (« Ce site imite paypal.com ») avec deux choix :
  « Annuler » (par défaut) et « Continuer quand même ». Le choix est journalisé
  dans le journal d’activité, sans l’URL complète.
- Aucune requête réseau : pas d’API de réputation, pas de listes noires en
  ligne.

### Critères d’acceptation
- `paypa1.com`, `pаypal.com` (a cyrillique), `paypal.com.login-check.io`,
  `http://192.168.1.10/login` déclenchent le bon signal quand `paypal.com` est
  dans le coffre.
- `accounts.google.com` pour un élément `google.com`, et deux domaines
  enregistrables distincts mais légitimes d’une même liste d’équivalences
  (ex. `apple.com` / `icloud.com`), ne déclenchent rien.
- Moins de 2 ms par vérification sur un coffre de 2 000 éléments.

### Tests
- Vitest : au moins 60 cas positifs et négatifs, dont IDN légitimes (`münchen.de`).
- e2e Chromium : remplissage forcé sur une page de test `paypa1.test` → bandeau,
  « Annuler » ne remplit rien.

---

## Q2 — Disponibilité de la 2FA et des passkeys par site

### Pourquoi
Le tableau de bord marque « Sans 2FA » toute connexion sans TOTP, même quand
le site ne propose aucune 2FA. C’est du bruit, qui pousse à ignorer
l’indicateur.

### Conception
- Jeux de données embarqués : 2fa.directory (méthodes de 2FA par domaine) et
  passkeys.directory (support des passkeys), instantané daté, script
  `scripts/update-2fa-directory.mjs`. Vérifier les licences avant l’ajout.
- `src/lib/security.ts` :
  - « Sans 2FA » seulement si le site propose une 2FA ; sinon, aucune alerte ;
  - nouvelle catégorie « Passkey disponible » : connexion par mot de passe
    sur un site qui accepte les passkeys, avec action « Créer une passkey »
    qui ouvre le site ;
  - nouvelle catégorie « Site sans HTTPS » pour les URL `http://`.
- La fiche d’une connexion affiche les méthodes de 2FA possibles (TOTP, SMS,
  clé matérielle) et un lien vers la documentation du site si le jeu de
  données le fournit.
- Le score de santé tient compte de la nouvelle règle (documenter le
  changement de calcul dans `CHANGELOG.md`, l’historique du score reste
  comparable ou est annoté).

### Critères d’acceptation
- Une connexion sur un site sans 2FA connue n’est plus comptée « Sans 2FA ».
- Le jeu de données n’est pas dans le bundle de l’extension.
- Aucune requête réseau (test).

---

## Q3 — Historique chiffré du générateur

### Pourquoi
Pendant une inscription, si l’enregistrement échoue ou si l’onglet se ferme,
le mot de passe généré est perdu alors que le site l’a déjà accepté.

### Conception
- Les 50 derniers mots de passe générés (app, extension, assistant de
  changement de mot de passe) sont conservés dans le contenu chiffré du
  coffre, avec la date et le domaine s’il est connu.
- Rétention configurable : 1, 7 ou 30 jours, ou désactivé. Défaut : 7 jours.
  Purge à l’ouverture du coffre, comme la corbeille.
- Écran « Historique du générateur » dans le générateur : copier, créer une
  connexion à partir d’une entrée, supprimer, tout effacer.
- Une entrée est retirée de l’historique dès qu’elle est enregistrée dans un
  élément.
- Synchronisé comme le reste du coffre (fusion par horloges).

### Critères d’acceptation
- Générer depuis l’extension, fermer l’onglet sans enregistrer : le mot de
  passe est retrouvable dans l’app.
- Désactiver l’option efface l’historique existant.
- Aucun mot de passe généré n’apparaît hors du contenu chiffré (test sur le
  fichier `.coffre` produit).

---

## Q4 — Sauvegardes planifiées avec rétention

### Pourquoi
Aujourd’hui, seules trois copies tournantes vivent dans le dossier de l’app.
Une panne de disque ou une suppression les emporte toutes.

### Conception
- Desktop : dossier cible choisi par l’utilisateur (disque externe, NAS,
  dossier synchronisé), fréquence quotidienne ou hebdomadaire, exécutée au
  démarrage ou à intervalles pendant que l’app tourne (pas de service
  système).
- Rétention : 7 quotidiennes, 4 hebdomadaires, 12 mensuelles (réglable).
  Noms de fichiers datés, écriture atomique, vérification du MAC après
  écriture.
- Les sauvegardes sont des fichiers `.coffre` chiffrés tels quels : aucun
  déchiffrement nécessaire, possible même verrouillé.
- « Tester la restauration » : ouvre une sauvegarde en lecture seule, vérifie
  l’intégrité (`verifyVault`) et compare le nombre d’éléments, sans toucher
  au coffre courant.
- Alerte au tableau de bord si la dernière sauvegarde réussie a plus de deux
  périodes, ou si le dossier cible est absent (disque débranché).
- Web : rappel d’export manuel à la même fréquence (pas d’accès disque en
  arrière-plan).
- Mode voyage : les sauvegardes planifiées sont suspendues tant qu’il est
  actif, pour ne pas écrire un coffre réduit par-dessus la rétention.

### Critères d’acceptation
- Après 40 jours simulés, la rétention conserve exactement le nombre
  attendu de fichiers par catégorie.
- Une sauvegarde corrompue est signalée par le test de restauration.
- Disque cible absent : aucune erreur bloquante, une alerte claire.

---

## Q5 — Codes de secours 2FA

### Conception
- Nouveau type d’élément « Codes de secours » (ou section d’une connexion) :
  liste de codes, chacun cochable « utilisé » avec la date.
- Import par collage d’un bloc de texte (un code par ligne ou séparés par des
  espaces), détection des formats courants.
- Alerte au tableau de bord quand il reste 2 codes ou moins.
- Copie d’un code → proposition de le marquer utilisé.
- Export CSV, CXF et KDBX : codes dans un champ texte long, documenté.

### Critères d’acceptation
- Coller 10 codes GitHub, en utiliser 8 : alerte affichée.
- L’élément s’exporte et se réimporte sans perte.

---

## Q6 — Alerte « TOTP et mot de passe au même endroit »

### Conception
- Option du tableau de bord, **désactivée par défaut** : signaler les
  connexions qui contiennent à la fois le mot de passe et le secret TOTP.
- Action « Déplacer le code 2FA » : crée un élément TOTP dans un coffre choisi
  (par exemple un coffre « 2FA » non marqué sûr pour le voyage) et retire le
  secret de la connexion, avec une version dans l’historique.
- Le remplissage de l’extension retrouve le TOTP dans l’autre coffre si les
  deux éléments partagent le domaine.

### Critères d’acceptation
- Déplacement réversible via l’historique de l’élément.
- Le remplissage TOTP fonctionne encore après déplacement.

---

## Q7 — Palette de commandes `⌘K`

### Conception
- `⌘K` / `Ctrl+K` ouvre une palette depuis n’importe quel écran déverrouillé.
- Résultats mélangés : éléments (même index de recherche que la liste,
  insensible aux accents), actions (nouvel élément par type, générateur,
  verrouiller, synchroniser, ouvrir un réglage précis, tableau de bord).
- Sur un élément : `Entrée` ouvre, `⌘C` copie le mot de passe, `⌘⇧C` le nom
  d’utilisateur, `⌘⌥C` le code TOTP, avec effacement temporaire du
  presse-papiers existant.
- Accessibilité : rôle `combobox` / `listbox`, piège à focus, annonces aux
  lecteurs d’écran.
- Aucun secret affiché dans la palette.

### Critères d’acceptation
- Toutes les actions de la barre latérale et des réglages sont accessibles.
- e2e : ouvrir, chercher, copier un mot de passe, sans souris.

---

## Q8 — Mini-fenêtre d’accès rapide (desktop)

### Conception
- Le raccourci global actuel (`⌘⇧Espace`) ouvre une petite fenêtre Tauri
  séparée, sans décoration, centrée, au-dessus des autres, au lieu de la
  fenêtre principale. Option pour garder l’ancien comportement.
- Contenu : champ de recherche, résultats, actions de copie de Q7. `Échap`
  ferme, la perte de focus ferme.
- Coffre verrouillé : déverrouillage dans la mini-fenêtre (mot de passe,
  Touch ID, Windows Hello si S1 est fait).
- Capability Tauri dédiée et minimale pour cette fenêtre.
- Sur macOS, la fenêtre ne doit pas apparaître dans le `⌘Tab` ni dans les
  captures d’écran partagées si l’API le permet (`NSWindow.sharingType`).

### Critères d’acceptation
- Raccourci → copier un mot de passe → fenêtre fermée en moins de 3 secondes
  au clavier seul.
- La fenêtre principale et la mini-fenêtre partagent le même état de
  verrouillage.

---

## Q9 — Résolution visuelle des conflits de synchronisation

### Pourquoi
`src/lib/sync.ts` archive la version perdante d’un conflit dans
l’historique, mais l’utilisateur n’en est pas informé.

### Conception
- Marquer chaque conflit archivé (identifiant, date, appareil d’origine) dans
  le contenu chiffré.
- Indicateur « N conflits à examiner » dans la barre latérale et au tableau de
  bord.
- Écran de comparaison : deux versions côte à côte, différences surlignées,
  secrets masqués par défaut, choix champ par champ ou version entière.
- « Garder la version actuelle » efface le marqueur sans rien changer ;
  toute résolution crée une version dans l’historique.

### Critères d’acceptation
- Conflit simulé entre deux appareils : indicateur visible, résolution
  champ par champ correcte, synchronisée ensuite sans nouveau conflit.

---

## Q10 — Notes en Markdown

### Conception
- Option par note : texte brut (défaut actuel) ou Markdown.
- Sous-ensemble sûr : titres, gras, italique, listes, cases à cocher
  cliquables, code, citations, liens `http(s)` uniquement. **Pas de HTML**,
  pas d’images distantes, rendu par une bibliothèque qui produit des éléments
  React (jamais `innerHTML`), compatible avec la CSP actuelle.
- Recherche sur le texte brut.

### Critères d’acceptation
- Un contenu contenant `<script>` ou `javascript:` s’affiche en texte.
- Cocher une case dans le rendu modifie la note et crée une version.

---

## Q11 — `coffre scan` : détection de secrets dans les fichiers

### Conception
- Nouvelle commande du CLI (`coffre-cli`) : `coffre scan [dossier]`.
- Détection par motifs connus (préfixes de jetons GitHub, AWS, Stripe, Slack,
  clés privées PEM, URL avec mot de passe) et par entropie sur les
  affectations de type `KEY=...` dans `.env`, YAML, JSON.
- Respecte `.gitignore` en option, ignore `node_modules` et binaires, limite
  de taille par fichier.
- Rapport : fichier, ligne, type, secret **masqué** (4 premiers caractères).
- `--import` : propose de créer un élément « Identifiant d’API » par secret et
  de remplacer la valeur par une référence `coffre://coffre/élément/champ`,
  lue par `coffre run`. Remplacement seulement après confirmation, avec
  sauvegarde du fichier d’origine.
- Aucune sortie du secret complet, ni à l’écran ni dans les journaux.

### Critères d’acceptation
- Un dépôt de test avec 10 secrets plantés : 10 détectés, 0 faux positif sur
  un projet témoin (ce dépôt lui-même).
- Le remplacement puis `coffre run` redonne la bonne valeur au programme.

---

## Q12 — Signature des commits Git par l’agent SSH

### Conception
- L’agent SSH (`coffre-ssh-agent`, `src-tauri/src/ssh_agent.rs`) reconnaît les
  demandes de signature d’un espace de noms `git` (format SSHSIG).
- Confirmation à chaque signature, avec le dépôt si disponible, ou
  autorisation pour 5 minutes (option).
- Assistant dans la fiche d’une clé SSH : commandes `git config` à copier
  (`gpg.format ssh`, `user.signingkey`, `commit.gpgsign`) et fichier
  `allowed_signers` généré.

### Critères d’acceptation
- `git commit -S` signe via Coffre, `git log --show-signature` valide.
- Coffre verrouillé : la signature échoue proprement.

---

## 2. Points de vigilance transverses

- **Faux positifs** (Q1, Q2, Q6, Q11) : un avertissement trop fréquent est
  ignoré. Mesurer sur des coffres réalistes (fixtures) et documenter les
  seuils choisis.
- **Jeux de données** : versionnés, datés, avec licence ; jamais téléchargés
  à l’exécution.
- **Documentation** : chaque lot met à jour `README.md`, `docs/SECURITY.md`
  (nouvelles données stockées, nouveaux signaux), `CHANGELOG.md`, et les
  traductions anglaises.
