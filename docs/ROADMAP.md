# Feuille de route Coffre — 2026–2028

**Version du document :** 1.0 — 12 novembre 2026  
**Périmètre :** produit, plateformes, sécurité, distribution, écosystème.  
**Statut :** document de travail, à réviser après chaque release.

> **Ambition.** Faire de Coffre le meilleur gestionnaire de mots de passe pour les personnes et les équipes qui refusent de dépendre d’un cloud propriétaire, sans sacrifier le confort d’1Password ni la transparence de Bitwarden.

---

## 0. Résumé exécutif

Coffre a déjà un socle rare : format ouvert, chiffrement local, synchronisation par dossier et sur réseau local, passkeys, agent SSH, signature Git, récupération par phrase et par parts Shamir, mode voyage, journal d’activité, extension Chromium, application macOS, CLI et builds reproductibles. La prochaine étape n’est pas d’ajouter dix fonctions isolées : c’est de combler les **derniers gouffres d’usage** (mobile, AutoFill système, partage, audit) tout en gardant les différenciateurs qui rendent Coffre unique.

### Les cinq paris

1. **Local-first sans compte obligatoire.** Le coffre reste un fichier que l’utilisateur possède. La synchronisation devient un choix : dossier, réseau local, WebDAV, S3 ou Nextcloud. Aucun serveur Coffre n’est requis.
2. **Portabilité totale.** Format `.coffre` documenté, import/export KDBX 4, CXF/CXP, CLI, API locale. Aucun verrou de sortie.
3. **Sécurité vérifiable.** Code ouvert, builds reproductibles, SBOM, signatures, audit externe publié, migration post-quantique planifiée.
4. **Autofill et passkeys partout.** Chromium, Firefox, Safari, Android, iOS, application desktop et AutoFill système. C’est la table stakes ; sans cela, le reste ne compte pas.
5. **Outils développeurs et équipes.** SSH, Git, secrets de CI, partage familial, rôles, audit. Le gestionnaire des développeurs, pas seulement des consommateurs.

### Les trois gouffres à combler en priorité

| Gouffre | Pourquoi c’est bloquant | Horizon |
| --- | --- | --- |
| **Mobile** | 70–80 % des usages de mots de passe sont mobiles. Sans Android/iOS, Coffre reste un outil de desktop. | 0.18 (Android), 1.0 (iOS) |
| **AutoFill système** | Safari, applications natives et clavier système sont des points d’entrée attendus. Sur macOS/iOS, Apple Developer est indispensable. | 1.0, conditionnel |
| **Partage et collaboration** | Familles et équipes sont le cœur du marché payant. Le partage hors ligne existe, mais pas les coffres partagés vivants. | 0.19–0.20 |

### Séquence recommandée

```text
0.16  Extension partout, Windows/Linux, CXP
0.17  Confiance, portabilité, UX, audit préparatoire
0.18  Android
0.19  Synchronisation utilisateur, famille, partage
0.20  Équipes, SSO/SCIM, secrets manager
1.0   Audit externe, iOS, AutoFill système, post-quantique, WCAG
```

### Ce que « meilleur que les meilleurs » veut dire

Ce n’est pas copier 1Password sur le cloud, ni Bitwarden sur le self-host. C’est être **le seul** à réunir :

- la **propriété locale** du coffre ;
- la **portabilité réelle** des données et des passkeys ;
- des **outils développeurs** de niveau 1Password ;
- une **récupération** de niveau famille/entreprise ;
- une **transparence** de build qu’aucun concurrent cloud ne propose ;
- le **confort d’autofill** d’un produit grand public.

---

## 1. Méthode et règles du jeu

### 1.1 Principes non négociables

1. **Aucun secret en clair** dans les logs, les URLs, les crash reports ou les exports non demandés.
2. **Aucune connexion implicite.** Toute fonction réseau est opt-in, documentée dans `docs/SECURITY.md`, et bloquée par un test quand elle est désactivée.
3. **Aucune nouvelle permission** sans justification écrite, test de révocation et mise à jour de la politique de sécurité.
4. **Le format et les protocoles sont versionnés.** Toute évolution de format passe par une migration, des vecteurs de test et une revue.
5. **Une PR = un lot.** Pas de mélange fonctionnalité + refactor massif + changement de format.
6. **La documentation fait partie du lot** : README, `docs/SECURITY.md`, `CHANGELOG.md`, traductions anglaises, captures si l’interface change.
7. **La CI doit être verte avant fusion.** Les tests instables sont corrigés, pas ignorés.
8. **Pas de télémétrie par défaut.** Les diagnostics sont locaux et opt-in.

### 1.2 Définition de « terminé »

Un lot est terminé quand :

- le comportement est spécifié et testé (unitaire + e2e ou smoke selon la surface) ;
- les cas d’erreur sont couverts ;
- la documentation et le CHANGELOG sont à jour ;
- les permissions et la surface réseau sont documentées ;
- les versions et le format restent cohérents (`bun run version:check`) ;
- le lot a été relu pour les fuites de secrets et les régressions d’accessibilité.

### 1.3 Priorités

| Priorité | Sens |
| --- | --- |
| **P0** | Bloque la parité ou la confiance ; à faire dans les 90 jours. |
| **P1** | Fort impact utilisateur ou différenciation ; 3–6 mois. |
| **P2** | Confort, écosystème, entreprise ; 6–12 mois. |
| **P3** | Exploratoire, moonshot, veille. |

### 1.4 Efforts

| Taille | Ordre de grandeur |
| --- | --- |
| S | ≤ 1 semaine |
| M | 2–4 semaines |
| L | 1–3 mois |
| XL | > 3 mois |

Les estimations sont en **personne-semaines** pour une personne à temps plein, hors support et hors aléas de revue externe.

---

## 2. État des lieux

**Version de référence :** 0.16.0 stable (13 novembre 2026) ; 0.17.0 en préparation.

### 2.1 Ce qui est déjà livré

| Domaine | État |
| --- | --- |
| Coffre | Multi-coffres, dossiers, étiquettes, favoris, recherche, actions groupées, corbeille, historique de versions, pièces jointes chiffrées, blobs hors fichier, modèles intégrés et personnalisés. |
| Types | Connexion, note, carte, identité, passkey, clé SSH, Wi-Fi, identifiant d’API, licence logicielle, document. |
| Champs | Jusqu’à 30 champs, 13 types, TOTP, codes de secours, dates, secrets masqués. |
| Sécurité | Argon2id, AES-256-GCM, manifeste 3, format 4, MAC global, anti-rollback, vérification d’intégrité, verrouillage auto, presse-papiers temporaire, mode voyage, journal d’activité. |
| Récupération | Phrase de récupération, kit papier, Shamir `k`/`n`, QR, restauration. |
| Analyse | Tableau de bord sécurité, mots de passe faibles/réutilisés/anciens, 2FA, passkeys disponibles, HTTPS, HIBP opt-in, assistant de changement. |
| Synchronisation | Dossier synchronisé, réseau local Noise XX, partage ponctuel hors ligne, conflits archivés, rotation de clés. |
| Extension | Chromium, Firefox construit, menu inline, enregistrement/mise à jour, cartes, identités, TOTP, passkeys, autofill au chargement, pont natif macOS/Linux. |
| Desktop | macOS universel, Touch ID, barre de menus, auto-type, verrouillage système, mises à jour signées, mode voyage. |
| Développeurs | CLI, agent SSH, signature Git, `coffre run`, exports CXF/KDBX/CSV. |
| Qualité | Tests Vitest, Playwright Chromium/WebKit, smoke extension, Rust, SBOM, builds reproductibles, bêta par PR, release stable. |

