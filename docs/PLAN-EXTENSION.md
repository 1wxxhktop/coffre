# Plan d’amélioration de l’extension navigateur

Document destiné à un agent de développement. Il porte sur l’extension
Manifest V3 (`extension/`) : fonctionnalités, praticité, design, fiabilité et
diffusion. État de départ : `main` au 9 novembre 2026, extension 0.8.0.

Les règles de la section 0 de `docs/PLAN-IMPLEMENTATION.md` s’appliquent
intégralement (principes non négociables, une PR par lot, contrôles
obligatoires, documentation, définition de « terminé »).

Plans liés :
- `docs/PLAN-FEATURES-QUOTIDIEN.md` : Q1 (anti-hameçonnage) et Q3 (historique
  du générateur) ont une partie dans l’extension ; ce plan s’appuie dessus
  sans les refaire.
- `docs/PLAN-INTEGRATION-SYSTEME.md` : S5 (Safari, hors programme faute de compte Apple) et S1 (icône de barre de
  menus, app gardée en arrière-plan) facilitent E1.

---

## 0. Règles propres à ce plan

1. **Le secret ne vit pas dans l’extension.** L’extension ne stocke aucun
   identifiant de façon durable. Seule exception déjà en place : la clé de
   session du pont natif. Un secret en transit (proposition d’enregistrement)
   peut aller dans `chrome.storage.session` (mémoire uniquement, jamais sur
   disque), avec une durée de vie courte, jamais dans `storage.local`.
2. **Permissions minimales.** Toute nouvelle permission (`commands`,
   `contextMenus`, `sidePanel`, `<all_urls>` optionnel) est justifiée dans la
   PR et dans `docs/SECURITY.md`. Les permissions d’hôte restent optionnelles.
3. **Rien de Coffre dans le DOM de la page.** Toute interface affichée dans une
   page (menu, bandeau) vit dans une iframe d’extension, comme `menu.html`
   aujourd’hui. La page ne voit ni noms d’éléments, ni secrets, ni état du
   coffre.
4. **Chromium et Firefox.** Chaque lot fonctionne dans les deux (Firefox 128+),
   ou documente pourquoi une API manque (ex. `sidePanel`).
5. **Taille du bundle.** Mesurée avant et après chaque lot ; aucun jeu de
   données lourd dans l’extension.
6. **CI et nettoyage.** Le dépôt est public : les runners standard sont
   gratuits, sans quota. Les tests de l’extension tournent sur Linux/Chromium,
   et les jobs macOS/Windows peuvent être ajoutés si nécessaire. Après chaque
   fusion ou release, exécuter `bun run post-merge` : il met à jour `release/`
   avec la dernière version, vérifie qu’une seule version est présente, puis
   nettoie les artefacts. `release/` n’est jamais supprimé.

---

## 1. Vue d’ensemble

| Lot | Contenu | Thème | Valeur | Taille |
| --- | --- | --- | --- | --- |
| E0 | Propositions d’enregistrement perdues à la mise en veille du service worker | Bug | Critique | S |
| E1 | Déverrouiller depuis l’extension (Touch ID / mot de passe via l’app) | Praticité | Très haute | M |
| E2 | Bandeau d’enregistrement dans la page | Fonction | Très haute | M |
| E3 | Raccourcis clavier | Fonction | Haute | S |
| E4 | Menu clic droit | Fonction | Haute | S |
| E5 | Accueil à l’installation et réglages complets | Praticité | Haute | M |
| E6 | Mot de passe fort proposé à l’inscription | Fonction | Haute | S |
| E7 | Exclusions par site (« Ne jamais enregistrer », « Ne jamais remplir ») | Fonction | Moyenne | S |
| E8 | Popup en sections, icônes, navigation clavier, états guidés | Design | Haute | M |
| E9 | Créer et modifier depuis la popup | Fonction | Moyenne | M |
| E10 | Petits plus : badge du nombre de connexions, TOTP copié après remplissage, activation sur tous les sites | Praticité | Moyenne | S |
| E11 | Remplissage au chargement (opt-in) et panneau latéral | Fonction | Moyenne | M |
| E12 | Corpus de pages réelles pour la qualité de détection | Fiabilité | Haute | M |
| E13 | Publication Chrome Web Store et Firefox | Diffusion | Haute | S |

Ordre recommandé : **E0 → E1 → E2 → E3 → E4 → E5 → E12 → E6 → E7 → E8 →
E10 → E9 → E11 → E13**.

E12 vient tôt : le corpus protège tous les lots suivants contre les
régressions de détection.

---

## E0 — Propositions d’enregistrement perdues

