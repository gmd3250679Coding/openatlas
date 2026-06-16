"""Quick: get fresh token, hit /api/sessions, dump body and the recent backend log tail."""
import json
import urllib.request
import subprocess

# Get token
r = urllib.request.Request(
    "http://127.0.0.1:58003/api/auth/login",
    data=json.dumps({"email": "admin@demo.openatlas", "password": "openatlas"}).encode(),
    method="POST",
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(r) as resp:
    token = json.loads(resp.read())["access_token"]

# Hit /api/sessions
r = urllib.request.Request(
    "http://127.0.0.1:58003/api/sessions",
    data=json.dumps({"title": "raw probe"}).encode(),
    method="POST",
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
)
try:
    with urllib.request.urlopen(r, timeout=15) as resp:
        print("OK:", resp.read().decode()[:400])
except urllib.error.HTTPError as e:
    print(f"ERR {e.code}:", e.read().decode()[:600])
