# Audit de l’extension navigateur et de ses protocoles de connexion

**Date :** 15 novembre 2026

**Commit audité :** `c5d52fb` (`main`, version 0.16.0, extension 0.17.0.72)

**Incident de référence :** Orion sur macOS, extension chargée depuis le dossier géré par Coffre, bêta 0.17.0.70.

**Nature :** audit statique du code, des protocoles et des flux d’état. Aucun test dynamique dans Orion n’a été possible dans cet environnement.

> **Verdict.** Le socle natif est globalement bien conçu : socket privé, ECDH P-256, HKDF-SHA-256, AES-256-GCM, compteurs par session, identifiant d’extension épinglé et validation des domaines. Mais l’extension repose sur un maillon faible : **la persistance de la clé d’appairage dans le stockage de l’extension**. Orion perd ce stockage, et le mécanisme de reconnexion actuel ne le compense pas. Deux autres sujets méritent une correction avant la 1.0 : **l’appairage n’est pas lié cryptographiquement au code affiché** et **le mode Web ne vérifie pas l’identité de l’application**.
>
> **Recommandation immédiate.** Tant que le stockage Orion n’est pas résolu, considérer Orion comme **expérimental** et recommander Chrome, Brave, Edge ou Firefox pour un usage quotidien. Ne pas promettre « associer une fois » sur Orion.

### Plan en une page

| Priorité | Chantier | Délai | Critère de sortie |
| --- | --- | --- | --- |
| P0 | Diagnostic stockage Orion (`local`, `session`, IndexedDB, contextes) | 0,5–1 j | On sait ce qui est perdu et où |
| P0 | IndexedDB + reconnexion réelle + Orion dans l’hôte natif | 1–3 j | Une confirmation après redémarrage, sans boucle |
| P1 | Protocole v3 : SAS, empreinte de l’application, version | 1 sem. | Test MITM détecté |
| P1 | Mode Web authentifié ou supprimé | 2–4 j | Faux serveur local sans identifiants |
| P1 | Stockage natif Linux/Windows, Windows named pipe | 1 sem. | Pairing persistant hors macOS |
| P2 | Permissions, fuzzing, tests d’intégration, matrice navigateurs | 1–2 sem. | CI + manuel verts |

---

## 1. Périmètre

Architecture, messages et crypto du pont natif ; installation de l’hôte natif ; appairage ; stockage de la clé ; reconnexion ; mode Web ; service worker MV3 ; popup et page d’options ; content script, menu embarqué, bandeau d’enregistrement et relais passkey ; permissions et surfaces exposées.

Hors périmètre : coffre lui-même, cryptographie du format `.coffre`, Android, iOS, audit de l’application desktop hors pont.

---

## 2. Architecture

```text
┌──────────────────────────── navigateur ────────────────────────────┐
│ popup.html / options.html / menu.html / save-banner.html           │
│            │ chrome.runtime.sendMessage                          │
│            ▼                                                       │
│ service worker background.ts                                       │
│   ├── nativeBridge.ts ── connectNative('app.coffre.bridge')       │
│   │        │ trames JSON préfixées par leur longueur              │
│   │        ▼                                                       │
│   │   binaire Coffre (mode hôte natif)                             │
│   │        │ socket Unix 0600                                      │
│   │        ▼                                                       │
│   │   application Tauri ── WebView NativeBridge.tsx                │
│   │        └── coffre déverrouillé                                 │
│   └── mode Web : chrome.scripting.executeScript dans l’onglet      │
│            Coffre → window.__coffreExtension                       │
└────────────────────────────────────────────────────────────────────┘
```

Deux modes de connexion coexistent :

1. **Mode desktop (recommandé)** : messagerie native + socket local + appairage ECDH.
2. **Mode Web** : injection de script dans l’onglet Coffre configuré, sans appairage.

Le mode desktop est prioritaire ; le mode Web sert de repli quand l’application desktop ne répond pas.

---

## 3. Flux et protocoles

### 3.1 Hôte natif et socket

