# Déploiement TrueNAS — les deux services

Le service est **deux conteneurs** issus de la même image. Le `web` sert le site et reçoit le
webhook Polar ; le `worker` traite la file (crawl → rédaction → PDF → email). **Sans worker, un
client paie et ne reçoit jamais rien** — et rien ne le signale dans les logs du web.

## 1. Mise à jour de l'image (obligatoire à chaque livraison)

```bash
cd /mnt/NVMe/Applications/scanseo
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Un correctif poussé n'est actif qu'après ce `pull` : le conteneur continue de tourner sur l'image
précédente sans prévenir.

## 2. Application `worker` (TrueNAS → Applications → Installer via YAML)

```yaml
services:
  scanseo-worker:
    image: ghcr.io/hollow313/scanseo:latest
    container_name: scanseo-worker
    restart: unless-stopped
    command: ["node", "worker.js"]
    env_file: /mnt/NVMe/Applications/scanseo/.env
    volumes:
      - /mnt/NVMe/Applications/scanseo/data:/data
      - /mnt/NVMe/Applications/scanseo/reports:/reports
    mem_limit: 1500m
    shm_size: 256m
```

- **`command: ["node", "worker.js"]`** est la ligne qui compte. Sans elle, l'application démarre un
  second site web qui ne traite aucune file.
- **Pas de port publié.**
- **`env_file` identique** à celui du web : le worker valide les 12 mêmes variables et refuse de
  démarrer s'il en manque une (message `FATAL: variables d'environnement requises manquantes`).
- **Pas de montage `/content`** : le worker ne sert aucune page.

## 3. Vérification (30 secondes)

```bash
curl -s http://192.168.1.200:30023/healthz | python3 -m json.tool
```

Attendu :

```json
{ "worker_last_seen": "2026-10-30T15:0…", "queue": { "pending": 0 } }
```

- `worker_last_seen` reste `null` → l'app ne tourne pas, ou la commande n'est pas `node worker.js`.
- `pending` qui ne descend pas → le worker tourne mais n'arrive pas à lire `/data` (droits 568).

Puis, dans `/admin` : le bandeau rouge « Worker silencieux » doit disparaître, et un audit relancé
depuis `/admin/audits` doit passer `running` → `done` en quelques minutes.

## 4. Email

`SMTP_URL` doit pointer sur la boîte **réellement authentifiée**, et `SMTP_FROM` doit être une
adresse autorisée par ce compte (sinon le relais OVH refuse). Le test se fait depuis
**`/admin/system` → « Envoyer un email de test »** : le résultat et l'erreur SMTP s'affichent dans
la page, pas seulement dans les logs.

Sans cette vérification, `mail: "configured"` ne veut rien dire : seul un email reçu prouve que la
livraison fonctionne.
