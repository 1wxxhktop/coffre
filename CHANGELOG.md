# Journal des changements

## 0.14.0 — 11 novembre 2026

- Documentation : `docs/RELEASE.md` et `docs/RELEASE-READINESS.md` décrivent
  désormais les mises à jour signées (B-02), la publication stable/bêta et la
  vérification d’une mise à jour depuis l’application.

### Sécurité

- **Manifeste d’intégrité 3** : l’identité publique complète des contacts
  d’urgence (clés de chiffrement et de signature, empreinte et enveloppe
  scellée) est désormais couverte par le MAC. Une clé remplacée sans changer le
  MAC est détectée ; l’empreinte est vérifiée avant tout changement de mot de
  passe ou récupération. Les manifestes 1 et 2 restent lisibles et sont réécrits
  en manifeste 3 à la première mutation.
- Les fichiers manifeste 3 sont ouverts en lecture seule par les applications
  0.12, qui ne peuvent pas vérifier le nouveau MAC. Voir
  [`docs/VERSIONING.md`](docs/VERSIONING.md) pour la procédure de mise à jour
  multi-appareils.
- `bun run version:check` vérifie désormais le format `.coffre`, le manifeste et
  les versions de protocoles en plus des versions produit.
- **Bundles de coffres partagés** : validation complète des identifiants, dates,
  doublons, relations élément/pièce jointe/version et pierres tombales avant
  import. Un bundle invalide est rejeté en entier et ne peut plus rendre le
  fichier local illisible.
- **Administrateur de coffre partagé épinglé** : un membre `write` ne peut plus
  se nommer administrateur avec un paquet plus récent. Le changement
  d’administrateur est refusé tant qu’une rotation signée par l’administrateur
  actuel n’est pas explicitement prise en charge.
- **Adoption d’époque** : les modèles, le journal d’activité, l’historique du
  générateur, les clés d’alias, l’identité de partage et l’accès d’urgence sont
  ré-enveloppés sous la nouvelle clé maîtresse. L’enveloppe PRF est retirée et
  doit être ré-enrôlée.
- **Fusion** : les enveloppes `emergency` et `prf` sont conservées au lieu
  d’être supprimées à chaque synchronisation.
- **Pièces jointes blob** : elles survivent au verrouillage, aux modifications
  et à la vérification ; leur suppression ne dépend plus d’un enregistrement
  inline et leur taille n’est plus plafonnée à 5 Mio.
- **Rotation Rust** : les sidecars modèles/activité/générateur/clés d’alias sont
  rescellés ; la rotation refuse explicitement le partage et l’accès d’urgence
  que le cœur Rust ne sait pas ré-envelopper, au lieu de les laisser sous
  l’ancienne clé. `templateWraps` est préservé.
- Une dégradation connue `v4 → v3` ouvre désormais le coffre en lecture seule.
- **LAN** : le protocole passe en version 2 et toutes les trames
  post-handshake (appairage, synchronisation, blobs) sont chiffrées et
  authentifiées par Noise. Les anciennes versions ne peuvent plus s’appairer
  avec cette version. Les codes d’appairage sont limités aux adresses locales,
  et une connexion invalide ne consomme plus toute la fenêtre d’appairage ou de
  synchronisation.
- **Fichiers blob** : les commandes `blob_encrypt`/`blob_decrypt` ouvrent un
  dialogue natif et ne reçoivent plus de chemin arbitraire depuis la WebView.
  Les fichiers temporaires sont créés en `0600`, nettoyés en cas d’échec et la
  cible déchiffrée reçoit aussi `0600`.
- **Origines locales Tauri** : seules `tauri://localhost` et
  `http://tauri.localhost` (sans port arbitraire) sont acceptées. Les variantes
  `tauri://evil`, `tauri.localhost:8080` et `https://tauri.localhost` sont
  refusées.
- **Auto-type** : la saisie est refusée dans la fenêtre Coffre côté Rust, le
  focus est revérifié entre chaque caractère et les secrets sont effacés après
  usage.
- **Lecture seule** : l’agent SSH et les mutations FFI refusent désormais un
  coffre dont le MAC global est invalide.
- **PDF** : la CSP autorise `frame-src blob:` pour l’aperçu des pièces jointes
  PDF, et `core:window:allow-hide` est accordé à l’auto-type.
- **Pont natif** : plafond de 16 connexions simultanées ; la variable de test
  `COFFRE_BRIDGE_SOCKET` n’est active qu’en build de débogage.
- Les identifiants de blobs et de synchronisation refusent les noms réservés
  Windows (`CON`, `NUL`, `COM1`, etc.).
- **Verrouillage** : les opérations longues (sync, import, restauration voyage)
  vérifient l’époque de verrouillage avant d’appliquer leur résultat ; une
  session ressuscitée est effacée immédiatement et les sidecars déchiffrés
  (activité, historique du générateur, clés d’alias, modèles) sont vidés.
- **Presse-papiers** : une copie qui se termine après le verrouillage est
  immédiatement effacée ; le code d’appairage LAN utilise le même mécanisme.
- **Mode voyage** : activation impossible sans source de synchronisation, le
  marqueur est écrit avant toute écriture destructive et les sauvegardes
  tournantes ne sont plus écrasées par la version strippée.
- **Exports en clair** : CXF, KDBX et journal d’activité exigent à nouveau le
  mot de passe maître.
- « Tout effacer » supprime aussi l’historique de sécurité, les préférences
  d’alias, les notifications d’échéance et la configuration de partage local.
- **Passerelle extension** : un hôte non vide est obligatoire pour remplir un
  identifiant ; `allowMismatch` n’est plus une autorisation fournie par
  l’appelant. Les recherches vides ne renvoient plus tout le coffre, la
  passerelle est révoquée au verrouillage et les passkeys demandent une
  confirmation.
- **Remplissage forcé** : un hôte différent de celui de l’élément est refusé
  même après l’avertissement anti-hameçonnage ; « Continuer » ne reste proposé
  que pour l’enregistrement, qui n’expose aucun secret.
- **Autofill** : l’origine et le port sont vérifiés dans le document cible juste
  avant l’injection, ce qui bloque le changement d’onglet pendant la
  récupération des identifiants.
- **Popup** : `DETAILS` transmet l’URL complète, le mode Web n’appelle plus le
  pont natif, et les propositions d’enregistrement sont purgées dès que le
  coffre est verrouillé.
- Les protocoles du pont natif et de l’extension passent en version 2.

### P2/P3

