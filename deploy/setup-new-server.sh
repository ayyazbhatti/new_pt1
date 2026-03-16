#!/bin/bash
# One-time setup for new Hetzner server (178.104.63.176).
# Run as root: sudo bash deploy/setup-new-server.sh
# Prerequisite: repo must be at /opt/newpt (e.g. rsync from your Mac first).

set -e
NEW_IP="178.104.63.176"

echo "=== 1. Install Docker ==="
if ! command -v docker &>/dev/null; then
  apt-get update && apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod 644 /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update && apt-get install -y docker-ce docker-ce-cli docker-compose-plugin
else
  echo "Docker already installed."
fi

echo "=== 2. Find and mount 500 GB volume ==="
# Find a block device that's not the root disk (e.g. sda1 is root, sdb is volume)
VOL_DEV=""
for d in /dev/sdb /dev/sdc; do
  if [ -b "$d" ] && ! mount | grep -q "^$d"; then
    VOL_DEV="$d"
    break
  fi
done
if [ -z "$VOL_DEV" ]; then
  echo "No unused block device found. lsblk:"
  lsblk
  exit 1
fi

if ! mountpoint -q /mnt/data500 2>/dev/null; then
  if ! blkid "$VOL_DEV" | grep -q ext4; then
    echo "Formatting $VOL_DEV..."
    mkfs.ext4 -L data500 "$VOL_DEV"
  fi
  mkdir -p /mnt/data500
  mount "$VOL_DEV" /mnt/data500
  if ! grep -q /mnt/data500 /etc/fstab; then
    UUID=$(blkid -s UUID -o value "$VOL_DEV")
    echo "UUID=$UUID /mnt/data500 ext4 defaults,nofail 0 2" >> /etc/fstab
  fi
  echo "Mounted $VOL_DEV at /mnt/data500"
else
  echo "/mnt/data500 already mounted."
fi

echo "=== 3. Put Docker on the volume ==="
if [ ! -L /var/lib/docker ] || [ ! -d /mnt/data500/docker ]; then
  systemctl stop docker 2>/dev/null || true
  if [ -d /var/lib/docker ] && [ ! -L /var/lib/docker ]; then
    mv /var/lib/docker /mnt/data500/docker 2>/dev/null || true
  fi
  mkdir -p /mnt/data500/docker
  ln -sfn /mnt/data500/docker /var/lib/docker
  systemctl start docker
  echo "Docker data is on /mnt/data500/docker"
else
  echo "Docker already using volume."
  systemctl start docker 2>/dev/null || true
fi

echo "=== 4. Create .env.production (same secrets as old server) ==="
REPO_DIR="/opt/newpt"
if [ ! -f "$REPO_DIR/deploy/docker-compose.prod.yml" ]; then
  echo "ERROR: Repo not found at $REPO_DIR. Copy the repo first, e.g.:"
  echo "  rsync -avz --exclude node_modules --exclude target --exclude .git /Users/mab/new_pt1/ root@$NEW_IP:/opt/newpt/"
  exit 1
fi

ENV_FILE="$REPO_DIR/deploy/.env.production"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << 'ENVEOF'
POSTGRES_PASSWORD=GbAHSe6SM8MXkgUCKiiWWnTO3XiHHCxh
JWT_SECRET=X/ll3fkr8u6BLDjarbsAHbbiNAI5AoeMpd3Fhdq9ocI=
JWT_ISSUER=newpt
CORS_ORIGINS=http://178.104.63.176
ENVEOF
  echo "Created $ENV_FILE with CORS_ORIGINS=http://$NEW_IP"
else
  if ! grep -q "CORS_ORIGINS" "$ENV_FILE"; then
    echo "CORS_ORIGINS=http://$NEW_IP" >> "$ENV_FILE"
    echo "Appended CORS_ORIGINS to $ENV_FILE"
  fi
fi

echo "=== 5. Build and start the app ==="
cd "$REPO_DIR"
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production build
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d

echo ""
echo "=== Done. Open http://$NEW_IP and test login. ==="
docker ps --format "table {{.Names}}\t{{.Status}}"
