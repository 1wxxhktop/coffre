# Niveau de préparation grand public — Coffre 0.8.0

**Date :** 7 novembre 2026  
**Conclusion :** le socle de sécurité est solide et aucun défaut critique de
confidentialité n’a été trouvé lors de la re-vérification. En revanche, Coffre
n’est **pas encore prêt pour une distribution grand public**. C’est une
**bêta technique utilisable localement** sur Web/PWA, Chromium et macOS arm64.

Le mot « grand public » implique ici : installation sans avertissement
Gatekeeper, mises à jour, AutoFill système, mobile, support multi-plateforme,
assurance externe et stockage durable. Ces points ne sont pas tous du code : ils
demandent des certificats Apple, une infrastructure de release, du matériel de
test et un audit externe.

---

## 1. Verdict par plateforme

| Plateforme | État | Verdict |
| --- | --- | --- |
| Web / PWA | Fonctionnelle, 30/30 E2E, CSP stricte, Lighthouse 1,0 | **Bêta publique possible** |
| Extension Chromium | Fonctionnelle, non publiée, installation manuelle | **Bêta technique** |
| Desktop macOS arm64 | Compile, signé ad hoc, se lance, Touch ID | **Bêta technique locale** |
| Desktop macOS Intel | Non testé | **Non validé** |
| Windows | Build CI, pas de test d’exécution | **Non validé** |
| Linux | Build CI, pas de test d’exécution | **Non validé** |
| iOS / Android | Non initialisé | **Non disponible** |
| Safari / AutoFill système | Non implémenté | **Non disponible** |

---

## 2. Ce qui est déjà au niveau attendu

- **Cryptographie** : Argon2id 64 Mio, AES-256-GCM, AAD par usage, hiérarchie
  de clés claire, nonces aléatoires, clés éphémères par élément.
- **Format** : `.coffre` v3 validé par Zod, compatibilité v1/v2, migrations à
  l’écriture, plafonds d’import, versions et pièces jointes.
- **Sécurité applicative** : CSP stricte, `freezePrototype`, aucune requête
  réseau, aucun `innerHTML`, URL http(s) uniquement, React escaping.
- **Verrouillage** : auto-lock, perte de visibilité, `pagehide`, Web Locks,
  instance desktop unique, effacement du presse-papiers au verrouillage.
- **Récupération** : phrase EFF de 10 mots, enveloppe séparée, vérification de
  l’enveloppe à l’intégrité.
- **Desktop** : Tauri v2, capability minimale, navigation externe contrôlée,
  Touch ID avec service de trousseau séparé, hardened runtime.
- **Tests** : 137 tests unitaires, 30 exécutions Playwright, 2 tests Rust,
  smoke extension avec CSP production, Lighthouse accessibilité 1,0.
- **Documentation** : SECURITY, audit, AutoFill, Proton Pass, native, README.

---

## 3. Bloquants avant une diffusion grand public

### B-01 — Signature Developer ID et notarisation

Le bundle est signé **ad hoc**. Gatekeeper avertit, et « Always Allow » du
trousseau peut être oublié après un rebuild. Il faut :

- un certificat **Developer ID Application** ;
- hardened runtime et entitlements ;
- `notarytool` + agrafage du ticket ;
- vérification `spctl` sur une machine vierge.

Sans cela, un utilisateur non technique ne peut pas installer Coffre sans
manipulation.

### B-02 — Mises à jour

Aucun mécanisme de mise à jour n’est présent. Un gestionnaire de mots de passe
grand public doit pouvoir corriger une faille rapidement. Il faut un canal de
release signé (Tauri Updater ou serveur statique) et une politique de versions.

### B-03 — Stockage durable des données

Le coffre desktop vit dans IndexedDB de la WebView. Une éviction, une mise à
jour de WebView ou une réinstallation peut le rendre inaccessible. Il faut un
fichier natif dans `Application Support` (ou App Group), des écritures
atomiques, trois sauvegardes et une restauration. C’est aussi le prérequis de
l’AutoFill.

### B-04 — AutoFill système et Safari

L’extension Chromium fonctionne, mais il n’existe pas de fournisseur AutoFill
macOS/iOS ni d’extension Safari. Pour un usage grand public, le remplissage doit
être disponible dans Safari et les apps, comme 1Password. Voir
[docs/MACOS-AUTOFILL.md](MACOS-AUTOFILL.md).

### B-05 — Mobile

iOS et Android ne sont pas initialisés. Les SDK, la signature et les tests
manquent. Un gestionnaire de mots de passe grand public doit au minimum couvrir
iOS et Android ou assumer explicitement un périmètre desktop.

### B-06 — Touch ID de niveau OS

Touch ID est une barrière applicative : la clé est dans le trousseau classique
et peut provoquer un second dialogue ACL. Le modèle cible est un élément
`SecAccessControl` (`kSecAccessControlBiometryCurrentSet`) ou une clé Secure
Enclave qui chiffre la clé maîtresse. Cela demande une évolution native et une
signature stable.

### B-07 — Audit externe

Aucun audit cryptographique ni test d’intrusion externe n’a été réalisé. Pour un
produit qui contient tous les mots de passe d’une personne, c’est un prérequis
de confiance, même avec 137 tests.

### B-08 — Validation Windows/Linux et macOS Intel

La CI compile Windows/Linux, mais aucune exécution réelle, aucun test
d’installation, aucun test de trousseau ni de WebView n’a été réalisé. Le build
local est arm64 uniquement.

### B-09 — Portabilité des données

L’import est très large, mais l’export se limite au format `.coffre`. Un export
CSV compatible avec les gestionnaires courants et Mots de passe d’Apple
manque pour éviter l’enfermement.

### B-10 — Détails d’accessibilité et de finition

Lighthouse est à 1,0, mais les textes de 9–10 px restent nombreux et l’auto-lock
desktop lors du passage à une autre application n’est pas explicite. Une revue
manuelle avec lecteur d’écran et navigation clavier complète reste à faire.

---

## 4. Critères de sortie proposés pour une 1.0 grand public

1. Bundle macOS signé Developer ID, notarié, agrafé et validé `spctl`.
2. Mécanisme de mise à jour signé et documenté.
3. Stockage natif atomique + sauvegardes + export/restauration testés.
4. AutoFill macOS/iOS et Safari (ou périmètre officiellement limité).
5. Applications iOS/Android initialisées et testées.
6. Touch ID protégé au niveau du trousseau/Secure Enclave.
7. Audit externe et correction des constats.
8. Tests d’installation/exécution Windows, Linux, macOS Intel.
9. Export CSV et migration sortante.
10. Revue d’accessibilité manuelle et documentation utilisateur.

---

## 5. Recommandation

- **Aujourd’hui** : distribuer comme **bêta technique 0.8**, avec un avertissement
  clair sur Gatekeeper, IndexedDB, AutoFill absent et l’absence d’audit externe.
- **Prochaine étape recommandée** : stockage natif + Developer ID/notarisation,
  puis AutoFill macOS et audit externe.
- **Ne pas présenter** Coffre comme un remplaçant grand public de 1Password ou
  Mots de passe d’Apple tant que B-01 à B-07 ne sont pas traités.

La sécurité du coffre local, de la cryptographie, du format et des tests est
déjà d’un bon niveau. Les bloquants restants sont principalement des sujets de
**distribution, d’intégration OS et d’assurance**, pas des failles de
confidentialité connues dans le code actuel.
