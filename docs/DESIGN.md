# Système de design de Coffre

Ce document décrit les règles appliquées à l’interface depuis le lot D du plan
de design (novembre 2026). Il complète `docs/PLAN-DESIGN.md`, qui contient
l’audit d’origine et le détail des problèmes corrigés.

## 1. Jetons

Toutes les valeurs visuelles vivent dans deux fichiers :

| Fichier | Rôle |
| --- | --- |
| `src/styles/tokens.css` | Thème sombre, échelles et couleurs sémantiques |
| `src/styles/light.css` | Redéfinition des variables sous `[data-theme="light"]` uniquement |

`src/styles/emergency-kit.css` est la seule exception : il décrit un document
imprimable (feuille du kit d’urgence), avec des noirs, blancs et gris de papier
fixes.

La commande `bun run lint` exécute `scripts/check-design-tokens.mjs`, qui
échoue si une feuille de composants contient :

- une couleur hexadécimale, `rgb()`, `rgba()`, `hsl()` ou `hsla()` ;
- une taille de police littérale ;
- un rayon littéral ;
- un `z-index` littéral ;
- une ombre littérale sans variable.

### Typographie

Six tailles de texte et une exception pour les surtitres en capitales :

| Jeton | Valeur | Usage |
| --- | --- | --- |
| `--text-xs` | 12 px | légendes, métadonnées, aides |
| `--text-sm` | 13 px | contrôles, corps compact |
| `--text-md` | 14 px | corps |
| `--text-lg` | 16 px | titres de section, codes TOTP |
| `--text-xl` | 20 px | titres de modale |
| `--text-2xl` | 28 px | grands nombres |
| `--text-overline` | 11 px | uniquement les surtitres en capitales (exception) |

Les titres éditoriaux utilisent `--display-sm`, `--display-md` et
`--display-lg` (valeurs `clamp()`), ainsi que `--display-score` pour le score
de sécurité. Le plancher de lisibilité est de 12 px hors surtitre.

### Espacement, rayons, profondeur

- Espacement : `--space-1` à `--space-10` (4 à 64 px, base 4 px).
- Rayons : `--radius-sm` (6 px), `--radius-md` (10 px), `--radius-lg`
  (14 px), `--radius-xl` (20 px), `--radius-full`.
- Ombres : `--shadow-1` à `--shadow-3`, plus `--shadow-modal`,
  `--shadow-panel`, `--shadow-drawer`, `--shadow-focus` et les ombres internes.
- Empilement : `--z-sticky`, `--z-dropdown`, `--z-drawer`, `--z-backdrop`,
  `--z-modal`, `--z-toast`, `--z-skip`.

### Couleurs

Les feuilles utilisent les variables sémantiques :

- surfaces : `--surface-1/2/3`, `--surface-raised`, `--surface-input`,
  `--surface-sidebar`, `--surface-topbar` ;
- texte : `--text-1/2/3`, `--text-on-accent` ;
- bordures : `--border-1/2/3` ;
- états : `--state-ok`, `--state-warn`, `--state-danger`, `--state-info`,
  avec leurs variantes `-soft`, `-line` et `-text`.

Les alias historiques (`--bg`, `--panel`, `--muted`, `--line`, etc.) restent
disponibles pour les composants existants, mais les nouveaux styles doivent
utiliser les noms sémantiques.

## 2. Thèmes

Le thème clair ne surcharge aucun composant : il remplace uniquement des
variables. Le ton d’un état de sécurité (`securityTone`) dépend du score, jamais
du thème. La trame de fond est atténuée de moitié dans l’application.

## 3. Modèle de détail et d’édition

- **≥ 1100 px** : liste et panneau de détail côte à côte. « Nouvel élément »
  ouvre une modale de création ; après « Enregistrer », la fiche s’affiche dans
  le panneau de détail. La lecture et la modification d’un élément existant se
  font dans le panneau. Les autres modales servent aux confirmations, au
  générateur, à l’historique et aux réglages.
- **< 1100 px** : la modale de création reste centrée, puis le détail remplace
  la liste avec un bouton retour vers la liste d’origine.
- **< 640 px** : barre d’onglets basse (Tout, Favoris, Récents, Sécurité,
  Réglages), barre d’actions basse de 52 px de haut et menu latéral limité aux
  coffres.

L’en-tête du détail contient l’icône, le titre, l’étoile de favori et, à droite,
« Modifier », « Copier le mot de passe » et le menu « … » (historique,
déplacement, partage hors ligne, duplication, suppression). Le contenu suit
l’ordre champs → étiquettes → notes → pièces jointes → métadonnées.

### Réglages

La fenêtre de réglages utilise deux colonnes : une navigation sticky à gauche et
un contenu qui défile indépendamment à droite. La hauteur est bornée pour que
le titre de la modale reste visible. En compact, la navigation devient une
liste de pages.