### 2.2 Ce qui manque ou reste partiel

| Manque | Statut | Impact |
| --- | --- | --- |
| Application Android | Absent | Très haut |
| Application iOS | Absent ; compte Apple requis pour AutoFill | Très haut |
| Safari / AutoFill système macOS/iOS | Absent ; bloqué par compte Apple | Très haut |
| Publication Firefox / Chrome Web Store / Edge | Firefox linté mais non validé/publié | Haut |
| Panneau latéral de l’extension | Absent (E11b) | Moyen |
| Corpus de détection de formulaires | Absent (E12) | Haut (fiabilité) |
| Pont natif Windows | Absent (S6) | Haut |
| Windows Hello | Absent | Haut |
| Linux Secret Service | Absent (S7) | Moyen |
| Validation Windows/Linux/Intel | Builds CI seulement | Haut |
| Audit externe | Absent | Critique pour la confiance |
| Notarisation / Developer ID | Absent (compte Apple) | Haut (installation) |
| Partage familial/équipe | Absent ; seul le partage hors ligne existe | Très haut |
| Sync WebDAV/S3/Nextcloud | Absent | Haut (différenciation) |
| CXP (passkeys portables) | CXF fichier seulement | Haut |
| Passkey unlock / cross-device | Partiel (PRF matériel) | Moyen |
| Alertes de fuite email / dark web | HIBP mots de passe seulement | Moyen |
| Alias email en ligne | Alias hors ligne seulement | Moyen |
| `coffre scan` (secrets dans les fichiers) | Absent (Q11) | Moyen |
| Notes Markdown | Absent (Q10) | Faible |
| Éditeur de séquence auto-type | Absent | Faible |
| i18n complète (Rust, langues) | FR/EN partiel | Moyen |
| Accessibilité certifiée WCAG 2.2 AA | Partielle | Moyen |
| SSO / SCIM / administration | Absent | Haut pour l’entreprise |
| Monitoring de corruption / crash opt-in | Absent | Moyen |
| Site docs / support / statut | Absent | Moyen |

### 2.3 Dette de validation

Ces points ne sont pas des fonctionnalités, mais ils bloquent la promesse « ça marche partout » :

- exécution réelle sur Windows 10/11 et Linux GNOME/KDE ;
- exécution sur Mac Intel ;
- Firefox réel (installation, autofill, passkeys) ;
- Orion et navigateurs Chromium secondaires ;
- deux machines pour la sync LAN et les blobs ;
- permissions système macOS (Accessibilité, Touch ID) ;
- Wayland pour l’auto-type ;
- mobile réel ;
- audit externe.

### 2.4 Dette technique connue

- messages Rust en français seulement ;
- autofill au chargement limité au chargement initial (pas les routes SPA) ;
- pas de panneau latéral ;
- pas de CXP ;
- `autotypeSequence` non exposé dans l’éditeur ;
- génération de `~/.ssh/config` par hôte absente ;
- clés SSH FIDO2 (`sk-ssh-*`) refusées ;
- déverrouillage CLI via socket desktop / named pipe Windows absent ;
- imports chiffrés (1Password, Dashlane, Bitwarden) non pris en charge ;
- limites de pièces jointes (5 Mo/fichier) à revoir avec le streaming ;
- recherche et rendu à optimiser sur les très gros coffres.

---

## 3. Benchmark concurrentiel

> **Avertissement.** Ce tableau est un benchmark indicatif des offres grand public et payantes en 2026. Les plans, les plateformes et les fonctions changent vite ; toute affirmation commerciale doit être revérifiée avant publication.

### 3.1 Table stakes : ce que les meilleurs ont et que Coffre doit avoir

- autofill navigateur et mobile ;
- passkeys (création, stockage, synchronisation, portabilité) ;
- applications macOS, Windows, Linux, iOS, Android ;
- partage famille/équipe avec permissions ;
- surveillance des fuites et santé des mots de passe ;
- import/export large ;
- 2FA/TOTP, clés de sécurité, récupération ;
- support et documentation ;
- audit externe et conformité.

### 3.2 Matrice

Légende : ✅ présent, 🟡 partiel/limité, ❌ absent, 🔒 bloqué par une dépendance externe.

| Fonction | Coffre | 1Password | Bitwarden | Dashlane | Proton Pass | NordPass |
| --- | --- | --- | --- | --- | --- | --- |
| Chiffrement zero-knowledge | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Clients open source | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Format ouvert / portabilité | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 |
| Sans compte ni cloud obligatoire | ✅ | ❌ | 🟡 | ❌ | ❌ | ❌ |
| Sync dossier / LAN | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sync WebDAV/S3 utilisateur | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Extension Chromium | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Extension Firefox | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Extension Safari | ❌ | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| Remplissage au chargement | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Panneau latéral | ❌ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 |
| Passkeys création/usage | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Portabilité CXP | ❌ | 🟡 | ✅ | ✅ | 🟡 | 🟡 |
| Déverrouillage par passkey | 🟡 | 🟡 | ✅ | 🟡 | 🟡 | 🟡 |
| Applications mobiles | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AutoFill mobile | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AutoFill système macOS/iOS | 🔒 | ✅ | 🟡 | ✅ | 🟡 | 🟡 |
| Windows Hello / biométrie | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Partage famille | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Équipes, rôles, collections | ❌ | ✅ | ✅ | ✅ | 🟡 | ✅ |
| SSO / SCIM | ❌ | ✅ | ✅ | ✅ | 🟡 | ✅ |
| Self-host | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Accès d’urgence / contact | 🟡 | ✅ | ✅ | 🟡 | ✅ | 🟡 |
| Surveillance fuites mots de passe | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dark web / identité | ❌ | 🟡 | 🟡 | ✅ | ✅ | ✅ |
| Alias email | 🟡 | ❌ | ❌ | ❌ | ✅ | 🟡 |
| TOTP | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Clés de sécurité / PRF | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Agent SSH / signature Git | ✅ | ✅ | ✅ | 🟡 | 🟡 | ❌ |
| CLI / secrets manager | ✅ | ✅ | ✅ | ❌ | 🟡 | ❌ |
| Intégrations CI/CD | 🟡 | 🟡 | ✅ | ❌ | 🟡 | ❌ |
| Mode voyage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Accès hors ligne | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | ✅ |
| Journal d’audit | 🟡 | ✅ | ✅ | ✅ | 🟡 | ✅ |
| Audit externe publié | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Builds reproductibles / SBOM | ✅ | ❌ | 🟡 | ❌ | ❌ | ❌ |
| Accessibilité WCAG | 🟡 | ✅ | ✅ | ✅ | 🟡 | 🟡 |
| i18n | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Installateurs notariés | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| VPN intégré | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Monitoring AI / agents | ❌ | 🟡 | ✅ | 🟡 | ❌ | ❌ |

