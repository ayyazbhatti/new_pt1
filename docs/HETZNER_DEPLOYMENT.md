# Deploying to Hetzner

This doc lists what we need from you (fresh Hetzner account) and the deployment options.

---

## Credentials (save securely)

| What | Value |
|------|--------|
| **Server IP** | `178.104.63.176` |
| **SSH** | `ssh root@178.104.63.176` |
| **Root password** | *(set by you; or use SSH key)* |
| **App URL (once running)** | http://178.104.63.176 |
| **Postgres password (production)** | `GbAHSe6SM8MXkgUCKiiWWnTO3XiHHCxh` |
| **JWT_SECRET (production)** | `X/ll3fkr8u6BLDjarbsAHbbiNAI5AoeMpd3Fhdq9ocI=` |

These are stored on the server in `/opt/newpt/deploy/.env.production`. **Revoke any Hetzner API token you shared in chat** and add your SSH key in the Hetzner Console so you can log in without the password.

---

## Your server (created)

| Item | Value |
|------|--------|
| **Name** | newpt-trading |
| **Public IP** | `178.104.49.76` |
| **Location** | Nuremberg (nbg1-dc3) |
| **Type** | CPX 22 (2 vCPU, 4 GB RAM, 80 GB disk) |
| **Image** | Ubuntu 24.04 |
| **Root password** | Shown once in the API response when the server was created — **save it somewhere secure**. If you did not save it, set a new password via Hetzner Console → Server → Rescue → Linux console, or add an SSH key and use that to log in. |

