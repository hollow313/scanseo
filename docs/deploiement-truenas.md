# Déploiement TrueNAS

**Mode par défaut : une seule application.** Le worker (crawl → rédaction → PDF → email) tourne
dans le même processus que le site, piloté par `WORKER_IN_PROCESS=true`. Un conteneur à maintenir,
un seul endroit où mettre les variables, un seul `pull`.

Si vous préférez isoler les deux processus (audits en continu, site qui ne doit jamais ralentir un
rendu PDF), utilisez `docker-compose.split.yml` et laissez `WORKER_IN_PROCESS=false`.

## 1. Mise à jour

```bash
cd /mnt/NVMe/Applications/scanseo
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Un correctif poussé n'est actif qu'après ce `pull` : le conteneur continue de tourner sur l'image
précédente sans prévenir. **Une variable d'environnement modifiée ne s'applique jamais à un
conteneur qui tourne** — il faut recréer le conteneur (`up -d` suffit).

## 2. Variables à ajouter à l'application existante

| Variable | Valeur | Pourquoi |
|---|---|---|
| `WORKER_IN_PROCESS` | `true` | sans elle, la file n'est jamais consommée : un client paie et rien ne se passe |
| `SCAN_API_KEY` | `openssl rand -hex 32` | active `/api/prospect/scan` (scans de démarchage) |

Et **2 Go de mémoire** au lieu de 1 : Chromium (rendu PDF) partage désormais la mémoire du site.

## 3. Vérification (30 secondes)

```bash
curl -s http://192.168.1.200:30023/healthz | python3 -m json.tool
```

Attendu :

```json
{ "worker_last_seen": "2026-10-30T15:0…", "queue": { "pending": 0 } }
```

- `worker_last_seen` reste `null` → `WORKER_IN_PROCESS` n'est pas à `true`, ou le conteneur n'a pas
  été recréé.
- `pending` qui ne descend pas → le worker tourne mais n'écrit pas dans `/data` (droits 568).

Dans `/admin`, le bandeau rouge « Worker silencieux » doit disparaître, et un audit relancé depuis
`/admin/audits` doit passer `running` → `done` en quelques minutes.

## 4. Email

`SMTP_URL` doit pointer sur la boîte **réellement authentifiée**, et `SMTP_FROM` doit être une
adresse autorisée par ce compte (sinon le relais OVH refuse). Le test se fait depuis
**`/admin/system` → « Envoyer un email de test »** : le résultat et l'erreur SMTP s'affichent dans
la page, pas seulement dans les logs.

`mail: "configured"` ne prouve rien : seul un email reçu prouve que la livraison fonctionne.

## 5. Mode isolé (option)

```bash
docker compose -f docker-compose.split.yml pull
docker compose -f docker-compose.split.yml up -d
```

Deux services, deux fois plus de mémoire (1 Go + 1,5 Go), mais un crash d'audit n'affecte que le
worker.