- **CSV** : les cellules commençant par `=`, `+`, `-`, `@`, tabulation ou retour
  chariot sont préfixées par `'` pour neutraliser les formules de tableur.
- **Imports KDBX/1PUX** : les paramètres Argon2 KDBX sont alignés sur les bornes
  du coffre (256 Mio / 6 passes / 8 threads), l’AES-KDF est plafonné à 2 millions
  de tours, la décompression KDBX est limitée à 128 Mio et l’archive 1PUX
  n’extrait que `export.attributes`/`export.data` avec un plafond de 128 Mio.
- **Rôle lecture** : corbeille, restauration, restauration de version,
  suppression de pièce jointe, renommage et suppression de coffre vérifient
  désormais le rôle local.
- **TOTP** : les algorithmes inconnus sont refusés ; les chiffres (6–8) et la
  période (1–300 s) sont validés de la même façon en TypeScript et en Rust.
- **Biométrie** : le texte du dialogue système est fixe côté Rust ; une page
  compromise ne peut plus présenter une demande trompeuse.
- `setAliasDefaults` tolère un stockage local indisponible ; `NOTICE` et le
  README reflètent les dépendances et compteurs actuels.
- `setVaultKey` efface l’ancienne clé ; `addVault` vérifie la clé de récupération
  avant toute mutation ; la vérification compte tous les enregistrements du
  manifeste ; les pierres tombales de modèles sont validées ; `addAttachment`
  relit le contenu existant pour appliquer les plafonds.
- **Accessibilité** : les notifications sont rendues hors de `#root`, donc
  annoncées même lorsqu’une modale est ouverte ; le focus revient au déclencheur
  après la fermeture d’une modale imbriquée ; la palette de commandes rend
  l’arrière-plan inerte via un verrou partagé ; le menu mobile ne reprend plus
  le focus à chaque rendu et se présente comme une boîte de dialogue.
- **Anglais** : les derniers libellés `tt()` sans traduction sont couverts, et
  `check-i18n.mjs` vérifie désormais chaque littéral `tt()` contre le
  dictionnaire anglais au lieu de laisser passer les clés non citées.

### Tauri

- **AppManifest** : les 67 commandes applicatives sont déclarées et couvertes
  par la capacité `default` de la fenêtre principale. Une WebView non locale
  ne peut plus appeler ces commandes par défaut.
- Les permissions générées par `tauri-build` sont ignorées par Git.
- **Extension** : les content scripts ne peuvent envoyer que `CONTENT_CONTEXT`,
  `FORM_SUBMITTED`, `GET_PENDING_BANNER`, `PASSKEY_REQUEST` et
  `PASSKEY_CANCEL` ; recherche, détails, remplissage, appairage et sauvegarde
  sont réservés aux pages de l’extension.
- **Menu inline** : chaque menu reçoit un jeton aléatoire lié à son onglet et à
  son cadre, enregistré avant le chargement de l’iframe. Un `menu.html` encadré
  directement par un site ne peut plus agir sans ce jeton.
- **Domaines** : correspondance exacte par défaut, avec la seule exception
  `www.example.com` ↔ `example.com`. Les relations parent/sous-domaine
  (`example.com` ↔ `login.example.com`) ne sont plus acceptées ; les vecteurs
  TypeScript/Rust et le smoke test sont alignés.
- **Appairage du pont natif** : l’application et l’extension affichent une
  empreinte courte de la clé publique de l’extension. L’utilisateur peut la
  comparer des deux côtés au lieu de traiter le code envoyé au demandeur comme
  une authentification.

### CI et release

- Toutes les actions GitHub sont épinglées par SHA, y compris le job de
  signature de release ; les checkouts utilisent `persist-credentials: false`.
- Le job de release exécute désormais formatage, clippy, tests workspace,
  `cargo deny` et `cargo audit` avant de signer.
- Le canal bêta échoue fermé si son manifeste courant existe mais est illisible.
- `bun audit` passe au niveau `moderate` ; `glob` et `minimatch` sont forcés
  vers des versions corrigées par `overrides`. L’alerte faible restante
  (`deepmerge`, sans version corrigée publiée) est documentée dans
  `docs/SECURITY.md`.
- `.gitignore` exclut les coffres locaux, fichiers `.env`, certificats et clés.
- Le script de release vérifie le lockfile (`cargo fetch --locked`) et sélectionne
  le DMG de la version courante.
- Le job de release génère une **attestation de provenance** GitHub pour le DMG,
  l’archive `.app.zip` et le paquet de mise à jour, vérifiable avec
  `gh attestation verify`.
- Le **SBOM web** est complété depuis `bun pm licenses --json` pour inclure les
  paquets que cyclonedx-npm omet (dont `@tauri-apps/api` et
  `@tauri-apps/plugin-dialog`) ; `scripts/check-sbom.mjs` vérifie les
  composants runtime attendus dans les SBOM web, cœur et FFI.

## 0.13.0 — 11 novembre 2026

- Fiche d’une connexion : le bloc « Sécurité » liste désormais les autres
  comptes qui utilisent exactement le même mot de passe, avec leur identifiant
  et leur site. Un clic ouvre le compte concerné pour changer son mot de passe
  sans perdre le fil de la vérification.
- `bun run release:collect` écrit toujours dans le dossier `release/` de la
  racine du dépôt, même lancé depuis un worktree, et retire les versions
  précédentes pour ne garder qu’un exemplaire (`--keep` pour les conserver).

- Extension : l’association avec l’application n’est plus redemandée après
  chaque mise à jour. Sous macOS, la clé d’appairage est gardée dans un fichier
  privé de l’application plutôt que dans le trousseau, qui la refusait à chaque
  nouvelle version d’une application signée ad hoc. Une dernière association
  est nécessaire après l’installation de cette version.
- Extension : mise à jour automatique. L’application embarque l’extension et en
  tient une copie à jour dans un dossier fixe (Réglages → Mises à jour →
  Extension navigateur). Chargée une fois depuis ce dossier, l’extension se
  recharge d’elle-même après chaque mise à jour de Coffre, sans requête réseau.
- Mises à jour : interrupteur « Mettre à jour automatiquement », qui règle d’un
  coup la recherche, le téléchargement en arrière-plan et l’installation à la
  fermeture.
- macOS : l’icône de la barre de menus affiche le cadenas de Coffre au lieu
  d’un carré plein.

## 0.12.0 — 11 novembre 2026

- Palette de commandes : `⌘K` / `Ctrl+K` ouvre une recherche unique pour
  ouvrir un élément ou lancer une action (nouvel élément, générateur, bilan de
  sécurité, réglages, verrouillage…). Elle ne cherche que dans le titre,
  l’identifiant, les adresses et les étiquettes, jamais dans les secrets.
