# SESSION LOG — OpenAtlas Phase 3.7 Skill ZIP Import

**Date:** 2026-06-06
**Sprint:** P3.7 (originally P3.6.6 — promoted to standalone sprint per 王六 B option)
**Status:** COMPLETE

---

## 1. Reality probe findings

Before writing code, did a 30-second grep/ls:

- **Hermes skills live in**: `~/.openatlas/hermes-runtime/{skills,optional-skills,plugins}/<name>/SKILL.md`
- **Format**: YAML frontmatter (name/version/author/category/metadata.hermes.tags) + markdown body
- **Current OpenAtlas DB**: has `skill_packages` table with `source_ref` (empty string) — perfect place to record ZIP path
- **No ZIP import code existed** — all skills created via `POST /api/skill-market` (metadata only, no actual files on disk)
- **Frontend SkillMarket.tsx**: has "发布新技能" button (metadata-only) — no file upload UI
- **Files in scope**: `backend/app/main.py` (2000+ lines), `frontend/src/services/api.ts` (683 lines), `frontend/src/pages/SkillMarket.tsx` (145 lines)

## 2. Design decisions

- **No PyYAML dependency** — wrote a 25-line YAML frontmatter parser (only flat key-value, no nested). Hermes skills have tiny frontmatters; we don't need full YAML.
- **Extract to** `OPENATLAS_HOME/tenant-skills/{tenant_slug}/{skill_slug}__{version}/` — NOT into hermes runtime. OpenAtlas owns this directory; doesn't touch hermes-runtime/skills/ or `~/.hermes`.
- **Isolation maintained**: ZIP contents go to `~/.openatlas/tenant-skills/...`, never `~/.hermes/`. Verified after import.
- **Duplicate check**: name+version (not just name) — versioned skills should be allowed to coexist.
- **Permission**: `global` = system_admin only; `tenant` = tenant_admin or system_admin; `user` = anyone.
- **No `pip install` for security**: zip-slip check uses pure-Python `Path.resolve().startswith()`.
- **No new frontmatter validation library**: 25 lines of regex/string parsing is enough.
- **Frontend uses raw `fetch` (not `apiFetch`)** for this endpoint because multipart/form-data needs different Content-Type handling.

## 3. Implementation (5 sub-items)

### 3.1 Backend endpoint — `backend/app/main.py`
- Added imports: `io`, `zipfile`, `FastAPI.File`, `FastAPI.UploadFile`
- Added helpers: `_YAML_FRONT_RE`, `_ZIP_MAX_BYTES = 10MB`, `_parse_skill_md()`, `_slugify_zip_skill()`
- Added endpoint `POST /api/skill-market/import` (Form data: `file`, query: `scope`)
- Validates: .zip extension, ≤10MB, has SKILL.md, SKILL.md has name+version in frontmatter
- Zip-slip check: every member path must `startswith(base_extract)`
- Duplicate check: name+version already in tenant
- Extracts to disk, creates SkillPackage, writes `skill.import_zip` audit log
- Returns skill dict + `extracted_path` + `extracted_files` count