- Manifeste natif `app.coffre.bridge` installé dans les dossiers des navigateurs.
- Identifiant Chromium épinglé : `dmajddgmehhebmpcdooifjdakjjngdla`.
- Identifiant Firefox : `coffre@1wxxhktop.github.io`.
- Socket dans `app_data_dir()/bridge/bridge.sock`, dossier `0700`, socket `0600`.
- Trames préfixées par une longueur 32 bits, limite 1 Mio, 16 connexions maximum.
- Le binaire relais peut démarrer l’application uniquement sur un premier `hello` avec `launch: true`.

### 3.2 Appairage natif

```text
Extension                                   Application
    │  pair-begin { publicKey:E }                 │
    ├────────────────────────────────────────────▶│
    │                                             │ génère A, code aléatoire
    │  pair-pending { code, publicKey:A }         │
    │◀────────────────────────────────────────────┤
    │  affiche code + empreinte(E)                │  affiche code + empreinte(E)
    │                                             │
    │  [l’utilisateur compare et clique Autoriser] │
    │                                             │
    │  pair-accepted { session }                  │
    │◀────────────────────────────────────────────┤
    │  clé = HKDF(ECDH(E privé, A public))        │  clé = HKDF(ECDH(A privé, E public))
    │  stocke la clé                              │  stocke la clé
```

La clé dérivée sert à AES-256-GCM. Chaque direction a son compteur ; l’AAD contient session, direction et compteur. Un nouveau `hello` crée un nouvel identifiant de session, ce qui invalide les anciens messages.

### 3.3 Mode Web

Le service worker trouve l’onglet à l’URL configurée, puis exécute des fonctions dans le monde MAIN de cet onglet. La page Coffre expose `window.__coffreExtension` lorsque le coffre est déverrouillé. Aucun secret n’est stocké, mais l’extension fait confiance à la page qui répond à cette URL.

### 3.4 Stockage de l’extension

- Réglages, préférences et exclusions : `storage.local`, sans secret.
- Clé d’appairage : `storage.local` puis, depuis les dernières bêtas, `storage.session`, avec lecture d’objet ou de chaîne JSON.
- Propositions d’enregistrement et sélections récentes : `storage.session` uniquement.
- Aucun stockage de secours de type IndexedDB.

---

## 4. Constats

| ID | Sévérité | Constat | Preuve principale |
| --- | --- | --- | --- |
| EXT-01 | **Critique (fiabilité)** | La clé d’appairage n’est pas durable sur Orion ; reconnexion en boucle. | Incident utilisateur ; `extension/nativeBridge.ts:221-324` |
| EXT-02 | **Élevé (sécurité)** | Le code d’appairage n’est pas lié cryptographiquement aux clés ; l’extension n’affiche pas d’empreinte de l’application. | `src/lib/bridgeProtocol.ts:121-190` ; `src/components/NativeBridge.tsx:322-343` |
| EXT-03 | **Élevé (sécurité)** | Le mode Web ne vérifie pas l’identité de l’application ; une page locale malveillante à l’URL configurée reçoit les identifiants. | `extension/background.ts:220-246`, `539-660` |
| EXT-04 | **Élevé (fiabilité)** | Orion n’est pas installé explicitement comme navigateur pour l’hôte natif. | `src-tauri/src/bridge.rs:314-361` |
| EXT-05 | **Élevé (fiabilité)** | Pas de backend de stockage durable de secours ; la reconnexion dépend du même stockage qui est perdu. | `extension/nativeBridge.ts:221-324` |
| EXT-06 | Moyen | État d’appairage non centralisé entre contextes/service workers ; courses possibles. | `extension/nativeBridge.ts:57-109` ; incident `native-disconnected` |
| EXT-07 | Moyen | Pas de négociation de version de protocole ; AAD `v1` alors que la constante vaut `2`. | `src/lib/bridgeProtocol.ts:15`, `212-217` |
| EXT-08 | Moyen | Appairage sans limitation de tentatives ni identité d’extension complète ; code à 6 chiffres non lié. | `src/components/NativeBridge.tsx:1173-1245` |
| EXT-09 | Moyen | Trousseau Windows/Linux sans repli ni diagnostic ; dépendance au keyring. | `src-tauri/src/extension_store.rs:81-130` |
| EXT-10 | Moyen | Le rechargement automatique de l’extension après mise à jour peut invalider l’appairage sur Orion. | `extension/selfUpdate.ts` ; `src-tauri/src/extension_store.rs:238-242` |
| EXT-11 | Moyen | Windows sans named pipe ; installation native non prise en charge ; Flatpak/Snap non gérés. | `src-tauri/src/bridge.rs:410-418` ; `docs/SECURITY.md:2.11` |
| EXT-12 | Faible | Permissions et ressources web accessibles plus larges que nécessaire. | `extension/public/manifest.json:10-35` |
| EXT-13 | Faible | Métadonnées `hello`/`status` en clair ; tout processus du même utilisateur peut ouvrir le socket. | `extension/nativeBridge.ts:331-359` ; `bridge.rs:180-198` |
| EXT-14 | Faible | Pas de test d’intégration du pont natif complet ; le smoke test ne couvre que le relais. | `scripts/smoke-bridge.mjs` |