### 3.3 Où Coffre peut gagner

1. **Propriété et portabilité** : aucun concurrent cloud ne peut offrir un coffre entièrement local avec sync au choix et sortie CXP/KDBX.
2. **Transparence de build** : reproductibilité, SBOM, code ouvert, audit publié.
3. **Développeurs** : SSH, Git, CLI, secrets de CI dans le même produit, sans serveur obligatoire.
4. **Récupération** : Shamir + kit papier + phrase + contact d’urgence, plus complet que la plupart.
5. **Vie privée** : pas de télémétrie, pas de scan dark web intrusif, réseau opt-in.

### 3.4 Où Coffre ne doit pas aller

- **VPN intégré** : hors périmètre, mieux vaut une intégration propre avec le VPN de l’utilisateur.
- **Cloud propriétaire obligatoire** : contraire à la promesse.
- **Télémétrie publicitaire** : jamais.
- **Scan dark web non consenti** : uniquement opt-in, avec explication du trade-off.
- **Crypto maison non auditée** : aucune.
- **Mobile “plus tard” indéfiniment** : c’est un prérequis de parité.

---

## 4. Stratégie produit

### 4.1 Positionnement

> **Coffre — le coffre que vous possédez vraiment.**  
> Aussi pratique qu’1Password, aussi ouvert que Bitwarden, aussi portable qu’un fichier KeePass, avec les outils des développeurs et la transparence du logiciel libre.

### 4.2 Personas

| Persona | Besoin principal | Fonctions gagnantes |
| --- | --- | --- |
| Particulier privacy-first | Ne pas confier ses secrets à un cloud | Local-first, sync dossier/LAN, audit, export |
| Famille | Partager sans perdre le contrôle | Coffres partagés, rôles, urgence, héritage |
| Développeur | Ne plus mettre de secrets dans `.env` | CLI, SSH, Git, `coffre scan`, CI |
| Petite équipe | Gérer les accès sans SaaS lourd | Sync utilisateur, rôles, audit, self-host |
| Entreprise | Conformité et gouvernance | SSO/SCIM, politiques, SIEM, audit, SLA |
| Migrateur | Quitter 1Password/Bitwarden/Dashlane | Import direct, CXP, KDBX, CXF |

### 4.3 Piliers

1. **Coffre & confort** : recherche, organisation, génération, TOTP, notes, pièces jointes.
2. **Remplissage & passkeys** : navigateur, OS, mobile, desktop.
3. **Synchronisation & partage** : dossier, LAN, WebDAV/S3, famille, équipes.
4. **Sécurité & confiance** : crypto, audit, récupération, post-quantique.
5. **Plateformes** : macOS, Windows, Linux, Android, iOS, Web, CLI.
6. **Développeurs & entreprise** : SSH, CI, secrets, SSO, SCIM, audit.
7. **Écosystème & migration** : imports, exports, alias, stores, API.
8. **Qualité & opérations** : CI, releases, support, docs, accessibilité.

### 4.4 Indicateurs

| Indicateur | Cible 1.0 |
| --- | --- |
| Taux de succès autofill sur corpus | ≥ 98 % |
| Taux de succès passkey (création + assertion) | ≥ 99 % |
| Déverrouillage p95 | < 2 s (coffre 10 000 éléments) |
| Recherche p95 | < 100 ms |
| Sessions sans crash | ≥ 99,5 % |
| Violations WCAG A/AA détectées | 0 sur les écrans principaux |
| Findings critiques/hauts d’audit | 0 |
| Couverture des tests unitaires `src/lib` | ≥ 85 % |
| Migration 1Password/Bitwarden réussie | ≥ 99 % des éléments supportés |
| Temps de première configuration | < 5 min |

### 4.5 Modèle économique et gouvernance

La fonctionnalité ne suffit pas : un projet qui veut dépasser les grands doit être finançable et crédible dans la durée.

- **Cœur open source GPL-3.0** : individus, associations, auto-hébergement personnel.
- **Offre famille** : confort de partage, support, sauvegardes guidées ; pas de cloud Coffre obligatoire.
- **Offre équipe/entreprise** : self-host, SSO/SCIM, audit, support, licences commerciales.
- **Support et intégrations** : contrats de support, migrations assistées, audits de déploiement.
- **Aucune publicité, aucune revente de données, aucune télémétrie par défaut.**
- **Gouvernance** : roadmap publique, RFC pour les changements de format/protocole, politique de sécurité, code de conduite, divulgation responsable.

Le financement doit rester aligné avec la promesse : l’utilisateur paie pour le support, la gouvernance et les fonctions d’équipe, jamais pour que ses secrets soient exploités.

---

## 5. Roadmap par horizons

### 5.1 `0.16.0` — Remplissage au chargement et fiabilité (13 novembre 2026)

**Objectif :** livrer le remplissage au chargement et les correctifs de fiabilité sans changer le format.

- E11a : remplissage au chargement en opt-in (HTTPS, cadre principal, une seule connexion, TOTP vide, aucune soumission).
- Réglages : retour en haut du contenu à chaque changement de section.
- Windows Hello : adaptation à `windows 0.62`.
- Dépendances : `snow 0.10`, `sha2 0.11`, `getrandom 0.4`, `notify 8.2`.
- CI : `cargo check` pour les PR Dependabot, sans bêta signée impossible.

**Sortie :** 0.16.0 stable, format `4`, manifeste `3`, protocoles `2`.

### 5.2 `0.17.0` — Extension partout et portabilité (mois 1–2)

**Objectif :** finir la surface navigateur et rendre Coffre crédible sur la sécurité et la migration.

- E11b : panneau latéral Chromium/Firefox.
- E12 : corpus de pages réelles et taux de détection.
- E13 : validation Firefox, publication Chrome Web Store et Edge Add-ons.
- Orion : installation automatique de l’hôte natif.
- Windows : relais du pont natif, validation de base.
- Linux : validation GNOME/KDE, Secret Service.
- i18n : messages Rust en anglais.
- Éditeur de séquence auto-type.
- CXP/CXF : import/export de passkeys et d’identifiants entre gestionnaires.
- Passkey unlock (PRF) et revue du déverrouillage biométrique.
- Tableau de bord sécurité v2 : évolution, remédiation guidée, export.
- Assistant de changement de mot de passe v2 : détection de formulaire, mise à jour assistée.
- Alias email en ligne (SimpleLogin/Addy/Fastmail/Proton), opt-in.
- Surveillance de fuites : HIBP mots de passe + email optionnel, cache local.
- Accessibilité : axe-core en CI, navigation clavier, WCAG 2.2 AA.
- Performance : démarrage, déverrouillage, recherche sur gros coffres.
- Audit externe : périmètre, appel d’offres, correctifs préparatoires.
- Format v5 : préparation des coffres partagés et des métadonnées CXP.

**Sortie :** 0.17.0 stable, extension publiée sur au moins un store, CXP utilisable sur desktop, audit planifié.

### 5.3 `0.18.0` — Android (mois 2–4)

