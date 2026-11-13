# Audit de sécurité externe — périmètre et appel d’offres

**Version visée :** 0.17.0 (release candidate)  
**Date de préparation :** 13 novembre 2026  
**Dépôt :** https://github.com/1wxxhktop/coffre  
**Licence :** GPL-3.0-only

Ce document définit le périmètre, les livrables et le déroulement d’un audit de
sécurité externe indépendant. Il sert aussi de cahier des charges pour consulter
plusieurs prestataires.

> **État.** Coffre a fait l’objet de deux audits internes en 0.8.0 et 0.12.0
> (`docs/AUDIT-2026-11-07.md`, `docs/AUDIT-2026-11-11.md`). Ils ne remplacent pas
> une revue externe : ce périmètre prépare l’audit indépendant requis avant la
> 1.0.

---

## 1. Objectifs

1. Vérifier la conception et l’implémentation cryptographiques du coffre, du
   format `.coffre` et des protocoles de synchronisation.
2. Rechercher des vulnérabilités exploitables dans les clients desktop, web,
   extension et Android alpha.
3. Vérifier que les correctifs des audits internes 0.8 et 0.12 sont complets et
   qu’aucune régression n’a été introduite.
4. Évaluer la chaîne de build, de signature et de mise à jour.
5. Produire un rapport public, des correctifs vérifiés et une attestation de
   retest.

## 2. Périmètre technique

### 2.1 Cœur cryptographique et format `.coffre`

- Dérivation Argon2id : paramètres, sel, mémoire, parallélisme, plafonds.
- Hiérarchie de clés : clé maîtresse, clés de coffre, clés d’élément, enveloppes.
- Chiffrement AES-256-GCM, construction STREAM, AAD, nonces, rotation.
- Manifeste d’intégrité, MAC global, anti-rollback, numéros de génération.
- Récupération : phrase de récupération, kit papier, Shamir `k`/`n`, contact
  d’urgence, enveloppes scellées.
- Passkeys : enveloppe PRF, export/import CXF, attestation et assertion.
- Coffres partagés : rôles, promotion, rotation de clé, fusion, conflits.
- Format `.coffre` version `4`, migrations, parseurs, limites de taille et de
  profondeur, fichiers tronqués ou malveillants.
- Fusion de fichiers, résolution de conflits, pierres tombales, blobs.
- Implémentations TypeScript et Rust (`coffre-core`) : cohérence des deux
  implémentations et vecteurs croisés.

**Points à retester explicitement** (constats internes 0.12) :

- AUD-01 clé publique d’urgence hors MAC ;
- AUD-09 pièces jointes supprimées à l’ouverture ;
- AUD-10 bundle partagé illisible ;
- AUD-11 adoption d’époque et sidecars ;
- AUD-12 fusion de `emergency` et `prf` ;
- AUD-13 auto-promotion d’un membre `write` ;
- AUD-14 rotation de clé de coffre partagé.

### 2.2 Synchronisation et réseau local

- Synchronisation par dossier : écritures atomiques, conflits, sauvegardes.
- Partage ponctuel hors ligne et bundle chiffré.
- Appairage LAN, handshake Noise XX, **transport post-handshake**.
- Trames de synchronisation, listes et transferts de blobs.
- Découverte mDNS, usurpation de pair, rejeu, downgrade, fuite de métadonnées.
- Comportement en cas de coupure, de fichier remplacé ou de rollback.

**À retester :** AUD-02 (transport LAN en clair après handshake), AUD-03
(commandes blob et accès fichier arbitraire).

### 2.3 Application desktop Tauri

- Commandes IPC et capabilities : moindre privilège, validation des entrées.
- Lecture/écriture du coffre, sauvegardes, chemins, permissions, symlinks.
- Trousseau macOS/Windows/Linux, Touch ID, Windows Hello, Secret Service.
- Presse-papiers temporaire, auto-type, fenêtre active.
- Mises à jour : manifeste signé, anti-rollback, signature des paquets,
  installation à la fermeture.
- Barre de menus, démarrage automatique, instance unique, mode voyage.
- WebView : CSP, navigation, ouverture de liens, injection.
- Builds macOS universel, Windows et Linux ; différences de comportement.

### 2.4 Application web / PWA

- CSP, service worker, cache, precache, mises à jour.
- IndexedDB, chiffrement au repos, migration vers le stockage natif.
- XSS, injection de composants, contenu importé, rendu Markdown.
- Gestion des sessions, verrouillage, onglets multiples, Web Locks.
- Absence de télémétrie et de requêtes réseau non documentées.

### 2.5 Extension navigateur