- Accès rapide : les éléments utilisés récemment apparaissent en tête de la
  liste complète.
- Fiche d’un élément : un clic sur une ligne copie sa valeur, avec « Copié »
  affiché sur place ; la robustesse et l’alerte éventuelle sont sous le mot de
  passe ; un bloc « Sécurité » résume robustesse, ancienneté, réutilisation,
  fuites connues et double authentification.
- Icônes : un compte sans site reconnu reçoit une pastille à initiale teintée,
  calculée localement d’après son nom, sans aucune requête réseau.
- Champs personnalisés : réordonnables par glisser-déposer ou avec les flèches
  haut et bas sur la poignée.
- En-tête étroit : libellés courts (« Copier », « Alias ») avant de passer aux
  icônes seules.
- Les notifications ne recouvrent plus la barre d’état.

## 0.11.0 — 11 novembre 2026

- Duplication en un clic : bouton à côté du titre et raccourci `⌘D` /
  `Ctrl+D` ; la copie s’ouvre directement en modification.
- TOTP : saisie directe de la clé secrète fournie par le site (espaces et
  minuscules acceptés), enregistrée comme lien `otpauth://` avec le site et
  l’identifiant ; un lien `otpauth://` reste accepté et ses réglages
  particuliers sont conservés.
- Champs personnalisés : 13 types (texte, texte long, texte masqué, mot de
  passe, code PIN, code 2FA avec code en direct, adresse web, e-mail,
  téléphone, nombre, date, mois et année, oui / non), avec saisie adaptée,
  affichage formaté et validation indicative. Les valeurs secrètes ne sont plus
  indexées par la recherche. Un type inconnu est lu comme du texte au lieu de
  rendre l’élément illisible.
- En-tête de l’élément : « Modifier » (ou « Enregistrer », « Restaurer ») est
  toujours sur la ligne du titre, en texte ou en icône selon la largeur du
  panneau ; les autres actions tiennent sur une seule ligne justifiée en
  dessous, à toutes les tailles. La barre d’actions fixe du mobile disparaît.
- Barre d’état : version de l’application en bas à droite, avec à côté la
  recherche de mise à jour et son état (disponible, téléchargement,
  redémarrage, erreur) sur desktop.
- Vue étroite : les titres de groupe collants de la liste ne passent plus
  par-dessus le panneau de détail.

## 0.10.0 — 10 novembre 2026

- `bun run release:collect` rassemble dans un dossier local `release/` tous
  les exécutables construits par la CI sur `main` : DMG macOS, installateurs
  Windows, paquets Linux, outils en ligne de commande (`coffre-cli`,
  `coffre-git-sign`, `coffre-ssh-agent`) pour chaque système, extension,
  application Web et SBOM, avec empreintes SHA-256. La CI compile désormais
  ces outils sur les trois systèmes, ne conserve que les paquets finaux et les
  garde 30 jours.

- CI : le dépôt étant public, les runners GitHub sont gratuits. Chaque PR et
  chaque push lancent de nouveau les tests sur macOS et Windows et les
  parcours Playwright sur WebKit ; les bundles desktop et la reproductibilité
  macOS tournent sur chaque push vers `main`.
- Correctifs révélés par la première CI complète : l’application desktop
  compile de nouveau sous Linux (type du chemin de session logind) ; les tests
  du binaire de l’agent SSH ne tournent que sous Unix et un test vérifie le
  message d’indisponibilité sous Windows ; le raccourci « remplir la
  connexion » passe à `Alt+Shift+L` sur tous les systèmes, `Ctrl+Shift+L`
  n’étant pas attribué par Chromium sous Linux.

- Releases macOS sans compte Apple : `scripts/release-macos.sh` et la CI
  produisent par défaut un bundle universel signé ad hoc (hardened runtime),
  sans Developer ID ni notarisation, avec le paquet de mise à jour signé par
  la clé de Coffre. Les notes de release expliquent la première ouverture
  (« Ouvrir quand même ») ; les mises à jour suivantes s’installent depuis
  l’application. Le mode Developer ID reste disponible si un certificat est
  fourni. Plans : S0, S3, S4 et S5 (AutoFill macOS, passkeys système,
  extension Safari) sont hors programme.

- Codes de secours 2FA : nouveau type d’élément avec import par collage (un
  code par ligne ou séparés par des espaces, puces et doublons ignorés), suivi
  « utilisé » avec date, copie avec proposition de marquer le code utilisé, et
  alerte du tableau de bord à partir de deux codes restants. Les codes restent
  chiffrés dans le contenu de l’élément ; l’export `.coffre` les conserve. Le
  CSV complet ajoute une colonne `recovery_codes`, CXF et KDBX les placent dans
  un champ texte long documenté, en clair comme le reste de ces exports.
- Mises à jour de l’application desktop (Réglages → Mises à jour) : recherche
  manuelle ou automatique (au démarrage, quotidienne, hebdomadaire ;
  désactivée par défaut), canal stable ou bêta, téléchargement en
  arrière-plan, installation sur confirmation ou à la fermeture, version
  ignorée, notes de version et barre de progression, notification discrète
  dans la fenêtre. Paquets signés (minisign, `requireSignedVersion`) publiés
  sur les releases GitHub ; le coffre est verrouillé et les écritures
  terminées avant le redémarrage. CI : paquet et `latest.json` produits par
  « Release macOS », publication et canal bêta par « Publier une mise à
  jour » (Linux, manuel). Clé de signature à créer : `docs/RELEASE.md` § 3.1.
- Extension : la validation automatique du formulaire de connexion après
  remplissage devient une option, « Valider le formulaire après remplissage »,
  désactivée par défaut. Par défaut, l’utilisateur peut vérifier le compte
  choisi avant l’envoi.

- Extension, correctif : l’extension transmet l’origine de la page
  (`schéma://hôte:port`) à l’application au lieu du seul nom d’hôte. Depuis la
  règle de domaines partagée, les connexions dont l’URL précise un port
  (`http://localhost:3000`, routeur, NAS) n’étaient plus remplies ni
  reconnues, et le refus d’un élément HTTPS sur une page HTTP restait sans
  effet depuis l’extension. Une connexion enregistrée depuis l’extension garde
  aussi le schéma et le port de la page, au lieu de `https://hôte`.
- Extension, correctif : le bandeau d’enregistrement s’affiche aussi quand la
  page d’arrivée d’une redirection se charge avant la fin de la vérification
  de la proposition.