**Objectif :** première plateforme mobile, avec autofill et passkeys.

- Application Android native (Kotlin/Compose) + cœur Rust via UniFFI.
- Coffre local, déverrouillage biométrique, générateur, TOTP.
- Autofill Framework Android.
- Passkeys via Credential Manager / provider Android 14+.
- Sync dossier, LAN, QR d’appairage.
- CXP Android (Play Services 26.21+).
- Mode voyage, verrouillage, capture d’écran bloquée, presse-papiers.
- Play Store : fiche, politique de confidentialité, data safety.

**Sortie :** bêta Android publique, autofill et passkeys validés sur appareils réels.

### 5.4 `0.19.0` — Partage et synchronisation utilisateur (mois 4–6)

**Objectif :** transformer Coffre en outil familial et multi-appareils sans cloud Coffre.

- Sync WebDAV, S3-compatible, Nextcloud.
- Coffres partagés : clés de groupe, enveloppes par membre, rôles.
- Invitations par fichier/QR/lien, révocation et rotation de clé.
- Contact d’urgence et héritage.
- Résolution visuelle des conflits.
- Partage de lien chiffré, avec expiration, via stockage utilisateur.
- Journal d’audit partagé et export.

**Sortie :** 0.19.0 stable, famille utilisable, sync distante sans serveur Coffre.

### 5.5 `0.20.0` — Équipes et développeurs (mois 6–8)

**Objectif :** adresser les équipes et les développeurs, sans trahir le local-first.

- Groupes, collections, rôles, politiques.
- SSO/OIDC pour un service self-hosted optionnel.
- SCIM et annuaire.
- Audit SIEM, webhooks, export.
- `coffre scan`, intégrations GitHub/GitLab/Jenkins, Kubernetes, Terraform.
- Comptes machine, tokens scopés, approbations.
- MCP / accès agents avec validation humaine.
- Rotation de secrets et baux d’accès (phase 1).

**Sortie :** 0.20.0 stable, offre équipe self-hosted, secrets manager minimal.

### 5.6 `1.0.0` — Socle audité (mois 8–12)

**Objectif :** version de référence, auditable et distribuable largement.

- Audit externe complet et corrections.
- Notarisation Developer ID (si compte Apple) et signature Windows.
- iOS et AutoFill système (si compte Apple).
- Windows Hello, Secure Enclave, Keystore Android.
- CXP bidirectionnel mature.
- Crypto post-quantique hybride (X25519+ML-KEM, Ed25519+ML-DSA).
- WCAG 2.2 AA vérifié, i18n élargie.
- Support, docs, statut, politique de sécurité.
- Performance et stabilité sur 100 000 éléments.

**Sortie :** 1.0.0, audit publié, installateurs signés, mobile et desktop couverts.

### 5.7 Après 1.0 — Moonshots

- Identité décentralisée et passkey-only.
- PAM léger : baux, approbations, rotation automatisée.
- Accès agent IA avec preuve d’usage.
- Sync P2P Internet sans relais.
- Conformité SOC 2 / ISO 27001 / FedRAMP selon marché.
- Hardware wallet / secure element externe.
- Marché de plugins communautaires (avec bac à sable).

---

## 6. Chantiers détaillés, pas à pas

### 6.1 Extension navigateur : finir la surface

**Pourquoi.** L’extension est le point de contact quotidien. Aujourd’hui : Chromium fonctionne, Firefox est construit mais non validé, Safari manque, les stores ne sont pas utilisés, le panneau latéral et le corpus de détection manquent.

#### 6.1.1 Panneau latéral (E11b)

1. Ajouter `sidePanel` (Chromium) et `sidebar_action` (Firefox) au manifeste, avec justification dans `docs/SECURITY.md`.
2. Créer `extension/sidepanel.html` et réutiliser les composants de la popup ; adapter la largeur 320–480 px.
3. Ajouter l’entrée Vite `sidepanel` dans `vite.extension.config.ts`.
4. Dans `background.ts`, appeler `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` ; conserver la popup en repli.
5. Firefox : `sidebar_action` avec le même document ; tester l’ouverture et la fermeture.
6. Adapter le CSS : en-tête/pied fixes, version en pied, scroll central.
7. Tests : smoke extension, ouverture du panneau, remplissage depuis le panneau, fermeture.
8. Docs : capture, permissions, limites Firefox.

**Acceptation :** le panneau s’ouvre, reste ouvert pendant un formulaire long, et remplit comme la popup.

#### 6.1.2 Corpus de détection (E12)

1. Créer `e2e/corpus/` avec ~50 pages HTML reconstruites (sans marques) : login, signup, changement de mot de passe, paiement, Shadow DOM, SPA, iframes, champs sans `name`.
2. Pour chaque page, un JSON de résultat attendu (`kind`, champs, visibilité).
3. Ajouter un test Vitest sur `detect.ts` avec JSDOM pour tout le corpus.
4. Ajouter un échantillon e2e Chromium.
5. Publier le taux de détection dans `docs/QA-FINAL.md`.
6. Faire échouer la CI si le taux baisse.

**Acceptation :** taux mesuré, aucune régression silencieuse.

#### 6.1.3 Publication stores (E13)

1. Chrome Web Store : fiche, captures, description, politique de confidentialité, justification des permissions.
2. Firefox AMO : `web-ext lint`, build XPI, signature, fiche.
3. Edge Add-ons : réutiliser le paquet Chromium.
4. Ajouter un workflow de release d’extension (version, tag, upload).
5. Documenter le délai de revue et la procédure de mise à jour.
6. Après publication : vérifier l’installation propre, l’autofill et les passkeys.

**Acceptation :** extension installable depuis au moins Chrome et Firefox, mise à jour automatique.

#### 6.1.4 Orion et navigateurs secondaires

1. Ajouter `Orion` à la liste macOS de `install_native_hosts` (`src-tauri/src/bridge.rs`) avec le manifeste `allowed_origins`.
2. Écrire le manifeste au démarrage et lors de l’installation.
3. Vérifier l’ID d’extension et le format attendu par Orion.
4. Documenter la limite : Orion peut avoir des bugs de livraison des réponses natives.
5. Test manuel : popup, statut, remplissage, ouverture de l’app.

**Acceptation :** Orion trouve l’hôte natif et le pont répond.

#### 6.1.5 Safari (conditionnel)

1. Compte Apple Developer, App Group, Keychain Access Group.
2. Extension Safari WebExtension empaquetée dans l’app.
3. AutoFill Credential Provider (S3/S4) et passkeys système.
4. Notarisation et distribution.
5. Tests sur macOS 14+ et iOS 17+.

**Dépendance :** compte Apple payant. Sans lui, le lot reste hors programme.

### 6.2 Windows : parité desktop

**Pourquoi.** Windows est le premier parc desktop. Aujourd’hui : build CI, pas de validation, pas de pont natif, pas de Windows Hello.