- Manifest V3, permissions, content scripts, `allFrames`, `optional_host_permissions`.
- Pont natif : authentification, appairage, jetons, validation d’origine.
- Détection et remplissage : sélection de formulaire, TOCTOU, navigation,
  formulaires cachés, iframes, Shadow DOM, sites exclus.
- Remplissage au chargement : conditions HTTPS, cadre principal, opt-in.
- Passkeys : origine, RP ID, confirmation utilisateur, attestation.
- Panneau latéral Chromium/Firefox et page partagée.
- Stockage de session, absence de secrets persistés.
- Menaces : site hostile, extension compromise, autre extension, page usurpée.

**À retester :** AUD-06 (passerelle web), AUD-07 (origine passkey), AUD-08
(TOCTOU d’autofill).

### 2.6 Android alpha

- Stockage natif dans le sandbox applicatif, sauvegardes rotatives.
- WebView, navigation, intents, FileProvider, import/export.
- Absence de pont natif, de tray, d’auto-type et de mises à jour.
- Comportement au verrouillage, au changement de configuration et au redémarrage.
- Périmètre explicitement limité à l’alpha 0.17 : l’autofill Android, Credential
  Manager/passkeys et la biométrie Keystore seront audités avec la 0.18.

### 2.7 Chaîne de build, release et supply chain

- Workflows GitHub Actions : permissions, actions épinglées, injection.
- Builds reproductibles macOS/web, artefacts Windows/Linux/Android.
- SBOM CycloneDX, `cargo-deny`, `cargo-audit`, `bun audit`.
- Signature et notarisation macOS, signature des mises à jour, clés de release.
- Attestations de provenance, publication des assets, `SHA256SUMS`.
- Secrets, variables, protection des branches et des environnements.

## 3. Hors périmètre

- Compromission physique de l’appareil ou attaque matérielle invasive.
- Analyse de fuites électromagnétiques, de cache ou de micro-architecture.
- Sécurité du système d’exploitation, des navigateurs et des stores.
- Ingénierie sociale et phishing hors composants Coffre.
- Disponibilité des services tiers (GitHub, HIBP, DNS).
- Audit juridique, RGPD, licence ou conformité commerciale.
- Tests sur appareils iOS/Safari : non disponibles avant compte Apple.
- Test d’intrusion des serveurs : Coffre n’exploite aucun serveur.

## 4. Modèle de menace

L’audit doit considérer au minimum :

1. **Attaquant réseau local** : lecture, modification, rejeu des trames LAN.
2. **Attaquant avec écriture sur le fichier `.coffre`** : rollback, substitution
   de clés, corruption ciblée, déni de service.
3. **Site web hostile** : formulaire piégé, iframe, Shadow DOM, navigation
   pendant le remplissage, vol de session.
4. **Extension ou page compromise** : appel des commandes du pont, usurpation
   d’origine, accès aux passkeys.
5. **Attaquant local sans privilège** : lecture de fichiers, presse-papiers,
   journaux, mémoire, sauvegardes.
6. **Dépendance ou action CI compromise** : build, artefact, signature, update.
7. **Utilisateur malveillant d’un coffre partagé** : élévation de rôle, fusion
   incohérente, accès aux blobs.
8. **Faux manifeste de mise à jour** : downgrade, signature valide d’une version
   antérieure, canal bêta.

Ne sont pas considérés comme compromis : le noyau, le matériel, le navigateur
lui-même, ni un attaquant qui connaît déjà le mot de passe maître.

## 5. Méthodologie attendue

- Revue manuelle du code et de la conception, pas seulement un scan automatique.
- Revue cryptographique par une personne expérimentée.
- Tests dynamiques sur builds fournis par l’équipe.
- Fuzzing ciblé des parseurs `.coffre`, KDBX, CXF, bundles et trames LAN.
- Tests différentiels TypeScript/Rust sur les mêmes vecteurs.
- Analyse de la chaîne CI et des artefacts publiés.
- Reproduction documentée de chaque finding, avec version et commit.
- Vérification des correctifs et retest après remediation.

Les outils automatiques sont acceptés en complément, jamais comme preuve unique.

## 6. Livrables

1. **Rapport détaillé** : résumé exécutif, méthodologie, findings avec sévérité
   CVSS 4.0, scénario, preuve de concept, impact, recommandation, références de
   code.
2. **Revue de conception cryptographique** : forces, faiblesses, hypothèses,
   recommandations à long terme.
3. **Rapport de supply chain** : CI, dépendances, signature, reproductibilité.
4. **Matrice de couverture** : ce qui a été testé, ce qui ne l’a pas été.
5. **Rapport de retest** : statut de chaque finding après correctifs.
6. **Rapport public** : version expurgée, publiée dans `docs/` avec l’accord du
   prestataire.
