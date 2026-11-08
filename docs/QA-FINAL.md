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

## 5. Mobile et QR (hors périmètre actuel)

1. Initialiser les cibles iOS/Android.
2. Scanner le QR d’appairage avec la caméra.
3. Vérifier les limites mémoire sur un coffre volumineux.
4. Vérifier l’absence de réseau implicite.

## 6. Audit externe

- parseurs KDBX, CXF, partages et blobs ;
- Noise F2 et appairage ;
- Argon2/AES-GCM et construction STREAM ;
- absence de fuite de secrets dans les journaux et erreurs.
