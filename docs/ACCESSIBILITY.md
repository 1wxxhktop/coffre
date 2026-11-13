# Accessibilité

**État :** base automatisée en place, validation manuelle partielle.  
**Référentiel :** WCAG 2.2 niveau AA.  
**Dernière vérification :** 14 novembre 2026, version 0.16.0.

Coffre est une application locale-first : l’accessibilité doit couvrir
l’application web/PWA, les clients desktop, l’extension et Android, sans
dépendre d’un service externe. Ce document décrit ce qui est vérifié
automatiquement, ce qui reste manuel et les limites connues.

---

## 1. Contrôles automatisés

Les parcours Playwright exécutent `axe-core` via `@axe-core/playwright` dans
`e2e/accessibility.spec.ts`, sur Chromium et WebKit.

Règles activées : `wcag2a`, `wcag2aa` et `wcag22aa`. Le job échoue à la moindre
violation A/AA sur les écrans couverts.

| Surface | Vérifications |
| --- | --- |
| Création de coffre | axe, noms accessibles, focus visible |
| Liste et détail d’un élément | axe, noms accessibles, vue mobile 375 px |
| Tableau de bord | axe, vue mobile |
| Réglages (thème sombre et clair) | axe, piège à focus, fermeture par Échap, `prefers-reduced-motion` |
| Tableau de bord Sécurité | axe |
| Générateur | axe, onglets pilotables aux flèches |
| Palette de commandes | axe, focus piégé, ouverture d’un élément au clavier |
| Nouvel élément | axe, sélecteur de type en `radiogroup` pilotable aux flèches |
| Assistant d’installation de l’extension | axe |
| Contrôles visibles | nom accessible pour chaque bouton, lien, champ et liste |

Commandes :

```bash
bunx playwright test e2e/accessibility.spec.ts --project=chromium
bunx playwright test e2e/accessibility.spec.ts --project=webkit
```

En CI, ces tests font partie des shards Playwright normaux : aucun job séparé
n’est nécessaire, et une violation bloque la fusion.

### Ce que les tests automatisés ne couvrent pas

`axe-core` ne détecte qu’une partie des critères WCAG. Ne sont pas prouvés par
la CI :

- la pertinence des libellés et de l’ordre de lecture ;
- le comportement réel de VoiceOver, NVDA et TalkBack ;
- le contraste des images, icônes et états translucides ;
- le zoom 200 %, la taille de texte système et le mode contraste élevé ;
- la navigation complète au clavier de tous les menus et dialogues ;
- les pages de l’extension (`popup.html`, `options.html`, `welcome.html`,
  `passkey.html`, `save-banner.html`) ;
- la WebView desktop et Android.

## 2. Choix d’implémentation

- **Focus visible** : tous les contrôles interactifs utilisent
  `:focus-visible` avec un contour contrasté ; le style natif n’est jamais
  supprimé sans remplacement.
- **Piège à focus** : les modales rendent le reste de la page `inert`, placent
  le focus dans le dialogue et le restituent à la fermeture.
- **Lien d’évitement** : « Aller au contenu » est le premier élément focusable
  et devient visible au clavier.
- **Onglets** : navigation aux flèches avec bouclage, `Home`/`End`, et un seul
  onglet dans l’ordre de tabulation.
- **Sélecteur de type d’élément** : exposé comme un groupe de boutons radio,
  avec `aria-checked` et navigation aux flèches, plutôt que comme des onglets.
- **Mouvement réduit** : les animations sont neutralisées quand
  `prefers-reduced-motion: reduce` est actif.
- **Pas de dépendance à la couleur seule** : les états critiques (erreur,
  succès, sélection) combinent couleur, texte ou icône.

## 3. Validation manuelle à faire

Checklist avant de revendiquer une conformité WCAG 2.2 AA complète :

- [ ] VoiceOver + Safari : création, déverrouillage, liste, détail, générateur.
- [ ] Safari : activer « Press Tab to highlight each item » et vérifier le lien
  d’évitement, la palette et les onglets.
- [ ] NVDA + Firefox : mêmes parcours, navigation par landmarks et formulaires.
- [ ] TalkBack + Android alpha : coffre local, déverrouillage, éléments, TOTP.
- [ ] Zoom 200 % et 400 % : aucune perte de contenu ni de contrôle.
- [ ] Taille de texte système augmentée : pas de troncature des libellés.
- [ ] Mode contraste élevé macOS/Windows : focus et bordures toujours visibles.
- [ ] Extension Chromium et Firefox : popup, options, menu, page passkey.
- [ ] Lecteur d’écran sur les messages d’erreur et les notifications.
- [ ] Vérification des contrastes des états désactivés et des textes secondaires.

Les résultats doivent être consignés dans ce document avec la version, la plateforme
et le lecteur d’écran testés.

## 4. Limites connues

- L’extension n’a pas encore de test axe automatisé ; ses pages sont auditées
  manuellement.
- La WebView Tauri et l’APK Android ne sont pas couverts par la CI
  d’accessibilité.
- La validation Android existe sur émulateur, pas encore sur appareil physique.
- Aucune certification WCAG externe n’a été réalisée. La roadmap vise une
  conformité AA vérifiée, pas une certification payante.

## 5. Signaler un problème

Ouvrir une issue avec :

- la version de Coffre et la plateforme ;
- le lecteur d’écran, le navigateur et la taille de texte ;
- les étapes de reproduction ;
- le critère WCAG concerné, si connu.

Ne joindre aucun secret, coffre réel ou donnée personnelle.
