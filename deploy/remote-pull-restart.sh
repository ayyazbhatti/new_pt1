#!/usr/bin/env bash
# Run ON THE SERVER after SSH login (or: ssh user@host 'bash -s' < deploy/remote-pull-restart.sh)
#
# Syncs latest code when this directory is a git clone; if not, push code from your laptop first, e.g.:
#   rsync -avz --exclude node_modules --exclude target --exclude .git ./ root@SERVER:/opt/newpt/
#
# Rebuilds auth (shared backend image) + frontend, recreates the full stack.
# If you only changed SQL, run migrations first:
#   cd deploy && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrations
#
# Usage on server:
#   cd /opt/newpt   # or your clone path
#   export APP_DIR=/opt/newpt
#   bash deploy/remote-pull-restart.sh
#
set -euo pipefail
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$APP_DIR"

COMPOSE=(docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production)

if [[ ! -f deploy/.env.production ]]; then
  echo "Missing deploy/.env.production — create it first (see deploy/.env.production.example)"
  exit 1
fi

if [[ -d .git ]]; then
  echo "==> git pull"
  git pull --ff-only origin main 2>/dev/null || git pull --ff-only
else
  echo "==> no .git in $APP_DIR — skipping git pull (rsync or clone from your machine first)"
fi

echo "==> build (backend image + frontend)"
"${COMPOSE[@]}" build auth frontend

echo "==> up -d (recreate stack)"
"${COMPOSE[@]}" up -d

echo "==> done. Quick check:"
"${COMPOSE[@]}" ps
echo ""
echo "Logs: ${COMPOSE[*]} logs -f --tail=50 auth"
