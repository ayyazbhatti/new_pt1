# Deploy steps (Hetzner server)

Server: **178.104.49.76** (root; password was in the API response when the server was created).

## 1. First login (required once)

Hetzner forces a password change on first login. Run:

```bash
ssh root@178.104.49.76
```

Enter the root password when prompted, then set a **new password** when asked. Log out (`exit`).

## 2. Run the deploy on the server

**Option A – From your machine (you’ll be prompted for the new root password):**

```bash
ssh root@178.104.49.76 'bash -s' < deploy/setup-and-deploy.sh
```

Or copy the script and run it over SSH:

```bash
scp deploy/setup-and-deploy.sh root@178.104.49.76:/tmp/
ssh root@178.104.49.76 'bash /tmp/setup-and-deploy.sh'
```

**Option B – On the server (after SSH in):**

```bash
ssh root@178.104.49.76
# then on the server:
apt-get update && apt-get install -y git
git clone https://github.com/ayyazbhatti/new_pt1.git /opt/newpt
cd /opt/newpt
bash deploy/setup-and-deploy.sh
```

The script will:

- Install Docker and Docker Compose
- Clone the repo to `/opt/newpt` (or update if already present)
- Generate `deploy/.env.production` with random `POSTGRES_PASSWORD` and `JWT_SECRET` (save a backup of that file)
- Build all images and run `docker compose up -d`

## 3. Open the app

In the browser:

- **http://178.104.49.76**

(Or your domain if you point it to this IP and add HTTPS later.)

## 4. Useful commands on the server

```bash
cd /opt/newpt
# Logs
docker compose -f deploy/docker-compose.prod.yml logs -f

# Restart after code changes (pull then rebuild)
git pull origin main
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build

# Stop
docker compose -f deploy/docker-compose.prod.yml down
```

## 5. Save your secrets

After the first run, copy `deploy/.env.production` from the server and keep it safe (e.g. in a password manager). It contains the generated Postgres password and JWT secret.

```bash
scp root@178.104.49.76:/opt/newpt/deploy/.env.production ./deploy/.env.production.backup
```