### Constat
`pendingSaves` (`extension/background.ts`) est une `Map` en mémoire. Chrome
arrête le service worker d’une extension MV3 après environ 30 secondes
d’inactivité : une proposition d’enregistrement faite après une inscription
disparaît si l’utilisateur ouvre la popup plus tard. Même problème pour tout
autre état gardé en variable globale du service worker.

### Conception
- Recenser toutes les variables globales du service worker qui doivent
  survivre à un redémarrage (propositions d’enregistrement, demandes de
  passkey en cours, état du badge, état d’activation par onglet).
- Les propositions d’enregistrement vont dans `chrome.storage.session`
  (Firefox : `browser.storage.session`, disponible depuis 115), avec :
  - une expiration de 10 minutes, purgée à chaque lecture ;
  - au plus 10 propositions, les plus anciennes supprimées ;
  - suppression à la fermeture de l’onglet et au verrouillage de Coffre.
- `setAccessLevel` restreint `storage.session` aux contextes de confiance
  (pas aux content scripts).
- Le badge est recalculé au réveil du service worker.

### Critères d’acceptation
- Test : proposition créée, service worker arrêté (Playwright :
  `serviceWorker` fermé ou `chrome://serviceworker-internals`), popup ouverte
  ensuite → la proposition est là.
- Après 10 minutes simulées, elle a disparu.
- Aucun secret dans `storage.local` (test qui lit tout le stockage local).

---

## E1 — Déverrouiller depuis l’extension

### Pourquoi
Aujourd’hui, l’extension ne sert que si l’onglet Coffre ou l’app desktop est
déjà déverrouillé. C’est la plus grosse friction face à Bitwarden et
1Password.

### Conception
- **Avec le pont natif** : nouveau message `UNLOCK_REQUEST`. L’app desktop,
  même sans fenêtre visible, déclenche Touch ID (ou Windows Hello si S1 est
  fait) ; en cas de refus ou d’absence de biométrie, elle affiche sa fenêtre
  de déverrouillage au premier plan. La popup montre « Déverrouillage en
  cours… » puis se met à jour.
- **Si l’app desktop n’est pas lancée** : le pont natif peut la lancer (l’hôte
  natif connaît son chemin), puis demander le déverrouillage.
- **Sans app desktop (mode Web)** : bouton « Ouvrir Coffre pour
  déverrouiller » qui ouvre ou active l’onglet Coffre, puis la popup se met à
  jour seule quand le coffre est déverrouillé.
- Le mot de passe maître n’est **jamais** saisi dans la popup ni transmis par
  le pont : la saisie se fait dans l’app.
- Limite de fréquence : une demande en cours à la fois, annulable.

### Critères d’acceptation
- App desktop lancée et verrouillée : clic sur « Déverrouiller » → Touch ID →
  la popup affiche les connexions du site sans autre action.
- App fermée : elle se lance et demande le déverrouillage.
- Refus Touch ID : aucune clé libérée, message clair dans la popup.

---

## E2 — Bandeau d’enregistrement dans la page

### Conception
- Après une soumission détectée (`FORM_SUBMITTED`), un bandeau s’affiche en
  haut à droite de la page, dans une iframe d’extension
  (`save-banner.html`), sur la page d’arrivée après redirection (même
  onglet, même domaine enregistrable ou domaine attendu).
- Contenu : « Enregistrer le mot de passe pour github.com ? » ou « Mettre à
  jour le mot de passe de nom@exemple.fr ? », nom d’utilisateur modifiable,
  choix du coffre, boutons « Enregistrer », « Plus tard », « Jamais pour ce
  site » (E7).
- « Plus tard » garde la proposition dans la popup (E0) ; le bandeau se ferme
  seul après 30 secondes sans interaction.
- Le mot de passe n’est jamais affiché dans le bandeau ; il n’est pas transmis
  à l’iframe, seulement un identifiant de proposition.
- Q1 : si la page déclenche un signal d’hameçonnage, le bandeau le dit et
  « Enregistrer » n’est pas le bouton par défaut.

### Critères d’acceptation
- Inscription sur une page de test avec redirection : bandeau visible sur la
  page d’arrivée, enregistrement correct dans Coffre.
- La page ne peut ni lire ni cliquer le bandeau (test : `contentDocument`
  inaccessible, clic synthétique ignoré).
- Coffre verrouillé : le bandeau propose de déverrouiller (E1) puis
  enregistre.

---

## E3 — Raccourcis clavier

