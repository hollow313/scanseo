# 05 — Prompt de rédaction et rapport PDF

Le produit, c'est ce fichier. Un rapport qui contient une seule affirmation non mesurée détruit la crédibilité du service ; un rapport qui ne donne pas le texte exact à coller ne se distingue pas des outils gratuits.

## 1. Prompt système (à stocker dans `src/prompts/report.fr.txt`, versionné)

```text
Tu es analyste SEO senior francophone. Tu rédiges un audit pour un dirigeant de PME ou un artisan.
Tu ne vois le site que par les FAITS MESURÉS qu'on te transmet : tu n'as pas accès à Internet,
tu ne peux pas consulter le site, Google, Search Console, ni un outil de mots-clés.

RÈGLES ABSOLUES
1. Chaque affirmation s'appuie sur un fait fourni. Si une information n'est pas dans les faits,
   tu ne l'écris pas. Tu ne devines jamais un chiffre : ni trafic, ni volume de recherche,
   ni position, ni nombre de backlinks, ni concurrence chiffrée.
2. Tu n'inventes aucun contrôle : tu ne cites que les codes présents dans la liste fournie.
3. Tu écris en français, au vouvoiement, pour quelqu'un qui n'est pas technicien.
   Chaque terme technique est expliqué en cinq mots la première fois.
4. Aucune promesse de résultat : jamais « vous serez en page 1 », « votre trafic va doubler »,
   « +30 % de visites ». Tu peux dire qu'une correction lève un obstacle, jamais qu'elle produit
   un résultat garanti.
5. Tu es concret : une correction est une action précise, faisable par le client dans son
   interface d'administration, pas un conseil général.
6. Tu ne recommandes jamais de désactiver la sécurité, d'acheter des liens, de masquer du
   contenu aux visiteurs, ni de dupliquer des pages.
7. Si la collecte est partielle (partial=true), tu le dis dans le résumé exécutif et tu
   n'extrapoles pas les scores manquants.

CE QUE TU PRODUIS
- verdict : UNE phrase de 15 à 30 mots qui dit l'essentiel du problème, sans jargon.
- resume_executif : 3 à 5 phrases. Ce qui bloque, ce qui est facile à corriger, par quoi commencer.
- points_forts : 3 à 5 choses réellement bonnes, mesurées. Jamais de compliment générique.
- piliers : un commentaire de 2 à 3 phrases par pilier, appuyé sur les faits et le score donné.
  Tu ne recalcules jamais les notes : elles te sont fournies.
- constats : 8 à 22 entrées, triées de la plus grave à la moins grave. Pour chacune :
    constat   = ce qui est mesuré, en une phrase factuelle (reprends le chiffre du fait).
    pourquoi  = l'effet concret pour le client, 1 à 2 phrases, sans jargon.
    correctif = l'action exacte, à l'impératif, avec le chemin de clic quand il existe
                (« WordPress → Pages → Modifier → onglet SEO »).
    texte_a_coller = quand le constat concerne un title, une meta, un H1 ou des H2 :
                tu rédiges le texte final, prêt à copier-coller.
- textes_prets : pour chaque page auditée dont le title ou la meta est absent, vide, dupliqué
  ou hors bornes, une entrée avec title (30 à 65 caractères), meta (120 à 165), h1, et 2 à 4 h2.
  Les titles doivent être uniques entre eux. Tu y places l'activité et la ville quand elles
  sont connues, sans jamais empiler les mots-clés.
- plan_30_jours : 4 semaines, 3 à 5 actions par semaine, ordonnées par impact décroissant.
  Chaque action mentionne le code du constat concerné.
- a_verifier_dans_search_console : 3 instructions maximum, avec le chemin de clic exact,
  pour les données que cet audit ne mesure pas (positions, pages indexées, requêtes).
- limites : 2 à 3 phrases sur ce que l'audit ne mesure pas et pourquoi.

STYLE DES TEXTES À COLLER
- title : l'activité puis la ville, puis la marque. Naturel, lisible, jamais de liste de mots-clés.
  Mauvais : « Plombier Toulouse | Plomberie pas cher 24h/24 dépannage urgence ».
  Bon     : « Plombier à Toulouse — dépannage 24 h/24 | Dupont Plomberie ».
- meta : une promesse concrète et un appel à l'action. Elle ne répète pas le title mot pour mot.
- h1 : une seule formulation, différente du title.
- Les textes sont en français correct, sans faute, sans majuscule abusive, tirets et espaces
  insécables avant « : » et « € » respectés.

FORMAT
Tu réponds STRICTEMENT en JSON valide, sans texte avant ou après, conforme au schéma fourni.
Aucune clé supplémentaire, aucun commentaire, aucune balise Markdown.
```

## 2. Prompt utilisateur (gabarit)

```text
SITE : {{host}} ({{url}})
ACTIVITÉ DÉCLARÉE : {{activity}}
VILLE : {{city}}
OFFRE : {{offer}}   (audit_49 = 25 pages, audit_149 = 100 pages + 2 pages de contenu à rédiger)
DATE : {{date}}

SCORES (calculés, ne pas les modifier) :
{{score_json}}

FAITS MESURÉS :
{{facts_json}}

CONSTATS DÉTECTÉS PAR LE CODE (un par ligne, à reprendre) :
{{findings_lines}}

CODES AUTORISÉS :
{{codes_list}}

Réponds uniquement avec le JSON du schéma `report.schema.json`.
```

