#!/bin/bash
# Full backup with minimal disk use: stream code into a single .tar.gz and put DB/Redis/migrations in a small data tarball.
# Use when disk space is limited. Run from project root.
# Usage: BACKUP_DIR=/path/to/backups [BACKUP_CODE=1] ./scripts/backup-full-streaming.sh
# Set BACKUP_CODE=0 to skip code archive (data-only). Use DATA_ONLY=1 for same.

set -e
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_ROOT}"
mkdir -p "${BACKUP_DIR}"
DATA_DIR="${BACKUP_DIR}/project_backup_${TIMESTAMP}_data"
mkdir -p "${DATA_DIR}/database" "${DATA_DIR}/migrations/infra_migrations" "${DATA_DIR}/migrations/database_migrations" "${DATA_DIR}/config" "${DATA_DIR}/redis"

echo "=== 1. Database dump ==="
if docker ps --format "{{.Names}}" | grep -q "trading-postgres"; then
  docker exec trading-postgres pg_dump -U postgres -d newpt --format=plain > "${DATA_DIR}/database/newpt_docker.sql" 2>/dev/null || \
  ( docker exec trading-postgres pg_dump -U postgres -d newpt --format=custom -f /tmp/newpt.dump && docker cp trading-postgres:/tmp/newpt.dump "${DATA_DIR}/database/newpt_docker.dump" )
  echo "Database backup done."
else
  echo "Docker Postgres not running; skip DB dump."
fi

echo "=== 2. Migrations copy ==="
cp -r "${PROJECT_ROOT}/infra/migrations/"*.sql "${DATA_DIR}/migrations/infra_migrations/" 2>/dev/null || true
cp -r "${PROJECT_ROOT}/database/migrations/"*.sql "${DATA_DIR}/migrations/database_migrations/" 2>/dev/null || true
cp "${PROJECT_ROOT}/database/"*.sql "${DATA_DIR}/migrations/database_migrations/" 2>/dev/null || true
[ -d "${PROJECT_ROOT}/backend/auth-service/migrations" ] && cp -r "${PROJECT_ROOT}/backend/auth-service/migrations/"*.sql "${DATA_DIR}/migrations/" 2>/dev/null || true
[ -f "${PROJECT_ROOT}/database/schema.sql" ] && cp "${PROJECT_ROOT}/database/schema.sql" "${DATA_DIR}/migrations/" 2>/dev/null || true

echo "=== 3. Redis (optional) ==="
if docker ps --format "{{.Names}}" | grep -q "trading-redis"; then
  docker exec trading-redis redis-cli SAVE 2>/dev/null
  docker cp trading-redis:/data/dump.rdb "${DATA_DIR}/redis/" 2>/dev/null || true
  docker cp trading-redis:/data/appendonly.aof "${DATA_DIR}/redis/" 2>/dev/null || true
fi

echo "=== 4. Config ==="
cp "${PROJECT_ROOT}/infra/docker-compose.yml" "${DATA_DIR}/config/" 2>/dev/null || true
cp "${PROJECT_ROOT}/.env" "${DATA_DIR}/config/" 2>/dev/null || true
cp "${PROJECT_ROOT}/.env.example" "${DATA_DIR}/config/" 2>/dev/null || true

echo "=== 5. Restore README ==="
cat > "${DATA_DIR}/RESTORE_README.md" <<'RESTOREEOF'
# Restore from this backup

- **database/** – Restore: `docker exec -i trading-postgres psql -U postgres -d newpt < database/newpt_docker.sql` (or use pg_restore for .dump)
- **migrations/** – Copy infra_migrations/* to infra/migrations/ and run your migration script; same for database_migrations
- **redis/** – Optional: copy dump.rdb into Redis /data and restart container
- **config/** – Copy .env and docker-compose as needed

For full project restore you also need the _code.tar.gz from the same backup run.
RESTOREEOF

echo "=== 6. Data tarball ==="
tar -czf "${BACKUP_DIR}/project_backup_${TIMESTAMP}_data.tar.gz" -C "${BACKUP_DIR}" "project_backup_${TIMESTAMP}_data"
rm -rf "${DATA_DIR}"
echo "Created: ${BACKUP_DIR}/project_backup_${TIMESTAMP}_data.tar.gz"

BACKUP_CODE="${BACKUP_CODE:-1}"
if [ "${BACKUP_CODE}" = "1" ] && [ "${DATA_ONLY}" != "1" ]; then
  echo "=== 7. Code tarball (streaming, may take a while) ==="
  tar -czf "${BACKUP_DIR}/project_backup_${TIMESTAMP}_code.tar.gz" \
    --exclude=node_modules --exclude=target --exclude=.git \
    -C "${PROJECT_ROOT}" \
    apps backend crates src database infra scripts docs \
    package.json package-lock.json Cargo.toml Cargo.lock index.html tsconfig.json tsconfig.node.json \
    vite.config.ts README.md .env.example \
    $(ls "${PROJECT_ROOT}"/*.md 2>/dev/null || true) 2>/dev/null || true
  echo "Created: ${BACKUP_DIR}/project_backup_${TIMESTAMP}_code.tar.gz"
fi

echo "Done. Restore: extract _data and _code tarballs; restore DB from database/newpt_docker.sql; apply migrations; start services."
