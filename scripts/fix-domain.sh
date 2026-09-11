#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/home/nasser/insulator_inspector_pro

# Allow the domain the browser actually uses, plus the IP.
python3 - <<'PY'
from pathlib import Path
p = Path("/home/nasser/insulator_inspector_pro/backend/.env")
text = p.read_text()
origins = '["http://77.37.45.106","http://skygreenline-lab.io","http://www.skygreenline-lab.io","https://skygreenline-lab.io","https://www.skygreenline-lab.io"]'
lines = []
found = False
for line in text.splitlines():
    if line.startswith("CORS_ORIGINS="):
        lines.append(f"CORS_ORIGINS={origins}")
        found = True
    else:
        lines.append(line)
if not found:
    lines.append(f"CORS_ORIGINS={origins}")
p.write_text("\n".join(lines) + "\n")
print("updated CORS_ORIGINS")
PY
chown nasser:nasser "${APP_DIR}/backend/.env"
chmod 640 "${APP_DIR}/backend/.env"

# Same-origin frontend: do not bake the IP into the JS bundle.
sudo -u nasser env HOME=/home/nasser bash -c "
  set -e
  cd ${APP_DIR}/frontend
  printf 'VITE_API_BASE_URL=\n' > .env.production
  npm run build
"
chmod -R a+rX "${APP_DIR}/frontend/dist"
chown -R nasser:nasser "${APP_DIR}/frontend/dist"

# Nginx should name the domain explicitly.
cat > /etc/nginx/sites-available/insulator-inspector <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name skygreenline-lab.io www.skygreenline-lab.io 77.37.45.106 _;

    root /home/nasser/insulator_inspector_pro/frontend/dist;
    index index.html;

    client_max_body_size 50M;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        client_max_body_size 50M;
    }
}
EOF
nginx -t
systemctl reload nginx
systemctl restart insulator-backend
sleep 2
systemctl is-active insulator-backend
curl -sf -H "Origin: http://skygreenline-lab.io" -D - -o /tmp/health.body http://127.0.0.1/api/health | head -n 20
echo
cat /tmp/health.body; echo
echo DONE
