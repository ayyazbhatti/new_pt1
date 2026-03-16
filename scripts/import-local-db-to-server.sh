#!/usr/bin/env bash
# Import all data (and schema) from local Docker Postgres to the server.
# Run from repo root. Requires: local Docker with trading-postgres, SSH to server.
#
# WARNING: This REPLACES the server database with a clone of your local DB.
# Server IP is set below; override with IMPORT_SERVER=ip if needed.

set -e
LOCAL_CONTAINER="${LOCAL_POSTGRES_CONTAINER:-trading-postgres}"
SERVER_IP="${IMPORT_SERVER:-178.104.63.176}"
SERVER_CONTAINER="${SERVER_POSTGRES_CONTAINER:-deploy-postgres-1}"
DUMP_FILE="${DUMP_FILE:-./newpt_dump.dump}"

echo "=== Import local DB to server ==="
echo "Local container: $LOCAL_CONTAINER"
echo "Server: root@$SERVER_IP (Postgres container: $SERVER_CONTAINER)"
echo "This will REPLACE the server database with your local DB."
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! "$REPLY" =~ ^[yY]$ ]]; then
  echo "Aborted."
  exit 1
fi

echo "[1/5] Dumping local database (newpt)..."
docker exec "$LOCAL_CONTAINER" pg_dump -U postgres -d newpt -Fc -f /tmp/newpt_dump.dump
docker cp "$LOCAL_CONTAINER:/tmp/newpt_dump.dump" "$DUMP_FILE"
docker exec "$LOCAL_CONTAINER" rm -f /tmp/newpt_dump.dump

echo "[2/5] Copying dump to server..."
scp "$DUMP_FILE" "root@${SERVER_IP}:/tmp/newpt_dump.dump"

echo "[3/5] Replacing server database (drop + create + restore)..."
ssh "root@${SERVER_IP}" "docker cp /tmp/newpt_dump.dump ${SERVER_CONTAINER}:/tmp/newpt_dump.dump && \
  docker exec ${SERVER_CONTAINER} psql -U postgres -d postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'newpt' AND pid <> pg_backend_pid();\" 2>/dev/null || true && \
  docker exec ${SERVER_CONTAINER} psql -U postgres -d postgres -c 'DROP DATABASE IF EXISTS newpt;' && \
  docker exec ${SERVER_CONTAINER} psql -U postgres -d postgres -c 'CREATE DATABASE newpt;' && \
  docker exec ${SERVER_CONTAINER} pg_restore -U postgres -d newpt --no-owner --no-privileges /tmp/newpt_dump.dump || true"
# pg_restore can exit 1 for harmless errors (e.g. role not found)

echo "[4/5] Cleaning up..."
ssh "root@${SERVER_IP}" "docker exec ${SERVER_CONTAINER} rm -f /tmp/newpt_dump.dump; rm -f /tmp/newpt_dump.dump"
rm -f "$DUMP_FILE"

echo "[5/5] Restarting auth and core-api on server..."
ssh "root@${SERVER_IP}" "cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml restart auth core-api"

echo "Done. Server database is now a full copy of your local DB."
