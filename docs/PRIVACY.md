# Politique de confidentialité de Coffre

**Dernière mise à jour :** 13 novembre 2026 — version 0.16.0

Coffre est un gestionnaire de mots de passe local-first, publié sous licence
GPL-3.0. Cette politique couvre l’application desktop, l’application web
installable et l’extension de navigateur.

## Résumé

- Aucun compte Coffre, aucun serveur Coffre, aucune télémétrie, aucune publicité.
- Le contenu du coffre reste chiffré sur l’appareil ou dans le dossier de
  synchronisation choisi par l’utilisateur.
- Les seules requêtes réseau sont les mises à jour, la vérification
  facultative des fuites et la synchronisation configurée par l’utilisateur.

## Données stockées localement

- Le fichier `.coffre` chiffré (Argon2id + AES-256-GCM) et, si activés, les
  blobs de pièces jointes.
- Les réglages de l’application : langue, thème, auto-lock, exclusions de
  sites, canal de mise à jour.
- Dans l’extension : la clé de session du pont natif, les domaines exclus et
  les préférences d’affichage. L’extension ne stocke aucun identifiant, mot de
  passe, TOTP ni contenu de coffre.
- Les journaux d’activité restent locaux et ne contiennent aucun secret.

Ces données restent sur l’appareil, sauf si l’utilisateur choisit un dossier
synchronisé (iCloud, Dropbox, Nextcloud, etc.) ou la synchronisation sur le
réseau local. Dans ce cas, seuls les fichiers chiffrés sont transmis.

## Requêtes réseau

- **Mises à jour.** L’application interroge GitHub Releases pour connaître la
  dernière version et télécharger un paquet signé. GitHub peut voir l’adresse
  IP, la date et l’agent HTTP standard, comme pour toute requête web. Aucun
  contenu de coffre n’est envoyé.
- **Vérification des fuites (facultative, désactivée par défaut).** Seuls les
  cinq premiers caractères hexadécimaux du SHA-1 d’un mot de passe sont envoyés
  à `api.pwnedpasswords.com`, avec `Add-Padding: true`. Le mot de passe, le
  hash complet et les suffixes ne quittent jamais l’appareil. Les résultats ne
  sont pas persistés.
- **Synchronisation.** Le dossier synchronisé est choisi par l’utilisateur ;
  Coffre n’exploite aucun service de synchronisation. La synchronisation LAN
  utilise le protocole Noise et ne passe pas par Internet.
- **Extension.** Le pont natif communique avec l’application Coffre locale
  (`localhost` ou messagerie native du navigateur). L’extension ne transmet ni
  l’URL des pages visitées, ni les formulaires, ni les secrets à un serveur
  distant. Le remplissage et l’enregistrement sont déclenchés par l’utilisateur
  ou par l’option explicite de remplissage au chargement.

Coffre ne vend, ne loue et ne partage aucune donnée personnelle. Aucun outil
d’analyse, de suivi ou de publicité n’est intégré.

## Permissions de l’extension

| Permission | Usage |
| --- | --- |
| `activeTab`, `scripting` | Remplir ou enregistrer uniquement après une action de l’utilisateur, sur les sites autorisés. |
| `storage` | Conserver la clé de session du pont, les réglages et les exclusions. |
| `nativeMessaging` | Communiquer avec l’application Coffre installée sur le même appareil. |
| `clipboardWrite`, `clipboardRead` | Copier un identifiant ou un code sur demande explicite. |
| `contextMenus` | Proposer les actions Coffre dans le menu contextuel. |
| `sidePanel` | Afficher l’interface dans le panneau latéral. |
| `optional_host_permissions` | Accorder l’accès site par site, à la demande. |
| `host_permissions` locaux | Autoriser uniquement l’application locale de développement et le pont. |

## Conservation et suppression

Les données restent aussi longtemps que l’utilisateur conserve son fichier et
ses réglages. Supprimer le fichier `.coffre`, les blobs associés et les données
de l’extension suffit à effacer les données locales. Les sauvegardes
éventuelles dépendent du dossier ou du service choisi par l’utilisateur.

## Mineurs

Coffre n’est pas destiné aux enfants de moins de 13 ans et ne collecte
sciemment aucune donnée les concernant.

## Modifications

Toute modification de cette politique sera publiée dans ce fichier avec la date
et la version concernées. Les changements importants seront signalés dans le
journal des changements.

## Contact

- Questions : [issues GitHub](https://github.com/1wxxhktop/coffre/issues)
- Vulnérabilités : [avis de sécurité privés](https://github.com/1wxxhktop/coffre/security/advisories/new)

---

## English summary

Coffre is a local-first password manager. There is no Coffre account, server,
telemetry or advertising. Your encrypted vault stays on your device or in the
sync folder you choose. The only network requests are update checks against
GitHub Releases, the optional Have I Been Pwned k-anonymity check (five
SHA-1 prefix characters only, disabled by default) and the synchronization you
configure. The browser extension stores only its native-bridge session key,
site exclusions and display preferences; it never sends vault contents, visited
URLs or form data to a remote server. Coffre does not sell or share personal
data. Contact: the GitHub issues and security advisories linked above.
