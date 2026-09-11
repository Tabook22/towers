import pathlib
import paramiko

key = paramiko.Ed25519Key.from_private_key_file(str(pathlib.Path.home() / ".ssh" / "id_ed25519"))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("77.37.45.106", username="root", pkey=key, allow_agent=False, look_for_keys=False)
cmd = r"""
set -e
ffmpeg -y -f lavfi -i sine=frequency=440:duration=1 /tmp/iip-tone.wav >/dev/null 2>&1
cd /home/nasser/insulator_inspector_pro/backend
sudo -u nasser env HOME=/home/nasser /home/nasser/insulator_inspector_pro/backend/.venv/bin/python - <<'PY'
from app.services.transcribe import transcribe_audio
raw = open('/tmp/iip-tone.wav','rb').read()
text, err = transcribe_audio(raw, 'tone.wav', 'audio/wav')
print('text=', repr(text))
print('err=', err)
PY
"""
stdin, stdout, stderr = c.exec_command(cmd, timeout=180)
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print("STDERR", err[-2000:])
c.close()