### Conception
- Section `commands` du manifeste, modifiables par l’utilisateur dans
  `chrome://extensions/shortcuts` et `about:addons` :
  - `_execute_action` : ouvrir la popup (`⌘⇧K` / `Ctrl+Shift+K`) ;
  - `fill-login` : remplir la connexion la plus pertinente du site
    (`⌘⇧L` / `Ctrl+Shift+L`) ; s’il y en a plusieurs, ouvrir le menu du champ
    actif ;
  - `generate-password` : générer et remplir le champ de mot de passe actif,
    avec les règles du site ;
  - `fill-totp` : remplir le code TOTP dans le champ actif.
- Vérifier l’absence de conflit avec les raccourcis du navigateur sur macOS,
  Windows et Linux ; documenter les choix.
- Les raccourcis sont affichés dans la popup (aide) et dans les réglages.

### Critères d’acceptation
- e2e Chromium : `fill-login` remplit sur la page de test sans ouvrir la
  popup.
- Sans permission sur le site, le raccourci utilise `activeTab` (geste de
  l’utilisateur) et fonctionne quand même.

---

## E4 — Menu clic droit

### Conception
- Permission `contextMenus`. Sur un champ éditable :
  - « Remplir avec Coffre » → sous-menu des connexions du site (noms affichés
    seulement quand Coffre est déverrouillé) ;
  - « Générer un mot de passe » ;
  - « Insérer un alias e-mail » ;
  - « Remplir une carte » / « Remplir une identité ».
- Sur une page : « Ouvrir Coffre », « Ajouter ce site à Coffre ».
- Coffre verrouillé : une seule entrée « Déverrouiller Coffre » (E1).
- Le menu est reconstruit à l’activation d’un onglet, sans exposer de données
  d’un autre site.

### Critères d’acceptation
- Les entrées utilisent `activeTab` et fonctionnent sans permission préalable
  sur le site.
- Aucun nom d’élément d’un autre domaine n’apparaît dans le menu.

---

## E5 — Accueil à l’installation et réglages complets

### Conception
- `runtime.onInstalled` (raison `install`) ouvre `welcome.html` :
  1. choisir le mode : application desktop (recommandé) ou application Web ;
  2. appairer (desktop) ou indiquer l’adresse de l’app (Web) et tester ;
  3. choisir l’activation : site par site (défaut) ou tous les sites ;
  4. montrer les raccourcis (E3) et l’épinglage de l’extension.
- Après une mise à jour (raison `update`), une note courte seulement si une
  permission ou un comportement change.
- Page d’options enrichie, en sections :
  - Connexion à Coffre (mode, appairage, adresse, test) ;
  - Remplissage (menu dans les champs, TOTP copié après remplissage, remplissage
    au chargement, sites autorisés) ;
  - Enregistrement (bandeau, exclusions E7) ;
  - Raccourcis (lien vers la page du navigateur) ;
  - Apparence (thème).
- Les réglages de l’extension vont dans `storage.local` ; ils ne contiennent
  aucun nom de site **sauf** les exclusions, documentées dans
  `docs/SECURITY.md`. Variante plus discrète à étudier : stocker les
  exclusions dans le coffre et les obtenir par le pont.

### Critères d’acceptation
- Nouvelle installation : l’utilisateur arrive à un remplissage fonctionnel
  sans lire la documentation (test manuel chronométré, noté dans la PR).
- Toutes les options existantes restent accessibles.

---

## E6 — Mot de passe fort proposé à l’inscription

### Conception
- `detect.ts` distingue déjà connexion et inscription ; sur un champ « nouveau
  mot de passe » (`autocomplete="new-password"`, confirmation, formulaire
  d’inscription ou de changement), le menu du champ affiche en premier
  « Utiliser un mot de passe fort », avec un aperçu partiel.
- Génération selon les règles du site (`passwordRules.ts`), remplissage du
  champ et de sa confirmation, puis proposition d’enregistrement préparée
  (E2) et entrée dans l’historique du générateur (Q3, s’il est fait).

### Critères d’acceptation
- Formulaire d’inscription de test : un clic remplit les deux champs avec un
  mot de passe conforme aux règles.
- Aucun déclenchement sur un formulaire de connexion simple.

---

## E7 — Exclusions par site

### Conception
- « Ne jamais proposer d’enregistrer » et « Ne jamais afficher le menu » par
  domaine enregistrable, depuis le bandeau (E2), le menu du champ et la popup.
- Liste modifiable dans les réglages (E5), avec suppression.

### Critères d’acceptation
- Domaine exclu : aucun bandeau, aucune proposition dans la popup.
- Retirer l’exclusion rétablit le comportement sans recharger l’extension.

---

## E8 — Design de la popup

### Conception
- **Sections** : « Pour ce site » en tête, puis Favoris, puis Récents ; la
  recherche bascule sur tout le coffre.
