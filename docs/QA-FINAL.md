# Recette finale — jalons restants

Cette recette couvre les vérifications qui ne peuvent pas être exécutées dans
la CI actuelle : deux machines, permissions système et cibles mobiles.

## 1. Synchronisation locale et blobs (F2/F8)

Prérequis : deux machines sur le même réseau, application desktop, coffre
déverrouillé, même réseau Wi-Fi, aucun accès Internet.

1. Appairer les appareils avec un code `coffre-lan://pair/…`.
2. Ajouter un document volumineux (image ou PDF) sur A.
3. Lancer **Recevoir une synchronisation** sur B, puis **Synchroniser** sur A.
4. Vérifier :
   - le `.coffre` fusionné sur les deux appareils ;
   - la présence du blob dans `Coffre/<idFichier>/blobs/` ;
   - l’aperçu image/PDF sur B ;
   - le téléchargement et le SHA-256.
5. Couper le Wi-Fi pendant un transfert : le transfert doit échouer sans
   laisser de fichier `.part` promu.
6. Vérifier qu’un appareil non appairé ne reçoit aucune donnée.

## 2. Découverte mDNS

1. Lancer une réception sur A.
2. Sur B, cliquer **Découvrir les appareils**.
3. Vérifier que A apparaît avec son nom, son adresse et le port `47823`.
4. Changer l’adresse de A (bail DHCP) et vérifier la mise à jour du pair.

## 3. Auto-type (F9)

### macOS

1. Autoriser Coffre dans **Réglages Système → Confidentialité et sécurité →
   Accessibilité**.
2. Ouvrir un formulaire de test.
3. Utiliser `Cmd+Shift+A`, choisir la connexion, vérifier la saisie.
4. Changer de fenêtre pendant la séquence : la saisie doit s’arrêter.

### Windows

1. Vérifier le raccourci `Ctrl+Shift+A` et l’envoi de touches.
2. Vérifier le changement de fenêtre pendant la séquence.

### Linux

1. Tester sous X11 puis Wayland.
2. Vérifier les permissions du portail et le raccourci global.
3. Documenter les limites Wayland.

## 4. Signature Git SSH (F14)

1. Configurer `gpg.ssh.program` vers `coffre-git-sign`.
2. Créer un commit signé avec `git commit -S`.
3. Vérifier avec `ssh-keygen -Y verify` et l’allowed_signers.
4. Vérifier que `COFFRE_PASSWORD` n’est pas utilisé en production.

## 5. Mobile et QR

1. Initialiser les cibles iOS/Android.
2. Scanner le QR d’appairage avec la caméra.
3. Vérifier les limites mémoire sur un coffre volumineux.
4. Vérifier l’absence de réseau implicite.

### Remplissage Android

1. Installer l’APK **signé** de la bêta, puis ouvrir **Réglages →
   Remplissage Android**.
2. Désactiver le verrouillage en arrière-plan, choisir Coffre dans Android,
   activer le remplissage, laisser le coffre déverrouillé.
3. Dans Chrome, ouvrir un formulaire dont le domaine correspond à un élément :
   la proposition Coffre apparaît et remplit l’identifiant et le mot de passe.
4. Ouvrir un formulaire d’un domaine voisin (`evil.example` pour
   `example.com`) : aucune proposition.
5. Ouvrir un formulaire d’inscription avec un champ « nouveau mot de passe » :
   il n’est pas rempli.
6. Ouvrir un formulaire de connexion à deux étapes avec un champ explicitement
   marqué « identifiant » : la proposition remplit l’identifiant sans toucher
   au reste. Un champ e-mail générique seul ne doit rien proposer.
7. Verrouiller Coffre puis revenir au formulaire : plus aucune proposition.
8. Laisser le coffre en arrière-plan au-delà du délai d’inactivité, puis
   revenir au formulaire : le cache natif a expiré.
9. Tuer le processus Coffre puis rouvrir le formulaire : aucune proposition
   avant un nouveau déverrouillage.
10. Vérifier qu’aucune boîte « Enregistrer ce mot de passe ? » n’est proposée
    par Coffre après une saisie dans une autre application.
11. Vérifier le rendu en thème clair et sombre, et sur un appareil Android 8
    ou 9 pour l’API minimale.

### Captures d’écran Android

1. Laisser le blocage actif, puis tenter une capture d’écran : Android doit
   refuser ou produire une image noire.
2. Lancer un enregistrement d’écran : la fenêtre Coffre doit rester noire.
3. Ouvrir le sélecteur d’applications récentes : l’aperçu de Coffre doit être
   masqué.
4. Désactiver **Réglages → Sécurité → Captures d’écran**, refaire une capture :
   elle doit fonctionner.
5. Réactiver, tuer l’application, la relancer : le blocage doit être appliqué
   dès l’écran de déverrouillage.
6. Vérifier qu’un partage d’écran (cast) ne montre pas le contenu tant que le
   blocage est actif.

### Interface mobile

1. Sur l’accueil, vérifier que la barre de navigation basse laisse voir le fond
   et reste distincte du contenu (voile translucide, pas de bande blanche).
2. Ouvrir la page Sécurité : la barre doit conserver la même transparence.
3. Vérifier l’icône Coffre sur l’écran d’accueil Android, dans le sélecteur
   d’applications et dans l’aperçu des récents ; elle doit être le cadenas
   blanc/noir, comme sur macOS et Windows.

## 6. Audit externe

- parseurs KDBX, CXF, partages et blobs ;
- Noise F2 et appairage ;
- Argon2/AES-GCM et construction STREAM ;
- absence de fuite de secrets dans les journaux et erreurs.

## 7. Corpus de détection de formulaires (E12)

Mesure du 13 novembre 2026 sur 50 pages reconstruites, sans marque ni requête
externe (`e2e/corpus/`).

| Catégorie | Cas | Réussis | Taux |
| --- | ---: | ---: | ---: |
| Connexion | 16 | 16 | 100 % |
| Inscription | 7 | 7 | 100 % |
| Changement de mot de passe | 5 | 5 | 100 % |
| Carte bancaire | 6 | 6 | 100 % |
| Identité et adresse | 6 | 6 | 100 % |
| Cas négatifs | 10 | 10 | 100 % |
| **Total** | **50** | **50** | **100 %** |

- Commande : `bun run test:corpus`
- Garde-fou : `e2e/corpus/baseline.json` ; toute baisse du taux global ou d’une
  catégorie fait échouer la CI.
- Non couvert : Shadow DOM, iframes, formulaires injectés après chargement et
  échantillon Playwright dédié. Ces cas restent à traiter dans E12/E13.