- Extensions macOS : `scripts/build-coffre-core-apple.sh` assemble désormais
  `CoffreCore.xcframework` sans Xcode complet, à partir des bibliothèques
  statiques arm64/x86_64 et des en-têtes générés par UniFFI. Le xcframework a
  été importé et lié dans un test Swift avec `swiftc`.
- Sauvegardes planifiées : copies datées du fichier `.coffre` déjà chiffré dans
  un dossier choisi (disque externe, NAS, dossier synchronisé), quotidiennes ou
  hebdomadaires, au démarrage puis toutes les heures tant que l’application
  tourne. Rétention réglable de 7 quotidiennes, 4 hebdomadaires et 12
  mensuelles, écriture atomique et contrôle SHA-256 de chaque copie ; quand le
  coffre est déverrouillé, la copie est immédiatement rouverte et son MAC
  vérifié. « Tester la restauration » rouvre une sauvegarde en lecture seule,
  vérifie son intégrité et compare le nombre d’éléments sans toucher au coffre
  courant. Alerte au tableau de bord si le dossier a disparu, si la dernière
  sauvegarde a échoué ou si elle date de plus de deux périodes. Le mode voyage
  suspend les écritures ; sur le Web, un rappel d’export manuel remplace la
  copie en arrière-plan. Aucune requête réseau.
- Cœur natif pour extensions (S2) : ouverture par clé maîtresse sans Argon2id,
  recherche de connexions par service avec la même règle de domaines que
  `loginAllowsHost` (suffixes publics, IDN, ports, HTTP/HTTPS, IP, localhost),
  révélation du seul élément demandé avec mot de passe et code TOTP, identités
  AutoFill sans secret, et assertions/créations de passkeys ES256 en Rust.
  Vecteurs croisés TypeScript ↔ Rust pour les domaines et les signatures de
  passkeys ; script local de génération de `CoffreCore.xcframework`.
- Intégration au système (S1) : verrouillage avec la session et à la mise en
  veille sur macOS, Windows et Linux, icône de barre de menus (ouvrir, recherche
  rapide, générateur, verrouiller) sans contenu du coffre, démarrage optionnel à
  l’ouverture de session dans un état verrouillé et masqué, et déverrouillage
  Windows Hello en plus de Touch ID. Le verrouillage système emprunte le même
  chemin que le verrouillage manuel et laisse les écritures déjà en file se
  terminer avant l’effacement des clés.
- Protection anti-hameçonnage au remplissage forcé et à l’enregistrement :
  analyse locale des domaines du coffre et de deux listes populaires embarquées
  (Apple MIT et Chrome UX Report CC BY 4.0, 1 000 origines), avec confusables
  Unicode TR39, distance de Damerau-Levenshtein, marque en sous-domaine, IP
  brute, HTTP, port inhabituel et identifiant déjà vu ailleurs. Bandeau
  Annuler / Continuer quand même dans l’extension et journalisation chiffrée du
  choix. Jeux de données datés (`popular-domains.json`,
  `popular-domains-crux.json`, `confusables.json`,
  `domain-equivalences.json`), scripts de mise à jour et aucune requête réseau
  à l’exécution.
- Disponibilité de la 2FA et des passkeys par site : instantanés datés de
  2FA Directory (MIT) et Passkeys Directory (CC BY 4.0), chargés dans un chunk
  séparé. « Sans 2FA » n’est plus affiché pour un site inconnu ou sans 2FA
  connue ; nouvelles catégories « Passkey disponible » et « Site sans HTTPS » ;
  méthodes de 2FA, documentation et action « Créer une passkey » dans la fiche
  d’une connexion. Le calcul du score passe en version 2 (pénalité HTTP, règle
  2FA plus juste) ; l’historique conserve les anciennes mesures et les annote.
- Historique chiffré du générateur : 50 derniers secrets générés par
  l’application ou l’extension, scellés par la clé maîtresse avec une AAD
  dédiée, dates et domaines compris, fusion par horloges, rétention de 1, 7 ou
  30 jours (ou désactivé), purge à l’ouverture et suppression automatique
  lorsqu’une entrée est enregistrée dans un élément. Écran « Historique » dans
  le générateur avec copie, création de connexion, suppression et effacement
  global. Aucun mot de passe en clair dans le fichier `.coffre` ni requête
  réseau.
- Manifeste d’intégrité 2 : l’historique du générateur et tous les sidecars
  (activité, modèles, alias, partage, urgence) sont couverts par le MAC global.
  Les fichiers signés avec le manifeste 1 restent lisibles et sont réécrits en
  manifeste 2 à la première mutation. Le cœur Rust et TypeScript partagent un
  vecteur croisé du manifeste canonique.
- Modèles intégrés pour tous les types d’éléments (connexion, note, carte,
  identité, passkey, clé SSH, Wi-Fi, identifiant d’API, licence logicielle,
  document), avec la liste complète de leurs champs, création directe depuis
  les réglages et choix du type dans les modèles personnalisés.
- Icônes de service locales sur les éléments : détection depuis l’URL, le RP ID
  d’une passkey, l’endpoint d’une API ou le site d’une licence (GitHub, Google,
  Apple, Amazon, bancaire, etc.), marque de carte, monogramme pour les domaines
  inconnus. Aucune requête réseau.
- Dette React : filtres, sélection, limite d’affichage, QR codes et historique
  de sécurité sont désormais dérivés pendant le rendu, sans effets de
  synchronisation ; `bun run lint` ne signale plus aucun avertissement.
- Reproductibilité desktop : `bun run repro:desktop` compare deux bundles
  macOS, avec recompilation de la caisse applicative et signature ad hoc entre
  les deux. La vérification Web/extension reste couverte par `repro:check`.
- Bundle découpé : les dialogues d’élément, de réglages, de sécurité et le
  générateur sont chargés à la demande, avec un écran d’attente accessible ;
  React, zod, hash-wasm, HPKE et Tauri sont répartis en chunks stables. Plus
  aucun chunk ne dépasse 500 Ko et l’avertissement `fflate` est supprimé.
- Liste groupée automatiquement par date : sections « Aujourd’hui », « Hier »,
  « 7 derniers jours », « Ce mois-ci » puis par mois, en-têtes sticky, tri
  appliqué à l’intérieur des groupes et option pour revenir à une liste plate.
