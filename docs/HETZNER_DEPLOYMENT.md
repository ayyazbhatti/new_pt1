# Deploy on Hetzner (production)

**Not a developer?** Use the step-by-step copy-paste guide: **[`DEPLOY_HETZNER_SIMPLE_GUIDE.md`](./DEPLOY_HETZNER_SIMPLE_GUIDE.md)**.

## Quick checklist (new server)

1. **Hetzner Cloud:** Ubuntu 22.04+ VM, **≥ 4 GB RAM** recommended for first `docker compose build` (Rust + Node).
2. **Firewall:** allow **TCP 22** (SSH) and **TCP 8080** (app). Add **80/443** later if you put TLS on the host.
3. **On the server:** clone this repo to `/opt/newpt` (or set `APP_DIR`), then run **`sudo bash deploy/setup-and-deploy.sh`** (see §2).
4. **Browser:** open **`http://YOUR_SERVER_IP:8080/`**.
5. **CORS:** set **`CORS_ORIGINS`** in **`deploy/.env.production`** to that exact origin (see **`deploy/.env.production.example`**), then recreate **`auth`** (see §3).

Provisioning the VM and SSH access must be done in **your** Hetzner account; this document describes only what to run on the server.

---

This repo runs the stack with **Docker Compose** (`deploy/docker-compose.prod.yml`). The **browser UI** is exposed on the host as **port `8080`** (maps to nginx `80` inside the `frontend` container). Internal services (auth `3000`, ws-gateway `3003`, core-api `3004`, etc.) are **not** published to the host by default; the SPA talks to `/api`, `/v1`, WebSockets, etc. **through nginx** on that same origin.

## 1. Hetzner Cloud

1. Create a **server** (Ubuntu 22.04 LTS is fine), at least **4 GB RAM** recommended for `docker compose build` (Rust + Node).
2. Add your **SSH public key**; note the server **public IPv4**.
3. **Firewall** (Hetzner Cloud Firewall or `ufw`):
   - **22** — SSH  
   - **8080** — app (until you put TLS on 443)  
   Optional later: **80** / **443** if you terminate TLS on the host or use a reverse proxy.

## 2. First-time deploy (script on the server)

**Option A — clone on the server, then run the bundled script**

SSH in as root (or a sudo user), then:

```bash
export REPO_URL='https://github.com/YOUR_ORG/new_pt1.git'   # or your fork
export BRANCH='main'
export APP_DIR='/opt/newpt'
sudo mkdir -p /opt && sudo chown "$USER":"$USER" /opt
git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"
sudo bash deploy/setup-and-deploy.sh
```

`setup-and-deploy.sh` installs Docker, clones/updates the repo, creates **`deploy/.env.production`** with random `POSTGRES_PASSWORD` and `JWT_SECRET` if missing, then **builds** and **`up -d`**.

**Option B — run remote setup from your laptop**

From the repo root (adjust server user/host):

```bash
./deploy/run-remote-setup.sh root@YOUR_SERVER_IP
```

That curls `setup-and-deploy.sh` from GitHub **`main`**. Use **`SETUP_SCRIPT_URL`** if you use a fork or pinned commit. Use **Option A** if the repo is private or GitHub raw is blocked.

**Option C — large volume + Docker on `/mnt/data500`**

For a dedicated volume (see `deploy/setup-new-server.sh`): copy the repo to `/opt/newpt` first (e.g. `rsync` or `git clone`), set secrets, then:

```bash
export POSTGRES_PASSWORD='...'
export JWT_SECRET='...'    # at least 32 characters
sudo bash deploy/setup-new-server.sh
```

Edit the hardcoded `NEW_IP` in that script if you still use it, or prefer Option A + manual `.env`.

## 3. After deploy — URLs and secrets

- **Open the app:** `http://YOUR_SERVER_IP:8080/`  
  (Not port 80 unless you change `deploy/docker-compose.prod.yml` `ports` for `frontend`.)

- **Backup** `deploy/.env.production` (contains `POSTGRES_PASSWORD`, `JWT_SECRET`). Permissions should be tight (`chmod 600`).

- **CORS / login from the browser:** set **`CORS_ORIGINS`** in `deploy/.env.production` to the exact origin users use, e.g.  
  `http://YOUR_SERVER_IP:8080` or `https://terminal.example.com`  
  See `deploy/.env.production.example` for optional keys (`MMDPS_API_KEY`, `VOISO_API_KEY`, etc.).

- Rebuild frontend after changing **`VITE_*`** build args — they are baked at **image build** time:

  ```bash
  cd /opt/newpt
  docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production build frontend
  docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d frontend
  ```

## 4. Updates (redeploy without re-reading this doc)

On the server, from the clone:

```bash
cd /opt/newpt
bash deploy/remote-pull-restart.sh
```

Or manually: `git pull`, then the same `docker compose ... build` / `up -d` as in that script.

## 5. TLS / domain (optional)

- Point **DNS A record** to the server IP.
- Either put **Caddy** or **nginx** on the host listening on **443** and reverse-proxy to `127.0.0.1:8080`, or adapt `deploy/nginx-ssl-ptf.conf` into your image/host setup.
- Set **`CORS_ORIGINS`** to `https://your-domain`.

## 6. Registry-based deploy (faster, no Rust build on server)

Build and push from a machine with Docker:

```bash
export REGISTRY=docker.io/YOUR_USER   # or ghcr.io/org/repo
./deploy/build-and-push.sh
```

On the server, use **`docker-compose.registry.yml`** as documented in that script’s header (`pull` + `up`).

## 7. Useful commands

```bash
cd /opt/newpt
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production ps
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production logs -f --tail=100 auth
```

Migrations run as a one-shot **`migrations`** service on `up`; for ad-hoc SQL see comments in `deploy/remote-pull-restart.sh`.

---

**Summary:** Create Ubuntu server → open **8080** (and 22) → clone repo → `sudo bash deploy/setup-and-deploy.sh` (or equivalent) → open **`http://IP:8080`** → set **`CORS_ORIGINS`** to match that URL (or your HTTPS domain).