---

## 5. Analyse détaillée

### 5.1 EXT-01 / EXT-05 — La clé d’appairage est le point de rupture

C’est la cause directe de l’incident.

Séquence observée :

1. Premier appairage réussi, l’extension fonctionne et reste associée.
2. Redémarrage ou mise à jour d’Orion.
3. Le desktop dispose encore de sa clé ; l’extension n’a plus la sienne.
4. L’utilisateur clique sur « Reconnecter l’extension ».
5. Le diagnostic affiche `desktopPaired: true`, `extensionKey: false`, puis la reconnexion reste sans effet.

Le code actuel écrit la clé dans `storage.local` et `storage.session`, puis la relit avec acceptation d’un objet ou d’une chaîne JSON. Cela corrige un premier bug de sérialisation Orion, mais **ne corrige pas la perte de stockage** : `storage.session` est en mémoire et disparaît au redémarrage du navigateur. Si Orion perd aussi `storage.local`, il ne reste aucune copie durable.

Le fait que la reconnexion échoue **immédiatement** alors que le desktop a une clé indique en plus que le stockage n’est pas partagé de façon fiable entre les contextes Orion : le contexte qui a écrit la clé et celui qui répond à `GET_STATUS` ne voient pas la même chose, ou le worker est recréé entre les deux.

Ce n’est donc pas un simple bug d’interface. Il faut un stockage réellement partagé et durable, ou assumer une reconnexion assistée par le desktop à chaque session.

### 5.2 EXT-02 — Le code d’appairage n’authentifie pas les clés

`deriveBridgeSessionKey` dérive la clé à partir de l’ECDH et des deux clés publiques triées. Le code à six chiffres n’entre **pas** dans la dérivation ; il n’est qu’un affichage.

De plus, l’extension affiche l’empreinte de **sa propre** clé publique, pas celle de l’application. Le desktop affiche cette même empreinte d’extension. En cas d’interception locale :

- un attaquant peut relayer le code ;
- l’extension et le desktop peuvent afficher des empreintes différentes si l’attaquant substitue sa clé ;
- mais l’utilisateur qui ne compare que le code peut valider l’attaquant.

Il manque une **chaîne d’authentification courte (SAS)** calculée sur les deux clés publiques et affichée des deux côtés, ou une signature de transcript vérifiable. Le code devrait aussi être inclus dans le HKDF ou dans un MAC de transcript.

### 5.3 EXT-03 — Le mode Web fait confiance à une URL

`readTabStatus` exécute un script dans l’onglet trouvé à l’URL configurée et vérifie seulement `window.__coffreExtension.version > 0`. `search`, `fill`, `save`, `passkey` exécutent ensuite des fonctions dans ce même onglet.

Conséquences :

- un serveur local malveillant qui écoute sur `http://localhost:1420` peut exposer un faux `__coffreExtension` et recevoir les identifiants que l’utilisateur demande ;
- une page compromise à cette origine peut faire de même ;
- aucun appairage, aucun secret partagé, aucune preuve d’identité de l’application.

