# 01 — Produit, prix et parcours

## 1. Le problème vendu

Un dirigeant de PME ou un artisan a un site, il ne sort pas sur Google, et il ne sait pas pourquoi. Les outils gratuits (Semrush, SEOptimer, Seobility) lui donnent un score sur 100 et une liste de problèmes **en anglais technique** : il ne sait toujours pas quoi écrire dans son titre, ni dans quel ordre corriger. Un freelance facture 300 à 1 500 € et rend sous 2 à 4 semaines.

**ScanSEO vend le livrable, pas le scan** : un PDF en français qui contient, pour chaque page, le `<title>`, la meta description et le H1 **exactement rédigés**, un plan de correction sur 30 jours, et le chemin de clic pour appliquer chaque correction. Le client applique lui-même. Le service ne touche jamais à son site.

## 2. Offres (définitives, ne pas en ajouter)

| Réf. | Offre | Prix affiché | Contenu | Limite |
|---|---|---|---|---|
| `teaser` | Analyse gratuite | 0 € | score global + 3 problèmes majeurs + 1 texte prêt à coller | 1 site / 24 h / IP |
| `audit_49` | Audit SEO | **49 € TTC** | 25 pages max, PDF complet, plan 30 jours, textes prêts | 1 site |
| `audit_149` | Audit Complet | **149 € TTC** | 100 pages max, plan 90 jours, 2 pages de contenu rédigées intégralement (H1 + chapô + H2 + FAQ + appel à l'action) | 1 site |

- Prix **TTC uniquement** (obligation d'affichage consommateur). Mention « TVA incluse, facture émise par Polar ».
- **Aucun abonnement. Aucune prestation d'implémentation n'est vendue ni affichée.** Une seule phrase figure en fin de rapport : « Si vous préférez que ces corrections soient appliquées pour vous, répondez à cet email. » Sans tarif, sans bouton, sans promesse.
- Pas de remise, pas de code promo.

## 3. Parcours client

```
Visiteur → / (landing FR)
  │ saisit son URL (formulaire « analyse gratuite »)
  ▼
POST /api/scan → teaser en ~60 s affiché dans la page + email « voici votre score »
  │ bouton « le rapport complet » → lien checkout Polar (custom fields : site=URL obligatoire)
  ▼
Checkout Polar (CB + SEPA, TVA UE gérée par Polar, email collecté par Polar)
  │ order.paid (webhook signé)
  ▼
POST /webhook/polar → commande enregistrée → email « votre audit démarre : 3 questions »
  │
  ▼
/audit/<token> → formulaire brief (activité + ville obligatoires, concurrents optionnels)
  │
  ▼
Worker : crawl (≤ 25 ou 100 pages) → PageSpeed → analyse DeepSeek → score → PDF
  │
  ▼
Email de livraison (PDF attaché + lien espace client) + page /audit/<token> à jour
```

**Délai affiché** : « sous 15 minutes ». **Réel attendu** : 4 à 8 min pour 25 pages, un seul audit traité à la fois.
**Si le brief n'est pas rempli** : relances automatiques à H+30 min et H+20 h, puis démarrage forcé à H+48 avec `activité` déduite du site et `ville = non précisée`. L'audit n'attend jamais indéfiniment.

**Retard** : au-delà de 60 min après paiement sans livraison, l'admin reçoit une alerte email interne. Au-delà de 6 h, un email d'excuse part au client avec le PDF ou, à défaut, un remboursement à déclencher manuellement.

## 4. Pages publiques à produire

| Route | Rôle |
|---|---|
| `/` | promesse, formulaire d'analyse gratuite, 3 exemples de constats, prix, FAQ |
| `/tarifs` | les deux offres, inclus / exclu, mention « audit automatisé, non contractuel » |
| `/exemple` | un rapport réel anonymisé, intégré en images |
| `/faq` | 8 questions : délai, que faire ensuite, données conservées, remboursement, plusieurs sites, qui rédige, garantie de classement (non), contact |
| `/mentions-legales`, `/cgv`, `/confidentialite` | textes FR complets |
| `/blog/*` | 6 articles (L7), rendus depuis des fichiers Markdown du dépôt |
| `/audit/<token>` | espace client (lien signé, pas de mot de passe) |
| `/admin/*` | back-office, Basic Auth |

Ton : vouvoiement, phrases courtes, zéro jargon non expliqué. **Aucune promesse de position ni de trafic.**

## 5. Contenu du PDF (détail dans `05-prompt-et-rapport-pdf.md`)

1. Couverture — nom du site, URL, date, score /100, mention « audit automatisé, non contractuel »
2. Synthèse — verdict en 1 phrase, 5 actions prioritaires
3. Scores par pilier (technique 25, on-page 30, contenu 20, performance 15, local & confiance 10)
4. **Ce qui fonctionne déjà** — 3 à 5 points mesurés (crédibilité ; sans quoi le reste n'est pas lu)
5. Constats détaillés — preuve mesurée, pourquoi ça compte, correctif précis
6. **Textes prêts à coller** — par page : title, meta, H1, H2
7. Plan 30 jours, semaine par semaine
8. À vérifier dans Search Console — les 3 clics exacts (positions, indexation : non mesurables chez nous)
9. Méthode, limites, annexe : les 66 contrôles passés avec leur résultat

## 6. Identité légale à reprendre partout

Loïc Huon, entrepreneur individuel (micro-entreprise), SIREN 853 658 375, 16 Rue Saint-Antoine du T, Bureau 3, 31000 Toulouse, tél. +33 6 82 29 87 65, TVA non applicable art. 293 B du CGI.
Email public : `contact@scanseo.fr` (à créer ; utiliser `CONTACT_EMAIL` en variable d'environnement, jamais une adresse en dur dans le code).

## 7. Limites à écrire noir sur blanc

- Audit **automatisé** : la mesure est réelle, la rédaction est générée puis relue par un humain sur demande.
- **Pas de positions Google, pas de volumes de recherche, pas de backlinks, pas de données Search Console** : ces données nécessitent un accès propriétaire que le service n'a pas. Le rapport renvoie aux 3 clics qui permettent au client de les voir.
- **Aucune garantie de classement, de trafic ou de délai de progression.**
- Un audit ne remplace pas une prestation de rédaction : il fournit les textes des pages existantes, pas de nouvelles pages (sauf offre 149 €, 2 pages).