- Correctifs de l’audit du 7 novembre 2026, portés sur le format 4 :
  - écritures contrôlées dans le navigateur : une modification calculée à
    partir d’une version périmée est refusée au lieu d’effacer celle d’un
    autre onglet ; chaque déverrouillage relit le fichier enregistré ;
  - verrouillage pendant un enregistrement : la modification en cours est
    signée et enregistrée avant l’effacement des clés, au lieu d’être perdue ;
  - fermeture de page : l’état passe à « verrouillé » (bfcache) sans retirer
    la clé du déverrouillage rapide ;
  - suppression d’un coffre : la clé n’est retirée de la session qu’après
    l’écriture réussie ;
  - export CSV en clair soumis à la saisie du mot de passe maître ;
  - estimateur de robustesse par motifs (dictionnaires, clavier, suites,
    dates, substitutions), sorti de `crypto.ts` pour ne pas alourdir
    l’extension ;
  - desktop : presse-papiers natif marqué secret et effacement différé fiable,
    raison Touch ID fixée côté Rust, serveur de développement refusé dans les
    builds de production, rotation des sauvegardes sans fichier courant ;
  - import Enpass : résolution des dossiers itérative et bornée ;
  - CI : actions épinglées par SHA, `persist-credentials: false`, permissions
    minimales et tests avant signature dans la release.

- Coffre de fichiers chiffrés en flux : blobs hors `.coffre`, AES-256-GCM par
  blocs de 64 Kio, nonce STREAM, détection de troncature/substitution,
  commandes Tauri, client TypeScript et ajout/téléchargement/suppression depuis
  la fiche d’élément, avec aperçu image/PDF en mémoire, synchronisation des
  blobs par dossier, échange des blobs manquants par le réseau local F2 et
  nettoyage des blobs orphelins.
- Alias e-mail hors ligne : générateur « plus » et catch-all, mémorisation des
  préférences, enregistrement dans l’élément ; intégration opt-in
  SimpleLogin/addy.io avec clé API chiffrée dans le coffre et création/copie
  d’alias depuis le menu de l’extension.
- Saisie automatique desktop : séquence KeePass, compte à rebours, vérification
  du focus avant chaque jeton, refus si la fenêtre change, commandes Tauri
  `autotype_active_window` et `autotype_run`, raccourci global et sélection des
  connexions correspondant à la fenêtre active.
- Outils développeur : `coffre-cli run --env-file` avec références
  `coffre://coffre/élément/champ`, assistant `git-credential` avec approbation
  explicite, signature `SSHSIG`, binaire `coffre-git-sign` pour `git commit -S`,
  génération de blocs `Host` SSH, et refus documenté des clés SSH FIDO2.
- Journal d’activité local chiffré : événements par identifiant, AAD dédiée,
  fusion, plafond de 5 000 entrées, page de consultation et export JSON.
- Modèles d’éléments personnalisés : éditeur dans les réglages, champs texte,
  secret, URL, date et texte long, stockage chiffré par modèle avec AAD dédiée,
  fusion, pierres tombales, changement de mot de passe, récupération et
  création d’éléments depuis un modèle et remplissage des champs `fillable`
  depuis l’onglet Modèles de l’extension, y compris via le pont natif desktop.
- Mode voyage (desktop) : marquage des coffres sûrs, retrait local des autres
  coffres, éléments, pièces jointes et versions sans pierre tombale, écrasement
  des sauvegardes locales, restauration depuis la synchronisation par dossier
  avec vérification du mot de passe maître.
- Synchronisation locale directe (desktop) : appairage par code/QR, identité
  X25519 locale, transport TCP chiffré par Noise XX, carnet de pairs, réception
  à la demande sur le port 47823 et fusion par `reconcileVaultFiles`. Aucun
  serveur ni connexion Internet ; annonce et découverte mDNS `_coffre._tcp`
  pendant la fenêtre de réception, mobile restant à faire.
- Extension : badge du nombre de connexions du site actif, avec priorité au
  point d’une proposition d’enregistrement ; copie optionnelle du code TOTP
  après remplissage, effacée après 30 secondes s’il n’a pas changé, avec la
  permission `clipboardRead` réservée à ce contrôle ; révocation de l’accès
  « Tous les sites » depuis les réglages.
- Extension : popup en sections « Pour ce site », « Favoris » et « Récents »,
  icônes SVG locales sans favicon, navigation complète au clavier (flèches,
  Entrée, Échap, `/`, copies `⌘C` / `⌘⇧C` / `⌘⌥C`) et états guidés avec action
  principale pour l’application fermée, l’appairage, le verrouillage, le site
  non autorisé et l’absence de résultat. Aucune permission ajoutée.
- Extension : exclusions par site « ne jamais remplir » et « ne jamais
  proposer d’enregistrer », modifiables depuis le bandeau, le menu du champ, le
  popup et la page d’options. Les listes ne contiennent que des domaines
  enregistrables ; une exclusion purge les propositions en attente et le
  retrait reprend effet sans recharger l’extension.
- Extension : proposition de mot de passe fort sur les formulaires
  d’inscription et de changement de mot de passe. Génération locale selon les
  règles du site, aperçu partiel, remplissage du champ et de sa confirmation
  après clic, sans soumission automatique. Les formulaires de connexion simple
  ne déclenchent pas la proposition.
- Extension : accueil à l’installation (`welcome.html`) pour choisir
  l’application desktop ou Web, associer ou configurer l’adresse, activer site
  par site (défaut) ou tous les sites, puis afficher les raccourcis. Note de
  mise à jour courte limitée aux changements de version concernés. Page
  d’options complète (connexion, remplissage, enregistrement, raccourcis,
  thème, permissions) avec réglages locaux sans secret.
- Extension : activation site par site par défaut ; les content scripts sont
  enregistrés dynamiquement sur les seules origines autorisées, et le menu dans
  les champs peut être désactivé dans les réglages.
- Extension : menu contextuel dans les champs (remplir une connexion du site,
  générer un mot de passe, insérer un alias, remplir une carte ou une
  identité) et sur la page (ouvrir Coffre, ajouter le site). Les connexions
  sont filtrées par domaine, le menu est reconstruit à l’activation d’un
  onglet et une seule entrée « Déverrouiller Coffre » reste disponible quand
  le coffre est verrouillé.
- Extension : raccourcis clavier pour ouvrir la popup (`⌘⇧Y` / `Ctrl+Shift+Y`),
  remplir la connexion (`⌘⇧L`, ou `Option+Shift+L` sur macOS), générer un mot
  de passe et remplir un code TOTP (sans touche par défaut). Le remplissage
  utilise `activeTab`, ouvre le menu du champ si plusieurs connexions
  correspondent, et la liste des raccourcis est visible dans le popup.
