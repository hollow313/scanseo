# ScanSEO — Guide d'exploitation

- **Build** : `docker compose -f docker-compose.prod.yml build`
- **Run (stack unique)** : `docker compose -f docker-compose.prod.yml up -d`
- **Logs** : `docker compose -f docker-compose.prod.yml logs -f`
- **Update** : `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`
- **Rollback** : `docker compose -f docker-compose.prod.yml down && docker run -d --name scanseo-web ghcr.io/hollow313/scanseo:<sha_precedent>`

---

## Déploiement TrueNAS (deux applications distinctes)

Si vous lancez les services via des applications TrueNAS séparées :

### 1. App Web (`scanseo-web`)
- **Image** : `ghcr.io/hollow313/scanseo:latest`
- **Port** : `192.168.1.200:30023` -> conteneur `3000`
- **Montages obligatoires** (droits `568:568`) :
  - `/mnt/NVMe/Applications/scanseo/data` -> `/data`
  - `/mnt/NVMe/Applications/scanseo/reports` -> `/reports`
  - `/mnt/NVMe/Applications/scanseo/content` -> `/content`
- **Env file** : `/mnt/NVMe/Applications/scanseo/.env`
- **Ressources** : 1 Go RAM

### 2. App Worker (`scanseo-worker`)
- **Image** : `ghcr.io/hollow313/scanseo:latest`
- **Commande** : `node worker.js` (aucun port exposé)
- **Montages obligatoires** (droits `568:568`) :
  - `/mnt/NVMe/Applications/scanseo/data` -> `/data`
  - `/mnt/NVMe/Applications/scanseo/reports` -> `/reports`
- **Env file** : `/mnt/NVMe/Applications/scanseo/.env`
- **Ressources** : 1,5 Go RAM, `shm_size: 256m`
