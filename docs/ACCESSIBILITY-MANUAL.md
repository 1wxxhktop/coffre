# Vérification manuelle de l’accessibilité

Ce document complète `e2e/accessibility.spec.ts` (noms accessibles, piège à
focus, `prefers-reduced-motion`, audit axe A/AA). Les contrôles ci-dessous
exigent un environnement réel et restent à faire avant une diffusion large.

À exécuter sur macOS avec VoiceOver, sur Windows avec NVDA, et sur un appareil
iOS réel avec Safari et VoiceOver.

## 1. Lecteurs d’écran

### VoiceOver (macOS 14+)

1. Activer VoiceOver (`Cmd + F5`), ouvrir l’application, créer ou déverrouiller
   un coffre.
2. Vérifier que le tableau de bord est annoncé comme page d’accueil, que le
   score de santé et chaque carte sont lisibles dans un ordre logique.
3. Parcourir la barre latérale : chaque filtre, le bouton « Tableau de bord »
   et le bouton de repli doivent avoir un nom et un état.
4. Ouvrir « Nouvel élément » : la modale doit annoncer son titre, piéger le
   focus, et `Échap` doit la fermer en rendant le focus au bouton d’origine.
5. Créer un élément, vérifier que le panneau de détail est annoncé, puis
   parcourir les champs, les boutons de révélation et le menu « … ».
6. Ouvrir les réglages : la navigation doit être annoncée comme une liste de
   pages, et le contenu comme une zone distincte.

### NVDA (Windows 11)

1. Répéter les parcours ci-dessus avec NVDA (`Ctrl + Alt + N`).
2. Vérifier les annonces des changements d’état : synchronisation en attente,
   copie dans le presse-papiers, confirmation de suppression.
3. Vérifier que les tableaux de bord Sécurité et Stockage ne perdent pas le
   focus lors des mises à jour asynchrones.

## 2. Zoom et reflow

1. Navigateur à 200 % : aucun contenu coupé, aucun défilement horizontal au
   niveau du document ; les colonnes passent en vue compacte sous 1100 px.
2. Zoom texte seul à 200 % : les libellés restent lisibles et les boutons ne se
   chevauchent pas.
3. Fenêtre de 320 px de large : les onglets du bas restent visibles et
   actionnables, et le tableau de bord ne déborde pas.
4. Hauteur de 480 px : la liste et le détail défilent sans masquer la barre
   d’actions.

## 3. Tactile et Safari iOS

1. Sur iPhone réel, vérifier le retour par glissement vers la droite depuis la
   vue détail, ainsi que le bouton « Retour à … ».
2. Vérifier que la barre d’actions du détail reste au-dessus de la zone sûre et
   que les cibles font au moins 44 × 44 px.
3. Vérifier le clavier virtuel : les champs ne sont pas masqués et la modale de
   création reste utilisable.
4. Vérifier le thème clair et le thème sombre en extérieur, puis avec
   « Réduire les animations » activé dans iOS.

## 4. Critères d’acceptation

- Aucun focus piégé hors d’une modale ouverte.
- Chaque action est atteignable au clavier, avec un nom explicite.
- Aucune information ne dépend uniquement de la couleur.
- Aucun débordement horizontal aux largeurs 320, 375, 768, 1024 et 1280 px.
- Les annonces de lecteur d’écran décrivent l’action, pas seulement l’icône.

Consigner la date, l’appareil, la version du lecteur d’écran et les écarts
observés dans la PR de validation.