1. **Pont natif** : implémenter le named pipe dans `src-tauri/src/bridge.rs` (`CreateNamedPipe` ou `tokio::net::windows::named_pipe`), avec les mêmes frames et le même chiffrement.
2. **Manifeste** : écrire la clé de registre `HKCU\Software\Google\Chrome\NativeMessagingHosts\app.coffre.bridge` (et Edge/Brave) pointant vers le JSON.
3. **Extension** : vérifier `connectNative` sur Windows, l’ouverture de l’app et le statut.
4. **Windows Hello** : utiliser `UserConsentVerifier` ou un plugin Tauri ; envelopper la clé de session avec DPAPI/Hello ; repli mot de passe maître.
5. **Auto-type** : valider l’existant, corriger les dispositions clavier, tester UAC et élévation.
6. **Packaging** : MSI/NSIS signés, winget, mise à jour signée.
7. **Validation** : VM Windows 10/11, écrans 100/125/150 %, clavier AZERTY/QWERTY.
8. **Docs** : installation, SmartScreen, permissions, limites.

**Acceptation :** installation propre, extension appairée, Hello fonctionnel, auto-type validé, mise à jour testée.

### 6.3 Linux : finitions

1. **Secret Service** (S7) : fournir une collection `org.freedesktop.secrets` via D-Bus ; stocker la clé de session ; déverrouillage par le trousseau système.
2. **Auto-type Wayland** : utiliser `wtype`/portail RemoteDesktop ou `ydotool` ; documenter les limites.
3. **X11** : valider le raccourci global et l’envoi de touches.
4. **Packaging** : Flatpak, Snap, AppImage, `.deb`, `.rpm` ; mise à jour.
5. **Validation** : GNOME, KDE, Wayland, X11, HiDPI.
6. **Docs** : permissions, portails, dépannage.

**Acceptation :** coffre utilisable sur GNOME/KDE, auto-type documenté et testé.

### 6.4 Android : la première plateforme mobile

**Pourquoi.** Sans mobile, Coffre ne peut pas concurrencer les grands. Android est prioritaire : pas de compte payant, Autofill Framework accessible, Play Services CXP.

**Architecture recommandée :** cœur Rust `coffre-core` via UniFFI + UI Kotlin/Compose. Tauri mobile est possible, mais les APIs Autofill/Credential Manager sont plus directes en Kotlin.

1. **Socle** : générer les bindings UniFFI Android ; ouvrir, lire, écrire, fusionner un `.coffre` ; tests croisés avec les vecteurs Rust.
2. **UI** : liste, recherche, fiche, générateur, TOTP, réglages, thème, verrouillage.
3. **Biométrie** : `BiometricPrompt` + Android Keystore ; clé enveloppée ; repli maître.
4. **Autofill** : `AutofillService`, parsing des champs, datasets, authentification, suggestions inline ; tests sur apps réelles.
5. **Passkeys** : `CredentialManager` / provider Android 14+ ; création, assertion, confirmation.
6. **Sync** : SAF pour dossier, LAN, QR d’appairage ; file d’attente hors ligne.
7. **CXP** : `ProviderEventsManager` import/export (Play Services 26.21+), CXF.
8. **Sécurité** : `FLAG_SECURE`, presse-papiers, pas de backup des clés, mode voyage, verrouillage.
9. **Distribution** : Play Store, data safety, politique de confidentialité, bêta fermée puis publique.
10. **Validation** : Pixel, Samsung, Android 10–16, modes sombre/clair, TalkBack.

**Acceptation :** autofill et passkeys fonctionnent sur au moins 10 sites et 5 apps, sync LAN OK, CXP OK.

### 6.5 iOS : conditionnel mais préparé

1. Compte Apple Developer, App Group, Keychain Sharing.
2. UI SwiftUI + cœur Rust via UniFFI.
3. AutoFill Credential Provider (mots de passe, TOTP, passkeys).
4. `ASCredentialProviderViewController` pour les passkeys.
5. CXP iOS 26+.
6. TestFlight, App Store, privacy nutrition labels.
7. Validation VoiceOver, Face ID/Touch ID, partage.

**Dépendance :** compte Apple et revue App Store. Sans compte, limiter à une PWA mobile améliorée.

### 6.6 Synchronisation utilisateur (WebDAV/S3/Nextcloud)

**Pourquoi.** Le cloud Coffre n’existe pas et ne doit pas devenir obligatoire. L’utilisateur doit pouvoir choisir son stockage.

1. Abstraire `SyncTarget` : dossier, LAN, WebDAV, S3.
2. WebDAV : `PROPFIND`, `GET`, `PUT`, `ETag`, `If-Match`, reprise.
3. S3 : SigV4, presigned URLs, compatible MinIO/Backblaze/Wasabi.
4. Nextcloud : WebDAV + gestion des conflits.
5. Chiffrer le fichier et les métadonnées ; ne jamais envoyer la clé maître.
6. Détection de conflits par révision/MAC ; fusion ; UI de résolution.
7. Planification, retry/backoff, bande passante, mode économie.
8. Tests avec MinIO, Nextcloud, coupure réseau, conflit concurrent.
9. Docs : configuration, sécurité, limites.

**Acceptation :** deux appareils synchronisent via WebDAV/S3 sans serveur Coffre, conflits visibles et résolus.

### 6.7 Famille et partage

**Pourquoi.** C’est le marché payant et la promesse « coffre pour la maison ».

1. **Format v5** : métadonnées de coffre partagé, membres, rôles, enveloppes de clé, révocation, audit.
2. **Crypto** : clé de coffre aléatoire, enveloppée pour chaque membre avec X25519 + HKDF ; signature Ed25519 des invitations.
3. **Invitation** : fichier `.coffre-invite`, QR ou lien ; le destinataire importe avec son empreinte.
4. **Rôles** : lecture, édition, partage, administration ; UI et contrôles côté cœur.
5. **Révocation** : rotation de clé, ré-enveloppe, ré-encryption des éléments, distribution.
6. **Contact d’urgence** : demande d’accès, délai, approbation, journal.
7. **Partage d’élément** : lien chiffré avec expiration, via stockage utilisateur ou fichier.
8. **Audit** : qui a vu/modifié/partagé, export.
9. **Tests** : 3 appareils, révocation, perte d’appareil, conflit, urgence.

**Acceptation :** une famille partage un coffre, révoque un membre, et retrouve l’accès d’urgence.

### 6.8 Équipes et entreprise

1. **Groupes et collections** : organisation, permissions, héritage.
2. **SSO/OIDC** : service self-hosted optionnel ; release de clé après authentification ; zero-knowledge à préserver.
3. **SCIM** : provisionnement utilisateurs/groupes.
4. **Politiques** : mot de passe maître, 2FA, session, export, partage, autofill.
5. **Console d’administration** : membres, rôles, audit, SIEM, webhooks.
6. **Self-host** : Docker/Helm, HA, sauvegarde, mises à jour.
7. **SIEM** : export JSON/CEF, HEC, webhooks.
8. **Baux et rotation** : accès temporaire, approbation, rotation de secrets.
9. **Conformité** : SOC 2/ISO 27001 selon marché.

**Acceptation :** une équipe de 20 personnes gère ses accès, audit et révocation sans cloud Coffre.

### 6.9 Passkeys et CXP

