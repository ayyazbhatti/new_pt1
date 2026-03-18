#!/usr/bin/env bash
# Sync code to server and rebuild/redeploy the frontend container only.
# Run from repo root. Server: set NEWPT_SERVER (default root@178.104.63.176)
#
# Usage: ./deploy/rebuild-frontend.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NEWPT_SERVER="${NEWPT_SERVER:-root@178.104.63.176}"

echo "Syncing code to server..."
rsync -avz --exclude '.git' --exclude 'node_modules' --exclude 'target' --exclude '**/target' \
  --exclude 'deploy/.env.production' --exclude '.cursor' \
  "$REPO_ROOT/" "$NEWPT_SERVER:/opt/newpt/"

echo "Building and redeploying frontend on server..."
ssh "$NEWPT_SERVER" "cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml --env-file .env.production build --no-cache frontend && docker compose -f docker-compose.prod.yml --env-file .env.production up -d frontend"

echo "Done. Frontend is running with the new build."