**Important:** Add your SSH key in [Hetzner Cloud Console](https://console.hetzner.cloud) → your project → Security → SSH Keys, then attach it to the server (or rebuild with the key) so you can log in as `root@178.104.49.76` without the password. **Revoke the API token you shared** and create a new one in the console; the old token was exposed in chat.

**First login:** Hetzner often requires a password change on first login. Connect once with `ssh root@178.104.49.76`, enter the root password above when prompted, then set a new password when asked. After that you can run the deploy script or use SSH keys.

---

## New server (newpt) — 8 vCPU, 32 GB RAM, 740 GB

| Item | Value |
|------|--------|
| **Name** | newpt |
| **Public IP** | `178.104.63.176` |
| **Type** | CCX33 (8 vCPU, 32 GB RAM, 240 GB local + 500 GB Volume) |
| **Total storage** | 740 GB |
| **App URL (once deployed)** | http://178.104.63.176 |

**Setup:** SSH as root (`ssh root@178.104.63.176`), then follow the **Replace server** section below (install Docker, mount 500 GB volume, copy repo, create `.env.production` with `CORS_ORIGINS=http://178.104.63.176`, then build and `up -d`).

---

## Deploy from local build (fast server deploy)

Building images on the server (especially the Rust auth service) can take 10–15+ minutes. You can **build on your machine** (or CI), push to a container registry, and have the server **only pull and run** — deploy in about **30–60 seconds**.

### One-time setup

1. **Create a container registry** (if you don’t have one):
   - [Docker Hub](https://hub.docker.com): create account, then `docker login`
   - Or [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry): use a personal access token and `docker login ghcr.io -u USERNAME --password-stdin`

2. **Choose a registry prefix** (examples):
   - Docker Hub: `docker.io/YOUR_DOCKERHUB_USERNAME`
   - GHCR: `ghcr.io/YOUR_GITHUB_USERNAME/newpt`

### Build and push (on your machine)

From the repo root:

```bash
export REGISTRY=docker.io/YOUR_USERNAME   # or ghcr.io/owner/repo
chmod +x deploy/build-and-push.sh
./deploy/build-and-push.sh
```

This builds the backend (auth) and frontend images locally, tags them as `$REGISTRY/newpt-auth:latest` and `$REGISTRY/newpt-frontend:latest`, and pushes them. The first run may take 10–20 minutes (Rust build); later runs are faster if only frontend or small backend changes.

### Deploy on the server (pull and run)

On the server (e.g. SSH into 178.104.63.176):

```bash
cd /opt/newpt/deploy
export REGISTRY=docker.io/YOUR_USERNAME   # same as above; or add to .env.production
docker compose -f docker-compose.prod.yml -f docker-compose.registry.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml -f docker-compose.registry.yml --env-file .env.production up -d
```

Migrations, Postgres, Redis, NATS, and other config are unchanged; only the auth and frontend (and other backend services that share the same image) are updated from the registry. No build runs on the server.

**Tip:** Put `REGISTRY=...` in `.env.production` so you don’t need to export it each time (ensure it’s not committed if the repo is public).

---

## Rebuild and redeploy order-engine only

Use this after order-engine code changes (e.g. JetStream acks, tick fallback). The backend image includes order-engine, auth, ws-gateway, data-provider, and core-api; rebuilding updates the whole image.

### Option A – Build on the server (no registry)

Sync the repo to the server (e.g. `git pull` or rsync), then on the server:

```bash
cd /opt/newpt
git pull origin main   # or however you update the repo
cd deploy
docker compose -f docker-compose.prod.yml --env-file .env.production build --no-cache order-engine
docker compose -f docker-compose.prod.yml --env-file .env.production up -d order-engine
```

Build can take 10–15+ minutes. Only the `order-engine` service is recreated; others keep running.

### Option B – Build locally, then deploy on server

From the repo root on your machine:

```bash
docker compose -f deploy/docker-compose.prod.yml build --no-cache order-engine
```

Then either push the image to your registry and on the server run pull + up (see “Deploy from local build” above), or rsync the repo to the server and run the Option A commands there.

---

## Domain: pt.interwarepvt.com (Hostinger)

The app is reachable at **http://pt.interwarepvt.com** (subdomain on Hostinger, domain interwarepvt.com).

### What was done

1. **DNS (in Hostinger)**  
   - In Hostinger → **Domains** → **interwarepvt.com** → **DNS Zone Editor** (under **Advanced**).  
   - **A record** for subdomain `pt`:  
     - **Name:** `pt` (host: `pt.interwarepvt.com`).  
     - **Points to:** `178.104.63.176`.  
     - Only one A record for `pt`; remove any duplicate pointing to another IP.  
   - CDN must be disabled for the domain to add A records (if you see “Cannot add A record when CDN is enabled”).

2. **Server**  
   - `CORS_ORIGINS` in `/opt/newpt/deploy/.env.production` includes `http://pt.interwarepvt.com` (and the IP) so login and API work from the domain.  
   - Restart auth after changing:  
     `docker compose -f docker-compose.prod.yml --env-file .env.production restart auth`

### App URL

| URL |
|-----|
| http://178.104.63.176 |
| http://pt.interwarepvt.com |

---

## SSL (HTTPS) with Let's Encrypt

You can serve the app over **HTTPS** using free certificates from [Let's Encrypt](https://letsencrypt.org/). The domain must already point to your server (e.g. **ptf.interwarepvt.com** or **pt.interwarepvt.com** → `178.104.63.176`).

### Overview

1. **Host nginx** listens on 80 and 443; **Docker frontend** listens on another port (e.g. 8080) so it doesn’t conflict.
2. **Certbot** obtains and renews Let’s Encrypt certificates for your domain.
3. Host nginx terminates SSL and proxies to the Docker frontend; HTTP is redirected to HTTPS.
4. **CORS** is updated so the auth service allows the `https://` origin.

### One-time setup (on the server)

Use your actual domain (e.g. `ptf.interwarepvt.com`) everywhere below.

**1. Move Docker frontend off port 80**

Edit `/opt/newpt/deploy/docker-compose.prod.yml` and change the frontend `ports` from `"80:80"` to `"8080:80"` so the app is on 8080 on the host. Then:

```bash
cd /opt/newpt/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate frontend
```

**2. Install nginx and Certbot (Ubuntu/Debian)**

```bash
apt-get update && apt-get install -y nginx certbot python3-certbot-nginx
```

**3. Get a certificate**

```bash
certbot certonly --standalone -d ptf.interwarepvt.com --non-interactive --agree-tos -m YOUR_EMAIL@example.com
```

Use a real email for renewal notices. If port 80 is in use, stop nginx first: `systemctl stop nginx`, run certbot, then continue.

Certificates will be in `/etc/letsencrypt/live/ptf.interwarepvt.com/` (fullchain.pem, privkey.pem).

**4. Configure nginx as HTTPS reverse proxy**

Create (or replace) the default site, e.g.:

```bash
cat > /etc/nginx/sites-available/ptf << 'EOF'
server {
    listen 80;
    server_name ptf.interwarepvt.com;
    return 301 https://$server_name$request_uri;
}
server {
    listen 443 ssl;
    server_name ptf.interwarepvt.com;
    ssl_certificate     /etc/letsencrypt/live/ptf.interwarepvt.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ptf.interwarepvt.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/ptf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

**5. Allow CORS for HTTPS**

Edit `/opt/newpt/deploy/.env.production` and add the HTTPS URL to `CORS_ORIGINS`, e.g.:

```bash
CORS_ORIGINS=http://178.104.63.176,http://ptf.interwarepvt.com,https://ptf.interwarepvt.com
```

Then restart auth:

```bash
cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml --env-file .env.production restart auth
```

**6. Auto-renew certificates**

Certbot installs a timer. Test renewal:

```bash
certbot renew --dry-run
```

After renewal, reload nginx so it picks up new certs:

```bash
systemctl reload nginx
```

You can add a renew hook so nginx reloads automatically (e.g. in `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` with `systemctl reload nginx`).

### Result

- **https://ptf.interwarepvt.com** serves the app over SSL.
- **http://ptf.interwarepvt.com** redirects to HTTPS.
- Login and API work with the HTTPS origin once it’s in `CORS_ORIGINS`.

### Multiple domains

Repeat the cert and nginx server blocks for each domain (e.g. pt.interwarepvt.com and ptf.interwarepvt.com), and add each `https://` URL to `CORS_ORIGINS`.

---

## Vertical scaling (Rescale): more CPU/RAM, same server

Use this to **upgrade to a bigger plan** (e.g. CCX33 → CCX43) without moving to a new machine. **IP and data stay the same.** Downtime: a few minutes while the server powers off, rescales, and boots.

### Upgrade (try bigger server)

1. Open [Hetzner Cloud Console](https://console.hetzner.cloud) → your project → **Servers** → select **newpt** (178.104.63.176).
2. In the left sidebar, click **Rescale**.
3. **Power off** the server (green power switch → turn OFF). Rescale only works when the server is off.
4. Choose upgrade type:
   - **CPU and RAM only** – Keeps your current disk layout (240 GB + 500 GB Volume). **You can downgrade back to CCX33 later** if you want to revert.
   - Or a **full plan change** (e.g. CCX43 with 360 GB disk) – more disk, but downgrade options may be limited; check the console.
5. Select the new plan, e.g. **CCX43** (16 vCPU, 64 GB RAM). That doubles CPU/RAM and should cut your CPU % roughly in half for the same workload.
6. Click the red **Rescale** button. The server will resize and then start automatically.
7. Wait until the server is **Running** again (same IP). If you have a **Volume** attached, it should still be attached; if not, reattach it in **Volumes** and mount it again on the server if needed (see “Expand disk” for mount commands).
8. SSH back in and bring the app up if it didn’t start on boot:  
   `ssh root@178.104.63.176` then  
   `cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml --env-file .env.production up -d`

### Revert (downgrade back to CCX33)

Only possible if you chose **“CPU and RAM only”** when upgrading.

1. Console → **Servers** → **newpt** → **Rescale**.
2. **Power off** the server.
3. Select **CCX33** (8 vCPU, 32 GB RAM).
4. Click **Rescale**. Server will resize and start again with the same IP and data.

---

## Expanding disk (e.g. add 500 GB)

The root disk (80 GB on CPX 22) **cannot be resized in-place** on Hetzner Cloud. To get more space (e.g. 500 GB), add a **Volume** and use it for data (Docker, logs, etc.).

### 1. Create and attach the Volume (Hetzner Console)

1. Open [Hetzner Cloud Console](https://console.hetzner.cloud) → your project → **Volumes**.
2. Click **Add Volume**.
3. **Size:** e.g. **500 GB** (10 GB–10 TB in 1 GB steps).
4. **Location:** same as the server (e.g. Nuremberg).
5. **Attach to:** select server **newpt-trading** (178.104.49.76).
6. **Mounting:** choose **Manual** (we format and mount it ourselves so we can use it for Docker).
7. Create the volume.

### 2. Format and mount on the server

SSH in, then run (replace `/dev/sdb` with the actual device if different — check with `lsblk`):

```bash
# See the new block device (usually sdb)
lsblk

# Format (only once; this wipes the device)
mkfs.ext4 -L data500 /dev/sdb

# Create mount point and mount
mkdir -p /mnt/data500
mount /dev/sdb /mnt/data500

# Add to fstab so it mounts on reboot (use the UUID)
UUID=$(blkid -s UUID -o value /dev/sdb)
echo "UUID=$UUID /mnt/data500 ext4 defaults,nofail 0 2" >> /etc/fstab
```

### 3. Move Docker data to the new disk (optional, frees root)

This moves Docker’s data to the 500 GB volume so images/containers use the new space:

```bash
# Stop containers
cd /opt/newpt && docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production down

# Move Docker data to the volume
systemctl stop docker
mv /var/lib/docker /mnt/data500/docker
ln -s /mnt/data500/docker /var/lib/docker
systemctl start docker

# Start the app again
cd /opt/newpt && docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d
```

After this, `df -h` should show the 500 GB volume at `/mnt/data500` (and Docker will use it via the symlink). You can also put app logs or other data on `/mnt/data500`.

---

## Replace server: new machine with 500 GB+ and higher resources

If you want to **delete the current server** and create a **new one** with more CPU/RAM and at least 500 GB space, do the following in the [Hetzner Cloud Console](https://console.hetzner.cloud). (Hetzner Cloud does not offer a single 500 GB root disk; you use a normal server + a 500 GB Volume.)

### 1. Save these before deleting the old server

- **Secrets** (from current server or your notes): `JWT_SECRET`, `POSTGRES_PASSWORD` (in `deploy/.env.production`). If you don’t have a copy, SSH to the old server and run: `grep -E 'JWT_SECRET|POSTGRES_PASSWORD' /opt/newpt/deploy/.env.production` and save the output.
- **Repo** is already on your machine; no need to copy code.

### 2. Delete the current server (optional)

- Console → **Servers** → select **newpt-trading** (178.104.49.76) → **Delete**.
- If you have a **Volume** attached (e.g. the 300 GB one), choose whether to delete it or detach and attach to the new server later. Deleting the server does not auto-delete Volumes.

### 3. Create a new server with more resources

- Console → **Servers** → **Add Server**.
- **Location:** e.g. Nuremberg (same as before).
- **Image:** Ubuntu 24.04.
- **Type:** pick a larger type if you want more power, e.g.:
  - **CPX 31** – 4 vCPU, 8 GB RAM, 160 GB disk (~€18/mo)
  - **CPX 41** – 8 vCPU, 16 GB RAM, 240 GB disk (~€36/mo)
- **SSH key:** add yours so you can log in as `root`.
- **Name:** e.g. `newpt-trading-v2`.
- Create the server and note the **new IP** and **root password** (or use SSH key).

### 4. Add a 500 GB Volume and attach to the new server

- Console → **Volumes** → **Add Volume**.
- **Size:** 500 GB.
- **Location:** same as the new server (e.g. Nuremberg).
- **Attach to:** select the **new server** you just created.
- **Mounting:** Manual.
- Create the volume.

### 5. Set up the new server (SSH as root)

Replace `NEW_SERVER_IP` with the new server’s IP.

```bash
# SSH in (use password or SSH key)
ssh root@NEW_SERVER_IP

# Install Docker (example for Ubuntu 24.04)
apt-get update && apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a644 /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update && apt-get install -y docker-ce docker-ce-cli docker-compose-plugin

# Find the 500 GB volume (often /dev/sdb)
lsblk

# Format and mount the 500 GB volume
mkfs.ext4 -L data500 /dev/sdb
mkdir -p /mnt/data500
mount /dev/sdb /mnt/data500
UUID=$(blkid -s UUID -o value /dev/sdb)
echo "UUID=$UUID /mnt/data500 ext4 defaults,nofail 0 2" >> /etc/fstab

# Move Docker to the 500 GB volume (so root stays small)
systemctl stop docker
mv /var/lib/docker /mnt/data500/docker 2>/dev/null || mkdir -p /mnt/data500/docker
ln -sfn /mnt/data500/docker /var/lib/docker
systemctl start docker
```

### 6. Deploy the app on the new server

- Clone or copy the repo to the new server (e.g. `/opt/newpt`), or use `rsync`/`scp` from your machine.
- Create `deploy/.env.production` with the **same** secrets (JWT_SECRET, POSTGRES_PASSWORD, etc.) and add:
  - `CORS_ORIGINS=http://NEW_SERVER_IP` (replace with the new IP).
- From the repo root on the server:

```bash
cd /opt/newpt
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production build
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d
```

- Open **http://NEW_SERVER_IP** and test login. If you use a domain later, add it to `CORS_ORIGINS` and (if you added the nginx Private-Network fix) the app will work there too.

### 7. Update this doc and your bookmarks

- Replace the old IP (178.104.49.76) with the **new server IP** in the “Credentials” and “Your server” tables at the top of this doc.
- Use the new URL for the app (http://NEW_SERVER_IP).

---

## Sync server database with full migrations

If the server DB was created from an older set of migrations (or manual fixes), it may be missing columns or tables. To bring it in line with **local** (and avoid "no column found" errors):

1. **Put the latest repo on the server** (including `infra/migrations/`):
   - From your PC: `rsync -avz --exclude node_modules --exclude target /Users/mab/new_pt1/ root@178.104.63.176:/opt/newpt/`
   - Or on the server, if it's a git clone: `cd /opt/newpt && git pull`

2. **Run all infra migrations** (from the server):
   ```bash
   cd /opt/newpt/deploy
   docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrations
   ```
   This runs every `infra/migrations/*.sql` in order; each file is idempotent (IF NOT EXISTS, etc.).

3. **Restart services that use the DB** so they pick up the new schema:
   ```bash
   docker compose -f docker-compose.prod.yml restart auth core-api
   ```

After this, the server DB should match what the app expects (users.last_login_at, user_groups.signup_slug, audit_logs, password_reset_tokens, etc.).

---

## System stats (admin page)

The **Admin → System** page shows server stats (disk, memory, uptime, Docker containers). Data is **not polled**: the page loads once on open and again when you click **Refresh**. A host script writes stats to a JSON file; the auth service reads it and serves it via `GET /api/admin/system/stats` (admin-only, permission `system:view`).

### One-time setup on the server

1. **Create the stats directory** (must match the volume mount in `docker-compose.prod.yml`):

   ```bash
   mkdir -p /opt/newpt/deploy/stats
   ```

2. **Make the script executable and run it once** so the file exists before the API is used:

   ```bash
   chmod +x /opt/newpt/deploy/scripts/collect-system-stats.sh
   /opt/newpt/deploy/scripts/collect-system-stats.sh
   ```

   This writes `/opt/newpt/deploy/stats/system-stats.json`. The auth container mounts `./stats` as `/host-stats` (read-only).

3. **Cron (every 2 minutes)** so the file is kept up to date:

   ```bash
   (crontab -l 2>/dev/null; echo "*/2 * * * * /opt/newpt/deploy/scripts/collect-system-stats.sh") | crontab -
   ```

4. **Restart auth** so it picks up the new route and volume (if you just deployed):

   ```bash
   cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml --env-file .env.production restart auth
   ```

If the stats file is missing or invalid, the API returns 503 and the System page shows an error (e.g. "Stats not available" or "Run the stats script on the server").

## Feed freshness watchdog (auto-recover stale live prices)

If live prices stop updating while containers are still "up", enable the host watchdog script so stale feeds auto-restart.

### What it does

- Calls `http://127.0.0.1:8080/dp/health/fresh` (frontend nginx proxy to data-provider).
- If freshness status is stale, force-recreates `data-provider` and `ws-gateway`.
- Exits with non-zero only when endpoint is unreachable or restart fails.

### One-time setup

```bash
chmod +x /opt/newpt/deploy/scripts/watch-feed-freshness.sh
```

### Manual run

```bash
/opt/newpt/deploy/scripts/watch-feed-freshness.sh
```

### Cron (every 2 minutes)

```bash
(crontab -l 2>/dev/null; echo "*/2 * * * * APP_DIR=/opt/newpt /opt/newpt/deploy/scripts/watch-feed-freshness.sh >> /var/log/newpt-feed-watchdog.log 2>&1") | crontab -
```

### Optional tuning via env

You can tune thresholds in `deploy/.env.production`:

```bash
FEED_FRESHNESS_BINANCE_MAX_STALE_SECS=120
FEED_FRESHNESS_MMDPS_MAX_STALE_SECS=180
FEED_WATCHDOG_INTERVAL_SECS=20
FEED_WATCHDOG_STALE_THRESHOLD=3
```

Then recreate `data-provider`:

```bash
cd /opt/newpt/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate data-provider
```

---

## Import local DB to server (clone all data)

To **replace** the server database with a full copy of your local DB (schema + data):

**Easiest (Mac):** Open the **scripts** folder in your project, then **double-click** **`Import-Local-Database-to-Server.command`**. When the Terminal window asks "Continue? (y/N)", type **y** and press Enter. Wait for "Done!" then press Enter to close. (Requires Docker Desktop running and local DB started, e.g. `cd infra && docker compose up -d`.)

**Or from Terminal (repo root):**

This will:

1. Dump the local DB from Docker container **`newpt-postgres`** (see `scripts/ensure-docker-postgres.sh`; host port **5433**).
2. Copy the dump to the server and restore it into the server’s Postgres container (`deploy-postgres-1`). The script stops **auth** and **core-api** first so `DROP DATABASE` can run.

**Requirements:** Local Docker running with `newpt-postgres`; SSH access to the server as `root`.

**Override server or container:** `IMPORT_SERVER=1.2.3.4 ./scripts/import-local-db-to-server.sh` or `SERVER_POSTGRES_CONTAINER=my-postgres ./scripts/import-local-db-to-server.sh`.

After the import, restart auth (and core-api) on the server so they use the new data:

```bash
ssh root@178.104.63.176 'cd /opt/newpt/deploy && docker compose -f docker-compose.prod.yml restart auth core-api'
```

---

## What I need from you

### 1. **Hetzner Cloud project & access**

- **Option A – API token (for automated setup)**  
  - In [Hetzner Cloud Console](https://console.hetzner.cloud) → Project → Security → API Tokens → Generate.  
  - Give me: **Read & Write** token (so we can create a server, firewall, SSH key).  
  - I’ll use it only to create resources; you can rotate/revoke it after.

- **Option B – You create the server yourself**  
  - Create a **Cloud Server** (e.g. **CPX21**: 3 vCPU, 4 GB RAM – good for all-in-one).  
  - Location: pick one (e.g. Falkenstein, Helsinki).  
  - Image: **Ubuntu 24.04**.  
  - Add your **SSH key** in the project.  
  - Give me: **server public IP** and confirm I can use **SSH with your key** (or a deploy key you add).

### 2. **Domain (optional but recommended for HTTPS)**

- A domain you control (e.g. `trading.yourdomain.com`).  
- You’ll point it to the server IP (A record).  
- If you don’t have one, we can deploy with IP-only and add a domain later.

### 3. **Production secrets (you choose and keep safe)**

- **`JWT_SECRET`** – Strong secret, at least 32 characters (for auth and WebSocket).  
- **Postgres password** – If we use the same compose as infra, we’ll set a strong `POSTGRES_PASSWORD` (and I’ll use it in `DATABASE_URL`).  
- Any other API keys (e.g. email, payment) if the app uses them in production.

### 4. **How you want to deploy**

- **Option 1 – Docker (recommended)**  
  - I add Dockerfiles + a production `docker-compose` so everything (Postgres, Redis, NATS, all backends, frontend) runs in containers.  
  - You (or CI) build images and run `docker compose up` on the server.

- **Option 2 – Server + scripts**  
  - One VPS with Docker only for Postgres/Redis/NATS.  
  - Backends and frontend run via systemd (or a single start script) after we build binaries and the Vite app (e.g. via GitHub Actions or manually on the server).

---

## Summary checklist

| Item | What you provide |
|------|-------------------|
| Hetzner | API token **or** server IP + SSH access |
| Domain | Domain name (e.g. `app.yourdomain.com`) or “none for now” |
| JWT_SECRET | A long random string (≥32 chars) for production |
| Postgres | Strong password for production DB (or I suggest one in env example) |
| Deploy style | “Docker” or “server + scripts” |

---

## What the stack looks like

- **Infra:** Postgres 15, Redis 7, NATS (already in `infra/docker-compose.yml`).
- **Backends (Rust):** auth-service (3000), ws-gateway (3003/9002), data-provider (9003/9004), order-engine (3002), core-api (3004).
- **Frontend:** Vite/React (build → static files; in production served by nginx or same host).

Once you send:

1. How you’ll give access (API token **or** IP + SSH),  
2. Domain (or “no domain”),  
3. JWT_SECRET (or “generate a placeholder for me”),  
4. Docker vs server+scripts,  

I can give you step-by-step commands and, for Docker, add the Dockerfiles and production compose to the repo.
