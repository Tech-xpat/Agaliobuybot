#!/usr/bin/env bash
# Dumps the PostgreSQL database from the compose stack into ./backups/
set -euo pipefail
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/agalio-$STAMP.dump"
echo "Backup written to backups/agalio-$STAMP.dump"
find backups -name 'agalio-*.dump' -mtime +14 -delete
