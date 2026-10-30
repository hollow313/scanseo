# 07 — Liste rouge

Chaque point ci-dessous a déjà cassé un projet réel. Un seul suffit à faire échouer la recette.

## Conteneur

1. **Ne pas binder un dossier hôte sur `/app` ou `/app/public`.** L'image et le disque se contredisent au premier `pull` ; seul `/content` (blog, pages, images, surcharges d'admin) est monté — du contenu, jamais du code.
2. **Ne pas tourner en root « pour éviter les problèmes de droits ».** L'uid est 568, le pré-vol échoue bruyamment, c'est le comportement voulu.
3. **Ne pas écrire hors de `/data` et `/reports`.** `/content` est lu, jamais modifié par l'application. Un PDF dans `/tmp` disparaît au redémarrage et le client perd son rapport.
4. **Ne pas utiliser d'image Debian/Ubuntu ni `node:latest`.** Alpine + Node 22 épinglé ; une mise à jour majeure de Node casse les modules natifs sans prévenir.
5. **Ne pas publier le port 30023 au-delà du LAN.** Le publier sur `192.168.1.200:30023` est voulu (NPM doit l'atteindre) ; le publier sur `0.0.0.0` ou le rediriger depuis la box expose le service sur toutes les interfaces du NAS et court-circuite le proxy. Et puisque le port est joignable directement, **l'authentification de l'app est la seule barrière** : jamais de `/admin` sans Basic Auth, jamais de webhook sans vérification de signature.

## Sécurité

6. **Ne jamais fetcher une URL utilisateur sans le garde SSRF.** Le formulaire public est une porte vers le LAN du NAS (192.168.1.200, la baie TrueNAS, l'admin du routeur).
7. **Ne pas laisser Chromium charger des sous-ressources arbitraires.** Une balise `<img>` pointant sur `http://192.168.1.1/` suffit à contourner un garde appliqué seulement à la page principale.
8. **Ne pas logger les clés, jetons, emails complets ni le HTML des pages.** Les logs partent dans Docker et chez le fournisseur ; ils ne sont pas un espace privé.
9. **Ne pas exposer `/admin` sans authentification, même « en local ».** L'argument qui compte n'est pas le réseau mais le proxy : une règle mal écrite expose la création d'audits et les données clients à Internet.

## Paiement

10. **Ne pas réutiliser le webhook de l'autre projet.** Mapping produit, secret et idempotence sont distincts ; un produit inconnu ne doit jamais produire un audit ou un plan par défaut.
11. **Ne jamais répondre `500` sur un cas métier** (produit inconnu, champ `site` manquant). Polar réessaie indéfiniment, l'événement se perd et le client a payé pour rien.
12. **Ne pas vérifier la signature sur un JSON re-sérialisé.** Sans le corps brut, tous les événements réels sont rejetés — et le test maison passe quand même.
13. **Ne pas considérer un email envoyé parce que le code SMTP a retourné sans exception.** Un `console.log('SMTP non configuré')` puis `return false` a déjà laissé des clients sans livraison. Un `delivery` en échec interdit le statut `done`.

## Rapport

14. **Ne jamais laisser le LLM calculer le score.** Le score est déterministe, sinon deux audits du même site se contredisent et le client perd confiance.
15. **Ne jamais livrer un chiffre absent des faits** (trafic, volume de recherche, position, nombre de backlinks, parts de marché). L'anti-hallucination du fichier `04` §7 est bloquante.
16. **Ne jamais promettre un classement, un trafic ou un délai de progression.** « Vous serez en page 1 » est un risque juridique et un mensonge.
17. **Ne jamais inventer un contenu client** (prix, ancienneté, label, garantie, témoignage) dans les pages rédigées : marquer `[À COMPLÉTER PAR VOS SOINS : …]`.
18. **Ne pas scraper Google, Bing ou un SERP pour « vérifier la position ».** Depuis un datacenter, le résultat est un captcha ou une erreur 429 ; l'afficher comme une mesure est une faute.
19. **Ne pas ajouter de traceur, de pixel ou de police distante sur le site.** La page confidentialité affirme l'absence de cookie et de ressource tierce : elle doit rester vraie.

## Produit

20. **Ne pas ajouter d'offre** (abonnement, suivi mensuel, implémentation, upsell) ni modifier les prix. La gamme est figée : gratuit / 49 € / 149 €.
21. **Ne pas transformer le service en outil d'agence** (multi-clients, white-label, API publique). Ce n'est pas le produit.
22. **Ne pas rendre l'audit dépendant d'un accès propriétaire** (Search Console, Google Ads, compte client) : le parcours doit fonctionner avec une seule URL.
