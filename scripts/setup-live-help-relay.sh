#!/usr/bin/env bash
# Run as root on the existing Ubuntu VPS AFTER deploying the live-help backend.
# Usage: bash scripts/setup-live-help-relay.sh skygreenline-lab.io 77.37.45.106
set -euo pipefail
test "$(id -u)" = 0
domain=${1:?Domain required}
public_ip=${2:?Public IPv4 required}
repo=/home/nasser/insulator_inspector_pro
[[ "$domain" =~ ^[a-zA-Z0-9.-]+$ ]]
python3 -c 'import ipaddress,sys; assert ipaddress.ip_address(sys.argv[1]).version == 4' "$public_ip"
test -f "/etc/letsencrypt/live/$domain/fullchain.pem"
test -f "$repo/backend/.env"
if command -v turnserver >/dev/null && ! grep -q '^# Insulator Inspector Live Help' /etc/turnserver.conf; then
  echo 'Existing independent TURN configuration found; review it before proceeding.' >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y coturn
systemctl stop coturn
install -d -m 750 -o root -g turnserver /etc/insulator-turn
install -m 640 -o root -g turnserver "/etc/letsencrypt/live/$domain/fullchain.pem" /etc/insulator-turn/fullchain.pem
install -m 640 -o root -g turnserver "/etc/letsencrypt/live/$domain/privkey.pem" /etc/insulator-turn/privkey.pem
# Keep the shared secret server-side; browser clients receive one-hour HMAC credentials.
python3 - "$repo" "$domain" "$public_ip" <<'PY'
import grp, json, os, re, secrets, sys
from pathlib import Path
repo, domain, public_ip = sys.argv[1:]
env = Path(repo) / 'backend/.env'
text = env.read_text()
match = re.search(r'^LIVE_TURN_SECRET=(.+)$', text, re.M)
secret = match.group(1).strip().strip('"\'') if match else secrets.token_hex(32)
if not re.fullmatch(r'[a-f0-9]{64}', secret):
    raise SystemExit('Existing relay secret requires manual configuration review')
urls = [f'turn:{domain}:3478?transport=udp', f'turn:{domain}:3478?transport=tcp', f'turns:{domain}:5349?transport=tcp']
for key, value in [('LIVE_TURN_SECRET', secret), ('LIVE_TURN_URLS', json.dumps(urls))]:
    text = re.sub(rf'^{key}=.*\n?', '', text, flags=re.M).rstrip() + f'\n{key}={value}\n'
env.write_text(text)
config = f'''# Insulator Inspector Live Help
listening-port=3478
tls-listening-port=5349
listening-ip={public_ip}
relay-ip={public_ip}
min-port=49160
max-port=49200
realm={domain}
server-name={domain}
fingerprint
use-auth-secret
static-auth-secret={secret}
cert=/etc/insulator-turn/fullchain.pem
pkey=/etc/insulator-turn/privkey.pem
no-tlsv1
no-tlsv1_1
no-dtls
no-tcp-relay
no-multicast-peers
no-cli
no-rfc5780
stale-nonce=600
user-quota=8
total-quota=80
max-bps=500000
bps-capacity=8000000
relay-threads=2
syslog
simple-log
'''
for denied in ['0.0.0.0-0.255.255.255', '10.0.0.0-10.255.255.255', '100.64.0.0-100.127.255.255',
               '127.0.0.0-127.255.255.255', '169.254.0.0-169.254.255.255', '172.16.0.0-172.31.255.255',
               '192.168.0.0-192.168.255.255', '198.18.0.0-198.19.255.255', '224.0.0.0-255.255.255.255',
               '::1', 'fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff']:
    config += f'denied-peer-ip={denied}\n'
path = Path('/etc/turnserver.conf')
path.write_text(config)
os.chown(path, 0, grp.getgrnam('turnserver').gr_gid)
os.chmod(path, 0o640)
PY
# Copy renewed certificates without exposing the Let's Encrypt private-key directory.
cat > /etc/letsencrypt/renewal-hooks/deploy/insulator-turn <<EOF
#!/bin/sh
set -eu
if [ "\${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/$domain" ]; then
  install -m 640 -o root -g turnserver "\$RENEWED_LINEAGE/fullchain.pem" /etc/insulator-turn/fullchain.pem
  install -m 640 -o root -g turnserver "\$RENEWED_LINEAGE/privkey.pem" /etc/insulator-turn/privkey.pem
  systemctl restart coturn
fi
EOF
chmod 750 /etc/letsencrypt/renewal-hooks/deploy/insulator-turn
ufw allow 3478/udp comment 'Live help TURN'
ufw allow 3478/tcp comment 'Live help TURN TCP'
ufw allow 5349/tcp comment 'Live help TURN TLS'
ufw allow 49160:49200/udp comment 'Live help media relay'
systemctl enable --now coturn
systemctl restart insulator-backend
systemctl is-active coturn insulator-backend
echo 'Authenticated live-help relay configured; shared secret was not printed.'
