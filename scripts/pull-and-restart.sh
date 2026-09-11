#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/home/nasser/insulator_inspector_pro
cd "${APP_DIR}"

echo "==> git fetch/reset to origin/main as nasser"
sudo -u nasser git fetch origin
sudo -u nasser git reset --hard origin/main
sudo -u nasser git log -1 --oneline
sudo -u nasser git status -sb

echo "==> frontend production build (same-origin API)"
printf 'VITE_API_BASE_URL=\n' > "${APP_DIR}/frontend/.env.production"
chown nasser:nasser "${APP_DIR}/frontend/.env.production"
sudo -u nasser env HOME=/home/nasser bash -c '
  set -e
  cd /home/nasser/insulator_inspector_pro/frontend
  npm ci
  npm run build
'
chmod -R a+rX "${APP_DIR}/frontend/dist"
chown -R nasser:nasser "${APP_DIR}/frontend/dist"

echo "==> restart backend"
systemctl restart insulator-backend
sleep 3
systemctl is-active insulator-backend
curl -sf http://127.0.0.1:8001/api/health
echo
echo DONE
