# Publication de l’extension (E13)

Ce document prépare la soumission aux stores. **La publication elle-même
revient à l’utilisateur** : elle exige des comptes développeur et une revue
externe. L’agent prépare les paquets, les textes, les justifications et la
procédure de vérification.

## État

- Paquets reproductibles : prêts (`bun run extension:zip`).
- Fiche française et anglaise : prête ci-dessous.
- Politique de confidentialité : `docs/PRIVACY.md`.
- Comptes requis : Chrome Web Store (5 $, une fois), Firefox AMO (gratuit),
  Microsoft Partner Center (gratuit).
- Bloqué tant que ces comptes ne sont pas créés par l’utilisateur.

## Artefacts

```sh
bun run extension:zip
```

Produit à la racine :

| Fichier | Destination |
| --- | --- |
| `coffre-extension.zip` | Chrome Web Store, Edge Add-ons |
| `coffre-extension.xpi` | Firefox AMO (même archive ZIP) |
| `SHA256SUMS-extension` | Vérification manuelle et notes de version |

Le script vérifie que la version du manifeste correspond à `package.json` et
que les fichiers indispensables sont présents. Le manifeste contient déjà
`browser_specific_settings.gecko.id` et `strict_min_version` pour Firefox.

Avant Firefox, lancer le lint officiel :

```sh
bunx web-ext lint --source-dir dist-extension
```

Les avertissements doivent être revus ; une erreur bloque la soumission.

## Fiche commune

- **Nom :** Coffre — gestionnaire de mots de passe local
- **Catégorie :** Productivité / Productivity
- **Langue principale :** français ; anglais en seconde langue.
- **Licence :** GPL-3.0
- **Site :** https://github.com/1wxxhktop/coffre
- **Politique de confidentialité :**
  https://github.com/1wxxhktop/coffre/blob/main/docs/PRIVACY.md
- **Objectif unique :** remplir et enregistrer des identifiants depuis un
  coffre local chiffré, sans compte ni cloud obligatoire.
- **Code distant :** aucun. Tout le code est embarqué dans l’archive.

### Description courte (132 caractères maximum)

> Remplissez vos mots de passe depuis un coffre local chiffré, sans compte ni
> cloud obligatoire.

### Description détaillée (français)

> Coffre remplit vos identifiants, mots de passe, cartes et adresses directement
> depuis un coffre chiffré qui reste sur votre appareil. Aucun compte Coffre,
> aucun serveur obligatoire, aucune télémétrie et aucune publicité.
>
> - Coffre local chiffré (Argon2id + AES-256-GCM), synchronisation par dossier
>   ou sur le réseau local si vous l’activez.
> - Remplissage à la demande, ou au chargement en opt-in sur HTTPS.
> - Enregistrement et mise à jour des identifiants, cartes, identités, TOTP et
>   passkeys.
> - Panneau latéral pour garder l’interface ouverte pendant les formulaires
>   longs.
> - Pont natif avec l’application Coffre pour macOS, Windows et Linux.
> - Exclusions de sites, verrouillage automatique et aucune lecture des pages
>   hors des formulaires autorisés.
>
> Coffre est open source sous GPL-3.0. L’extension ne stocke aucun secret :
> elle utilise une clé de session pour parler à l’application locale.

### Description détaillée (anglais)

> Coffre fills your credentials, passwords, cards and addresses from an
> encrypted vault that stays on your device. No Coffre account, no mandatory
> server, no telemetry and no ads.
>
> - Local encrypted vault (Argon2id + AES-256-GCM), folder or LAN sync when you
>   enable it.
> - On-demand filling, or on page load as an opt-in on HTTPS.
> - Save and update logins, cards, identities, TOTP and passkeys.
> - Side panel to keep the interface open during long forms.
> - Native bridge with the Coffre desktop app for macOS, Windows and Linux.
> - Per-site exclusions, auto-lock, and no page reading outside authorized
>   forms.
>
> Coffre is open source under GPL-3.0. The extension stores no secrets: it uses
> a session key to talk to the local app.

