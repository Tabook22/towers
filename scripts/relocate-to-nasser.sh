#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/home/nasser/insulator_inspector_pro
OLD_DIR=/var/www/insulator_inspector_pro
REPO=https://github.com/Tabook22/towers.git
PY=/opt/uv-python/cpython-3.12-linux-x86_64-gnu/bin/python3.12
PUBLIC_ORIGIN=http://77.37.45.106

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

echo "==> Stopping backend so the database copy is consistent"
systemctl stop insulator-backend || true

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "==> Clone GitHub repo as nasser"
  rm -rf "${APP_DIR}"
  sudo -u nasser git clone --depth=1 "${REPO}" "${APP_DIR}"
else
  echo "==> Repo already cloned; fetching latest main"
  sudo -u nasser git -C "${APP_DIR}" fetch --depth=1 origin main
  sudo -u nasser git -C "${APP_DIR}" reset --hard origin/main
fi

echo "==> Preserve live .env and storage (photos + database)"
if [[ -f "${OLD_DIR}/backend/.env" ]]; then
  cp -a "${OLD_DIR}/backend/.env" "${APP_DIR}/backend/.env"
fi
if [[ -d "${OLD_DIR}/backend/storage" ]]; then
  mkdir -p "${APP_DIR}/backend/storage"
  cp -a "${OLD_DIR}/backend/storage/." "${APP_DIR}/backend/storage/"
fi
chown -R nasser:nasser "${APP_DIR}"

echo "==> Python venv as nasser"
sudo -u nasser env HOME=/home/nasser bash -c "
  set -e
  cd ${APP_DIR}/backend
  ${PY} -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
"

echo "==> Frontend production build as nasser"
sudo -u nasser env HOME=/home/nasser bash -c "
  set -e
  cd ${APP_DIR}/frontend
  printf 'VITE_API_BASE_URL=%s\n' '${PUBLIC_ORIGIN}' > .env.production
  npm ci
  npm run build
"

echo "==> Home dir traversable so Nginx can read static files"
chmod 711 /home/nasser
chmod -R a+rX "${APP_DIR}/frontend/dist"
chown -R nasser:nasser "${APP_DIR}"
if [[ -f "${APP_DIR}/backend/.env" ]]; then
  chmod 640 "${APP_DIR}/backend/.env"
  chown nasser:nasser "${APP_DIR}/backend/.env"
fi

echo "==> systemd unit"
cat > /etc/systemd/system/insulator-backend.service <<EOF
[Unit]
Description=Insulator Inspector Pro — backend
After=network.target

[Service]
User=nasser
Group=nasser
WorkingDirectory=${APP_DIR}/backend
Environment=PATH=${APP_DIR}/backend/.venv/bin
ExecStart=${APP_DIR}/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 2
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

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
        proxy_pass http://127.0.0.1:8001/api/;
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

nginx -t
systemctl daemon-reload
systemctl enable insulator-backend
systemctl start insulator-backend
systemctl reload nginx

sleep 3
echo "==> Verify"
sudo -u nasser git -C "${APP_DIR}" remote -v
sudo -u nasser git -C "${APP_DIR}" log -1 --oneline
systemctl is-active insulator-backend
ps -eo user,pid,cmd | grep '[u]vicorn'
curl -sf http://127.0.0.1:8001/api/health
echo
curl -sf -o /dev/null -w "nginx / %{http_code}\n" http://127.0.0.1/
curl -sf -o /dev/null -w "nginx /api/health %{http_code}\n" http://127.0.0.1/api/health
echo "App now lives at ${APP_DIR} (old copy kept at ${OLD_DIR})"