Le mode Web est pratique pour la PWA, mais il ne doit pas être présenté comme équivalent au mode desktop. Il faut soit le supprimer, soit exiger un jeton d’appairage (QR/code) et une preuve de possession, comme pour le pont natif.

### 5.4 EXT-04 — Orion n’est pas un navigateur de premier rang

`install_native_hosts` couvre Chrome, Chromium, Edge, Brave, Vivaldi et Firefox, mais pas Orion. Le roadmap le reconnaît déjà (`docs/ROADMAP.md:502-510`). Orion peut parfois lire un manifeste Chromium/Firefox existant, ce qui explique que le pont ait fonctionné une première fois. Ce n’est pas garanti après une mise à jour ou un changement de profil.

Il faut ajouter explicitement :

- macOS : `~/Library/Application Support/Orion/NativeMessagingHosts/` ;
- Linux : `~/.config/Orion/NativeMessagingHosts/` ;
- vérifier le format de manifeste et l’identifiant d’extension acceptés par Orion.

### 5.5 EXT-06 — État multi-contextes

L’état d’appairage (`pairingPromise`, `pairingAttempt`, `sessionKey`, compteurs) vit dans la portée du module du service worker. Chrome maintient généralement un worker unique, mais Orion peut recréer des contextes. Un `GET_STATUS` peut alors être servi par un contexte qui n’a jamais vu la clé en mémoire, et la seule source commune est le stockage — précisément celui qui est cassé.

Il faut :

- une source de vérité unique et testable ;
- des messages de diagnostic qui indiquent le contexte ;
- ou un stockage partagé qui ne dépend pas du worker.

### 5.6 EXT-07 — Versionnement

`BRIDGE_PROTOCOL_VERSION = 2`, mais l’AAD utilise `coffre-bridge:v1`. Aucun message `hello` ne transporte la version du protocole. Une extension ancienne et une application récente peuvent se parler sans négociation, ou échouer avec un message générique.

Il faut un champ `protocolVersion` dans `hello` et dans `pair-begin`, une matrice de compatibilité et un refus explicite des versions non supportées.

### 5.7 EXT-08 — Robustesse de l’appairage

- Le code est généré par `getUint32() % 1_000_000`, avec un léger biais (négligeable pour un code non cryptographique, mais à corriger si le code devient une authentification).
- Aucune limitation du nombre de demandes d’appairage par fenêtre de temps.
- Le desktop affiche l’empreinte de l’extension, mais pas son nom, son identifiant ou son origine ; l’utilisateur ne peut pas distinguer facilement une extension légitime d’une extension homonyme.
- Le bouton d’autorisation peut être martelé ; les tentatives remplacées sont rejetées, mais il n’y a pas de journal d’audit.

### 5.8 EXT-09 — Trousseau et plateformes

Sous macOS, la clé est dans un fichier privé, ce qui est adapté à une signature ad hoc. Sous Windows/Linux, elle dépend du trousseau système. Si le keyring est verrouillé ou indisponible, `bridge_key_store`/`load` échouent sans repli ni message précis. Il faut un diagnostic clair et, si possible, un fichier 0600 de secours comme sur macOS.

Windows n’a pas de named pipe : le pont natif n’y fonctionne pas. C’est un écart fonctionnel majeur par rapport à la promesse multiplateforme.

### 5.9 EXT-10 — Mise à jour de l’extension

L’application remplace la copie gérée de l’extension quand la version change. L’extension se recharge via `runtime.reload()` si la version sur disque est plus récente. Sur Orion, ce rechargement peut effacer le stockage de l’extension — donc la clé. Chaque mise à jour de Coffre peut ainsi imposer un réappairage.

Il faut soit désactiver le rechargement automatique sur les navigateurs qui perdent le stockage, soit stocker la clé hors de l’extension, soit accepter et guider une reconnexion en un clic.

### 5.10 EXT-12 à EXT-14 — Durcissement

- `clipboardRead` est justifié par l’effacement du TOTP, mais reste une permission sensible.
- `web_accessible_resources` expose `assets/*`, `chunks/*`, `icons/*` à tous les sites http/https ; réduire aux ressources réellement nécessaires.
- Les messages `hello`/`status` en clair révèlent l’état verrouillé/déverrouillé et la version de l’extension à un processus local du même utilisateur.
- Le smoke test du pont ne teste que le relais, pas l’appairage, le chiffrement, la reconnexion ou la perte de stockage.