### Tableau de bord

La vue « Tableau de bord » est la page d’accueil par défaut après le
déverrouillage. Elle rassemble l’essentiel du coffre : score de santé,
statistiques, points d’attention, éléments prioritaires, récents, coffres,
échéances et un état du stockage local. Ce dernier indique la dernière écriture,
signale une synchronisation en attente et rappelle les trois sauvegardes
tournantes chiffrées en AES-256-GCM ; le bouton « Réglages » ouvre directement
la synchronisation. La vue reste accessible depuis la barre latérale et
l’onglet « Accueil » sur mobile. Les catégories de sécurité ouvrent la liste
filtrée correspondante, et les actions rapides permettent de créer un élément
ou de générer un mot de passe.

### Liste groupée par date

La bibliothèque regroupe automatiquement les éléments par date. Les sections
sont « Aujourd’hui », « Hier », « 7 derniers jours », « Ce mois-ci », puis un
groupe par mois pour les dates plus anciennes. Le regroupement suit la date de
modification par défaut ; il suit la date de création avec le tri « Créés »,
l’horodatage d’utilisation avec « Récents » et la date de suppression dans la
corbeille. Le tri choisi s’applique à l’intérieur de chaque groupe.

Les en-têtes de date restent collés en haut de la liste pendant le défilement.
L’option « Grouper par date » du menu de la liste, active par défaut, permet de
revenir à une liste plate ; le choix est mémorisé dans `localStorage`.

### Colonnes redimensionnables

Sur desktop, deux poignées permettent d’ajuster la largeur de la barre
latérale (220–420 px) et de la liste (320–640 px, avec au moins 360 px
réservés au détail). Les largeurs sont mémorisées dans `localStorage` et
peuvent être ajustées au clavier (flèches, `Home`, `End`) ou réinitialisées par
double-clic.

La barre latérale peut être repliée en un rail de 64 px qui ne conserve que les
icônes, avec des infobulles et des noms accessibles. L’état replié est mémorisé.
Sur mobile, la barre reste un tiroir complet et les poignées sont masquées.

### Marque

Le symbole de Coffre est plat : un carré plein et un cadenas en réserve. Le
remplissage utilise `--accent-strong` et le cadenas `--text-on-accent`, ce qui
inverse automatiquement le contraste entre les thèmes sombre et clair. Aucun
dégradé n’est utilisé dans l’interface. Les icônes publiques (`icon.svg`,
`favicon.svg`, PWA et Tauri) reprennent le même dessin.

### Défilement

L’application occupe exactement `100dvh` et le document ne défile jamais
derrière elle (`body:has(.app-shell) { overflow: hidden }`). La liste et le
détail défilent indépendamment, avec `overscroll-behavior: contain` pour éviter
la propagation au document. La liste masque aussi tout débordement horizontal.
Les tests vérifient que `scrollHeight` reste inférieur ou égal à la hauteur du
viewport, y compris sur des fenêtres courtes (480 px).

## 4. Menus et accessibilité

- Menu déroulant portalé, fermeture au clic extérieur, à `Échap` et au
  défilement ; navigation aux flèches, `Home` et `End`.
- Menu latéral mobile : `inert` et `visibility: hidden` lorsqu’il est fermé,
  piège à focus et `Échap` lorsqu’il est ouvert.
- Lignes de liste parcourables aux flèches ; focus visible sur les lignes, les
  cartes de sécurité et les sélecteurs de type.
- `prefers-reduced-motion` neutralise les animations de modales, de menus et de
  notifications.

## 5. Vérifications

```bash
bun run lint              # oxlint + contrôle des jetons
bun run typecheck
bun run test
bun run test:e2e          # Chromium + WebKit
bun run build
```

Les tests `e2e/design.spec.ts` vérifient l’absence de débordement à 1280, 1024,
768 et 375 px, l’inertie du menu mobile, la barre d’actions mobile, le menu du
détail, le thème clair, la navigation aux flèches, le parcours
créer en modale → lire et modifier dans le panneau de détail, la génération d’un
mot de passe depuis le bandeau de sécurité, les gestes de retour et la
navigation en pages des réglages.

La régression visuelle `e2e/visual.spec.ts` capture six écrans dans les deux
thèmes. Elle est optionnelle car les baselines dépendent de la plateforme :

```bash
bun run test:visual                 # comparer sur macOS
bun run test:visual --update-snapshots
```

Pour l’activer en CI, générer d’abord les baselines Linux avec le workflow
manuel **Baselines visuelles Linux**, puis committer les fichiers `*-linux.png`
produits.
`e2e/accessibility.spec.ts` vérifie les noms accessibles, le piège à focus, la
réduction des animations et l’absence de violation axe A/AA sur les écrans
principaux, dans les deux thèmes et les deux tailles.
