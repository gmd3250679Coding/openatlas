"""Send same payload to Hermes directly to see the 400 body."""
import json
import urllib.request
import urllib.error

r = urllib.request.Request(
    "http://127.0.0.1:58642/api/sessions",
    data=json.dumps({"title": "raw probe"}).encode(),
    method="POST",
    headers={"Content-Type": "application/json", "Authorization": "Bearer openatlas-demo-dev-key"},
)
try:
    with urllib.request.urlopen(r) as resp:
        print("OK:", resp.read().decode()[:300])
except urllib.error.HTTPError as e:
    print(f"ERR {e.code}: {e.read().decode()[:600]}")
