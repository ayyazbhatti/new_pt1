# Deploying to Hetzner

This doc lists what we need from you (fresh Hetzner account) and the deployment options.

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
