#!/usr/bin/env bash
# Import all data (and schema) from local Docker Postgres to the server.
# Run from repo root. Requires: local Docker with Postgres (default: newpt-postgres), SSH to server.
#
# WARNING: This REPLACES the server database with a clone of your local DB.
# Server IP is set below; override with IMPORT_SERVER=ip if needed.
# Non-interactive: IMPORT_DB_CONFIRM=yes

set -e
LOCAL_CONTAINER="${LOCAL_POSTGRES_CONTAINER:-newpt-postgres}"
SERVER_IP="${IMPORT_SERVER:-178.104.63.176}"
SERVER_CONTAINER="${SERVER_POSTGRES_CONTAINER:-deploy-postgres-1}"
DUMP_FILE="${DUMP_FILE:-./newpt_dump.dump}"

echo "=== Import local DB to server ==="
echo "Local container: $LOCAL_CONTAINER"
echo "Server: root@$SERVER_IP (Postgres container: $SERVER_CONTAINER)"
echo "This will REPLACE the server database with your local DB."
if [[ "${IMPORT_DB_CONFIRM:-}" != "yes" ]]; then
  read -p "Continue? (y/N) " -n 1 -r
  echo
  if [[ ! "$REPLY" =~ ^[yY]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "[1/5] Dumping local database (newpt)..."
docker exec "$LOCAL_CONTAINER" pg_dump -U postgres -d newpt -Fc -f /tmp/newpt_dump.dump
docker cp "$LOCAL_CONTAINER:/tmp/newpt_dump.dump" "$DUMP_FILE"
docker exec "$LOCAL_CONTAINER" rm -f /tmp/newpt_dump.dump

echo "[2/5] Copying dump to server..."
scp "$DUMP_FILE" "root@${SERVER_IP}:/tmp/newpt_dump.dump"

echo "[3/5] Stopping DB clients, replacing server database, starting apps..."
# auth + core-api hold pooled connections; DROP DATABASE fails unless they are stopped first.
ssh "root@${SERVER_IP}" "export SERVER_CONTAINER='${SERVER_CONTAINER}'; bash -s" <<'REMOTE'
set -e
SC="$SERVER_CONTAINER"
cd /opt/newpt/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production stop auth core-api
sleep 3
docker cp /tmp/newpt_dump.dump "${SC}:/tmp/newpt_dump.dump"
docker exec "$SC" psql -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'newpt' AND pid <> pg_backend_pid();" 2>/dev/null || true
sleep 1
docker exec "$SC" psql -U postgres -d postgres -c 'DROP DATABASE IF EXISTS newpt;'
docker exec "$SC" psql -U postgres -d postgres -c 'CREATE DATABASE newpt;'
set +e
docker exec "$SC" pg_restore -U postgres -d newpt --no-owner --no-privileges /tmp/newpt_dump.dump
RV=$?
set -e
# pg_restore often exits 1 for harmless notices (e.g. role "postgres" already exists)
if [ "$RV" -ne 0 ] && [ "$RV" -ne 1 ]; then exit "$RV"; fi
docker exec "$SC" rm -f /tmp/newpt_dump.dump
rm -f /tmp/newpt_dump.dump
docker compose -f docker-compose.prod.yml --env-file .env.production up -d auth core-api
REMOTE

echo "[4/5] Cleaning up local dump file..."
rm -f "$DUMP_FILE"

echo "[5/5] Restarting other app services on server (refresh caches)..."
ssh "root@${SERVER_IP}" "cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml --env-file .env.production restart order-engine data-provider"

echo "Done. Server database is now a full copy of your local DB."
