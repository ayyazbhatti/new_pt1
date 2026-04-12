#!/usr/bin/env bash
# Sync code to server and rebuild/redeploy the frontend container only.
# Run from repo root. Server: set NEWPT_SERVER (default root@178.104.63.176)
#
# Usage: ./deploy/rebuild-frontend.sh
#
# If the server cannot pull from Docker Hub (TLS timeout, etc.), build the image
# locally and push it as a tarball. The production host is linux/amd64 (e.g. Hetzner);
# on Apple Silicon you must use this path or the container will fail with
# "exec format error" on the server.
#
#   NEWPT_LOCAL_AMD64=1 ./deploy/rebuild-frontend.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NEWPT_SERVER="${NEWPT_SERVER:-root@178.104.63.176}"

if [[ "${NEWPT_LOCAL_AMD64:-}" == "1" ]]; then
  echo "Building deploy-frontend:latest for linux/amd64 (local Docker)..."
  docker buildx build --platform linux/amd64 -f deploy/Dockerfile.frontend -t deploy-frontend:latest --load .
  TAR="/tmp/deploy-frontend-amd64-$$.tar.gz"
  docker save deploy-frontend:latest | gzip -1 >"$TAR"
  echo "Copying image to server..."
  scp "$TAR" "$NEWPT_SERVER:/tmp/deploy-frontend-amd64.tar.gz"
  rm -f "$TAR"
  echo "Loading image and restarting frontend..."
  ssh "$NEWPT_SERVER" "gunzip -c /tmp/deploy-frontend-amd64.tar.gz | docker load && rm -f /tmp/deploy-frontend-amd64.tar.gz && cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate frontend; docker start deploy-frontend-1"
  echo "Done. Frontend image loaded and container started."
  exit 0
fi

echo "Syncing code to server..."
rsync -avz --exclude '.git' --exclude 'node_modules' --exclude 'target' --exclude '**/target' \
  --exclude 'deploy/.env.production' --exclude '.cursor' \
  "$REPO_ROOT/" "$NEWPT_SERVER:/opt/newpt/"

echo "Building and redeploying frontend on server..."
ssh "$NEWPT_SERVER" "cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml --env-file .env.production build --no-cache frontend && docker compose -f docker-compose.prod.yml --env-file .env.production up -d frontend"

echo "Done. Frontend is running with the new build."