7. **Attestation** : lettre confirmant le périmètre, la date, le commit audité
   et le résultat du retest.

Un finding critique ou élevé non corrigé bloque la 1.0. Les risques moyens
peuvent être acceptés s’ils sont documentés et justifiés.

## 7. Déroulement proposé

| Étape | Durée | Contenu |
|---|---:|---|
| Cadrage | 1 semaine | NDA, périmètre, accès, environnement, critères |
| Revue | 4–6 semaines | Crypto, format, clients, CI, tests dynamiques |
| Rapport provisoire | 1 semaine | Findings, sévérités, questions |
| Correctifs | 2–4 semaines | Équipe Coffre, échanges avec l’auditeur |
| Retest | 1 semaine | Vérification des correctifs |
| Publication | 1 semaine | Rapport public, attestation, annonce |

Le commit exact est figé au début de la revue. Les correctifs sont développés sur
une branche dédiée et le retest porte sur le commit final.

## 8. Budget indicatif

Fourchettes en euros, hors taxes, à confirmer par les prestataires :

| Lot | Contenu | Fourchette |
|---|---|---:|
| A | Crypto, format `.coffre`, récupération, partages | 25 000–45 000 |
| B | Desktop, web, extension, Android alpha | 15 000–30 000 |
| C | Sync LAN, blobs, CI et supply chain | 8 000–15 000 |
| Retest | Vérification des correctifs | 5 000–10 000 |
| **Total** | Audit complet + retest | **40 000–70 000** |

Un audit limité au lot A peut servir de première étape si le budget global n’est
pas disponible immédiatement.

## 9. Critères de sélection du prestataire

- Expérience vérifiable en cryptographie appliquée et en revue de gestionnaires
  de mots de passe ou de coffres chiffrés.
- Compétences Rust, TypeScript, WebAssembly, Tauri, WebExtensions, Android.
- Connaissance de WebAuthn/passkeys et des architectures local-first.
- Références publiques et autorisation de citer des rapports.
- Capacité à publier un rapport expurgé et à effectuer un retest.
- Absence de conflit d’intérêts avec les concurrents ou les hébergeurs.
- Assurance professionnelle et NDA signés.
- Proposition détaillée : méthode, jours-homme, prix fixe, planning.

Grille indicative : cryptographie 30 %, expérience clients 25 %, méthodologie
20 %, références 15 %, prix 10 %.

## 10. Accès et confidentialité

- Dépôt privé en lecture ou archive du commit audité.
- Builds signés ou reproductibles fournis avec les instructions.
- Aucun coffre réel, aucun secret utilisateur, uniquement des fixtures de test.
- Environnement de test isolé ; pas d’accès à la production.
- NDA mutuel ; divulgation coordonnée selon `docs/SECURITY.md`.
- Les findings sont partagés au fil de l’eau pour les critiques, sans attendre le
  rapport final.

## 11. Préparation interne avant lancement

- [x] Périmètre et modèle de menace documentés.
- [x] Audits internes 0.8 et 0.12 disponibles.
- [x] SBOM, builds reproductibles et signatures en place.
- [x] Tests unitaires, Playwright, Rust, corpus et smoke extension.
- [ ] Corriger ou documenter les findings internes encore ouverts.
- [ ] Fournir un commit release candidate 0.17.0 et ses artefacts.
- [ ] Préparer un jeu de fixtures sans données réelles.
- [ ] Désigner un référent sécurité et un canal de communication.
- [ ] Budgéter l’audit et le retest.
- [ ] Consulter 3 à 5 prestataires.

## 12. Modèle de demande

> Objet : demande de proposition — audit de sécurité externe de Coffre 0.17.0
>
> Bonjour,
>
> Coffre est un gestionnaire de mots de passe local-first open source (GPL-3.0),
> desktop macOS/Windows/Linux, web/PWA, extension Chromium/Firefox et Android
> alpha. Nous recherchons un audit externe indépendant couvrant la cryptographie,
> le format `.coffre`, la synchronisation, les clients et la chaîne de release.
>
> Le périmètre complet, les livrables et le budget indicatif sont dans
> `docs/AUDIT-SCOPE.md`. Merci de nous transmettre une proposition avec méthode,
> jours-homme, prix fixe, planning, références et disponibilité pour un retest.
>
> Cordialement,
> L’équipe Coffre

## 13. Contact

- Vulnérabilités : avis de sécurité privés GitHub.
- Gouvernance et audit : ouvrir une discussion privée avec les mainteneurs.
- Ne jamais envoyer de secret réel, de coffre utilisateur ou de donnée personnelle
  dans un rapport ou un ticket.
