# ScanSEO — Guide d'exploitation

- **Build** : `docker compose -f docker-compose.prod.yml build`
- **Run** : `docker compose -f docker-compose.prod.yml up -d`
- **Logs** : `docker compose -f docker-compose.prod.yml logs -f`
- **Update** : `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`
- **Rollback** : `docker compose -f docker-compose.prod.yml down && docker run -d --name scanseo-web ghcr.io/hollow313/scanseo:<sha_precedent>`