- Extension : bandeau d’enregistrement après une soumission, y compris après
  redirection. Il vit dans une iframe d’extension fermée et ne reçoit qu’un
  identifiant d’offre ; le mot de passe reste dans `storage.session`. L’identifiant
  est modifiable, « Plus tard » conserve la proposition dans le popup et le
  bandeau se ferme après 30 secondes sans interaction. Le signal Q1 est prévu
  comme point d’extension.
- Extension : déverrouillage depuis la popup. Avec le pont natif, Coffre
  reprend le premier plan et déclenche Touch ID si l’option est active ; le
  mot de passe maître reste saisi dans l’application. Si l’application est
  fermée, l’hôte natif la démarre sur ce clic explicite (jamais pour une simple
  lecture d’état). Le popup suit l’état et affiche un message clair en cas de
  refus ou d’expiration. Sans desktop, il ouvre l’onglet Coffre Web.
- Extension : les propositions d’enregistrement et la dernière connexion
  choisie survivent à l’arrêt du service worker MV3. Elles vivent dans
  `storage.session` (dix minutes, dix propositions au plus, purge à la
  fermeture de l’onglet et au verrouillage), restent inaccessibles aux content
  scripts et ne touchent jamais `storage.local` ; le badge est recalculé au
  réveil.
- Extension : options du générateur (longueur, classes de caractères,
  caractères ambigus, entropie estimée) mémorisées localement.
- Extension : le remplissage d’une connexion valide automatiquement le
  formulaire (bouton de connexion ou `requestSubmit`) pour réduire les
  interactions, sans soumettre les cartes ni les identités.
- Extension : icônes d’action 16/32/48/128 px et variantes clair/sombre
  (`theme_icons`) pour la barre d’outils.
- Extension : barre de recherche et bouton du générateur ancrés en haut pendant
  le défilement ; la recherche est focalisée à l’ouverture et toute touche
  imprimable lance une recherche automatiquement.
- Extension : logo Coffre thémable (carré clair avec cadenas sombre en thème
  sombre, inversé en clair) dans le popup, le menu inline, les réglages et la
  fenêtre passkey.
- Extension : la liste des connexions utilise toute la hauteur disponible ;
  l’indicateur de remplissage actif est réduit à une pastille verte dans le
  pied de page.
- Extension : plus de demande d’enregistrement quand les identifiants soumis
  correspondent déjà à une connexion du coffre ; une mise à jour est proposée
  uniquement si le mot de passe a changé.
- Extension : le bouton d’activation du remplissage est remplacé par un
  indicateur « Remplissage actif » dès que le content script répond dans
  l’onglet courant.
- Extension : réglages intégrés au popup (thème, adresse de l’application,
  test de connexion), barre d’actions et notification ancrées en bas de la
  fenêtre, et activation du remplissage compatible WebKit/Orion (repli
  d’injection et vérification du content script).
- Extension : thème clair/sombre (système, clair, sombre), détails de connexion
  avec copie individuelle de l’identifiant, du mot de passe et du code TOTP,
  et correction des débordements du popup et du menu inline.
- Extension : remplissage des cartes bancaires et des identités/adresses depuis
  le menu à trois onglets, détection `autocomplete` et libellés français, CVC et
  PIN uniquement sur action explicite, refus des cartes hors HTTPS ou dans une
  iframe tierce non prestataire, et enregistrement d’une carte ou d’une identité
  saisie dans un formulaire.
- Imports étendus : Dashlane JSON, export XML KeePass 2.x, Dashlane et Keeper
  CSV sans ligne d’en-tête, champs Bitwarden `fields`, et rapport des colonnes
  de métadonnées ignorées.
- Portabilité CXF 1.0 : import et export des connexions, notes, cartes,
  identités et passkeys (clé publique COSE recalculée à l’import), avec
  confirmation explicite avant l’export en clair.
- Format de fichier v4 : identifiant d’appareil, révision monotone, époque des
  clés, horloges par enregistrement et pierres tombales conservées 180 jours.
- MAC global HMAC-SHA-256 sur un manifeste canonique : détection des
  suppressions, substitutions et rejeux d’enregistrements, y compris avec des
  ciphertexts authentiques. Un fichier altéré s’ouvre en lecture seule.
- Clé de MAC aléatoire scellée par la clé maîtresse et tournée au changement de
  mot de passe ou après une récupération par phrase.
- Anti-retour en arrière local : la plus haute révision vue est conservée hors
  du fichier (IndexedDB ou `vault/state.json`), et un fichier plus ancien
  déclenche un avertissement. Les fichiers v1 à v3 restent lisibles et sont
  migrés en v4 à la première écriture.
- Pont natif extension ↔ application desktop : hôte de messagerie native
  installé pour Chrome, Chromium, Edge, Brave et Firefox, socket local `0600`,
  appairage par code à six chiffres, ECDH P-256 + HKDF-SHA-256, messages
  AES-256-GCM avec compteurs anti-rejeu, et contrôle de domaine dans
  l’application.
- L’extension utilise le pont natif en priorité et conserve l’onglet Coffre Web
  comme repli. Une application verrouillée ramène sa fenêtre au premier plan
  sans renvoyer de secret.
- Préparation de la synchronisation : `mergeVaultFiles` fusionne les fichiers
  v4 par horloges `{ rev, writer }`, pierres tombales, versions et pièces
  jointes. Fusion pure, commutative et idempotente, couverte par des tests de
  propriété `fast-check` ; les conflits à révision égale sont signalés pour être
  archivés par l’application.
- Synchronisation desktop : `sync_prepare`, `sync_list`, `sync_read` et
  `sync_write` confinés à `Coffre/<idFichier>/`, refus des noms dangereux et des
  liens symboliques, écritures atomiques `0600`, et surveillance `notify` avec
  anti-rebond.
- Interface « Synchronisation » dans les réglages desktop : choix du dossier,
  état, dernière synchronisation, conflits archivés et synchronisation
  manuelle.
- Vérification du MAC de chaque fichier distant avant fusion ; adoption d’une
  nouvelle époque de clés après saisie du nouveau mot de passe, sans fusionner
  de ciphertexts d’époques différentes.
- Archivage déterministe des contenus perdus lors d’un conflit dans l’historique
  de l’élément, sans doublon lors des synchronisations suivantes.
- Synchronisation Web (Chromium) via File System Access API : choix d’un dossier,
  handle persistant dans IndexedDB, permission lecture/écriture, mêmes fichiers
  `.coffre` signés et mêmes règles de fusion que sur desktop. Repli manuel sur
  Safari/Firefox.
