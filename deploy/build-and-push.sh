#!/usr/bin/env bash
# Build auth (Rust) and frontend images locally, then push to a container registry.
# Server then only runs: pull + up (no build, deploy in ~30–60 seconds).
#
# One-time: create a registry and log in:
#   Docker Hub:  docker login
#   GHCR:        echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
#
# Usage:
#   export REGISTRY=docker.io/YOUR_USERNAME   # or ghcr.io/owner/repo
#   ./deploy/build-and-push.sh
#
# Then on the server (with same REGISTRY in .env or export):
#   cd /opt/newpt/deploy
#   docker compose -f docker-compose.prod.yml -f docker-compose.registry.yml pull
#   docker compose -f docker-compose.prod.yml -f docker-compose.registry.yml up -d

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -z "$REGISTRY" ]; then
  echo "ERROR: Set REGISTRY (e.g. export REGISTRY=docker.io/YOUR_USERNAME or ghcr.io/owner/repo)"
  exit 1
fi

# Strip trailing slash
REGISTRY="${REGISTRY%/}"
AUTH_IMAGE="${REGISTRY}/newpt-auth:latest"
FRONTEND_IMAGE="${REGISTRY}/newpt-frontend:latest"

echo "Building backend (auth) image locally..."
docker build -f deploy/Dockerfile.backend -t newpt-auth:latest -t "$AUTH_IMAGE" .

echo "Building frontend image locally..."
docker build -f deploy/Dockerfile.frontend -t deploy-frontend:latest -t "$FRONTEND_IMAGE" .

echo "Pushing $AUTH_IMAGE ..."
docker push "$AUTH_IMAGE"
echo "Pushing $FRONTEND_IMAGE ..."
docker push "$FRONTEND_IMAGE"

echo "Done. On the server run:"
echo "  export REGISTRY=$REGISTRY"
echo "  cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml -f docker-compose.registry.yml pull"
echo "  docker compose -f docker-compose.prod.yml -f docker-compose.registry.yml up -d"