## Justification des permissions

| Permission | Justification pour la revue |
| --- | --- |
| `activeTab` | Remplir ou enregistrer uniquement après un clic ou un raccourci de l’utilisateur. |
| `scripting` | Injecter le content script sur les sites que l’utilisateur a autorisés, pour détecter les formulaires et remplir les champs. |
| `storage` | Conserver la clé de session du pont natif, les préférences et les domaines exclus. Aucun secret de coffre. |
| `nativeMessaging` | Communiquer avec l’application Coffre installée localement ; aucun serveur distant. |
| `clipboardWrite` | Copier un identifiant ou un code TOTP sur demande explicite. |
| `clipboardRead` | Coller un mot de passe généré ou un code dans un formulaire, uniquement sur action de l’utilisateur. |
| `contextMenus` | Ajouter les actions Coffre (remplir, copier, générer) au menu contextuel. |
| `sidePanel` | Afficher l’interface Coffre dans le panneau latéral Chromium. |
| `optional_host_permissions` | Demander l’accès site par site, jamais pour tous les sites par défaut. |
| `host_permissions` locaux | Autoriser uniquement l’application locale de développement (`localhost:1420`, `127.0.0.1:1420`, `localhost:4173`) et le pont. |

Aucune permission de géolocalisation, caméra, microphone, historique ou
identité n’est demandée. L’extension ne lit pas le presse-papiers en
arrière-plan.

## Chrome Web Store

1. Créer le compte développeur (5 $, une fois) et vérifier l’adresse e-mail.
2. « New item » → téléverser `coffre-extension.zip`.
3. Renseigner la fiche commune, la catégorie et la politique de confidentialité.
4. Coller les justifications de permissions ci-dessus.
5. Déclarer « no remote code » et « no user data collected ».
6. Ajouter au moins une capture 1280×800 (ou 640×400) : popup, panneau latéral,
   remplissage, réglages.
7. Soumettre. Délai habituel : quelques jours ouvrés, parfois plus lors d’une
   première revue.

## Firefox AMO

1. Créer un compte AMO gratuit et enregistrer le développeur.
2. `bunx web-ext lint --source-dir dist-extension`, puis corriger les erreurs.
3. Soumettre `coffre-extension.xpi` en canal « listed ».
4. Renseigner la fiche, la licence GPL-3.0 et la politique de confidentialité.
5. Notes pour la revue : le pont natif est facultatif ; l’extension fonctionne
   en mode dégradé sans l’application ; aucune requête distante n’est faite par
   l’extension elle-même.
6. Soumettre. Délai habituel : quelques jours ouvrés.

## Edge Add-ons

1. Créer un compte Microsoft Partner Center.
2. Réutiliser `coffre-extension.zip` (même base Chromium).
3. Renseigner la fiche et les justifications, puis soumettre.
4. Vérifier le comportement du panneau latéral et du pont natif après
   installation depuis le store.

## Vérification après publication

- Installer depuis chaque store dans un profil vierge.
- Vérifier l’appairage, le déverrouillage, le remplissage, l’enregistrement,
  le TOTP, les cartes, les identités et les passkeys.
- Vérifier le panneau latéral Chromium/Firefox et le repli si l’API manque.
- Vérifier la mise à jour automatique à la version suivante.
- Comparer l’empreinte du paquet publié avec `SHA256SUMS-extension`.
- Consigner la date, la version, le numéro de fiche et les éventuelles
  limitations dans `docs/QA-FINAL.md`.

## Mise à jour d’une fiche existante

1. Incrémenter la version dans `package.json`, `extension/public/manifest.json`
   et les fichiers de version suivis par `bun run version:check`.
2. `bun run extension:zip`, puis vérifier les empreintes.
3. Téléverser le nouveau paquet sur chaque store, avec les notes de version.
4. Attendre la revue avant d’annoncer la disponibilité.
5. Vérifier l’installation et la mise à jour depuis la version précédente.