---

## 6. Ce qui fonctionne bien

- Socket dans un dossier `0700`, fichier `0600`, limite de trames et de connexions.
- ECDH P-256 + HKDF-SHA-256 + AES-256-GCM avec nonce aléatoire et AAD contextuelle.
- Compteurs par direction et identifiant de session aléatoire.
- Identifiant d’extension Chromium épinglé par la clé du manifeste ; manifeste Firefox séparé.
- Validation de l’hôte côté application (`loginAllowsHost`) avant tout remplissage.
- Pages d’extension réservées aux messages sensibles ; content scripts limités à une liste de messages.
- Jeton de menu aléatoire, iframe d’extension dans un shadow root fermé, vérification `event.source`/`event.origin`.
- Validation `rpId`/origine pour les passkeys.
- Propositions d’enregistrement en `storage.session`, jamais en `storage.local`.
- Aucun secret dans les réglages ou les exclusions.
- Assistant d’installation et reconnexion guidée déjà présents.

---

## 7. Diagnostic Orion : hypothèses et tests

| Hypothèse | Indice | Test |
| --- | --- | --- |
| H1. Orion renvoie les valeurs `storage.local` en chaîne JSON | Bug connu, correctif bêta 72 | Lire `bridgeSession` après écriture et après redémarrage ; vérifier le type |
| H2. Orion efface `storage.local` au redémarrage/rechargement | Clé perdue après restart ; `extensionKey:false` | Écrire une valeur témoin, redémarrer Orion, relire |
| H3. Orion n’implémente pas `storage.session` ou l’efface au restart | `storage.session` en mémoire ; reconnexion immédiatement non associée | Lire `storage.session` après écriture puis après redémarrage |
| H4. Plusieurs contextes/service workers ne partagent pas l’état mémoire | `desktopPaired:true` mais `extensionKey:false` | Comparer les lectures depuis popup, options et worker |
| H5. Le rechargement d’extension après mise à jour efface le stockage | Appairage perdu après mise à jour | Écrire, appeler `runtime.reload()`, relire |
| H6. L’hôte natif Orion n’est pas installé ou est mal découvert | Orion absent de `install_native_hosts` | Ajouter le chemin Orion, vérifier le manifeste et `connectNative` |

Un build de diagnostic doit exposer, sans jamais afficher la clé :

- `storage.local` : présence, type (objet/chaîne), version ;
- `storage.session` : présence, type ;
- IndexedDB : présence ;
- `desktopPaired`, `extensionKey` ;
- identifiant du contexte/service worker.

C’est le prérequis pour choisir entre IndexedDB, stockage desktop et reconnexion assistée.

---

## 8. Plan de correction

### Phase 0 — Diagnostic ciblé (0,5–1 jour)

1. Ajouter les sondes de stockage ci-dessus dans une bêta de diagnostic.
2. Ajouter Orion aux chemins d’installation natifs et vérifier le manifeste.
3. Faire tester par l’utilisateur : pairer, fermer/rouvrir le popup, redémarrer Orion, mettre à jour Coffre, relancer.
4. Consigner les résultats dans ce document.

**Critère de sortie :** on sait si Orion perd `local`, `session`, les deux, ou si le problème est l’installation native.

### Phase 1 — Rendre Orion utilisable (1–3 jours)

1. Ajouter un backend **IndexedDB** pour la clé, avec la même enveloppe versionnée et les mêmes validations.
2. Écrire dans `local` + `session` + IndexedDB, lire dans l’ordre local → session → IDB.
3. Ne jamais retourner un succès d’appairage sans relecture réelle dans le contexte qui répond à `GET_STATUS`.
4. Si aucun stockage durable n’est disponible, conserver la clé en mémoire et afficher un état **« session uniquement »** ; proposer une reconnexion explicite au prochain démarrage.
5. Rendre la reconnexion réellement fonctionnelle : le bouton doit réappairer, et non dépendre d’une clé locale absente.
6. Ajouter un bouton **« Oublier l’association »** pour repartir proprement.

