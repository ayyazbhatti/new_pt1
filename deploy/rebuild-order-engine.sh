#!/usr/bin/env bash
# One-command rebuild and redeploy of order-engine (no registry needed).
# Syncs code to server, builds there, restarts order-engine. Run from repo root.
#
# Usage: ./deploy/rebuild-order-engine.sh
# Server: set NEWPT_SERVER (default root@178.104.63.176)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NEWPT_SERVER="${NEWPT_SERVER:-root@178.104.63.176}"

echo "Syncing code to server..."
rsync -avz --exclude '.git' --exclude 'node_modules' --exclude 'target' --exclude '**/target' \
  --exclude 'deploy/.env.production' --exclude '.cursor' \
  "$REPO_ROOT/" "$NEWPT_SERVER:/opt/newpt/"

echo "Building and redeploying order-engine on server (this may take 10–15 min)..."
ssh "$NEWPT_SERVER" "cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml --env-file .env.production build --no-cache order-engine && docker compose -f docker-compose.prod.yml --env-file .env.production up -d order-engine"

echo "Done. order-engine is running with the new image."