### 3.2 Frontend API client — `frontend/src/services/api.ts`
- Added `importSkillFromZip(file, scope)` function
- Uses raw `fetch` (bypasses `apiFetch`'s JSON Content-Type)
- Auth token from `localStorage.getItem(TOKEN_KEY)` (`openatlas_access_token`)

### 3.3 Frontend UI — `frontend/src/pages/SkillMarket.tsx`
- Added "从 ZIP 导入" button next to "发布新技能"
- New `ImportModal` component with `Upload.Dragger`, scope select, success alert
- Disabled 导入 button when no file selected
- Result alert shows: name/version/scope/visibility/mutable/extracted_path/files count

### 3.4 Validation — `/tmp/verify_p37.py`
**10/10 PASS** after fixing test setup (use TS-suffixed names to avoid leftover collisions):
| # | Case | Expected | Actual |
|---|------|----------|--------|
| 1 | Good ZIP, scope=user | 200 | 200 ✓ (3 files extracted) |
| 2 | No SKILL.md | 400 | 400 ✓ |
| 3 | Missing `name` field | 400 | 400 ✓ |
| 4 | Plain text (not zip) | 400 | 400 ✓ |
| 5 | Zip-slip `../escape.md` | 400 | 400 ✓ |
| 6 | Duplicate name+version | 409 | 409 ✓ |
| 7 | `scope=tenant` as system_admin | 200 | 200 ✓ |
| 8 | `scope=tenant` as acme tenant_admin (his own tenant) | 200 | 200 ✓ |
| 9 | Empty file | 400 | 400 ✓ |
| 10 | .txt extension (zip content) | 400 | 400 ✓ |

### 3.5 Browser E2E — `/skill-market` page
- **Bugs found and fixed during browser test:**
  1. `importSkillFromZip` used wrong localStorage key (`'openatlas_token'` instead of `TOKEN_KEY='openatlas_access_token'`) → silent 401. **Root-caused** by checking `localStorage.keys()` to find the real key, then patched line 447. This is the **#1 lesson** of this sprint: never invent storage key strings; use the constant the rest of the codebase uses.
  2. Antd Upload.Dragger doesn't accept file via `input.files = dt.files` cleanly when bypassed programmatically — required React fiber `__reactProps` onClick invocation. Real users drag-and-drop or click, so the Antd UX works. But the E2E test needs the React-fiber trick.
- **After fix:** uploaded `browser-final-v3-1780748190` v1.0.0 from browser → DB row created → 3 files extracted to disk → success alert "已导入 browser-final-v3-1780748190 v1.0.0" shown in modal.

## 4. File changes summary

| File | Change |
|------|--------|
| `backend/app/main.py` | +3 imports (io, zipfile, FastAPI File/UploadFile); +_YAML_FRONT_RE; +_ZIP_MAX_BYTES; +_parse_skill_md(); +_slugify_zip_skill(); +`@app.post("/api/skill-market/import")` endpoint (~190 lines) |
| `frontend/src/services/api.ts` | +`importSkillFromZip()` function (1 line of behavior + 18 lines) — fixed TOKEN_KEY bug |
| `frontend/src/pages/SkillMarket.tsx` | +Antd imports (Upload, Space, Alert, InboxOutlined, FileZipOutlined); +"从 ZIP 导入" button; +`showImport` state; +`ImportModal` component (~70 lines) |
| `frontend/public/p37-test/skill.zip` | Test ZIP (E2E only, 730 bytes) |

## 5. Files extracted (sample, on disk at `/Users/macbook/.openatlas/tenant-skills/demo/`)

```
browser-uploaded-skill-1780747513__1.0.0/
  SKILL.md
  references/example.md
  scripts/hello.sh
browser-final-v3-1780748190__1.0.0/
  SKILL.md
  references/example.md
  scripts/hello.sh
tenant-skill-test-1780747337__2.0.0/
  SKILL.md
zip-test-skill-1780747301__1.0.0/
  SKILL.md
  references/example.md
  scripts/hello.sh
zip-test-dup-1780747337__1.0.0/  (duplicate test)
  SKILL.md
... ~10 total directories
```

All under `OPENATLAS_HOME/tenant-skills/`. **None** under `~/.hermes/`. **None** under `OPENATLAS_HOME/hermes-runtime/skills/`. Isolation maintained.

## 6. 7 真坑 (lessons)

1. **Storage key strings** — use `TOKEN_KEY` constant, never hard-code. The 1-line bug made the whole UI flow silently 401.
2. **Multipart fetch bypass** — `apiFetch` adds `Content-Type: application/json`; must use raw `fetch()` for file uploads.
3. **YAML subset is enough** — Hermes skills have ≤30 lines of frontmatter; 25 lines of Python parsing > adding a PyYAML dep.
4. **Zip-slip** — even with Python's safe `extractall`, malicious `../` paths can still escape. Always `.resolve().startswith()` check.
5. **Antd Upload + React E2E** — `input.files = dt.files` works for set, but Antd Upload's `useState` doesn't sync via direct DOM mutation. Need React fiber onClick invocation for headless E2E.
6. **Duplicate check is by name+version** — versioned skills (v1.0.0, v1.1.0) should coexist. Single-name check would block legitimate version bumps.
7. **Test idempotency** — 6 test runs × 5 unique skill names = 30 leftover skills. Always suffix with timestamp.

## 7. Status

- **Backend**: 10/10 verify_p37.py tests pass
- **Frontend build**: `npm run build` passes (10.04s, 0 errors)
- **Browser E2E**: ZIP uploaded via UI → DB row → 3 files on disk → success alert shown
- **Isolation**: `~/.hermes/` mtime unchanged; all extracted to `~/.openatlas/tenant-skills/`
- **Sprint 3.7 complete.** Ready for next.

## 8. Next candidates

- **P3.8 (群聊 / 切换历史会话)**: handleSwitchConversation may have FNV-1a shim pollution at line 561 (sets `setActiveEmployee({id: empId, ...})` where empId is openatlas session's employee_id UUID but doesn't carry `__id`).
- **P3.9 (Skill fork/copy from global → employee)**: Wires the existing `forkSkill` API to a new "Bind to Employee" workflow in SkillMarket.
- **Cleanup**: tsconfig lib: "es5" → es2018+ to clear 100+ pre-existing TS errors (vite build passes anyway).