- **Icônes sans réseau** : mêmes icônes par type et pastilles d’initiales que
  l’app (`ItemIcon`), aucune favicon téléchargée.
- **Navigation clavier** complète : flèches, `Entrée` remplit, `⌘C` copie le
  mot de passe, `⌘⇧C` l’identifiant, `⌘⌥C` le TOTP, `/` focus sur la
  recherche, `Échap` revient en arrière.
- **États guidés**, chacun avec un message et une action principale : app
  fermée, non appairé, coffre verrouillé (E1), site non autorisé, aucun
  résultat (« Ajouter ce site »).
- Jetons de design de l’app ; vérifier contraste, focus visible et lecteurs
  d’écran (rôles `listbox` / `option`).

### Critères d’acceptation
- Captures avant / après dans la PR, en clair et en sombre.
- e2e : ouvrir la popup, sélectionner au clavier, remplir, sans souris.

---

## E9 — Créer et modifier depuis la popup

### Conception
- « Ajouter ce site » : formulaire court (nom, identifiant, mot de passe
  généré, coffre), envoyé à l’app par le pont ou l’onglet Coffre ; l’app fait
  l’écriture (persistance contrôlée), jamais l’extension.
- « Modifier le mot de passe » d’une connexion existante, avec l’ancien
  conservé dans l’historique de l’élément.
- Coffres en lecture seule (partage) : actions masquées.

### Critères d’acceptation
- Création et modification visibles immédiatement dans l’app ; historique de
  version créé.

---

## E10 — Petits plus

- **Badge** : nombre de connexions pour le site actif (« 2 »), seulement quand
  Coffre est déverrouillé et le site autorisé ; le point « ● » des
  propositions d’enregistrement reste prioritaire.
- **TOTP copié après remplissage** (option, désactivée par défaut) : copie du
  code avec effacement après 30 secondes si le presse-papiers n’a pas changé ;
  documenter que c’est une exception au principe « l’extension ne copie
  rien ».
- **Activer sur tous les sites** : demande unique de la permission optionnelle
  `https://*/*` avec une explication claire ; révocable dans les réglages.

---

## E11 — Remplissage au chargement et panneau latéral

- **Remplissage au chargement**, désactivé par défaut, activable site par
  site : seulement dans le cadre principal, en HTTPS, s’il y a exactement une
  connexion correspondante, sans signal Q1, et jamais de soumission
  automatique.
- **Panneau latéral** (`sidePanel` Chromium, `sidebar_action` Firefox) : même
  interface que la popup, qui reste ouverte pendant les longs formulaires.

---

## E12 — Corpus de pages réelles

### Conception
- `e2e/corpus/` : une cinquantaine de pages de connexion, d’inscription, de
  changement de mot de passe et de paiement, **reconstruites** à partir de la
  structure HTML de sites populaires (sans copier leurs contenus ni marques),
  couvrant Shadow DOM, applications à page unique, connexion en plusieurs
  étapes, iframes, champs sans `name`, `autocomplete` trompeur.
- Pour chaque page, le résultat attendu de la détection dans un fichier JSON.
- Un test Vitest (rapide, sur `detect.ts` avec un DOM simulé) et un e2e
  Chromium (échantillon) mesurent le taux de détection ; la PR affiche le
  taux avant / après.

### Critères d’acceptation
- Taux de détection mesuré et publié dans `docs/` ; toute baisse fait échouer
  le test.

---

## E13 — Publication

- **Chrome Web Store** : compte développeur (5 $, une fois) créé **par
  l’utilisateur**. L’agent prépare la fiche (texte français et anglais,
  captures, politique de confidentialité, justification de chaque
  permission) et un script de paquet reproductible.
- **Firefox (AMO)** : gratuit. Lint `web-ext`, fiche, publication en
  « listed ». La variante Firefox existe déjà.
- **Edge Add-ons** : même paquet que Chrome.
- Aucune publication par l’agent : il prépare, l’utilisateur soumet.

---

## 2. Points de vigilance transverses

- **Surface d’attaque de la page** : toute nouvelle interface dans la page
  passe par une iframe d’extension ; les messages entre content script et
  iframe sont validés (origine, identifiant de proposition, pas de secret).
- **Service worker MV3** : tout état qui doit survivre va dans
  `storage.session` ; tester systématiquement le redémarrage du worker.
- **Accessibilité** : bandeau, menu et popup utilisables au clavier et au
  lecteur d’écran.
- **Documentation** : chaque lot met à jour `README.md` (section Extension),
  `docs/SECURITY.md` (permissions, données stockées), `CHANGELOG.md` et les
  traductions `extension/public/_locales/`.
