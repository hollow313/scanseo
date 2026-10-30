# 04 — Pipeline : collecte, score, contrat JSON

## 1. Les 7 étapes du worker

```
1. claim        SELECT ... FROM audits WHERE status='queued' ORDER BY created_at LIMIT 1  (BEGIN IMMEDIATE)
2. garde URL    validation + résolution DNS (anti-SSRF)
3. collecte     crawl ≤ N pages (HTML brut, UA Googlebot) + matrice UA + PageSpeed
4. faits        écriture pages.facts + findings déterministes + score par pilier
5. rédaction    appel DeepSeek → JSON strict → validation zod + anti-hallucination
6. rendu        HTML → PDF (Chromium) → /reports/<id>/rapport.pdf
7. livraison    email `delivery` + status done  (done seulement si l'email est parti)
```

Chaque étape écrit sa durée et ses erreurs. Une erreur relance l'audit (max 3, backoff 2/10/30 min) ; au 3ᵉ échec `failed` + alerte admin. **Jamais de `done` sans PDF sur disque et email `sent`.**

## 2. Anti-SSRF (obligatoire, avant toute requête)

Le formulaire public est un proxy potentiel vers le réseau interne du NAS. Trois vérifications, dans cet ordre :

1. **Schéma et forme** : `http(s)` uniquement, hôte de la forme `[a-z0-9.-]`, pas d'IP littérale, pas de `localhost`, `.local`, `.internal`, `.lan`, pas de port < 1024 ni de port inhabituel (autoriser 80, 443, 8080, 8443, et le port par défaut). Longueur ≤ 2 048.
2. **Résolution** : résoudre tous les `A`/`AAAA` ; refuser si **une** adresse tombe dans : `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4`, `240/4`, `::1`, `fc00::/7`, `fe80::/10`, `::ffff:0:0/96`.
3. **Anti-rebinding** : la connexion doit utiliser l'adresse validée, pas une nouvelle résolution. Implémentation avec `undici` :

```js
import { Agent, fetch } from 'undici';
import { lookup as dnsLookup } from 'node:dns';

const PRIVATE = [/* CIDR list above */];
function isPrivate(ip) { /* net.BlockList ou comparaison manuelle, v4 + v6 */ }

const safeAgent = new Agent({
  connect: {
    lookup(hostname, opts, cb) {
      dnsLookup(hostname, { all: true, family: opts?.family ?? 0 }, (err, addrs) => {
        if (err) return cb(err);
        if (!addrs.length || addrs.some(a => isPrivate(a.address)))
          return cb(new Error('EURLFORBIDDEN'));
        cb(null, addrs[0].address, addrs[0].family);
      });
    },
    timeout: 20_000,
  },
  maxRedirections: 5,
});
```

- Le `lookup` est aussi appliqué à **chaque redirection** (undici le réapplique par hop) : une redirection vers `http://192.168.1.200/` est donc rejetée.
- `EURLFORBIDDEN` → `400 {"error":"url_not_allowed"}`, message unique, aucun détail réseau en réponse.
- Chromium (rendu JS et PDF) ne charge que des pages **déjà validées** ; bloquer les sous-ressources via `page.setRequestInterception` en refusant toute requête dont l'hôte n'est pas dans la liste autorisée (le site + son CDN déclaré), sinon un `<img src="http://192.168.1.1/">` fait du SSRF par le navigateur.

## 3. Règles de crawl

| Paramètre | Valeur |
|---|---|
| User-Agent principal | `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)` |
| UA de contrôle (cloaking) | `ScanSEO/1.0 (+https://scanseo.fr/bot)` et `curl/8` |
| Débit | 1 requête/seconde par hôte, 3 en parallèle max |
| Timeout | 20 s par page, 15 min par audit |
| Taille max | 8 Mo par page, budget total 300 Mo |
| Profondeur | 3 clics maximum depuis la page d'accueil |
| Pages | accueil + 24 (offre 49 €) / 99 (offre 149 €), priorité : accueil, pages du sitemap, pages de navigation, puis liens internes |
| Suivi | `robots.txt` lu et respecté pour les pages internes ; les 5 URLs d'entrée (accueil, sitemap) sont toujours lues |
| Ne jamais | soumettre un formulaire, s'authentifier, suivre un `mailto:`/`tel:`, sortir du domaine (sauf vérification d'un lien sortant) |