1. **CXF** : vérifier l’export/import existant ; compléter les types, les champs et les passkeys.
2. **CXP** : implémenter le protocole sur Android/iOS/macOS 26+ ; sinon export/import fichier sécurisé.
3. **Export de passkey** : confirmation utilisateur, compteur à zéro, validation RP ID, pas de clé en clair.
4. **Cross-device** : QR + ECDH éphémère pour transférer une passkey entre appareils sans cloud.
5. **Passkey unlock** : clé PRF de plateforme enveloppe la clé maître ; repli maître.
6. **Windows provider** : intégration Windows 11 (phase 2).
7. **Santé des passkeys** : liste, RP ID, dernier usage, sites sans passkey.
8. **Tests** : Apple Passwords, Bitwarden, 1Password, Dashlane.

**Acceptation :** une passkey créée dans Coffre s’exporte vers un autre gestionnaire et inversement.

### 6.10 Sécurité, audit et post-quantique

1. **Audit externe** : périmètre (crypto, format, sync, parsers, mobile, extension), appel d’offres, corrections, rapport public.
2. **Post-quantique** : hybride X25519 + ML-KEM-768, Ed25519 + ML-DSA-65 ; format v6 ; migration et vecteurs.
3. **Matériel** : Secure Enclave macOS, Windows Hello, Android Keystore, TPM.
4. **Mémoire** : `zeroize`, `mlock`, éviter le swap, effacer les secrets.
5. **Anti-hameçonnage v2** : signaux locaux, punycode, homoglyphes, formulaires suspects, réputation locale.
6. **Fuites** : HIBP mots de passe, email opt-in, cache local, aucune persistance des résultats sensibles.
7. **Duress/panique** : mot de passe de contrainte, coffre leurre, effacement d’urgence.
8. **Journal d’audit** : chaîne de hachage, export, vérification.
9. **Fuzzing** : KDBX, CXF, CXP, imports, parsers ; `cargo-fuzz`.
10. **Bug bounty** : périmètre, récompenses, divulgation.

**Acceptation :** audit sans finding critique/haut, migration PQ testée, fuzzing en CI.

### 6.11 Développeurs

1. **`coffre scan`** (Q11) : motifs, entropie, `.gitignore`, masquage, `--import`, `coffre run`.
2. **CI** : GitHub Action, GitLab CI, Jenkins, Kubernetes Operator, Terraform provider, Ansible.
3. **Comptes machine** : tokens scopés, expiration, audit, approbation.
4. **SSH** : clés FIDO2 `sk-ssh-*`, génération de `~/.ssh/config`, hôtes multiples.
5. **Déverrouillage CLI** : socket desktop, named pipe Windows.
6. **MCP / agents** : serveur local, demandes de secrets avec approbation humaine, audit.
7. **Shell** : complétions, man pages, `coffre run --env-file`.

**Acceptation :** un pipeline CI récupère un secret sans le stocker, un agent IA demande un accès approuvé.

### 6.12 UX, accessibilité, i18n

1. **Onboarding** : choix local/sync, récupération, installation extension.
2. **Migration** : assistant 1Password/Bitwarden/Dashlane/Proton/Nord/KeePass, aperçu, déduplication, rapport.
3. **Notes Markdown** (Q10) : sous-ensemble sûr, cases à cocher, liens http(s), pas de HTML.
4. **Palette de commandes** : actions, recherche, navigation clavier.
5. **Accessibilité** : axe-core CI, VoiceOver/NVDA, contrastes, taille de texte, focus.
6. **i18n** : espagnol, allemand, portugais, italien ; messages Rust ; pluriels/dates.
7. **Performance** : démarrage, unlock, recherche, rendu de listes.
8. **Thèmes** : clair/sombre/système, densité, taille de police.

**Acceptation :** 0 violation axe A/AA, migration réussie, interface utilisable au clavier.

### 6.13 Écosystème et intégrations

1. **Alias email** : SimpleLogin, Addy.io, Fastmail, Proton ; tokens chiffrés ; génération dans l’extension.
2. **Imports directs** : 1Password, Bitwarden, Dashlane, Proton, Nord, KeePass ; chiffrés si possible.
3. **Partage de lien** : payload chiffré dans le fragment pour les petits éléments ; stockage utilisateur pour les gros.
4. **API locale** : tokens scopés, lecture/écriture contrôlée, audit.
5. **Intégrations OS** : Shortcuts macOS/iOS, intents Android, Raycast/Alfred.
6. **Stores** : Chrome, Firefox, Edge, Safari (conditionnel).

**Acceptation :** un utilisateur quitte un concurrent en moins de 10 minutes, alias email généré dans l’extension.

### 6.14 Opérations, release et support

1. **Signature** : Developer ID/notarisation (conditionnel), signature Windows, Android/iOS.
2. **Reproductibilité** : builds reproductibles, SBOM, provenance SLSA.
3. **Diagnostics** : crash reports opt-in, redaction, pas de secrets.
4. **Mises à jour** : stable/beta, déploiement progressif, rollback.
5. **Docs** : site, guides, FAQ, statut, changelog.
6. **Support** : canal, SLA, base de connaissances.
7. **Cadence** : mineure toutes les 4–6 semaines, patch selon besoin.
8. **Gouvernance** : roadmap publique, RFC, politique de sécurité, code de conduite.

---

## 7. Backlog exhaustif

> Les lignes déjà livrées sont dans la section 2. Ce tableau liste les fonctions **manquantes ou à renforcer**, avec une priorité et un horizon indicatifs.

### 7.1 Coffre et organisation

| ID | Fonction | Priorité | Horizon | Effort |
| --- | --- | --- | --- | --- |
| C01 | Dossiers imbriqués et collections | P2 | 0.19 | M |
| C02 | Champs personnalisés supplémentaires (fichier, référence, couleur) | P2 | 0.19 | M |
| C03 | Modèles de notes et d’éléments partagés | P2 | 0.20 | M |
| C04 | Notes Markdown | P1 | 0.17 | S |
| C05 | Aperçu intégré des pièces jointes (PDF, images, texte) | P1 | 0.17 | M |
| C06 | Limites de pièces jointes augmentées + streaming UI | P1 | 0.17 | M |
| C07 | Recherche plein texte dans les pièces jointes (OCR local opt-in) | P3 | 1.0+ | L |
| C08 | Déduplication et fusion d’éléments | P1 | 0.17 | M |
| C09 | Archivage et corbeille par coffre | P2 | 0.19 | S |
| C10 | Historique de versions avec diff visuel | P2 | 0.20 | M |
| C11 | Épinglage et accès rapide personnalisable | P2 | 0.19 | S |
| C12 | Modèles de générateur par site | P2 | 0.19 | S |

### 7.2 Remplissage et navigateur

