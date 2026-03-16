#!/bin/bash
# Double-click this file to import your local database to the server.
# It will open Terminal, run the import, and tell you when it's done.

cd "$(dirname "$0")/.." || exit 1
echo "=============================================="
echo "  Import local database to server"
echo "=============================================="
echo ""
echo "This will copy your LOCAL database to the SERVER (replacing server data)."
echo ""

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running. Please open Docker Desktop and try again."
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

# Check local Postgres container exists
if ! docker ps -a --format '{{.Names}}' | grep -q 'trading-postgres'; then
  echo "ERROR: Local database container 'trading-postgres' not found."
  echo "Please start it first: open Terminal, run:"
  echo "  cd $(pwd)/infra && docker compose up -d"
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

echo "Type y and press Enter to continue, or anything else to cancel."
read -p "Continue? (y/N) " -r
echo
if [[ ! "$REPLY" =~ ^[yY]$ ]]; then
  echo "Cancelled."
  read -p "Press Enter to close..."
  exit 0
fi

echo ""
echo "[1/4] Dumping local database..."
docker exec trading-postgres pg_dump -U postgres -d newpt -Fc -f /tmp/newpt_dump.dump || { echo "Dump failed."; read -p "Press Enter to close..."; exit 1; }
docker cp trading-postgres:/tmp/newpt_dump.dump ./newpt_dump.dump || { echo "Copy from container failed."; read -p "Press Enter to close..."; exit 1; }
docker exec trading-postgres rm -f /tmp/newpt_dump.dump

echo "[2/4] Copying dump to server..."
scp -o ConnectTimeout=10 ./newpt_dump.dump root@178.104.63.176:/tmp/newpt_dump.dump || { echo "Copy to server failed. Check SSH (e.g. ssh root@178.104.63.176)."; rm -f ./newpt_dump.dump; read -p "Press Enter to close..."; exit 1; }

echo "[3/4] Restoring on server..."
ssh root@178.104.63.176 "docker cp /tmp/newpt_dump.dump deploy-postgres-1:/tmp/newpt_dump.dump && docker exec deploy-postgres-1 pg_restore -U postgres -d newpt --clean --if-exists --no-owner --no-privileges /tmp/newpt_dump.dump || true"
ssh root@178.104.63.176 "docker exec deploy-postgres-1 rm -f /tmp/newpt_dump.dump; rm -f /tmp/newpt_dump.dump"

echo "[4/4] Restarting auth on server..."
ssh root@178.104.63.176 "cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml restart auth core-api"

rm -f ./newpt_dump.dump
echo ""
echo "=============================================="
echo "  Done! Your local database is now on the server."
echo "=============================================="
echo ""
read -p "Press Enter to close this window..."