Rendu JS : **une seule** page (l'accueil) est chargée dans Chromium, pour détecter un site dont le contenu n'existe qu'après JS — c'est un constat majeur (`T13`), pas un outil de crawl complet.

## 4. Catalogue des contrôles (contrat entre le code et le rapport)

Codes **stables** : le LLM ne peut citer que ceux-ci. `G` = gravité par défaut, `P` = pénalité par occurrence, `cap` = nombre d'occurrences comptées.

### Technique (pilier `technique`, poids 25)

| Code | Contrôle | G | P | cap |
|---|---|---|---|---|
| T01 | HTTP → HTTPS absent ou non redirigé | bloquant | 20 | 1 |
| T02 | Certificat invalide / expiré / HSTS absent | majeur | 5 | 1 |
| T03 | Accueil ne répond pas 200 | bloquant | 20 | 1 |
| T04 | `robots.txt` absent | mineur | 2 | 1 |
| T05 | Sitemap absent, invalide ou vide | majeur | 5 | 1 |
| T06 | `meta robots` en `noindex` | bloquant | 20 | 1 |
| T07 | En-tête `X-Robots-Tag: noindex` | bloquant | 20 | 1 |
| T08 | Canonical absent | mineur | 2 | 5 |
| T09 | Canonical pointant vers une autre URL / autre domaine | critique | 10 | 5 |
| T10 | Pages en 404/410 dans le sitemap ou la navigation | majeur | 5 | 5 |
| T11 | Chaînes de redirection (> 1 saut) | mineur | 2 | 5 |
| T12 | Divergence de contenu par User-Agent (cloaking) | bloquant | 20 | 1 |
| T13 | Contenu principal absent du HTML brut, présent seulement après JS | critique | 10 | 1 |
| T14 | `hreflang` incohérent ou incomplet | mineur | 2 | 5 |
| T15 | Contenu mixte (ressource `http://` sur page `https`) | majeur | 5 | 3 |
| T16 | TTFB > 800 ms | majeur | 5 | 1 |
| T17 | URL avec paramètres / identifiants techniques | mineur | 2 | 10 |

### On-page (pilier `onpage`, poids 30)

| Code | Contrôle | G | P | cap |
|---|---|---|---|---|
| O01 | `<title>` absent | critique | 10 | 5 |
| O02 | `<title>` hors 30–65 caractères | mineur | 2 | 10 |
| O03 | `<title>` dupliqué entre pages | majeur | 5 | 10 |
| O04 | `<title>` sans marque ni localisation | mineur | 2 | 10 |
| O05 | Meta description absente | majeur | 5 | 10 |
| O06 | Meta description hors 120–165 caractères | mineur | 2 | 10 |
| O07 | Meta description dupliquée | majeur | 5 | 10 |
| O08 | Aucun `<h1>` | critique | 10 | 10 |
| O09 | Plusieurs `<h1>` | mineur | 2 | 10 |
| O10 | `<h1>` vide | majeur | 5 | 10 |
| O11 | Hiérarchie de titres cassée (saut H2→H4) | mineur | 2 | 10 |
| O12 | Contenu mince (< 300 mots) | majeur | 5 | 10 |
| O13 | Images sans attribut `alt` | majeur | 5 | 10 |
| O14 | Images > 200 Ko ou non redimensionnées | mineur | 2 | 10 |
| O15 | Ancres internes génériques (« cliquez ici », « en savoir plus ») | mineur | 2 | 10 |
| O16 | Page du sitemap non liée en interne (orpheline) | majeur | 5 | 10 |
| O17 | Liens internes cassés (4xx) | majeur | 5 | 10 |
| O18 | Balises Open Graph / Twitter absentes | informatif | 0 | 1 |
| O19 | Attribut `lang` absent sur `<html>` | mineur | 2 | 1 |
| O20 | Données structurées absentes | majeur | 5 | 1 |
| O21 | JSON-LD invalide (ne se parse pas / champs requis manquants) | majeur | 5 | 3 |
| O22 | Incohérence NAP entre JSON-LD, page et pied de page | critique | 10 | 3 |
| O23 | Texte essentiel porté par une image (détecté : image sans alt + texte voisin court) | mineur | 2 | 5 |
| O24 | `<meta name="keywords">` ou balise obsolète | informatif | 0 | 1 |

### Contenu (pilier `contenu`, poids 20)

| Code | Contrôle | G | P | cap |
|---|---|---|---|---|
| C01 | Ni l'activité ni la ville n'apparaissent dans le corps de l'accueil | critique | 10 | 1 |
| C02 | Cannibalisation : 2 pages visant la même intention (titles proches) | majeur | 5 | 5 |
| C03 | Contenu quasi dupliqué entre pages (SimHash, distance < 5) | majeur | 5 | 5 |
| C04 | Aucune FAQ ni bloc de questions/réponses | mineur | 2 | 1 |
| C05 | Contenu clé à plus de 3 clics de l'accueil | mineur | 2 | 5 |
| C06 | Absence de page « contact » ou de moyen de contact direct | majeur | 5 | 1 |
| C07 | Aucune mention géographique sur les pages internes | majeur | 5 | 5 |

### Performance (pilier `performance`, poids 15 — PageSpeed Insights)

| Code | Contrôle | G | P | cap |
|---|---|---|---|---|
| P01 | Score mobile < 50 | critique | 10 | 1 |
| P02 | Score mobile 50–74 | majeur | 5 | 1 |
| P03 | LCP > 2,5 s | majeur | 5 | 1 |
| P04 | CLS > 0,1 | majeur | 5 | 1 |
| P05 | INP > 200 ms | majeur | 5 | 1 |
| P06 | Poids de page > 2 Mo | mineur | 2 | 1 |
| P07 | Opportunités Lighthouse non exploitées (≥ 3 listées) | mineur | 2 | 1 |

### Local & confiance (pilier `local`, poids 10)

| Code | Contrôle | G | P | cap |
|---|---|---|---|---|
| L01 | Aucun lien `tel:` cliquable | majeur | 5 | 1 |
| L02 | Adresse postale absente ou incohérente | majeur | 5 | 3 |
| L03 | Aucun lien vers la fiche Google Business | majeur | 5 | 1 |
| L04 | Aucune carte / plan d'accès | mineur | 2 | 1 |
| L05 | Aucun avis client visible | mineur | 2 | 1 |
| L06 | Plusieurs établissements sur une seule page (au lieu d'une page par lieu) | majeur | 5 | 1 |
| S01 | Mentions légales absentes | critique | 10 | 1 |
| S02 | Traceur chargé sans bandeau de consentement | critique | 10 | 1 |
| S03 | Liens sortants vers des domaines douteux (> 5) | majeur | 5 | 1 |
| S04 | Indices de compromission (liens cachés, texte masqué, redirection conditionnelle) | bloquant | 20 | 1 |
| S05 | Version de CMS exposée (`generator`, `/wp-json`, `?ver=`) | mineur | 2 | 1 |

> Total : **66 contrôles**. Le rapport doit afficher le nombre réellement exécuté ; un contrôle non applicable (site sans téléphone, par exemple) est marqué `non applicable`, jamais « réussi ».

## 5. Score (calculé par le code, **jamais par le LLM**)

```
pour chaque contrôle c :
   occurrences_pondérées = min(nb_occurrences, cap)
   pénalité_c = P_c × occurrences_pondérées
note_pilier = max(0, 100 - Σ pénalité_c du pilier)
score_global = round( Σ (note_pilier × poids_pilier) / 100 )
```

- Le score est reproductible : deux exécutions sur le même site à contenu identique donnent le même résultat.
- Un site dont la collecte a échoué partiellement porte `score = null` et `partial = true` dans les faits ; le rapport l'indique en couverture.
- Interdiction d'un score « de complaisance » : aucun plancher, aucun arrondi flatteur.

## 6. Faits envoyés au LLM

Un seul objet JSON, **≤ 60 000 caractères**. Structure :

```json
{
  "site": {"url":"…","host":"…","activity":"…","city":"…","cms":"wordpress 6.8","pages_crawled":24,"partial":false},
  "score": {"global":62,"piliers":{"technique":71,"onpage":58,"contenu":50,"performance":64,"local":70}},
  "findings": [{"code":"O05","pillar":"onpage","severity":"majeur","page":"https://…","evidence":"meta description absente (0 caractère sur 24 pages)","detail":"…"}],
  "pages": [{"url":"…","title":"…","title_len":0,"meta":"…","meta_len":0,"h1":"…","h1_count":1,"words":210,"jsonld":["Organization"],"images_no_alt":3,"status":200,"internal_links":12}],
  "performance": {"mobile_score":43,"lcp_ms":4100,"cls":0.18,"inp_ms":230,"top_opportunities":["…"]},
  "local": {"phone_found":true,"address_found":true,"gbp_link":false,"reviews_found":false},
  "limites_connues": ["positions Google non mesurées","volumes de recherche non mesurés","backlinks non mesurés"]
}
```

Règles : le corps des pages **n'est jamais envoyé** (uniquement les champs ci-dessus, plus 300 caractères du premier paragraphe par page). Pas de HTML brut dans le prompt : cela coûte des tokens et invite le modèle à inventer.

## 7. Contrat JSON attendu du LLM

```json
{
  "verdict": "Une phrase de 15 à 30 mots, factuelle, sans promesse.",
  "resume_executif": "3 à 5 phrases (60 à 120 mots).",
  "points_forts": ["3 à 5 constats mesurés et positifs"],
  "piliers": [{"code":"technique","commentaire":"2 à 3 phrases, appuyé sur les faits"}],
  "constats": [
    {"code":"O05","page":"https://…","gravite":"majeur",
     "constat":"Ce qui est mesuré, en une phrase.",
     "pourquoi":"Effet concret pour le client, 1 à 2 phrases.",
     "correctif":"Action précise, à l'impératif.",
     "texte_a_coller":{"title":"…","meta":"…","h1":"…","h2":["…"]}}
  ],
  "textes_prets": [{"page":"https://…","title":"…","meta":"…","h1":"…","h2":["…","…","…"]}],
  "plan_30_jours": [{"semaine":1,"theme":"…","actions":["…","…"]}],
  "a_verifier_dans_search_console": ["3 instructions avec le chemin de clic exact"],
  "limites": "2 à 3 phrases rappelant ce que l'audit ne mesure pas."
}
```

Contraintes vérifiées **en code** (zod + contrôles maison), avant rendu :

1. `constats[].code` ∈ catalogue §4 ; sinon le constat est supprimé (et l'écart logué).
2. `constats[].page` ∈ URLs crawlées ; sinon supprimé.
3. `title` 30–65 caractères, `meta` 120–165, `h1` ≤ 70 ; hors bornes → **une** régénération ciblée, puis troncature propre et mention `ajusté automatiquement`.
4. `textes_prets` : une entrée par page auditée ayant un `title` vide ou hors bornes, `title` unique dans tout le rapport.
5. **Anti-hallucination numérique** : tout nombre (`\d+(?:[.,]\d+)?\s*(?:%|€|s|ms|pages?|mots?)`) présent dans `pourquoi` ou `resume_executif` doit exister dans les faits. Sinon → régénération une fois ; toujours présent → phrase supprimée et remplacée par la version déterministe.
6. `plan_30_jours` : 4 semaines, 3 à 5 actions par semaine, chaque action cite un `code` existant.
7. Longueur totale : `constats` entre 8 et 22 entrées. En dessous de 8, on complète avec les constats déterministes de gravité la plus haute.

Aucune de ces règles n'est optionnelle : sans elles, le rapport contient des chiffres inventés et perd toute crédibilité.

## 8. Coût et garde-fous d'appel

- `POST https://api.deepseek.com/chat/completions`, `model=DEEPSEEK_MODEL_PAID`, `temperature=0.3`, `response_format={"type":"json_object"}`, `max_tokens=8000`.
- Timeout 180 s, 2 tentatives, pas de streaming.
- Coût attendu : ~0,06 $ par audit payant, ~0,01 $ par teaser. Le coût réel (`usage.prompt_tokens`, `completion_tokens`) est stocké en base et affiché dans l'admin — c'est le garde-fou contre une dérive de prompt.
- Si `usage.prompt_tokens > 150 000` : réduire les faits (30 pages max → 20) et relancer une fois.