| ID | Fonction | Priorité | Horizon | Effort |
| --- | --- | --- | --- | --- |
| A01 | Panneau latéral | P0 | 0.16 | M |
| A02 | Corpus de détection | P0 | 0.16 | M |
| A03 | Publication Chrome Web Store | P0 | 0.16 | S |
| A04 | Validation et publication Firefox | P0 | 0.16 | M |
| A05 | Edge Add-ons | P1 | 0.16 | S |
| A06 | Safari WebExtension | P1 | 1.0 (conditionnel) | L |
| A07 | Autofill SPA / routes internes | P1 | 0.17 | M |
| A08 | Détection Shadow DOM avancée | P1 | 0.17 | M |
| A09 | Remplissage des formulaires multi-étapes | P1 | 0.17 | M |
| A10 | Menu contextuel enrichi (copier, TOTP, alias) | P2 | 0.17 | S |
| A11 | AutoFill système macOS/iOS | P1 | 1.0 (conditionnel) | XL |
| A12 | AutoFill Android | P0 | 0.18 | L |
| A13 | AutoFill Windows (application) | P2 | 0.20 | M |
| A14 | Remplissage de fichiers / documents | P3 | 1.0+ | M |
| A15 | Détection de formulaire de changement de mot de passe | P1 | 0.17 | M |

### 7.3 Synchronisation et partage

| ID | Fonction | Priorité | Horizon | Effort |
| --- | --- | --- | --- | --- |
| S01 | Sync WebDAV | P1 | 0.19 | L |
| S02 | Sync S3-compatible | P1 | 0.19 | L |
| S03 | Sync Nextcloud | P1 | 0.19 | M |
| S04 | Résolution visuelle des conflits | P1 | 0.19 | M |
| S05 | Sync sélective par coffre | P2 | 0.19 | M |
| S06 | Coffres partagés famille | P1 | 0.19 | L |
| S07 | Rôles et permissions | P1 | 0.19 | L |
| S08 | Invitations par fichier/QR/lien | P1 | 0.19 | M |
| S09 | Révocation et rotation de clé | P1 | 0.19 | L |
| S10 | Contact d’urgence | P1 | 0.19 | M |
| S11 | Partage de lien chiffré avec expiration | P2 | 0.19 | M |
| S12 | Groupes et collections d’équipe | P2 | 0.20 | L |
| S13 | Audit partagé et export | P2 | 0.20 | M |
| S14 | Sync P2P Internet | P3 | 1.0+ | XL |
| S15 | Appareils et révocation à distance | P2 | 0.20 | M |

### 7.4 Passkeys et sécurité

| ID | Fonction | Priorité | Horizon | Effort |
| --- | --- | --- | --- | --- |
| P01 | CXP import/export | P0 | 0.17 | L |
| P02 | CXF complet (tous types) | P1 | 0.17 | M |
| P03 | Passkey unlock (PRF) | P1 | 0.17 | M |
| P04 | Transfert de passkey par QR | P1 | 0.18 | M |
| P05 | Windows passkey provider | P2 | 1.0 | L |
| P06 | Santé des passkeys | P2 | 0.19 | S |
| P07 | Audit externe | P0 | 1.0 | XL |
| P08 | Crypto post-quantique hybride | P2 | 1.0 | L |
| P09 | Secure Enclave / Windows Hello / Keystore | P1 | 0.17–1.0 | L |
| P10 | Anti-hameçonnage v2 | P1 | 0.17 | M |
| P11 | Surveillance email/dark web opt-in | P2 | 0.17 | M |
| P12 | Mode contrainte / coffre leurre | P3 | 1.0+ | M |
| P13 | Journal d’audit à chaîne de hachage | P2 | 0.20 | M |
| P14 | Fuzzing des parseurs | P1 | 0.17 | M |
| P15 | Bug bounty | P2 | 1.0 | M |

### 7.5 Plateformes

| ID | Fonction | Priorité | Horizon | Effort |
| --- | --- | --- | --- | --- |
| M01 | Application Android | P0 | 0.18 | XL |
| M02 | AutoFill Android | P0 | 0.18 | L |
| M03 | Passkeys Android | P0 | 0.18 | L |
| M04 | CXP Android | P1 | 0.18 | M |
| M05 | Application iOS | P1 | 1.0 (conditionnel) | XL |
| M06 | AutoFill iOS | P1 | 1.0 (conditionnel) | XL |
| M07 | CXP iOS | P1 | 1.0 (conditionnel) | M |
| M08 | PWA mobile améliorée (hors stores) | P1 | 0.17 | M |
| M09 | Windows bridge natif | P0 | 0.16 | L |
| M10 | Windows Hello | P1 | 0.17 | M |
| M11 | Validation Windows 10/11 | P0 | 0.16 | M |
| M12 | Validation Linux GNOME/KDE | P0 | 0.16 | M |
| M13 | Linux Secret Service | P1 | 0.17 | M |
| M14 | macOS Intel validation | P1 | 0.16 | S |
| M15 | Signature/notarisation macOS | P1 | 1.0 (conditionnel) | M |
| M16 | Signature Windows | P1 | 0.20 | M |
| M17 | Flatpak/Snap | P1 | 0.19 | M |

### 7.6 Développeurs

| ID | Fonction | Priorité | Horizon | Effort |
| --- | --- | --- | --- | --- |
| X01 | `coffre scan` | P1 | 0.20 | M |
| X02 | GitHub Action | P2 | 0.20 | M |
| X03 | GitLab CI | P2 | 0.20 | M |
| X04 | Jenkins | P2 | 0.20 | M |
| X05 | Kubernetes Operator | P2 | 0.20 | L |
| X06 | Terraform provider | P2 | 0.20 | M |
| X07 | Ansible | P2 | 0.20 | S |
| X08 | Comptes machine/tokens scopés | P2 | 0.20 | L |
| X09 | Clés SSH FIDO2 | P2 | 0.19 | M |
| X10 | Génération `~/.ssh/config` | P2 | 0.19 | S |
| X11 | Déverrouillage CLI socket/named pipe | P2 | 0.19 | M |
| X12 | MCP / accès agents | P3 | 0.20+ | L |
| X13 | Rotation de secrets | P3 | 1.0+ | L |
| X14 | Baux d’accès et approbations | P3 | 1.0+ | L |

### 7.7 UX, accessibilité, i18n

| ID | Fonction | Priorité | Horizon | Effort |
| --- | --- | --- | --- | --- |
| U01 | Assistant de migration | P1 | 0.17 | M |
| U02 | Onboarding guidé | P1 | 0.17 | S |
| U03 | Notes Markdown | P1 | 0.17 | S |
| U04 | Palette de commandes enrichie | P2 | 0.19 | S |
| U05 | Accessibilité WCAG 2.2 AA | P1 | 0.17 | L |
| U06 | Tests lecteur d’écran | P1 | 0.17 | M |
| U07 | Espagnol | P2 | 0.19 | M |
| U08 | Allemand | P2 | 0.19 | M |
| U09 | Portugais | P3 | 0.20 | M |
| U10 | Messages Rust traduits | P1 | 0.16 | M |
| U11 | Performance unlock/recherche | P1 | 0.17 | M |
| U12 | Thèmes/densité/typo | P2 | 0.19 | S |
| U13 | Mode RTL | P3 | 1.0+ | M |

### 7.8 Écosystème et entreprise

