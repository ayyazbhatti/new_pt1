#!/usr/bin/env bash
# Run on the Hetzner server (Ubuntu). Sets up Docker and deploys the app.
# Usage: copy this file and run: bash setup-and-deploy.sh
# Or: curl -sSL <url> | bash
# Requires: REPO_URL and BRANCH env vars, or run from existing clone.

set -e
export DEBIAN_FRONTEND=noninteractive

REPO_URL="${REPO_URL:-https://github.com/ayyazbhatti/new_pt1.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/newpt}"

echo "==> Installing Docker..."
apt-get update -qq
apt-get install -y -qq ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME:-jammy}") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Cloning repo..."
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git fetch origin "$BRANCH" && git reset --hard "origin/$BRANCH" && cd - > /dev/null
else
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo "==> Creating production env..."
if [ ! -f deploy/.env.production ]; then
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -base64 24)}"
  JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"
  echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" > deploy/.env.production
  echo "JWT_SECRET=$JWT_SECRET" >> deploy/.env.production
  echo "JWT_ISSUER=${JWT_ISSUER:-newpt}" >> deploy/.env.production
  echo "  Generated secrets saved in deploy/.env.production (keep a backup)."
fi

echo "==> Building and starting..."
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production build --no-cache 2>/dev/null || docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production build
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d

echo ""
echo "==> Deploy complete. App should be on http://$(curl -sS --max-time 2 169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}'):80"
echo "    To view logs: docker compose -f deploy/docker-compose.prod.yml logs -f"
