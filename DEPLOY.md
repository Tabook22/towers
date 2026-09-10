# Deploying to a Hostinger VPS

This app is a FastAPI backend + a React (Vite) frontend — it needs a real server that can run a
long-lived Python process and build/serve static files, i.e. a **Hostinger VPS** (KVM plan, root/SSH
access). Hostinger's shared/cPanel hosting cannot run this stack — if that's what you have, upgrade
to a VPS plan first.

Everything below assumes Ubuntu 22.04+ on the VPS. A domain is optional: you can go live on the
VPS IP first (e.g. `http://77.37.45.106`) and add HTTPS later once an A record points at it.

**Hostinger firewall (easy to miss):** hPanel has its own firewall in front of the VM. If ports 80
and 443 are not allowed there, the site will work on the server (`curl localhost`) but time out
from the internet. Allow TCP 80, 443, and 22 in **hPanel → VPS → Firewall** before you expect the
site to load in a browser.

## 0. Fast path — one script, GitHub → VPS

SSH in as root, then:

```bash
curl -fsSL https://raw.githubusercontent.com/Tabook22/towers/main/scripts/bootstrap-vps.sh -o /tmp/bootstrap-vps.sh
# If that URL 404s (script not pushed yet), scp scripts/bootstrap-vps.sh from your PC instead.
sudo PUBLIC_ORIGIN=http://77.37.45.106 bash /tmp/bootstrap-vps.sh
```

That clones `https://github.com/Tabook22/towers.git` into `/var/www/insulator_inspector_pro`,
installs Python/Node/Nginx, builds the frontend, and starts the backend as a systemd service.

`VITE_API_BASE_URL` must be the **origin only** (`http://77.37.45.106` or `https://your-domain.com`),
not `.../api`. Every frontend request already starts with `/api/...`; adding `/api` a second time
breaks login and every other call.

The rest of this file is the same setup, step by step, if you would rather run it by hand.

## 1. First-time server setup

SSH into the VPS, then:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-venv python3-pip nginx git

# Node 20 (Hostinger's default apt repo is usually too old for this app)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. Get the code onto the server

```bash
cd /var/www
sudo git clone https://github.com/Tabook22/towers.git insulator_inspector_pro
sudo chown -R $USER:$USER insulator_inspector_pro
cd insulator_inspector_pro
```

Later, to deploy an update: `git pull`, then re-run whichever of steps 3/4 changed, then restart the
service (step 6).

## 3. Backend

```bash
cd /var/www/insulator_inspector_pro/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
nano .env   # set a real SECRET_KEY and CORS_ORIGINS — see the comments in the file
```

Generate the secret key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Set `CORS_ORIGINS` in `.env` to your real domain, e.g. `CORS_ORIGINS=["https://your-domain.com"]`.

The database and upload folders under `backend/storage/` are created automatically the first time
the app runs — nothing to do there. If you want the demo/seed accounts on a brand-new database:

```bash
python -m app.seed
```

**Then sign in and change every seeded/default password immediately** — see the security note at
the bottom of this file.

## 4. Run the backend as a systemd service

Create `/etc/systemd/system/insulator-backend.service`:

```ini
[Unit]
Description=Insulator Inspector Pro — backend
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/insulator_inspector_pro/backend
Environment="PATH=/var/www/insulator_inspector_pro/backend/.venv/bin"
ExecStart=/var/www/insulator_inspector_pro/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 2
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /var/www/insulator_inspector_pro/backend/storage
sudo systemctl daemon-reload
sudo systemctl enable --now insulator-backend
sudo systemctl status insulator-backend   # should say "active (running)"
```

## 5. Frontend — build the static files

```bash
cd /var/www/insulator_inspector_pro/frontend
echo "VITE_API_BASE_URL=https://your-domain.com" > .env.production
# IP-only (no domain yet): echo "VITE_API_BASE_URL=http://77.37.45.106" > .env.production
npm ci
npm run build
```

This produces `frontend/dist/` — a folder of plain static files. Nginx (next step) serves it
directly; there's no Node process to keep running for the frontend.

## 6. Nginx — serve the frontend and reverse-proxy the API

Create `/etc/nginx/sites-available/insulator-inspector`:

```nginx
server {
    listen 80;
    server_name your-domain.com 77.37.45.106 _;

    root /var/www/insulator_inspector_pro/frontend/dist;
    index index.html;

    # React Router client-side routes — let index.html handle any path Nginx can't find a file for.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Everything under /api/ (including image/report downloads) goes to the backend.
    location /api/ {
        proxy_pass http://127.0.0.1:8001/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;   # thermal photos can be a few MB each
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/insulator-inspector /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Your site should now be reachable at `http://your-domain.com`.

## 7. HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot edits the Nginx config to redirect HTTP → HTTPS and auto-renews the certificate. Once this
is done, update `frontend/.env.production` to use `https://` (if it didn't already) and rebuild.

## 8. Back up the data regularly

Everything that matters lives in `backend/storage/` (the SQLite database + every uploaded photo and
report). None of it is in git — it only exists on this server. At minimum, cron a nightly copy
somewhere off the VPS:

```bash
# /etc/cron.d/insulator-backup — runs at 02:00 daily
0 2 * * * root tar -czf /root/backups/insulator-$(date +\%F).tar.gz /var/www/insulator_inspector_pro/backend/storage
```

Then sync `/root/backups/` off-server (Hostinger's own backup add-on, an S3 bucket, rclone to
anywhere — whatever you already use) — a backup that only lives on the same VPS doesn't protect you
if that VPS is lost.

## Before this is a real production URL

- **Change the seeded `admin` / `Admin123!` login immediately** (and `inspector1` / `Inspect123!` if
  you seeded it) — these are documented in this repo's README for local development and must never
  be the real credentials on a public server.
- Confirm `SECRET_KEY` in `backend/.env` is the random one you generated in step 3, not the
  `dev-secret-key-...` placeholder from `app/config.py`.
- Confirm `CORS_ORIGINS` lists your real domain only.
