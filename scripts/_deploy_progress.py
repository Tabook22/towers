import pathlib
import paramiko

key = paramiko.Ed25519Key.from_private_key_file(str(pathlib.Path.home() / ".ssh" / "id_ed25519"))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("77.37.45.106", username="root", pkey=key, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
root = pathlib.Path(r"C:\Users\nmtab\OneDrive\Desktop\myProjects\insulator_inspector_pro")
files = [
    "backend/app/schemas.py",
    "backend/app/routers/teams.py",
    "frontend/src/api/hooks.ts",
    "frontend/src/pages/TeamDetailPage.tsx",
]
for rel in files:
    data = (root / rel).read_bytes().replace(b"\r\n", b"\n")
    with sftp.open("/home/nasser/insulator_inspector_pro/" + rel, "wb") as f:
        f.write(data)
    print("put", rel)
sftp.close()
cmd = """
set -e
chown -R nasser:nasser /home/nasser/insulator_inspector_pro/backend/app /home/nasser/insulator_inspector_pro/frontend/src
sudo -u nasser env HOME=/home/nasser bash -c 'cd /home/nasser/insulator_inspector_pro/frontend; npm run build'
chmod -R a+rX /home/nasser/insulator_inspector_pro/frontend/dist
systemctl restart insulator-backend
sleep 3
systemctl is-active insulator-backend
curl -sf http://127.0.0.1:8001/api/health
echo
"""
stdin, stdout, stderr = c.exec_command(cmd, timeout=180)
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print("STDERR", err[-2500:])
c.close()
