#!/usr/bin/env bash
# One-shot install: clone Insulator Inspector Pro from GitHub onto this VPS and
# serve it on port 80 (Nginx static frontend + reverse-proxy to FastAPI).
#
# Run as root on Ubuntu 22.04+:
#   PUBLIC_ORIGIN=http://77.37.45.106 bash bootstrap-vps.sh
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this script as root (sudo bash $0)" >&2
  exit 1
fi

REPO_URL="${REPO_URL:-https://github.com/Tabook22/towers.git}"
APP_DIR="${APP_DIR:-/var/www/insulator_inspector_pro}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-http://77.37.45.106}"
BACKEND_PORT="${BACKEND_PORT:-8001}"
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"

export DEBIAN_FRONTEND=noninteractive
export PATH="/root/.local/bin:${PATH}"

echo "==> Installing system packages"
apt-get update -y
apt-get install -y python3 python3-venv python3-pip python3-dev nginx git curl ca-certificates ufw nodejs npm build-essential

echo "==> Node $(node -v 2>/dev/null || echo missing)  npm $(npm -v 2>/dev/null || echo missing)"

# Small Hostinger plans (1–2 GB RAM) OOM during `npm run build` without swap.
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [[ "${mem_kb}" -lt 2500000 ]] && [[ ! -f /swapfile ]]; then
  echo "==> Adding 2G swap (detected $((mem_kb / 1024)) MB RAM)"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Opening SSH / HTTP / HTTPS on the VPS firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable || true

echo "==> Fetching ${REPO_URL}"
mkdir -p /var/www
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch --depth=1 origin main
  git -C "${APP_DIR}" reset --hard origin/main
else
  rm -rf "${APP_DIR}"
  git clone --depth=1 "${REPO_URL}" "${APP_DIR}"
fi

echo "==> Python ${PYTHON_VERSION} via uv (system python is $(python3 --version))"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="/root/.local/bin:${PATH}"
fi
# Install CPython somewhere www-data can execute (uv's default is /root/.local/share/uv).
export UV_PYTHON_INSTALL_DIR="${UV_PYTHON_INSTALL_DIR:-/opt/uv-python}"
uv python install "${PYTHON_VERSION}"
chmod -R a+rX "${UV_PYTHON_INSTALL_DIR}"

echo "==> Backend virtualenv + dependencies"
cd "${APP_DIR}/backend"
uv venv .venv --python "${PYTHON_VERSION}"
uv pip install --python .venv/bin/python -r requirements.txt

if [[ ! -f .env ]]; then
  echo "==> Writing backend/.env"
  SECRET="$(.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(48))')"
  cat > .env <<EOF
SECRET_KEY=${SECRET}
CORS_ORIGINS=["${PUBLIC_ORIGIN}"]
EOF
  chmod 640 .env
  chgrp www-data .env
else
  echo "==> backend/.env already exists — leaving it unchanged"
  chgrp www-data .env || true
  chmod 640 .env
fi

if [[ ! -f storage/insulator_inspector.db ]]; then
  echo "==> Seeding empty database (change admin password after first login)"
  .venv/bin/python -m app.seed
fi

chown -R www-data:www-data "${APP_DIR}/backend/storage"
# www-data must traverse the tree and read the venv / source.
chmod -R a+rX "${APP_DIR}"

workers=1
if [[ "${mem_kb}" -ge 1800000 ]]; then
  workers=2
fi

echo "==> systemd unit (uvicorn on 127.0.0.1:${BACKEND_PORT}, ${workers} worker(s))"
cat > /etc/systemd/system/insulator-backend.service <<EOF
[Unit]
Description=Insulator Inspector Pro — backend
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=${APP_DIR}/backend
Environment=PATH=${APP_DIR}/backend/.venv/bin
ExecStart=${APP_DIR}/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT} --workers ${workers}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable insulator-backend
systemctl restart insulator-backend

echo "==> Building frontend (VITE_API_BASE_URL=${PUBLIC_ORIGIN})"
cd "${APP_DIR}/frontend"
# Requests in the app already start with /api/... so this must be the origin only,
# not origin + /api (that would produce /api/api/...).
printf 'VITE_API_BASE_URL=%s\n' "${PUBLIC_ORIGIN}" > .env.production
npm ci
npm run build

echo "==> Nginx"
cat > /etc/nginx/sites-available/insulator-inspector <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root ${APP_DIR}/frontend/dist;
    index index.html;

    client_max_body_size 50M;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        client_max_body_size 50M;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/insulator-inspector /etc/nginx/sites-enabled/insulator-inspector
nginx -t
systemctl enable nginx
systemctl reload nginx

sleep 2
echo "==> Health checks"
systemctl --no-pager --full status insulator-backend | head -n 20 || true
curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/health" && echo
curl -sf -o /dev/null -w "nginx HTTP %{http_code}\n" http://127.0.0.1/ || true

cat <<EOF

============================================================
Insulator Inspector Pro is installed.

Open:  ${PUBLIC_ORIGIN}

Login (CHANGE THESE immediately):
  admin       / Admin123!
  inspector1  / Inspect123!

If the page does not load from the internet, open ports 80 and 443
in Hostinger hPanel → VPS → Firewall (the panel firewall is separate
from ufw on the VM).
============================================================
EOF