- Extension : menu directement dans les champs, dans une iframe d’extension
  isolée ; détection locale des formulaires (30 pages de test), iframes,
  connexions en plusieurs étapes, remplissage TOTP et proposition d’enregistrer
  ou de mettre à jour après soumission.
- Permissions d’hôte optionnelles : le content script n’est enregistré qu’après
  activation explicite depuis le popup, et le mot de passe d’une soumission
  reste en mémoire du service worker au plus deux minutes.
- Passkeys WebAuthn : nouveau type d’élément `passkey` (RP ID, compte,
  identifiant de credential, clé privée ECDSA P-256 PKCS#8 et clé publique COSE
  dans le contenu chiffré). L’extension intercepte `navigator.credentials`
  dans le monde `MAIN`, affiche une fenêtre de confirmation, puis l’application
  crée l’attestation `none` ou signe l’assertion. La clé privée ne traverse
  jamais le pont ; le `rpId` est validé contre l’origine réelle et les suffixes
  publics courants sont refusés. Les sites exigeant une vérification
  utilisateur (`UV`) ou un authentificateur externe retombent sur le navigateur.
- Les passkeys sont visibles dans le filtre « Passkeys », en lecture seule, et
  le compteur d’assertion reste à zéro pour éviter une écriture du coffre à
  chaque connexion. Le partage hors ligne et la duplication sont masqués pour
  ne pas recopier une clé privée par inadvertance. Un test unitaire vérifie que
  la clé privée ne figure pas dans la réponse destinée au navigateur ; le smoke
  de l’extension couvre la création, la connexion, le `clientDataJSON`, le hash
  de RP ID et la vérification de la signature ECDSA avec les primitives Node.
- Nouveau type `ssh-key` : clé privée, clé publique, empreinte et commentaire
  chiffrés, avec formulaire, fiche détaillée et filtre « Clés SSH ». Aucune clé
  privée n’est incluse dans les exports CSV.
- Déverrouillage FIDO2/PRF optionnel : credential WebAuthn résident avec
  vérification utilisateur, sortie PRF transformée par HKDF-SHA-256 et
  enveloppe AES-256-GCM liée au fichier. Enrôlement/révocation dans les
  réglages, bouton de déverrouillage et suppression automatique lors d’un
  changement de mot de passe ou d’une récupération.
- Nouveau type `wifi` : SSID, mot de passe, sécurité WPA/WEP/ouvert et réseau
  masqué, avec QR code de connexion généré localement à la demande.
- Nouveau type `api-credential` : identifiant de clé, secret, environnement et
  point de terminaison, avec formulaire, fiche et filtre dédiés.
- Nouveau type `software-license` : clé de licence, titulaire, version, site
  web et date d’achat, avec formulaire, fiche et filtre dédiés.
- Nouveau type `document` : type, émetteur, numéro, date d’émission et pièce
  jointe principale, avec formulaire, fiche et filtre dédiés.
- Règles de génération par site : dataset Apple « Password Manager
  Resources » embarqué, parseur des classes et contraintes, génération de mots
  de passe compatibles dans le générateur.
- Socle de partage L10 : identités X25519 et Ed25519, empreintes SHA-256,
  enveloppes HPKE X25519/HKDF-SHA-256/AES-256-GCM pour les clés de coffre et
  l’accès d’urgence, enveloppes multi-membres, rotation de clé partagée et rôles
  signés. Identité persistée dans le fichier, ré-enveloppée au changement de
  mot de passe et créable depuis les réglages avec export public ; paquets de
  partage signés par membre, validation des identités/paquets importés et
  interface de génération/import dans les réglages, et paquet complet des
  éléments/pièces jointes/versions chiffrés, avec propagation des suppressions
  par pierres tombales. Le paquet peut être copié ou téléchargé en fichier
  `.coffre-shared.json` puis importé. Synchronisation par dossier : chaque
  membre écrit un bundle signé Ed25519 (`shared-<coffre>-<empreinte>.coffre-shared.json`),
  importé automatiquement toutes les 60 secondes ou à la demande ; les paquets
  de partage sont conservés chiffrés dans les métadonnées pour permettre les
  exports suivants. Une rotation de clé signée par le même administrateur est
  adoptée automatiquement : ré-enveloppe des clés d’éléments locales,
  métadonnées et récupération. Sur desktop, les pièces jointes binaires
  chiffrées sont exportées et importées via le même dossier de partage. Les
  coffres partagés en
  lecture seule bloquent les mutations dans l’application ; la limite face à un
  client modifié est documentée. Révocation d’un membre par rotation de la clé
  du coffre, re-enveloppe des clés d’éléments et nouveau paquet pour les
  membres restants. Accès d’urgence : enveloppe HPKE de la clé maîtresse pour
  un contact ou en parts Shamir 2/3, ré-enveloppée lors des rotations ; aucun
  délai imposé sans serveur.
- Chaîne d’approvisionnement : toolchain Rust épinglée, builds Web/extension
  comparés deux fois avec `SOURCE_DATE_EPOCH=0`, bundle macOS comparé après
  recompilation de la caisse applicative, SBOM CycloneDX Rust et web générés en
  CI et joints aux releases macOS avec une somme SHA-256. `cargo deny` contrôle
  licences, avis RUSTSEC et sources ; les exceptions sont documentées dans
  `src-tauri/deny.toml`, et `RUSTSEC-2023-0071` est retiré depuis le passage à
  `rsa` 0.10 / `ssh-key` 0.7.0-rc.12. Fuzzing hebdomadaire du parseur et de la
  fusion `coffre-core` avec libFuzzer.
- Divulgation responsable : `/.well-known/security.txt` avec contact GitHub
  privé, politique, langues et expiration ; validation automatique dans le lint.
- Cœur Rust partagé `coffre-core` : Argon2id, AES-256-GCM, AAD, HMAC-SHA-256,
  manifeste canonique, ouverture des fichiers v1 à v4, création/modification/
  suppression d’éléments, signature v4 (horloges, tombstones, MAC), rotation
  du mot de passe maître, fusion L3 et façade UniFFI JSON. Commande Tauri de
  fusion sans déchiffrement. Buffers `Zeroizing`, aucune dépendance réseau,
  vecteurs croisés TypeScript ↔ Rust et CI dédiée Linux/macOS/Windows.
- CLI `coffre-cli` : `list`, `get`, `totp` et `run --env` pour les scripts,
  mot de passe lu sans écho sur le terminal ou sur stdin, jamais en argument.
  Injection des secrets par l’environnement du processus enfant, propagation
  du code de sortie, tests unitaires et d’intégration, CI Linux/macOS/Windows.
