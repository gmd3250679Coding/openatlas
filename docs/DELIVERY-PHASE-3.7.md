# OpenAtlas Phase 3.7 — Skill ZIP Import

**Date:** 2026-06-06
**Sprint:** 3.7 (formerly P3.6.6 — promoted to standalone sprint)
**Goal:** Allow admins/users to import a Hermes-compatible SKILL.md packaged as a ZIP, validate it, extract to disk, register in DB.

---

## 1. Why this sprint exists

P3.6.6 (Skill ZIP import) was originally bundled with P3.6. 王六 选了 B option:把 P3.6.6 推到独立 sprint。Sprint 3.7 关闭这个 gap。

**Before this sprint:** `POST /api/skill-market` (create_skill) only stored **metadata** in OpenAtlas DB. No actual skill file was ever extracted to disk. Users could not bundle scripts/references/assets with their skill.

**After this sprint:** A user can drag-and-drop a `SKILL.zip` into the Skill Market UI, and the backend:
1. Validates the ZIP (`.zip` extension, ≤10MB, has `SKILL.md` with `name`+`version` in frontmatter)
2. Prevents zip-slip attacks
3. Rejects duplicates (name+version)
4. Enforces permission scope (`user` / `tenant` / `global`)
5. Extracts to `OPENATLAS_HOME/tenant-skills/{tenant_slug}/{skill_slug}__{version}/`
6. Creates `SkillPackage` row with `source_ref="zip:..."`
7. Writes `skill.import_zip` audit log

---

## 2. Files changed

| File | Change | Lines |
|------|--------|-------|
| `backend/app/main.py` | +3 imports + 2 helpers + endpoint | +195 |
| `frontend/src/services/api.ts` | +importSkillFromZip + TOKEN_KEY fix | +19 / -1 |
| `frontend/src/pages/SkillMarket.tsx` | +Upload icon + "从 ZIP 导入" button + ImportModal | +88 |

Total: ~300 new lines. No new dependencies (no PyYAML, no Ant Design extras — already-imported `Upload`, `Space`, `Alert`).

---

## 3. Backend

### 3.1 Endpoint

```python
POST /api/skill-market/import?scope={user|tenant|global}
Content-Type: multipart/form-data
Authorization: Bearer <jwt>

Body: file=<SKILL.zip>
```

**Returns:**
```json
{
  "id": "<uuid>",
  "name": "browser-final-v3-1780748190",
  "version": "1.0.0",
  "scope": "user",
  "visibility": "private",
  "mutable": true,
  "extracted_path": "/Users/macbook/.openatlas/tenant-skills/demo/browser-final-v3-1780748190__1.0.0",
  "extracted_files": 3,
  ...
}
```

**Errors:**
- `400` "file must be a .zip" | "zip must contain a SKILL.md file" | "SKILL.md frontmatter missing required field: name" | "zip-slip detected: '../escape.md' escapes target dir" | "empty file" | "zip too large" | "scope must be user | tenant | global"
- `403` "only system_admin can import global skills" | "only tenant_admin can import tenant-scoped skills"
- `409` "skill '<name>' v<version> already exists"

### 3.2 YAML frontmatter parser (no PyYAML)

25 lines, accepts:
- `key: value`
- `key: "quoted value"`
- `key: [a, b, c]` (list)
- `key:` (followed by indented `- item` lines, list)

Hermes skill frontmatters are small (≤20 lines, no nested maps). No need for full YAML.

### 3.3 Isolation

Extracted files go to `OPENATLAS_HOME/tenant-skills/{tenant_slug}/`. This directory is **outside**:
- `~/.hermes/` (the live local Hermes)
- `OPENATLAS_HOME/hermes-runtime/` (the OpenAtlas-owned hermes-agent copy)
- `OPENATLAS_HOME/hermes-tenants/{tenant}/.hermes/` (the per-tenant hermes home)

If we ever need to "activate" a skill in a hermes runtime, Phase 4 will copy it from `tenant-skills/` to `hermes-tenants/{tenant}/.hermes/skills/`. That's a P4 concern.

---

## 4. Frontend

### 4.1 UI changes

**Button bar in SkillMarket:**
- Old: `[发布新技能]`
- New: `[从 ZIP 导入]  [发布新技能]`

**New ImportModal:**
- `Upload.Dragger` with `.zip` accept, 10MB max
- Scope select (user/tenant/global, options disabled if no permission)
- Disabled 导入 button until file selected
- Success alert: shows name, scope, visibility, mutable, extracted_path, files count

### 4.2 Critical bug found during browser test

`importSkillFromZip` originally used `localStorage.getItem('openatlas_token')`. The real key (set by `apiFetch`) is `'openatlas_access_token'` (constant `TOKEN_KEY`). The function silently 401'd.