**Critère de sortie :** dans Orion, après redémarrage, une seule confirmation suffit ; le popup affiche ensuite les identifiants sans boucle.

### Phase 2 — Sécuriser l’appairage (1 semaine)

1. Calculer une **SAS** = troncature SHA-256 des deux clés publiques, affichée des deux côtés.
2. Inclure le code/SAS dans le HKDF ou dans un MAC de transcript.
3. Afficher l’empreinte de l’application dans l’extension, pas seulement celle de l’extension.
4. Ajouter `protocolVersion` dans `hello` et `pair-begin` ; refuser proprement les versions incompatibles.
5. Aligner l’AAD sur la version du protocole (`v2`).
6. Limiter les tentatives d’appairage et journaliser les refus (sans secret).

**Critère de sortie :** un test de MITM avec substitution de clé produit une SAS différente ou un refus ; une trame de transcript altérée est rejetée.

### Phase 3 — Mode Web (2–4 jours)

Choisir explicitement :

- **Option A (recommandée)** : supprimer le mode Web ou le marquer expérimental, et recommander le mode desktop.
- **Option B** : exiger un appairage Web (secret généré par l’application, échangé par QR/code) avant d’exposer `window.__coffreExtension`.

Dans les deux cas, tester un faux serveur local à `localhost:1420` et vérifier qu’il ne peut pas obtenir d’identifiants.

### Phase 4 — Plateformes et stockage natif (1 semaine)

1. Ajouter Orion macOS/Linux à `install_native_hosts` et aux tests.
2. Implémenter le named pipe Windows et l’inscription au registre, ou déclarer Windows non supporté.
3. Ajouter un repli fichier 0600 pour la clé sous Linux/Windows si le keyring échoue.
4. Documenter Flatpak/Snap et les limites de messagerie native.
5. Valider Firefox en exécution réelle.

### Phase 5 — Durcissement et tests (1–2 semaines)

1. Réduire `web_accessible_resources` aux fichiers nécessaires.
2. Revoir `clipboardRead`, `sidePanel`, `activeTab` et les permissions optionnelles.
3. Fuzzzer les messages du pont et les parseurs de stockage.
4. Ajouter un test d’intégration du pont natif avec un faux hôte, couvrant appairage, reconnexion, perte de stockage, redémarrage et verrouillage.
5. Ajouter une matrice manuelle Chrome/Brave/Edge/Firefox/Orion : appairage, fermeture du popup, redémarrage navigateur, mise à jour, coffre verrouillé, app fermée.
6. Mettre à jour `docs/SECURITY.md` et `docs/ROADMAP.md` avec les résultats et les limitations.

---

## 9. Décisions à prendre

1. **Orion** : navigateur officiellement supporté (avec stockage durable) ou expérimental (recommandation Chromium) ?
2. **Mode Web** : suppression, ou appairage Web authentifié ?
3. **Clé d’appairage** : IndexedDB, reconnexion assistée par le desktop à chaque session, ou stockage natif hors extension ?
4. **Protocole** : introduire une v3 avec SAS et négociation de version, ou conserver la v2 et documenter les limites ?

---

## 10. Références

- `extension/nativeBridge.ts` : connexion, stockage de la clé, appairage, reconnexion.
- `src/lib/bridgeProtocol.ts` : ECDH, HKDF, AES-GCM, codes et empreintes.
- `src/components/NativeBridge.tsx` : handshake côté application, modal d’appairage, compteurs.
- `extension/background.ts` : statut, mode Web, messages, passkeys.
- `src-tauri/src/bridge.rs` : socket, relais, installation des hôtes natifs.
- `src-tauri/src/extension_store.rs` : clé d’appairage desktop et copie gérée.
- `docs/SECURITY.md` § 2.10–2.11 : garanties annoncées.
- `docs/ROADMAP.md` § 6.1.4 : dette Orion déjà identifiée.
- Incident utilisateur : Orion macOS, extension `0.17.0.70`, `desktopPaired: true`, `extensionKey: false` après reconnexion.