- Agent SSH `coffre-ssh-agent` : protocole `SSH_AUTH_SOCK`, liste d’identités,
  signatures ed25519 et RSA, socket Unix `0600`, approbation obligatoire dans le
  terminal et binaire `--list`. Intégration desktop avec démarrage depuis les
  réglages, modale d’approbation par signature, Touch ID optionnel, signature
  de commits Git via `ssh-keygen -Y sign`, mémorisation opt-in de 15 secondes
  par clé et arrêt automatique au verrouillage.
- Surveillance des fuites optionnelle et désactivée par défaut : calcul SHA-1
  local, envoi des 5 premiers caractères seulement à Have I Been Pwned avec
  `Add-Padding`, réponse parsée en mémoire et résultats intégrés au tableau de
  bord Sécurité. Sur desktop, la requête passe par la commande Rust
  `hibp_range` (préfixe validé, délai et taille plafonnés) pour conserver la CSP
  de la WebView ; sur le Web, seul l’hôte HIBP est ajouté à `connect-src`.
  Aucun mot de passe, hash complet ou résultat n’est persisté.
- Compatibilité KeePass : import et export KDBX 4 avec mot de passe dédié et
  fichier clé optionnel à l’import. Le fichier exporté contient les éléments
  actifs, sans pièces jointes ni historique Coffre ; l’import passe par le
  provider et les contrôles de doublons habituels.
- Rappels d’échéance : date de révision des mots de passe, expiration des
  cartes et des documents d’identité, vue « Bientôt expirés », badges J-xx et
  notifications locales optionnelles (aucun serveur de notification).
- Kit d’urgence papier : parts Shamir `k` parmi `n` de la clé de récupération,
  encodées en mots EFF et QR codes, avec restauration depuis l’écran de
  récupération. Génération et impression entièrement locales.
- Partage ponctuel hors ligne : fichier `.coffre-share` chiffré par une clé
  aléatoire, clé transmise séparément en mots ou QR code, expiration facultative
  et import avec contrôle de la clé. Aucun serveur.
- Santé avancée : historique local du score (un point par jour, 365 jours) et
  assistant de changement de mot de passe avec ouverture de l’URL standard
  `/.well-known/change-password` du site.
- Internationalisation : socle français/anglais, réglage de langue, dates
  localisées, traduction de l’ensemble des composants de l’application et de
  l’interface de l’extension (`_locales`), et règle de lint `lint:i18n` contre
  les nouvelles chaînes d’interface en dur. Les messages Rust restent à
  traduire.
- Système de design : `src/styles/tokens.css` (typographie, espacement, rayons,
  profondeur, z-index, couleurs sémantiques), thème clair réduit à ses
  variables, échelle de tailles de police avec plancher à 12 px et contrôle
  automatique des valeurs littérales (`bun run lint:design`).
- Détail et édition unifiés : création dans une modale dédiée, puis lecture et
  modification dans le panneau persistant sur desktop, avec menu « … »
  (historique, déplacement entre coffres, duplication, suppression) et barre
  d’actions adaptée au pouce sur mobile.
- Liste et barre d’outils compactes : tri et sélection dans un menu, largeur
  minimale de 320 px, aucun débordement horizontal, pastilles d’alerte
  explicites (« Faible », « Réutilisé », « Sans 2FA ») et bandeau de sécurité
  dans le détail avec génération immédiate d’un nouveau mot de passe.
- Réglages en pages (Général, Sécurité, Sauvegarde et import, Stockage, Zone
  dangereuse) avec navigation latérale et vue compacte ; « Verrouiller
  maintenant » reste dans la barre latérale. L’effacement du coffre local passe
  par « Autres options » sur l’écran de déverrouillage et demande de taper
  `EFFACER`.
- Tableau de bord Sécurité honnête et actionnable : score plafonné à 40/100
  quand la majorité des connexions sont faibles ou réutilisées, explication
  du score, trois compteurs principaux, langage simplifié et ouverture des
  catégories dans la liste filtrée de la vue principale.
- Mobile de première classe : barre supérieure contextuelle avec retour,
  barre d’actions basse, onglets de navigation, menu latéral inerte lorsqu’il
  est fermé, piège à focus, appui long pour la sélection et glissement pour
  revenir.
- Accessibilité : navigation au clavier dans la liste, focus visible sur les
  lignes et cartes, animations neutralisées avec `prefers-reduced-motion`, et
  tests e2e de noms accessibles, de piège à focus, d’inertie du menu et
  d’absence de débordement à 1280, 1024, 768 et 375 px.
- Finitions : textes d’aide longs repliés derrière « En savoir plus » et
  explication d’une phrase pour chaque catégorie secondaire du tableau de bord
  Sécurité.
- Régression visuelle optionnelle : `e2e/visual.spec.ts` capture six écrans
  dans les deux thèmes (`bun run test:visual`).
- Colonnes redimensionnables sur desktop : largeur de la barre latérale et de
  la liste ajustable à la souris, au doigt ou au clavier, mémorisée localement.
- Barre latérale repliable en rail de 64 px avec uniquement les icônes, des
  infobulles et des noms accessibles ; état mémorisé et tiroir complet conservé
  sur mobile.
- Tableau de bord complet : score de santé, statistiques, points d’attention,
  éléments prioritaires, récents, coffres, échéances et actions rapides.
  Affiché par défaut après le déverrouillage, avec l’état du stockage local
  (dernière écriture, synchronisation en attente, sauvegardes tournantes).
  Accessible depuis la barre latérale et l’onglet « Accueil » sur mobile.
- Corrections d’interface : libellé « Retour à … » sur mobile, en-tête de
  détail ramené à une ligne, bandeau d’alerte qui passe sous le texte, libellé
  « Aucun élément » à zéro, trame de fond retirée de l’application et onglets
  bas exclusifs. Points de rupture unifiés (1099 / 768 / 639 px en largeur,
  deux en hauteur).
- Réglages : navigation latérale sticky et contenu défilant indépendamment.
- Correction du défilement résiduel en bas de l’application : le document est
  bloqué quand l’application est montée, les panneaux gèrent leur propre
  défilement et le débordement horizontal de la liste est masqué.
- Icône de marque plate et monochrome, pilotée par les variables du thème :
  carré plein et cadenas en réserve, lisibles en sombre comme en clair. Les
  favicons et icônes PWA/Tauri sont alignés sur ce dessin.

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
- Popup d’extension : recherche permanente, générateur de mot de passe local,
  correction des débordements et copie sécurisée.
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