| ID | Fonction | Priorité | Horizon | Effort |
| --- | --- | --- | --- | --- |
| E01 | Alias SimpleLogin | P2 | 0.17 | M |
| E02 | Alias Addy.io | P2 | 0.17 | M |
| E03 | Alias Fastmail | P2 | 0.17 | M |
| E04 | Alias Proton | P2 | 0.17 | M |
| E05 | Import direct 1Password | P1 | 0.17 | M |
| E06 | Import direct Bitwarden | P1 | 0.17 | M |
| E07 | Import direct Dashlane | P1 | 0.17 | M |
| E08 | Import direct Proton/Nord | P2 | 0.19 | M |
| E09 | Partage de lien | P2 | 0.19 | M |
| E10 | API locale | P3 | 0.20 | L |
| E11 | Shortcuts macOS/iOS | P3 | 1.0+ | S |
| E12 | Intents Android | P3 | 1.0+ | S |
| E13 | Raycast/Alfred | P3 | 1.0+ | S |
| E14 | SSO/OIDC | P2 | 0.20 | XL |
| E15 | SCIM | P2 | 0.20 | L |
| E16 | SIEM/webhooks | P2 | 0.20 | M |
| E17 | Self-host équipe | P2 | 0.20 | L |
| E18 | Baux/rotation de credentials | P3 | 1.0+ | XL |
| E19 | SOC 2 / ISO 27001 | P3 | 1.0+ | XL |

### 7.9 Opérations

| ID | Fonction | Priorité | Horizon | Effort |
| --- | --- | --- | --- | --- |
| O01 | Site docs | P1 | 0.17 | M |
| O02 | Page statut | P2 | 0.20 | S |
| O03 | Diagnostics opt-in | P2 | 0.19 | M |
| O04 | Déploiement progressif | P2 | 0.20 | M |
| O05 | Rollback de release | P2 | 0.20 | S |
| O06 | Politique de sécurité publique | P1 | 0.17 | S |
| O07 | Bug bounty | P2 | 1.0 | M |
| O08 | Support/SLA | P2 | 1.0 | M |
| O09 | Reproductibilité mobile | P3 | 1.0+ | M |
| O10 | Provenance SLSA | P2 | 0.20 | M |

---

## 8. Planning et ressources

### 8.1 Scénarios

| Scénario | Équipe | 0.16 | 0.17 | 0.18 | 0.19 | 0.20 | 1.0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Solo | 1 dev | 3 sem. | 2 mois | 4 mois | 3 mois | 3 mois | +6 mois |
| Petit | 2–3 devs | 2 sem. | 6 sem. | 3 mois | 2 mois | 2 mois | +4 mois |
| Équipe | 4–6 devs | 2 sem. | 4 sem. | 2 mois | 6 sem. | 6 sem. | +3 mois |

Le chemin critique est : **Android → AutoFill/passkeys → sync/partage → audit → iOS/AutoFill système**. Le reste peut avancer en parallèle.

### 8.2 Budget externe

| Poste | Coût indicatif |
| --- | --- |
| Apple Developer | 99 $/an |
| Google Play | 25 $ une fois |
| Certificat Windows | 200–500 $/an |
| Audit externe | 25 000–80 000 $ selon périmètre |
| Matériel de test (Android, Windows, Linux) | 1 500–3 000 $ |
| Bug bounty | variable |
| Support/CI | variable |

### 8.3 Portes de décision

1. **Compte Apple** : sans lui, pas de Safari/AutoFill/iOS distribuable. Décider avant 1.0.
2. **Audit externe** : budget et périmètre à figer avant 0.17.
3. **Android** : choix Tauri vs natif avant 0.18.
4. **Cloud** : confirmer le non-goal du cloud Coffre ; seulement du stockage utilisateur.
5. **Équipe** : SSO/SCIM seulement si offre entreprise validée.

---

## 9. Risques et parades

| Risque | Probabilité | Impact | Parade |
| --- | --- | --- | --- |
| Compte Apple absent | Haute | Très haut | Documenter, prioriser Android, PWA mobile |
| Audit coûteux | Moyenne | Haut | Audit ciblé crypto/parsers/sync, financement |
| Mobile sous-estimé | Haute | Très haut | Recruter/planifier 3–4 mois, commencer Android |
| Sync/conflits complexes | Haute | Haut | Design v5, tests 3 appareils, conflits visibles |
| Fuite de secret dans logs | Moyenne | Critique | Redaction, tests, revue, pas de télémétrie |
| Scope creep | Haute | Haut | Un lot = une PR, backlog priorisé |
| Runners macOS saturés | Moyenne | Moyen | Cross-compilation Intel, files d’attente |
| Support utilisateurs | Moyenne | Moyen | Docs, FAQ, diagnostics, communauté |
| Dépendance à un fournisseur | Moyenne | Moyen | Interfaces abstraites, formats ouverts |
| Régression de format | Faible | Critique | Vecteurs, migrations, audit, tests croisés |

---

## 10. Prochaines deux semaines

1. **0.16.0** : tester la bêta `0.16.0-beta.26.1`, corriger, publier la stable.
2. **Dependabot** : fusionner #79, #83, #97 ; rebaser #80–#82/#84 avec `cargo check`.
3. **Orion** : ajouter Orion à `install_native_hosts` et documenter.
4. **CXP/CXF** : écrire la spécification d’import/export et les vecteurs de test.
5. **Audit** : rédiger le périmètre et l’appel d’offres.
6. **Android** : spike UniFFI + Compose, ouvrir le coffre et lister les éléments.
7. **Accessibilité** : ajouter axe-core aux parcours Playwright.
8. **Documentation** : publier cette roadmap et la lier depuis le README.

---

## 11. Annexes

### 11.1 Glossaire

- **CXP** : Credential Exchange Protocol, transfert chiffré de credentials entre gestionnaires.
- **CXF** : Credential Exchange Format, représentation JSON normalisée.
- **PRF** : Pseudo-Random Function WebAuthn, utilisée pour déverrouiller un coffre.
- **KDBX** : format KeePass 4.
- **Argon2id** : fonction de dérivation de clé.
- **Zero-knowledge** : le serveur ne voit jamais les secrets en clair.
- **Local-first** : les données vivent d’abord chez l’utilisateur.

### 11.2 Références

- 1Password, fonctionnalités et SSH agent : <https://1password.com/features>
- Bitwarden, nouveautés 2026 et CXP : <https://bitwarden.com/blog/bitwarden-2026-product-roundup/>
- Dashlane, export CXP : <https://support.dashlane.com/hc/en-us/articles/32907864739474>
- Proton Pass : <https://proton.me/pass>
- NordPass / Dashlane, comparaison 2026 : <https://cybernews.com/password-managers/nordpass-vs-dashlane/>
- FIDO Alliance, CXF : <https://fidoalliance.org/specs/cx/cxf-v1.0-ps-errata-20260309.html>
- FIDO Alliance, CXP : <https://fidoalliance.org/specs/cx/cxp-v1.0-wd-20241003.html>

### 11.3 Règle de mise à jour

Cette roadmap est révisée :

- après chaque release mineure ;
- après chaque audit ;
- lorsqu’une dépendance externe change (Apple, Google, stores) ;
- lorsqu’un concurrent livre une fonction qui change la parité.

La version datée du document doit rester cohérente avec `CHANGELOG.md` et `docs/VERSIONING.md`.
