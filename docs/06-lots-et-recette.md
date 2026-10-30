# 06 — Lots, critères d'acceptation, recette

Chaque critère est numéroté et se prouve par une commande ou une sortie réelle. **On ne passe pas au lot suivant sans avoir collé ces sorties.**

Convention : `$H` = base URL (`http://192.168.1.200:30023` — port de production, publié sur l'IP LAN ; l'instance de dev répond sur `http://127.0.0.1:30024`), `$K` = clé d'API admin fictive si besoin.

---

## L0 — Socle : dépôt, image, conteneur, santé

1. Le dépôt contient `Dockerfile`, `entrypoint.sh`, `docker-compose.yml`, `docker-compose.prod.yml`, `.dockerignore`, `.env.example`, `.github/workflows/docker-publish.yml`, `package.json`, `server.js`, `worker.js`, `README.md` de run (5 lignes : build, run, logs, update, rollback).
2. `docker build -t scanseo:dev .` réussit ; `docker run --rm scanseo:dev id` affiche **`uid=568 gid=568`**.
3. `docker run --rm scanseo:dev which chromium-browser || which chromium` affiche un chemin, et `docker run --rm scanseo:dev chromium-browser --version` (ou `chromium`) affiche une version.
4. Pré-vol : `docker run --rm -v /tmp/ro:/data:ro scanseo:dev node server.js` **échoue** avec le message `dossier /data non inscriptible par uid 568`, code de sortie ≠ 0.
5. `curl -s $H/healthz | jq` renvoie `ok:true`, `db:true`, `reports:true`, `mail:"configured"`, `chromium_version` non vide.
6. `curl -s -o /dev/null -w '%{http_code}' $H/` → `200`.
7. Les volumes sont bien utilisés : `docker exec scanseo-web touch /data/.probe && ls -l /mnt/NVMe/Applications/scanseo/data/.probe` montre le fichier, propriétaire `568`. Même contrôle sur `/reports`.
7bis. `/content` : créer `content/pages/faq.md` avec un titre reconnaissable → `curl -s $H/faq | grep «titre»` le rend **dans les 5 secondes, sans redémarrage ni rebuild**. Supprimer le fichier → la page revient à la version embarquée. Déposer un `.js` dans `content/` → il n'est **pas** servi (404), et `curl -s $H/assets/img/../../etc/passwd` renvoie `400/404`.
8. Sans `DEEPSEEK_API_KEY`, le conteneur refuse de démarrer en listant les variables manquantes (pas de démarrage silencieux).
9. Workflow CI vert sur un push `main`, image visible sur `ghcr.io/hollow313/scanseo:latest`.

## L1 — Paiement : webhook Polar → commande → audit

1. Corps brut préservé : `POST /webhook/polar` avec un JSON réindenté mais signature calculée sur l'original → **signature valide acceptée** (le service doit signer/vérifier sur les octets reçus, pas sur un `JSON.stringify`).
2. Signature absente → `401`. Signature fausse → `401`. Timestamp à −600 s → `401`. Trois réponses **génériques** identiques.
3. `order.paid` signé (produit 49) → `200`, une ligne `orders`, une ligne `audits` en `pending`, une ligne `emails` kind `brief` en `sent` (ou `failed` + alerte, jamais silencieux).
4. **Rejeu du même `webhook-id`** → `200 {"already_processed":true}`, `SELECT count(*) FROM audits` inchangé.
5. `order.paid` d'un `product_id` inconnu → `200`, `events.status='failed'`, alerte admin, **aucune** licence ni audit inventé.
6. `order.paid` sans `custom_field_data.site` → `200`, `orders.status='needs_site'`, email client envoyé, alerte admin. Jamais `500`.
7. `order.refunded` → `orders.status='refunded'`, audit → `refunded`, **aucun email** envoyé, job non exécuté.
8. L'email `brief` arrive réellement dans une boîte relevée (pas seulement `200` côté SMTP) : fournir l'extrait de `himalaya`/client mail avec l'objet et l'horodatage.

## L2 — Collecte

1. Sur un site de test WordPress : `pages_crawled` ≥ 10, chaque page a `http_status`, `title`, `h1_count`, `words`, `ttfb_ms`.
2. Anti-SSRF, quatre refus avec `400 url_not_allowed` : `http://192.168.1.200/`, `http://localhost:3000/`, `http://127.0.0.1/`, `http://[::1]/`. Et une redirection `https://site-test.tld/r` → `http://10.0.0.1/` également refusée.
3. Un domaine résolvant vers une IP publique est accepté ; le test doit être reproductible hors réseau interne.
4. `robots.txt`, `sitemap.xml` et `meta robots` sont lus et produisent les constats `T04`/`T05`/`T06` quand ils sont absents ou bloquants.
5. Matrice UA : sur un site de test qui sert un contenu différent à Googlebot, le constat `T12` sort ; sur un site normal, il ne sort **pas** (pas de faux positif).
6. PageSpeed : `performance.mobile_score`, `lcp_ms`, `cls`, `inp_ms` renseignés ; en cas d'échec API, le champ vaut `null` et le rapport marque `non mesuré` (jamais 0).
7. Les 66 contrôles sont exécutés ou marqués `non applicable` ; la somme (`conforme + à corriger + non applicable`) vaut 66 dans l'annexe du PDF.
8. Score reproductible : deux exécutions successives sur le même site donnent le même score (coller les deux JSON).

## L3 — Rédaction et validation