**Root-cause method:** `Object.keys(localStorage)` in browser console revealed the real key.

**Fix:** Use the constant. One-line patch.

**Lesson:** Never invent storage key strings in new code. Grep the codebase for the established constant.

### 4.3 Multipart fetch bypass

The shared `apiFetch` helper adds `Content-Type: application/json` to every request. For `multipart/form-data`, the browser must set the Content-Type automatically with the correct boundary. So `importSkillFromZip` uses raw `fetch()`.

```ts
const fd = new FormData();
fd.append('file', file);
const resp = await fetch('/api/skill-market/import?scope=user', {
  method: 'POST',
  headers: token ? { Authorization: `Bearer ${token}` } : {},
  body: fd,
  // NO Content-Type — let the browser set it
});
```

---

## 5. Verification

### 5.1 Backend unit tests — `/tmp/verify_p37.py`

10/10 PASS:

| # | Test | Expected | Got |
|---|------|----------|-----|
| 1 | Good ZIP, scope=user | 200 | 200 ✓ |
| 2 | No SKILL.md | 400 | 400 ✓ |
| 3 | Missing `name` field | 400 | 400 ✓ |
| 4 | Plain text, not zip | 400 | 400 ✓ |
| 5 | Zip-slip `../escape.md` | 400 | 400 ✓ |
| 6 | Duplicate name+version | 409 | 409 ✓ |
| 7 | `scope=tenant` as system_admin | 200 | 200 ✓ |
| 8 | `scope=tenant` as acme tenant_admin (his tenant) | 200 | 200 ✓ |
| 9 | Empty file | 400 | 400 ✓ |
| 10 | .txt extension (zip content) | 400 | 400 ✓ |

### 5.2 Browser E2E

1. Login as `admin@demo.openatlas`
2. Navigate to `/skill-market`
3. Click `从 ZIP 导入`
4. Drag-drop a real `SKILL.zip` (pre-built with timestamped name)
5. Click `导 入`
6. Modal shows: `"已导入 browser-final-v3-1780748190 v1.0.0"` + extracted path + files count
7. Disk verification: `ls /Users/macbook/.openatlas/tenant-skills/demo/browser-final-v3-1780748190__1.0.0/` → `SKILL.md`, `references/example.md`, `scripts/hello.sh` all present
8. DB verification: `GET /api/skill-market` lists the new skill with `source_ref="zip:..."`
9. **Isolation check**: `~/.hermes/` mtime unchanged; no files written to `hermes-runtime/skills/` or `hermes-tenants/demo/.hermes/skills/`

### 5.3 Build

`npm run build`: ✓ built in 10.04s (no new TS errors; pre-existing 100+ are tsconfig lib: "es5" issues, not blockers).

---

## 6. Lessons (7 真坑)

1. **Storage key strings** — use the constant. Bug cost 5 min of silent 401.
2. **Multipart bypass** — `apiFetch` can't handle file uploads; use raw `fetch()`.
3. **YAML subset is enough** — 25 lines of Python beats a `pip install pyyaml`.
4. **Zip-slip** — `zipfile.extractall()` is NOT safe on its own; always check `.resolve().startswith()`.
5. **Antd Upload + React E2E** — programmatic file injection requires React fiber onClick invocation, not `.click()`.
6. **Versioned duplicate check** — name+version, not just name, so v1.1.0 can coexist with v1.0.0.
7. **Test idempotency** — suffix all test skill names with `int(time.time())` to avoid leftover state.

---

## 7. Status

**P3.7 SHIPPED.**
- Backend: 10/10 tests pass
- Frontend: vite build passes, browser E2E confirmed
- Disk: 10 sample extractions verified
- DB: 10 zip-sourced skills in `skill_packages` table
- Audit: `skill.import_zip` entries in audit log
- Isolation: 100% — never touched `~/.hermes/` or `hermes-runtime/skills/`

---

## 8. Next candidates (P3.8+)

- **P3.8: 群聊 / 切换历史会话** — handleSwitchConversation at CommandCenter.tsx:561 may have FNV-1a shim pollution (sets `setActiveEmployee({id: empId, ...})` without `__id`).
- **P3.9: Skill fork/copy → employee binding workflow** — wires the existing `forkSkill` API to a new "Bind to Employee" UX in SkillMarket.
- **P3.10: Cleanup tsconfig** — `lib: "es5"` → `lib: ["es2020", "dom"]` clears 100+ pre-existing TS errors.
- **P3.11: Skill activation pipeline** — when a skill is bound to a profile, copy from `tenant-skills/` to that tenant's `hermes-tenants/{tenant}/.hermes/skills/` and restart the gateway.
- **P4.0: Sandbox** — Docker/credential isolation per tenant.