## 3. Étape « 2 pages rédigées » (offre 149 € uniquement)

Deuxième appel, `max_tokens=6000`, sur les deux pages les plus importantes (accueil + page de service la plus faible). Sortie :

```json
{"pages":[{"url":"…","title":"…","meta":"…","h1":"…","chapo":"…","h2":[{"titre":"…","paragraphes":["…","…"]}],"faq":[{"q":"…","r":"…"}],"cta":"…"}]}
```

Règles : chaque paragraphe fait 40 à 90 mots ; aucune information non déduite du site (horaires, tarifs, certifications) — si une information manque, écrire `[À COMPLÉTER PAR VOS SOINS : …]` plutôt que l'inventer. Interdiction absolue d'inventer un prix, une ancienneté, un label, une garantie ou un témoignage : c'est un risque juridique et un mensonge au client.

## 4. Validation avant rendu (bloquante)

Dans l'ordre, en code :

1. JSON parse + validation zod du schéma.
2. `code` ∈ catalogue, `page` ∈ pages crawlées.
3. Bornes de longueur (title 30–65, meta 120–165, h1 ≤ 70), unicité des titles.
4. Chasse aux nombres non sourcés (règle 5 du §7 du fichier `04`).
5. `constats.length >= 8`, sinon compléter avec les constats déterministes triés par gravité.
6. Si une étape échoue : **une** régénération avec le motif d'échec ajouté au prompt. Deuxième échec → rendu avec les seules données déterministes (`fallback=true` logué, alerte admin). **On ne livre jamais un PDF qui n'a pas passé la validation.**

## 5. Rapport PDF — structure et rendu

Rendu : Chromium en mode headless, `Page.printToPDF` avec `printBackground:true`, `format:'A4'`, marges 18 mm, `displayHeaderFooter:true` (en-tête discret « ScanSEO — audit de {{host}} » / pied « page X / Y »). Texte **sélectionnable**, liens cliquables, aucune image bitmap pour du texte.

Gabarit HTML unique `src/templates/report.html` + CSS `report.css`, alimenté par le JSON validé. Sections :

| # | Section | Contenu |
|---|---|---|
| 1 | Couverture | nom du site, URL, date, score /100 en gros, mention « Audit automatisé — non contractuel », identité de l'éditeur |
| 2 | Synthèse | verdict encadré, 5 actions prioritaires numérotées, ce qui fonctionne déjà |
| 3 | Scores | barre par pilier avec la note et le poids, une phrase de commentaire par pilier |
| 4 | Constats | un bloc par constat : gravité (pastille + libellé), preuve mesurée, pourquoi, correctif, texte à coller en bloc monospace copiable |
| 5 | Textes prêts | tableau page → title (avec compteur de caractères) → meta (compteur) → H1 |
| 6 | Plan 30 jours | 4 colonnes semaines, actions cochables |
| 7 | Search Console | 3 étapes numérotées avec le chemin de clic |
| 8 | Méthode & limites | ce qui est mesuré, ce qui ne l'est pas, comment relancer un audit |
| 9 | Annexe technique | tableau des 66 contrôles : code, libellé, résultat (`conforme` / `à corriger` / `non applicable`) |

Contraintes de mise en page :

- **Un constat ne se coupe pas** entre deux pages : `break-inside: avoid`.
- Une page blanche est un défaut : après rendu, le nombre de pages est vérifié et chaque page doit contenir du texte (sauf la couverture).
- Aucun débordement horizontal ; les URLs longues passent à la ligne (`overflow-wrap:anywhere`).
- Lisibilité en noir et blanc : la gravité ne repose jamais sur la seule couleur, le libellé est toujours écrit.
- Police : Noto Sans (fallback DejaVu Sans), 10,5 pt corps, 9 pt tableaux, interligne 1,45.
- Cible : 14 à 22 pages. Au-delà de 22, regrouper les constats de même code par page (« 8 pages concernées ») au lieu d'un bloc par page.

## 6. Vérification après rendu (obligatoire, automatisée)

```js
// à exécuter dans le worker après printToPDF
const pdf = await PDFDocument.load(bytes);
const pages = pdf.getPageCount();          // attendu : 12 ≤ pages ≤ 26
// + extraction texte par page (pdfjs-dist) : chaque page doit rendre > 200 caractères,
//   sauf la couverture ; assert sur la présence du host, du score et de la date.
```

Critères : `pages` dans les bornes, aucune page vide, `title` du PDF = `Audit SEO — {{host}} — {{date}}`, poids < 6 Mo, `pdf` ouvert et lu manuellement sur 3 audits de recette (L4). Un PDF non lu page par page n'est pas un PDF livré.

## 7. Livraison

- Fichier : `/reports/<YYYY-MM-DD>_<id>/rapport.pdf`, nom d'envoi `audit-seo-<host>-<date>.pdf`.
- Email `delivery` : verdict en objet secondaire, score dans le corps, PDF attaché (< 6 Mo), lien `/audit/<token>`.
- L'espace client affiche la même chose en HTML : score, 5 actions, bouton de téléchargement, et — si l'audit n'est pas terminé — l'état d'avancement réel (collecte / rédaction / rendu).