1. `report.json` valide le schéma zod, `constats.length` entre 8 et 22.
2. Aucun `code` hors catalogue : ajouter artificiellement un `code:"X99"` dans la réponse simulée → il est supprimé et l'écart est logué.
3. Anti-hallucination : sur un rapport réel, chercher les nombres présents dans `pourquoi`/`resume_executif` et vérifier qu'ils existent dans `faits.json` (script `tools/check-numbers.js` fourni et vert).
4. Toutes les entrées `textes_prets` respectent les bornes de longueur ; les titles sont uniques (`sort | uniq -d` vide).
5. Coût : `tokens_in`, `tokens_out`, `cost_usd` renseignés en base ; un audit 49 € doit rester **< 0,20 $**.
6. Régénération : en forçant une réponse hors bornes, le système régénère **une fois** puis passe en `fallback=true` sans planter.

## L4 — PDF

1. PDF généré, `pages` entre 12 et 26, aucune page ne rend moins de 200 caractères (hors couverture).
2. Ouverture du PDF : les 9 sections sont présentes dans l'ordre, la couverture porte le score et la mention « non contractuel ».
3. Links `tel:` et URL cliquables ; textes sélectionnables ; aucune police cassée sur `é à ç œ € — « » ’`.
4. Trois audits réels rendus et **lus page par page** ; liste des défauts visuels corrigés (débordement, bloc coupé, tableau écrasé) jointe.
5. Poids < 6 Mo, `content-disposition` correct sur `/audit/<token>/rapport.pdf`.

## L5 — Front public, teaser, espace client

1. `/`, `/tarifs`, `/faq`, `/exemple`, `/mentions-legales`, `/cgv`, `/confidentialite` répondent `200` en français, sans lorem ipsum, sans marqueur `[À COMPLÉTER]`.
2. `/tarifs` affiche 49 € TTC et 149 € TTC, avec la mention « audit automatisé, non contractuel » et **aucun** abonnement, **aucune** offre d'implémentation.
3. Le formulaire d'analyse gratuite fonctionne : soumission → `202` → polling → score + 3 constats affichés dans la page en moins de 90 s.
4. Rate limit : 4ᵉ soumission en 1 h depuis la même IP → `429` avec message clair. 2ᵉ soumission du même `host` dans 24 h → résultat en cache, pas de nouveau crawl.
5. `/audit/<token>` : token valide → page ; token modifié d'un caractère → `404`. Sans brief, le formulaire s'affiche ; après brief, le statut progresse jusqu'au PDF.
6. Aucune ressource tierce chargée (pas de Google Fonts, pas d'analytics, pas de pixel) : `curl -s $H/ | grep -Eo 'https?://[^"]+' | grep -v scanseo.fr` doit être vide.
7. Mobile 375 px : aucun débordement horizontal (`document.documentElement.scrollWidth <= 375`).

## L6 — Admin

1. `/admin` sans identifiants → `401` avec `WWW-Authenticate` ; mauvais mot de passe → `401` ; 6ᵉ tentative/min → `429`.
2. Tableau de bord : nombre d'audits 7 jours, temps moyen, taux d'échec, coût LLM du mois.
3. Liste des audits : filtres statut/offre, tri par date, colonnes demandées.
4. Actions vérifiées une par une : télécharger, **renvoyer l'email** (une nouvelle ligne `emails`, un seul envoi), **relancer** (audit repasse en `queued`, `attempts=0`), marquer remboursé, supprimer le dossier `/reports/<id>`.
5. « Créer un audit manuellement » : formulaire `{email, site, offre}` → audit en `queued`, email `brief` envoyé.
6. `/admin` envoie `X-Robots-Tag: noindex, nofollow` ; `/robots.txt` contient `Disallow: /admin`.
7. Le dossier `content/admin` fonctionne : y déposer `logo.svg` et `admin.css` → le logo et le style remplacent ceux de l'admin sans rebuild ; dossier absent ou vide → aucun effet, l'admin reste complet.

## L7 — Contenu SEO et durcissement

1. Six articles de blog rendus depuis `content/blog/*.md` (Markdown + front-matter), chacun > 900 mots, un seul H1, maillage interne vers `/tarifs`. Ajouter un 7ᵉ fichier dans le dossier le publie sans rebuild.
2. `sitemap.xml` généré avec toutes les pages publiques (hors `/admin`, hors `/audit/*`), `robots.txt` cohérent.
3. Chaque page publique : `<title>` 30–65, meta 120–165, un seul H1, JSON-LD `Organization` + `Service` valides.
4. Score Lighthouse mobile ≥ 95 sur `/` et `/tarifs` (le site qui vend du SEO ne peut pas être lent).
5. Aucun cookie déposé : `curl -sI $H/ | grep -i set-cookie` vide ; la page confidentialité correspond à ce comportement.
6. Journalisation : aucune clé API ni mot de passe dans `docker logs scanseo-web` (grep sur les 200 dernières lignes).
7. Purge : `node cli.js purge --email test@example.com` supprime commande, audit, PDF, emails et le consigne.

---

## Jeux de test imposés (à fournir dans `tests/fixtures/`)

| Cas | Usage | Attendu |
|---|---|---|
| Site WordPress vitrine, 15 pages | L2, L4 | 15–20 constats, score 40–70, 0 faux positif de cloaking |
| Site une page (SPA JS) | L2 | `T13` sorti, rapport l'indique, pas de crash |
| Site avec `noindex` volontaire | L2 | `T06` bloquant, verdict adapté (ne pas conseiller de l'enlever à l'aveugle) |
| Site inaccessible (500) | L2 | Audit `failed` après 3 essais, email d'excuse, pas de PDF vide |
| Site avec cloaking simulé | L2 | `T12` sorti, `S04` sorti |

## Ce qui est remis à la fin de chaque lot

1. Les sorties de commandes collées, numérotées comme ci-dessus.
2. Le hash du commit correspondant.
3. Une phrase par critère : `OK` ou `NON` avec la raison.
4. Rien d'autre : pas de résumé du code, pas de plan des lots suivants.
