# ScanSEO — dossier de construction

**À remettre tel quel à l'agent de build (Antigravity).** Tu ne verras rien d'autre : tout ce qui est nécessaire est ici. Lis les fichiers dans l'ordre, puis exécute les lots de `06-lots-et-recette.md` **un par un**.

---

## 1. Ce que tu construis

Un service payant d'audit SEO automatisé, hébergé dans **un seul conteneur Linux Alpine**, qui :

1. reçoit un paiement **Polar** (produit « Audit SEO » 49 € TTC, produit « Complet » 149 € TTC) ;
2. collecte des faits mesurables sur le site du client (crawl + PageSpeed) ;
3. fait rédiger le diagnostic et les correctifs par l'**API DeepSeek** (pas d'agent, pas d'outil externe) ;
4. rend un **PDF professionnel de 14 à 22 pages** avec les textes prêts à coller ;
5. livre par email et dans un **espace client** accessible par lien signé ;
6. expose une **interface d'administration** protégée.

Nom de domaine : `scanseo.fr`. Site public français, cible France + francophonie (BE/CH/LU/CA acceptés, non ciblés).

## 2. Ce que tu ne construis pas

- Le plugin WordPress `rgaa-audit` et le site `rgaa-audit.eu` : **projets séparés, ne pas y toucher, ne pas les citer.**
- Aucune dépendance à **Hermes** : pas d'agent, pas de gateway, pas de mémoire, pas d'appel à un agent. Le service parle uniquement à l'API DeepSeek en HTTPS.
- Pas de page « suivi mensuel », pas d'abonnement, pas d'offre d'implémentation. Un achat = un audit.
- Pas de scraping de Google, pas de positions, pas de backlinks, pas de volumes de recherche.

## 3. Ordre de lecture

| Fichier | Contenu |
|---|---|
| `01-produit-et-parcours.md` | l'offre, les prix, le parcours client, ce que contient le rapport |
| `02-conteneur-et-deploiement.md` | image Alpine, uid 568, bind mounts, compose, proxy, env, CI |
| `03-donnees-api-webhook.md` | schéma SQLite, machine d'état, webhook Polar, routes, emails |
| `04-collecte-et-analyse.md` | pipeline, anti-SSRF, catalogue des 66 contrôles, score, contrat JSON |
| `05-prompt-et-rapport-pdf.md` | le prompt exact, la validation anti-hallucination, le gabarit PDF |
| `06-lots-et-recette.md` | 7 lots, critères d'acceptation numérotés, commandes de reproduction |
| `07-interdits.md` | liste rouge — ce qui fait échouer la recette |

## 4. Règles de travail (non négociables)

1. **Un lot à la fois.** Tu livres L0, tu colles les sorties réelles, on valide, tu passes à L1. Ne pas enchaîner deux lots.
2. **Chaque critère d'acceptation est numéroté et se prouve par une commande.** Une capture d'écran ne remplace pas une sortie de commande.
3. **Aucune donnée inventée.** Si une information n'est pas mesurable, le code doit écrire `non mesuré` et le rapport doit le dire. Une valeur plausible fabriquée est un défaut bloquant.
4. **Tout est en Node 22 + Alpine.** Pas de Python, pas de PHP, pas d'image Debian.
5. **Le conteneur tourne en uid 568** (utilisateur applicatif TrueNAS). L'application n'écrit que dans `/data` et `/reports` ; `/content` (blog, pages, images, admin) est lu, jamais modifié.
6. **Aucun secret dans le dépôt.** Uniquement `.env` + variables d'environnement.

## 5. Environnement

- Dépôt : `https://github.com/hollow313/scanseo.git` (privé, branche `main`, **actuellement vide** — ton premier commit est L0).
- Image publiée : `ghcr.io/hollow313/scanseo:latest` via GitHub Actions à chaque push sur `main`.
- Hôte : NAS TrueNAS, dataset `NVMe/Applications`, chemins hôte `/mnt/NVMe/Applications/scanseo/...`.
- Reverse proxy : Nginx Proxy Manager (déjà en place), Proxy Host `scanseo.fr` → `192.168.1.200:30023` (port hôte : **30023**, publié sur l'IP LAN seulement).
- SMTP : OVH, `smtps://...:465`.
- Paiement : Polar (même organisation que l'autre projet, **produits et webhook distincts**).

## 6. Définition de fini

- `docker compose -f docker-compose.prod.yml up -d` sur le NAS : deux conteneurs `running`, `/healthz` à `200`.
- Un `order.paid` Polar signé crée la commande, l'audit, et déclenche le parcours complet jusqu'à l'email reçu en boîte réelle.
- Le PDF est ouvert page par page et lu : aucune page blanche, aucun débordement, textes sélectionnables, liens cliquables.
- L'admin liste les audits, permet relance et renvoi d'email, protégé par mot de passe.
- Les 7 lots sont validés avec leurs sorties collées.
