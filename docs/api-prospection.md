# API de prospection

Endpoint interne pour lancer un audit gratuit sur un site repéré (démarchage), sans passer par
Polar. Il crée un audit partageable et, par défaut, un **PDF d'aperçu de 2 pages** à envoyer au
prospect.

## Activation

Une seule variable d'environnement, à ajouter sur **les deux** services (`web` et `worker`) :

```bash
SCAN_API_KEY=$(openssl rand -hex 32)
```

Sans elle, la route répond `503 prospection_disabled` — elle n'est jamais ouverte par défaut.
Absence de clé = fonctionnalité éteinte, pas de porte dérobée.

## Appel

```bash
curl -sS -X POST http://192.168.1.200:30023/api/prospect/scan \
  -H "x-api-key: $SCAN_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"url":"https://plomberie-exemple.fr","email":"contact@prospect.fr","pages":8}'
```

- `Authorization: Bearer <clé>` est accepté aussi (pratique pour les clients HTTP).
- La réponse attend la fin du scan : **10 à 30 secondes** pour 8 pages. Prévoir un timeout client ≥ 120 s.
- Débit : **30 scans par heure et par IP** (IP hachée, jamais stockée en clair).
- L'URL cible est soumise au même garde anti-SSRF que le site public : pas d'IP privée, pas de
  `localhost`, pas de rebinding DNS, même si l'appel vient du réseau local.

## Réponse

```json
{
  "ok": true,
  "audit_id": "…",
  "token": "…",
  "share_url": "https://scanseo.fr/audit/…",
  "pdf": true,
  "duration_ms": 12400,
  "site": { "host": "plomberie-exemple.fr", "pages_crawled": 8 },
  "score": 84,
  "piliers": { "technique": 95, "onpage": 79, "contenu": 58, "performance": 100, "local": 100 },
  "counts": { "critiques": 0, "majeurs": 5, "mineurs": 4, "informatifs": 0 },
  "top_findings": [
    { "code": "T10", "severity": "majeur", "pillar": "technique",
      "page": "https://…", "evidence": "1 lien interne en 404 (ex. …)", "fix": null }
  ],
  "catalogue": { "conforme": 37, "a_corriger": 9, "non_applicable": 20 }
}
```

- `share_url` : page client sans mot de passe (lien signé), utilisable dans un email de démarchage.
- `top_findings` : 8 constats maximum, dédoublonnés par URL citée.
- Aucun appel LLM : le scan de prospection est **gratuit en tokens**, il ne produit que des
  constats déterministes et un aperçu commercial.

## Bon usage

Un scan de prospection n'est pas un audit payant : pas de rédaction des balises, pas de plan
d'action. C'est un appât honnête — le score et les 5 constats sont réels, et le PDF renvoie vers
l'offre. Ne jamais envoyer un aperçu sans avoir vérifié qu'il ne contient pas de faux positif :
un constat erroné envoyé à un prospect coûte plus cher qu'un scan non envoyé.

## Fichiers

- `src/routes/prospect.js` — authentification, quotas, validation.
- `src/prospect.js` — scan, création de l'audit, rendu du PDF d'aperçu.
