# Portabilité CXF 1.0 et CXP

**État :** CXF 1.0 import/export complet ; CXP non implémenté (spec instable).

**Dernière vérification :** 14 novembre 2026, version 0.16.0.

**Références :** [CXF 1.0 Proposed Standard + errata](https://fidoalliance.org/specs/cx/cxf-v1.0-ps-errata-20260309.html),
[CXP 1.0 Working Draft](https://fidoalliance.org/specs/cx/cxp-v1.0-wd-20241003.html).

Ce document décrit le mapping entre le modèle Coffre et le Credential Exchange
Format, les garanties de sécurité de l’export, puis le plan d’implémentation du
Credential Exchange Protocol.

---

## 1. CXF 1.0

CXF est un document JSON autonome. Coffre utilise :

- `version.major = 1`, `version.minor = 0` ;
- `exporterRpId = coffre.local`, `exporterDisplayName = Coffre` ;
- un seul compte, sans collection ;
- un élément CXF par élément Coffre actif (hors corbeille).

L’export est proposé dans **Réglages → Sauvegarde et import → Exporter en CXF**
après confirmation du mot de passe maître. Le fichier produit s’appelle
`coffre.cxf.json`.

### 1.1 Mapping Coffre → CXF

| Type Coffre | Justificatifs CXF | Remarques |
| --- | --- | --- |
| `login` | `basic-auth`, `totp` | `scope.urls` reprend jusqu’à 30 URL ; `scope.androidApps` est toujours présent, même vide. |
| `note` | `note` | Le contenu est dans `content`. |
| `card` | `credit-card` | `expiry` est converti en `AAAA-MM`. |
| `identity` | `address`, `person-name`, `passport`, `drivers-license`, `identity-document`, `custom-fields`, `note` | Les dates d’expiration des documents deviennent des justificatifs structurés. |
| `passkey` | `passkey` | Clé privée PKCS#8 en base64url. Les passkeys à compteur non nul sont exclues. |
| `ssh-key` | `ssh-key` ou `custom-fields` | `ssh-key` seulement si la clé est PKCS#8 et si le type OpenSSH est connu. Sinon la clé part en champs personnalisés avec un avertissement. |
| `wifi` | `wifi` | `WPA` → `wpa2-personal`, `WEP` → `wep`, `nopass` → `unsecured`. |
| `api-credential` | `api-key` | `secret` → `key`, `keyId` → `username`, `endpoint` → `url`, `expiresAt` → `expiryDate`, environnement en champ personnalisé. |
| `software-license` | `custom-fields`, `note` | Champs « Clé de licence », « Titulaire », « Version », « Site web », « Date d’achat ». Type restauré par extension. |
| `document` | `identity-document` ou `custom-fields`, `note` | Les documents d’identité utilisent `identity-document` ; les autres gardent leurs champs en libellés. Type restauré par extension. |
| `recovery-codes` | `note` | Les codes sont exportés en texte, avec la date d’utilisation ; l’extension restaure le type et les codes à l’import. |

Les champs personnalisés Coffre sont exportés dans un justificatif
`custom-fields`. Les libellés et types sont conservés : `hidden`, `password`,
`pin` et `totp` deviennent `concealed-string` ; `checkbox` devient `boolean` ;
`date` et `month` deviennent `date` et `year-month`.

### 1.2 Extension propriétaire

Les types sans équivalent CXF natif sont marqués par une extension conforme au
format `EXPORTER_RP_ID/EXTENSION_NAME` :

```json
{
  "extensions": [
    { "name": "coffre.local/item-type", "itemType": "software-license" }
  ]
}
```

Valeurs utilisées : `software-license`, `document` et `recovery-codes`. Les autres importateurs
doivent ignorer cette extension ; Coffre s’en sert uniquement pour restaurer le
type d’élément et ses champs. Aucun secret supplémentaire n’y est stocké.

### 1.3 Import

L’import accepte CXF 1.x et applique les règles suivantes :

- les types de justificatifs inconnus sont ignorés avec un avertissement ;
- les champs `EditableField` sont lus via leur propriété `value` ;
- les dates `year-month` sont converties en `MM/AA` pour les cartes ;
- les passkeys sont recréées avec `signCount = 0` et la clé publique COSE est
  recalculée localement ;
- les collections CXF deviennent des tags ;
- les éléments sans justificatif reconnu ne sont pas importés ;
- la limite est de 5 000 éléments par fichier, 30 champs personnalisés par
  élément et 10 000 caractères par champ.

### 1.4 Sécurité

- Le fichier CXF **n’est pas chiffré**. Il contient des mots de passe, des clés
  privées de passkeys et des clés SSH en clair.
- L’export exige une ré-authentification par mot de passe maître.
- Les pièces jointes, icônes, historiques et fichiers binaires ne sont pas
  inclus ; un avertissement les compte.
- Le JSON est produit localement, sans requête réseau ni télémétrie.
- Un import CXF ne doit jamais écraser un coffre existant : il ajoute des
  éléments et signale les doublons avant validation.

### 1.5 Vecteurs de test

Les vecteurs vivent dans `src/lib/cxf.test.ts` et couvrent :

- connexion avec TOTP, URL, tags, favori, champ caché et échéance ;
- note, carte, identité et passkey ;
- codes de secours ;
- Wi-Fi, identifiant d’API, clé SSH PKCS#8, licence logicielle et document ;
- clé SSH OpenSSH exportée en champs personnalisés ;
- expirations passeport, permis et carte d’identité ;
- passkey à compteur non nul exclue ;
- type inconnu et version majeure refusée ;
- présence obligatoire de `scope.androidApps`.

Chaque test fait un aller-retour export → import et vérifie les champs
structurés, pas seulement le nombre d’éléments.

---

## 2. CXP 1.0

CXP est un **protocole**, pas un format de fichier. Il transporte un document
CXF chiffré entre un fournisseur exportateur et un fournisseur importateur. Le
document CXF reste identique ; CXP ajoute la négociation, le chiffrement et le
transport.

### 2.1 Flux

1. L’importateur crée un `ExportRequest` avec sa version, ses paramètres HPKE
   préférés, ses algorithmes d’archive, le mode de réponse (`direct`,
   `indirect` ou `self`), son identifiant de relying party et, éventuellement,
   les types de justificatifs et extensions demandés.
2. L’exportateur choisit un paramètre HPKE et un algorithme compatibles,
   demande l’autorisation à l’utilisateur, chiffre chaque fichier CXF, signe le
   challenge et produit un `ExportResponse`.
3. L’importateur vérifie la réponse, déchiffre le payload, valide l’intégrité du
   document CXF et l’importe.

Le payload est une archive ZIP contenant `index.jwe` et un ou plusieurs
fichiers `documents/*.jwe`. Chaque fichier est un JWE chiffré avec la clé
dérivée par HPKE (RFC 9180). Le mode `indirect` permet d’échanger les fichiers
JSON par le système de fichiers, sans serveur.

### 2.2 Décision d’implémentation

CXP ne sera pas réimplémenté à la main en JavaScript. Le risque d’une erreur
dans HPKE, JWE, le ZIP ou la gestion des clés serait trop élevé pour un
gestionnaire de mots de passe.

| Plateforme | Adapter prévu | Horizon |
| --- | --- | --- |
| Android | `ProviderEventsManager` de Credential Manager (Play Services 26.21+) | 0.18 |
| iOS / macOS 26+ | API système d’échange de credentials | 1.0 conditionnel |
| Desktop Linux/Windows | Mode `indirect` avec fichiers `ExportRequest`/`ExportResponse` et CXF, si la spécification est stabilisée | différé |
| Web/PWA | Import/export CXF uniquement ; pas de CXP natif | — |

Le mode `indirect` reste utile même sans API système : il permet à un
utilisateur de produire une demande, de la remettre à un autre gestionnaire et
de récupérer une réponse chiffrée. Il exige une bibliothèque HPKE auditée ou
une implémentation Rust relue, plus le support JWE et DEFLATE.

### 2.3 Risques de la spécification

Le document CXP 1.0 disponible en novembre 2026 est un **Working Draft daté
d’octobre 2024**, pas un Proposed Standard. Sa lecture révèle des écarts qui
empêchent une implémentation interopérable :

- le flux décrit un *challenge* et une signature du challenge, mais le CDDL
  `ExportRequest` et `ExportResponse` ne contient aucun champ de challenge ni de
  signature ;
- l’« identifiant anonyme » utilisé pour nommer les fichiers du ZIP n’est défini
  nulle part ;
- les paramètres JWE (`alg`, `enc`, AAD, dérivation de clé) ne sont pas
  spécifiés ;
- la version 1.0 est décrite avec un champ `version` par défaut à `0`, sans
  valeur normative explicite ;
- la protection contre le rejeu et l’authentification de l’exportateur ne sont
  pas définies.

**Décision.** Coffre ne livrera pas d’implémentation CXP maison tant que ces
points ne sont pas stabilisés. Une implémentation partielle donnerait une fausse
impression d’interopérabilité et exposerait les utilisateurs à des erreurs de
chiffrement ou d’authentification. Le mode fichier CXF reste la voie supportée
en 0.17 ; CXP sera repris avec les API système ou une version stable de la
spécification.

### 2.4 Prérequis avant implémentation

- [ ] Obtenir une version stable de CXP ou les API système qui l’encapsulent.
- [ ] Choisir une bibliothèque HPKE auditée (Rust ou TypeScript) si le mode
      fichier est retenu.
- [ ] Ajouter les vecteurs HPKE/JWE de la spécification et des tests croisés.
- [ ] Définir le format de fichier `ExportRequest`/`ExportResponse` en mode
      `indirect`.
- [ ] Vérifier l’authentification de l’exportateur et la signature du challenge.
- [ ] Tester le refus de downgrade de version et les paramètres inconnus.
- [ ] Fuzzer le parseur ZIP/JWE et les champs base64url.
- [ ] Faire relire l’implémentation par l’audit externe avant la 1.0.

### 2.5 Ce qui n’est pas couvert

- La destruction des credentials chez l’exportateur après migration (hors
  périmètre CXP).
- La synchronisation CXP entre appareils.
- Les fichiers binaires et pièces jointes : CXF les référence, Coffre ne les
  inclut pas encore.
- Les extensions FIDO2 autres que celles déjà présentes dans CXF.

---

## 3. Références

- FIDO Alliance, *Credential Exchange Format 1.0*, Proposed Standard et errata,
  9 mars 2026.
- FIDO Alliance, *Credential Exchange Protocol 1.0*, Working Draft,
  3 octobre 2024.
- RFC 9180, *Hybrid Public Key Encryption*.
- RFC 7516, *JSON Web Encryption*.
- RFC 1951, *DEFLATE Compressed Data Format*.
