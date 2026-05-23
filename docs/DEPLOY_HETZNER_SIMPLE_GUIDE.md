# Deploy this trading app on Hetzner (simple guide — no coding)

Someone with **15 minutes** and access to your **Hetzner account** can follow this. You do **not** need to write code — only click in the browser and **copy–paste** text.

---

## Which script is which? (important)

| Script | Where it runs | Purpose |
|--------|----------------|--------|
| **`scripts/start-all-servers.sh`** | Your **Mac / laptop** (repo folder) | **Local development only** — Docker infra + Rust + Vite (e.g. **5173**, **3000**). **Not** for Hetzner. |
| **`scripts/stop-all-servers.sh`** | Your **Mac / laptop** | Stops those **local** dev processes. |
| **`deploy/setup-and-deploy.sh`** | **Hetzner server** (Ubuntu) | **Production deploy** — Docker, clone, **`deploy/docker-compose.prod.yml`**, app on **8080**. **This is the Hetzner script.** |
| **`deploy/run-remote-setup.sh`** | Your **laptop** | SSH to server + run setup from GitHub (optional). |
| **`deploy/remote-pull-restart.sh`** | **Server** | Updates after first deploy (`git pull` + rebuild). |

The “restart all servers” script used on your machine was **`scripts/start-all-servers.sh`** — that is **not** the same as deploying to Hetzner. For Hetzner use **`deploy/setup-and-deploy.sh`** (Part B runs it).

---

## Part A — Create the server (in Hetzner’s website)

1. Log in at **https://console.hetzner.cloud/** (create an account if you don’t have one).
2. Open your **project** (or create one).
3. Click **Add Server**.
4. **Location:** pick a region close to you (e.g. Falkenstein, Nuremberg).
5. **Image:** **Ubuntu 22.04**.
6. **Type:** choose a server with at least **4 GB RAM** (CPX21 or similar). Smaller may work but the first install can be slow or fail.
7. **SSH keys:** add your key if you have one; if Hetzner offers **“Password only”** or **“Console”** login, you can use that — your helper will need the root password Hetzner shows or emails you.
8. **Firewall:** create or select a firewall that allows:
   - **TCP 22** (SSH — for setup)
   - **TCP 8080** (the app in the browser)
9. Click **Create & buy** (or equivalent). Wait until the server shows **Running**.
10. Note the server’s **IPv4 address** (looks like `95.x.x.x`). You will open the app at:  
    `http://THAT-IP:8080`  
    (type it in the browser with **http** and **:8080** at the end.)

---

## Part B — One-time install on the server (copy–paste)

You need to run commands **on the server**. Easiest ways:

- **Hetzner “Console”** (browser terminal on the server page), or  
- **Your Mac “Terminal”** app: `ssh root@YOUR_SERVER_IP` (use the IP from step 10).

**Replace** `YOUR_SERVER_IP` with your real IP. **Replace** the GitHub URL if your code is on a **different** GitHub address.

Copy everything below **in one block**, paste into the terminal, press **Enter**, and wait **15–45 minutes** (first build is long). Do not close the window until it finishes.

```bash
export REPO_URL='https://github.com/ayyazbhatti/new_pt1.git'
export BRANCH='main'
export APP_DIR='/opt/newpt'
apt-get update -qq && apt-get install -y -qq git ca-certificates curl
mkdir -p /opt && git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR" 2>/dev/null || (cd "$APP_DIR" && git fetch origin "$BRANCH" && git reset --hard "origin/$BRANCH")
cd "$APP_DIR" && bash deploy/setup-and-deploy.sh
```

If `git clone` fails (private repo or wrong URL), you need the correct **git link** from whoever owns the code, then change `REPO_URL` and run again.

When the script ends, open in your browser:

**`http://YOUR_SERVER_IP:8080/`**

---

## Part C — If something goes wrong

| Problem | What to do |
|--------|------------|
| Browser shows “can’t connect” | Check Hetzner **firewall** allows **8080**. Wait 2–3 minutes after the script finishes. |
| Login / API errors | On the server, file **`/opt/newpt/deploy/.env.production`** must include **`CORS_ORIGINS=http://YOUR_SERVER_IP:8080`** (same IP you use in the browser). The setup script tries to add this automatically; if you use a **domain** later, change that line to `https://your-domain.com` and ask someone to restart Docker (see full doc). |
| “Permission denied” on git | Repo may be **private** — you need access from the owner or use SSH deploy keys (ask a developer once). |

More detail (TLS, updates, backups): **`docs/HETZNER_DEPLOYMENT.md`**

---

## What I (the AI) cannot do for you

I **cannot** open Hetzner in your browser, pay for servers, or run SSH on **your** IP. I can only prepare instructions and scripts **inside your project** (already done).

**Fastest real-world path:** send this file (`docs/DEPLOY_HETZNER_SIMPLE_GUIDE.md`) plus your Hetzner login (or add them as a project member) to a **friend, IT person, or freelancer** — they follow Part A + Part B once.

---

## After it works

- **Save a copy** of `/opt/newpt/deploy/.env.production` somewhere safe (passwords).  
- To **update** the app later, on the server:  
  `cd /opt/newpt && bash deploy/remote-pull-restart.sh`  
  (Someone with SSH access runs that when you want a new version.)

If you tell me **only** whether your code is on **public GitHub** or **private**, I can reply with a **single line** you change in the paste block (no account access needed).
