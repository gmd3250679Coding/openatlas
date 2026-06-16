"""Wrap probe + save backend log to a temp file we can read."""
import json
import urllib.request
import urllib.error
import subprocess
import time

r = urllib.request.Request(
    "http://127.0.0.1:58003/api/auth/login",
    data=json.dumps({"email": "admin@demo.openatlas", "password": "openatlas"}).encode(),
    method="POST",
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(r) as resp:
    token = json.loads(resp.read())["access_token"]

# Re-create probe (no employee_id this time)
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

# Try with employee_id, no audit-context
r = urllib.request.Request(
    "http://127.0.0.1:58003/api/sessions",
    data=json.dumps({"title": "raw probe 2", "employee_id": "ffffffff-ffff-ffff-ffff-ffffffffffff"}).encode(),
    method="POST",
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
)
try:
    with urllib.request.urlopen(r, timeout=15) as resp:
        print("OK2:", resp.read().decode()[:400])
except urllib.error.HTTPError as e:
    print(f"ERR2 {e.code}:", e.read().decode()[:600])
