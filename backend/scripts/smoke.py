"""End-to-end smoke test: login → list employees → chat stream → memories."""
import json
import urllib.request
import urllib.error
import sys

BASE = "http://127.0.0.1:58003"

def req(method, path, body=None, token=None, stream=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    if stream:
        return urllib.request.urlopen(r, timeout=60)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            return json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode()}

def pp(label, obj):
    print(f"\n=== {label} ===")
    print(json.dumps(obj, indent=2, ensure_ascii=False)[:600])

# 1. login
res = req("POST", "/api/auth/login", {"email": "admin@demo.openatlas", "password": "openatlas"})
pp("1. login", res)
token = res["access_token"]

# 2. me
pp("2. /api/auth/me", req("GET", "/api/auth/me", token=token))

# 3. employees
res = req("GET", "/api/employees", token=token)
print(f"\n=== 3. /api/employees (count={len(res['items'])}) ===")
for e in res['items'][:3]:
    print(f"  - {e['display_name']}  profile={e['profile_name']}  avatar={e['avatar']}")

import time
suffix = int(time.time()) % 10000

# 4. create employee
new_emp = req("POST", "/api/employees", {
    "display_name": f"数据分析师{suffix}",
    "description": "擅长 SQL 与数据可视化",
    "avatar": "数",
    "system_prompt": "你是一名严谨的数据分析师。",
    "toolsets": ["hermes-cli"],
}, token=token)
pp("4. created employee", new_emp)
emp_id = new_emp["id"]

# 5. capabilities
caps = req("GET", "/api/capabilities", token=token)
print(f"\n=== 5. capabilities ===")
print(f"  session_chat_streaming: {caps['features']['session_chat_streaming']}")
print(f"  run_events_sse: {caps['features']['run_events_sse']}")

# 6. models
mods = req("GET", "/api/models", token=token)
print(f"\n=== 6. models: {[m['id'] for m in mods.get('data', [])]} ===")

# 7. health
pp("7. /api/runtime/health", req("GET", "/api/runtime/health", token=token))

# 8. skill market
sm = req("GET", "/api/skill-market", token=token)
print(f"\n=== 8. /api/skill-market (count={len(sm['items'])}) ===")
for s in sm['items'][:3]:
    print(f"  - [{s['scope']}] {s['name']}  mutable={s['mutable']}")

# 9. memories empty
pp("9. /api/memories (before)", req("GET", "/api/memories", token=token))

# 10. create user memory
mem = req("POST", "/api/memories", {
    "scope": "user",
    "title": "我的偏好",
    "content": "回答尽量简洁，优先使用表格和数字。",
    "tags": ["偏好", "风格"],
    "priority": 80,
}, token=token)
pp("10. created memory", mem)

# 11. effective memories
eff = req("GET", f"/api/memories/effective?employee_id={emp_id}", token=token)
print(f"\n=== 11. effective memories (count={len(eff['items'])}) ===")
for m in eff['items']:
    print(f"  - [{m['scope']}] {m['title']}  p={m['priority']}  locked={m['locked']}")

# 12. create session (with unique title to avoid Hermes title-unique enforcement)
import uuid as _u
unique = _u.uuid4().hex[:6]
sess = req("POST", "/api/sessions", {"employee_id": emp_id, "title": f"数据分析-{unique}"}, token=token)
pp("12. created session", sess)
sid = sess["id"]

# 13. list sessions
sl = req("GET", "/api/sessions", token=token)
print(f"\n=== 13. /api/sessions (count={len(sl['items'])}) ===")

# 14. dashboard
pp("14. /api/dashboard/me", req("GET", "/api/dashboard/me", token=token))

# 15. SSE chat stream
print(f"\n=== 15. SSE chat stream on session {sid} ===")
print("  (Hermes dev gateway is openatlas-demo (no real provider) — stream may end with 'no provider' or a model not-found event, but the SSE plumbing must work)")

r = urllib.request.Request(
    BASE + f"/api/sessions/{sid}/chat/stream",
    data=json.dumps({"message": "用一句话介绍你自己"}).encode(),
    method="POST",
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
)
try:
    with urllib.request.urlopen(r, timeout=30) as resp:
        ct = resp.headers.get("Content-Type")
        print(f"  Content-Type: {ct}")
        buf = b""
        events = []
        for chunk in resp:
            buf += chunk
            while b"\n\n" in buf:
                block, buf = buf.split(b"\n\n", 1)
                line0 = block.decode(errors="ignore").split("\n", 1)[0]
                if line0:
                    events.append(line0)
                if len(events) >= 12:
                    break
            if len(events) >= 12:
                break
        for e in events:
            print(f"  ← {e[:140]}")
except Exception as ex:
    print(f"  stream error (may be expected with no real provider): {type(ex).__name__}: {ex}")

print("\n=== SMOKE TEST DONE ===")
