# Direction visuelle — références client et traduction

Loïc a donné quatre références. Deux sont exploitables en l'état ; les deux autres
(`preview.themeforest.net`) sont derrière un challenge Cloudflare et n'ont pas pu être capturées,
mais leur démo officielle a été utilisée à la place.

| Référence | Ce qui a été analysé | Ce qu'on en garde |
|---|---|---|
| **Agiletech** (wowtheme7.com) | capture du hero réel | hero **centré, text-first**, badge « pilule », titre très gras et serré, **un seul** CTA bleu plein, formes flottantes discrètes (cercle pâle, grille de points, mini-cartes) |
| **Conseil** (conseil.pixfort.com) | capture du hero réel | **panneau sombre arrondi** posé sur fond clair, pastille d'annonce, titre énorme avec élément inline, double CTA, **mockup produit** en dessous = effet premium |
| **Rayo** | non capturable | à suivre : portfolio d'agence, on retient l'idée de galerie de réalisations (à reprendre pour `/exemple`) |
| **Paces** | démo admin chargée | registre **dashboard** propre : cartes, tableaux, badges d'état — à réutiliser pour `/admin`, pas pour le site public |

## Ce qui produit l'effet « moderne » (à respecter)

1. **Un seul accent** — le bleu de la marque (#3b5bfd), jamais deux couleurs vives concurrentes.
2. **Typographie = la hiérarchie.** Titres très grands (56–64 px desktop), graisse 700, `letter-spacing:-.03em`. Rien d'autre ne compense un titre timide.
3. **Beaucoup de blanc.** Sections de 96–120 px de padding vertical, largeur de lecture limitée à 680 px.
4. **Un eyebrow par section** (petites capitales, `letter-spacing:.14em`, couleur accent) avant chaque titre.
5. **Cartes arrondies 16–20 px**, bordure 1 px #e6e8ee, ombre très diffuse (`0 1px 2px rgba(14,17,22,.04)`), jamais d'ombre lourde.
6. **Un seul CTA plein par écran.** Les autres sont en contour ou en texte.
7. **Un moment sombre** dans la page (panneau #0e1116 arrondi) pour montrer le rapport : c'est le rappel du produit, et c'est ce qui fait « premium » chez Conseil.
8. **Décor CSS discret** : dégradé radial très pâle, grille de points, jamais d'image de stock.
9. **Preuves visuelles** : montrer le PDF / l'écran d'audit plutôt que des adjectifs.

## Traduction pour ScanSEO

```
[en-tête collant, fond blanc translucide + filet 1px au scroll]
[hero centré]
   pill « Audit SEO automatisé — 66 contrôles »
   H1 : « Sachez enfin pourquoi votre site ne sort pas. »
   sous-titre 2 lignes, 18 px, #3d4652, max 620 px
   carte formulaire (URL + email + bouton)  — c'est le CTA principal
   micro-réassurance : « gratuit · sans compte · résultat en 60 s »
   décor : halo bleu pâle + grille de points + carte flottante « score 58/100 »
[bande de confiance : 4 chiffres réels — 66 contrôles, 15 min, 49 €, sans abonnement]
[3 blocs bénéfices, icônes SVG inline, cartes sans ombre]
[section sombre arrondie : aperçu du rapport PDF + 3 puces de contenu]
[offres : 2 cartes, badge Recommandé sur 149 €]
[3 exemples de constats avec pastille de gravité]
[FAQ 4 questions en <details>]
[pied de page 3 colonnes + identité légale]
```

## Interdits

- Thème sombre par défaut sur tout le site (le sombre est un **accent**, pas la base).
- Dégradés multicolores, ombres portées fortes, effets de verre flous partout.
- Plus de deux polices. Deux graisses suffisent (400 et 700) plus une 600 pour les libellés.
- Images de personnes souriantes en stock.
