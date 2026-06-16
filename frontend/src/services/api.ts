/**
 * OpenAtlas API service — all data from backend, no mock.
 *
 * ID model: per spec §3.3, all entity IDs are UUID strings.  To minimize
 * touching the existing component code that uses `number | null` for
 * `employee_id`, this layer coerces the string UUID to a stable numeric
 * hash for *display only* (route keys, Map lookups).  The original UUID
 * is preserved in `__id` (string) on every record.
 *
 * Auth: Bearer token from /api/auth/login, stored in localStorage.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api';
const TOKEN_KEY = 'openatlas_access_token';

// 32-bit FNV-1a hash of a UUID → 31-bit non-negative integer
function hashToInt(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h & 0x7fffffff;
}

function withIdShim<T extends { id: string }>(o: T): T & { id: number; __id: string } {
  return { ...o, id: hashToInt(o.id), __id: o.id };
}

function withNullableIdShim<T extends { id: string | null }>(o: T): T & { id: number | null; __id: string | null } {
  return { ...o, id: o.id == null ? null : hashToInt(o.id), __id: o.id };
}

/* ── Types — string IDs per spec ── */

export interface Employee {
  __id: string;
  id: number;            // derived numeric for legacy components
  display_name: string;
  name: string;          // alias = display_name
  avatar_char: string;
  avatar: string;
  description: string;
  status: string;
  status_text: string;
  mood: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  profile_name: string;
  model: string;
  provider: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  toolsets: string[];
  allowed_toolsets?: string[] | null;
  // legacy fields used by older components/pages, optional
  department?: { name: string; color: string } | null;
  skills?: string[];
  conversation_count?: number;
  total_messages?: number;
  last_conversation_at?: string | null;
  total_tokens?: number;
  role?: string;
}

export interface Conversation {
  __id: string;
  id: number;
  employee_id: number | null;
  hermes_session_id: string;
  title: string;
  status: string;
  task_status?: string;
  task_summary?: string;
  created_at: string;
  updated_at: string;
  last_message: string;
  message_count: number;
  is_group?: boolean;
  participant_ids?: string[] | null;
  pinned?: boolean;
  workspace?: string;
  model_override?: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  token_count: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  speaker_employee_id?: string | number | null;
  speaker_name?: string;
  turn_index?: number | null;
  created_at: string;
}

export interface MemoryEntry {
  __id: string;
  id: number;
  scope: 'global' | 'tenant' | 'user' | 'employee';
  title: string;
  content: string;
  tags: string[];
  priority: number;
  visibility: string;
  mutable: boolean;
  status: string;
  version: number;
  employee_id: number | null;
  created_at: string;
  updated_at: string;
  source?: 'openatlas' | 'hermes';
  locked?: boolean;
}

export interface SkillPackage {
  __id: string;
  id: number;
  scope: 'global' | 'tenant' | 'user' | 'employee';
  name: string;
  slug: string;
  description: string;
  category: string;
  version: string;
  visibility: string;
  mutable: boolean;
  status: string;
  source_ref?: string;
  binding_count?: number;
  bound_employee_count?: number;
  disable_impact?: { binding_count?: number; employee_count?: number };
  ability_description?: string;
  input_example?: string;
  output_example?: string;
  suitable_employees?: string[];
  risk_level?: string;
  health?: {
    run_count?: number;
    failure_count?: number;
    failure_rate?: number;
    last_run_at?: string | null;
    last_error?: string | null;
  };
  created_at: string;
}

export interface AuditLog {
  id: number;
  user: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  created_at: string;
}

export interface StreamChunk {
  event_type?: string;
  event?: string;
  content?: string;
  done?: boolean;
  conversation_id?: number | string;
  error?: string;
  tool?: {
    name: string;
    label?: string;
    status?: string;
    toolCallId?: string;
    args?: any;
    result?: any;
    error?: string;
    duration?: number | string;
    preview?: string;
    command?: string;
    delta?: string;
    hermes_run_id?: string;
    runtime_event?: string;
  };
  memories?: MemoryEntry[];
  files?: UploadedFile[];
  skills?: any[];
  aborted?: boolean;
  openatlas_session_id?: string;
  items?: any[];
  delta?: string;
  tool_name?: string;
  label?: string;
  tool_call_id?: string;
  message?: string;
  detail?: string;
  text?: string;
  run_id?: string;
  hermes_run_id?: string;
  agent_id?: number | string;
  speaker_employee_id?: number | string | null;
  speaker_name?: string;
  turn_index?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  reasoning?: { text?: string; hermes_run_id?: string };
  approval_required?: {
    hermes_run_id?: string;
    run_id?: string;
    approval_id?: string;
    command?: string;
    description?: string;
    pattern_key?: string;
    pattern_keys?: string[];
    choices?: string[];
    tool_name?: string;
    source?: string;
    timeout_ms?: number;
  };
  approval_responded?: { choice?: string; resolved?: number; hermes_run_id?: string };
  task_state?: {
    session_id?: string;
    task_status?: string;
    reason?: string;
    openatlas_session_id?: string;
  };
  trace?: any;
}

export interface ChatResponse {
  message: Message;
  conversation_id: number;
}

export interface ToolEvent {
  name: string;
  label?: string;
  toolCallId?: string;
  status?: 'running' | 'completed' | string;
  args?: any;
  result?: any;
  error?: string;
  duration?: number | string;
  preview?: string;
  command?: string;
  delta?: string;
  hermes_run_id?: string;
  runtime_event?: string;
}

export interface LoginIn { email: string; password: string; }
export interface LoginOut { access_token: string; user: any; tenant: any; }

/* ── Helpers ── */

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options?.body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    if (!path.startsWith('/auth/')) window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail = text || response.statusText;
    try {
      const j = JSON.parse(text);
      if (j?.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
    } catch { /* not JSON */ }
    throw new Error(`API ${response.status}: ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

/* ── Auth ── */

export async function login(email: string, password: string): Promise<LoginOut> {
  const out = await apiFetch<LoginOut>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem(TOKEN_KEY, out.access_token);
  return out;
}

// Legacy aliases for components that haven't been migrated
export const loginApi = login;

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = '/login';
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export async function fetchMe(): Promise<any> {
  return apiFetch('/auth/me');
}

// Legacy alias used by AuthContext.tsx
export const fetchCurrentUser = fetchMe;

/* ── Employees ── */

function normalizeEmployee(e: any) {
  return {
    ...e,
    name: e.display_name,
    avatar_char: e.avatar,
    status_text: e.status,
    mood: '',
    is_active: e.status === 'active',
    conversation_count: Number(e.conversation_count || 0),
    total_messages: Number(e.total_messages || 0),
    total_tokens: Number(e.total_tokens || 0),
  };
}

export async function fetchEmployees(): Promise<Employee[]> {
  const r = await apiFetch<{ items: any[] }>('/employees');
  return r.items
    .filter((e) => e?.status !== 'archived')
    .map((e) => withIdShim(normalizeEmployee(e))) as any;
}

export async function fetchEmployeeDetail(id: string): Promise<Employee & { skills: any[] }> {
  const realId = await resolveEmployeeUuid(id);
  const e = await apiFetch<any>(`/employees/${realId || id}`);
  return { ...withIdShim(normalizeEmployee(e)),
           skills: e.skills || [] } as any;
}

export async function createEmployee(body: {
  display_name: string;
  description?: string;
  avatar?: string;
  system_prompt?: string;
  toolsets?: string[];
  initial_skill_ids?: string[];
  model?: string;
}): Promise<Employee> {
  const e = await apiFetch<any>('/employees', { method: 'POST', body: JSON.stringify(body) });
  return withIdShim(normalizeEmployee(e)) as any;
}

export async function patchEmployee(id: string, body: any): Promise<Employee> {
  const e = await apiFetch<any>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  return withIdShim(normalizeEmployee(e)) as any;
}

export async function dismissEmployee(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/employees/${id}`, { method: 'DELETE' });
}

/* ── Sessions / chat ── */

export async function fetchSessions(): Promise<Conversation[]> {
  const r = await apiFetch<{ items: any[] }>('/sessions');
  return r.items.map((s) => withIdShim({ ...s, status: 'active' })) as any;
}

// Bug 3/4/11 (2026-06-06): 加 participantIds 参 (群聊接力员工 UUID 列表).
// 之前 createSession 只发 { employee_id, title } 不传 relays, 后端收到的是
// 空 list, 群聊 = 单聊.  现在后端 SessionRecord.participant_ids 存 relays,
// list_sessions 透传, chat stream 串行 dispatch.
export async function createSession(
  employeeId: string | null,
  title: string,
  participantIds?: string[],
): Promise<Conversation> {
  const s = await apiFetch<any>('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      employee_id: employeeId,
      title,
      participant_ids: participantIds || [],
    }),
  });
  return withIdShim({ ...s, status: 'active' }) as any;
}

export async function fetchSessionMessages(id: string | number): Promise<{ data: Message[] }> {
  // FNV-1a shim safety: resolve shim int → real UUID before hitting backend.
  const realId = await resolveRealSessionId(id);
  const r = await apiFetch<any>(`/sessions/${realId}/messages`);
  return { data: r.data || r.items || [] };
}

export async function approveHermesRun(
  runId: string,
  choice: 'once' | 'session' | 'always' | 'deny' = 'deny',
  resolveAll = false,
  approvalId?: string,
): Promise<any> {
  return apiFetch(`/hermes-runs/${encodeURIComponent(runId)}/approval`, {
    method: 'POST',
    body: JSON.stringify({ choice, resolve_all: resolveAll, approval_id: approvalId }),
  });
}

export async function stopHermesRun(runId: string, reason = 'user_requested'): Promise<any> {
  return apiFetch(`/hermes-runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function forkSession(
  id: string | number,
  title = '',
): Promise<Conversation> {
  const realId = await resolveRealSessionId(id);
  const r = await apiFetch<any>(`/sessions/${realId}/fork`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return withIdShim({ ...r, status: 'active' }) as any;
}

export async function patchSession(
  id: string | number,
  patch: {
    title?: string;
    pinned?: boolean;
    workspace?: string;
    model_override?: string;
  },
): Promise<Conversation> {
  const realId = await resolveRealSessionId(id);
  const r = await apiFetch<any>(`/sessions/${realId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return withIdShim({ ...r, status: 'active' }) as any;
}

export async function* streamChat(
  sessionId: string, message: string,
  opts?: {
    attachmentIds?: string[];
    relayEmployeeIds?: string[];
    primaryEmployeeId?: string | null;
    reasoningEffort?: string;
    signal?: AbortSignal;
  },
): AsyncGenerator<StreamChunk, void, undefined> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}/sessions/${sessionId}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message,
      ...(opts?.attachmentIds?.length ? { attachment_ids: opts.attachmentIds } : {}),
      ...(opts?.relayEmployeeIds?.length ? { relay_employee_ids: opts.relayEmployeeIds } : {}),
      ...(opts?.primaryEmployeeId ? { primary_employee_id: opts.primaryEmployeeId } : {}),
      ...(opts?.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
    }),
    signal: opts?.signal,  // P3.12 3.4.3: 切会话时 abort
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    yield { event_type: 'error', error: text || resp.statusText };
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let evName = 'message';
        let dataLines: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) evName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        const dataStr = dataLines.join('\n');
        if (!dataStr && evName === 'message') continue;
        let parsed: any = {};
        try { parsed = dataStr ? JSON.parse(dataStr) : {}; } catch { parsed = { raw: dataStr }; }
        yield { event: evName, event_type: evName, ...parsed } as StreamChunk;
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      yield { event_type: 'aborted', aborted: true };
    } else {
      yield { event_type: 'error', error: String(e) };
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

/* ── Capabilities / models / runtime ── */

export async function fetchCapabilities(): Promise<any> { return apiFetch('/capabilities'); }
export async function fetchModels(): Promise<any> { return apiFetch('/models'); }
export async function fetchToolsets(): Promise<any> { return apiFetch('/toolsets'); }
export async function fetchToolsetGovernance(): Promise<any> { return apiFetch('/toolsets/governance'); }
export async function updateEmployeeToolsets(employeeId: string, toolsets: string[]): Promise<any> {
  return apiFetch(`/employees/${employeeId}/toolsets`, {
    method: 'PATCH',
    body: JSON.stringify({ toolsets }),
  });
}
export async function fetchRuntimeHealth(): Promise<any> { return apiFetch('/runtime/health'); }
export async function fetchRuntimeStatus(): Promise<any> { return apiFetch('/runtime/status'); }
export async function fetchRuntimeDiagnostics(): Promise<any> { return apiFetch('/runtime/diagnostics'); }
export async function fetchRuntimeLogs(kind = 'gateway', tail = 120): Promise<any> {
  const q = new URLSearchParams({ kind, tail: String(tail) });
  return apiFetch(`/runtime/logs?${q.toString()}`);
}
export async function runRuntimeOperation(action: string): Promise<any> {
  return apiFetch(`/runtime/ops/${encodeURIComponent(action)}`, { method: 'POST', body: '{}' });
}
export async function fetchTenantIsolation(): Promise<any> { return apiFetch('/tenant/isolation'); }
export async function fetchJobs(): Promise<any> { return apiFetch('/jobs'); }

/* ── Skill Market ── */

export async function fetchSkillMarket(): Promise<SkillPackage[]> {
  const r = await apiFetch<{ items: any[] }>('/skill-market');
  return r.items.map((s) => withIdShim(s)) as any;
}

export async function createSkill(body: {
  name: string; slug: string; description?: string; category?: string;
  scope: 'global' | 'tenant' | 'user'; visibility?: string; mutable?: boolean;
}): Promise<SkillPackage> {
  const s = await apiFetch<any>('/skill-market', { method: 'POST', body: JSON.stringify(body) });
  return withIdShim(s) as any;
}

export async function syncHermesSkills(): Promise<any> {
  const r = await apiFetch<any>('/skill-market/sync-hermes', { method: 'POST', body: '{}' });
  return { ...r, items: (r.items || []).map((s: any) => withIdShim(s)) };
}

export async function fetchSkillHealth(): Promise<any> {
  return apiFetch('/skill-market/health');
}

export async function reconcileHermesSkills(): Promise<any> {
  return apiFetch('/skill-market/reconcile-hermes');
}

export async function browseHermesSkillsHub(params: {
  page?: number; size?: number; source?: string;
} = {}): Promise<any> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.size) q.set('size', String(params.size));
  if (params.source) q.set('source', params.source);
  return apiFetch(`/hermes-skills/hub/browse?${q.toString()}`);
}

export async function searchHermesSkillsHub(params: {
  q: string; source?: string; limit?: number;
}): Promise<any> {
  const q = new URLSearchParams({ q: params.q });
  if (params.source) q.set('source', params.source);
  if (params.limit) q.set('limit', String(params.limit));
  return apiFetch(`/hermes-skills/hub/search?${q.toString()}`);
}

export async function inspectHermesSkill(identifier: string): Promise<any> {
  const q = new URLSearchParams({ identifier });
  return apiFetch(`/hermes-skills/hub/inspect?${q.toString()}`);
}

export async function installHermesSkill(body: {
  identifier: string; source?: string; category?: string; name?: string; force?: boolean;
}): Promise<any> {
  return apiFetch('/hermes-skills/hub/install', { method: 'POST', body: JSON.stringify(body) });
}

export async function hermesSkillLifecycleAction(
  action: 'check' | 'update' | 'audit' | 'uninstall' | 'opt-out' | 'opt-in' | 'reset' | 'repair-official',
  body: {
    name?: string; deep?: boolean; restore?: boolean; remove?: boolean; sync?: boolean; force?: boolean;
  } = {},
): Promise<any> {
  return apiFetch(`/hermes-skills/hub/${action}`, { method: 'POST', body: JSON.stringify(body) });
}

export async function exportHermesSkillSnapshot(): Promise<any> {
  return apiFetch('/hermes-skills/hub/snapshot/export', { method: 'POST', body: '{}' });
}

export async function importHermesSkillSnapshot(path: string, force = false): Promise<any> {
  return apiFetch('/hermes-skills/hub/snapshot/import', {
    method: 'POST',
    body: JSON.stringify({ path, force }),
  });
}

export async function listHermesSkillTaps(): Promise<any> {
  return apiFetch('/hermes-skills/hub/taps');
}

export async function addHermesSkillTap(repo: string): Promise<any> {
  return apiFetch('/hermes-skills/hub/taps', { method: 'POST', body: JSON.stringify({ name: repo }) });
}

export async function removeHermesSkillTap(name: string): Promise<any> {
  return apiFetch(`/hermes-skills/hub/taps/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function bindSkill(skillId: string, body: {
  target_type: 'user' | 'employee'; target_id: string; binding_mode?: string;
}): Promise<any> {
  return apiFetch(`/skill-market/${skillId}/bind`, {
    method: 'POST',
    body: JSON.stringify({ ...body, skill_id: skillId }),
  });
}

/* ── Memory Center ── */

export async function fetchMemories(scope?: string): Promise<MemoryEntry[]> {
  const q = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  const r = await apiFetch<{ items: any[] }>(`/memories${q}`);
  return r.items.map((m) => withNullableIdShim({ ...m, source: 'openatlas' as const })) as any;
}

export async function createMemory(body: {
  scope: 'global' | 'tenant' | 'user' | 'employee';
  title: string; content: string; tags?: string[];
  priority?: number; visibility?: string; mutable?: boolean;
  employee_id?: string;
}): Promise<MemoryEntry> {
  const m = await apiFetch<any>('/memories', { method: 'POST', body: JSON.stringify(body) });
  return withNullableIdShim({ ...m, source: 'openatlas' as const }) as any;
}

export async function patchMemory(id: string, body: any): Promise<MemoryEntry> {
  const m = await apiFetch<any>(`/memories/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  return withNullableIdShim({ ...m, source: 'openatlas' as const }) as any;
}

export async function archiveMemory(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/memories/${id}/archive`, { method: 'POST' });
}

export async function fetchEffectiveMemories(employeeId?: string): Promise<MemoryEntry[]> {
  const q = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : '';
  const r = await apiFetch<{ items: any[] }>(`/memories/effective${q}`);
  return r.items.map((m) => withNullableIdShim({ ...m, source: 'openatlas' as const, locked: m.locked })) as any;
}
/* ── Dashboard ── */

export async function fetchDashboardMe(): Promise<any> { return apiFetch('/dashboard/me'); }
export async function fetchDashboardTenant(): Promise<any> { return apiFetch('/dashboard/tenant'); }
export async function fetchDashboardSystem(): Promise<any> { return apiFetch('/dashboard/system'); }

export async function refreshSessionSummary(sessionId: string | number): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/summary`, { method: 'POST', body: '{}' });
}

export async function patchSessionTaskStatus(sessionId: string | number, task_status: string): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/task-status`, {
    method: 'PATCH',
    body: JSON.stringify({ task_status }),
  });
}

export async function fetchRunQueue(): Promise<any[]> {
  const r = await apiFetch<{ items: any[] }>('/run-queue');
  return r.items || [];
}

export async function resumeSessionTask(sessionId: string | number, message = ''): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/resume`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export async function fetchSessionContext(sessionId: string | number): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/context`);
}

export async function fetchSessionArtifacts(sessionId: string | number): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/artifacts`);
}

export async function archiveArtifact(artifactId: string): Promise<any> {
  return apiFetch(`/artifacts/${artifactId}/archive`, { method: 'POST', body: '{}' });
}


/* ════════════════════════════════════════════════════════════════════════
 * Phase 3.5 — Job lifecycle, Skill Market publish/fork/disable, Memory fork/bind
 * ════════════════════════════════════════════════════════════════════════ */

/* Jobs */

export async function createJob(body: {
  name: string; description?: string; schedule_kind?: string;
  schedule_expr?: string; employee_id?: string | null;
  skills?: string[]; toolsets?: string[];
  deliver?: string; prompt?: string;
}): Promise<any> {
  return apiFetch('/jobs', { method: 'POST', body: JSON.stringify(body) });
}
export async function getJob(id: string): Promise<any> { return apiFetch(`/jobs/${id}`); }
export async function patchJob(id: string, body: any): Promise<any> {
  return apiFetch(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function deleteJob(id: string): Promise<{ ok: true }> {
  return apiFetch(`/jobs/${id}`, { method: 'DELETE' });
}
export async function pauseJob(id: string): Promise<any> {
  return apiFetch(`/jobs/${id}/pause`, { method: 'POST', body: '{}' });
}
export async function resumeJob(id: string): Promise<any> {
  return apiFetch(`/jobs/${id}/resume`, { method: 'POST', body: '{}' });
}
export async function runJob(id: string): Promise<any> {
  return apiFetch(`/jobs/${id}/run`, { method: 'POST', body: '{}' });
}

/* Skill Market — extended CRUD */

export async function getSkill(id: string): Promise<any> { return apiFetch(`/skill-market/${id}`); }
export async function patchSkill(id: string, body: any): Promise<any> {
  return apiFetch(`/skill-market/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function publishSkill(id: string): Promise<any> {
  return apiFetch(`/skill-market/${id}/publish`, { method: 'POST', body: '{}' });
}
export async function disableSkill(id: string): Promise<any> {
  return apiFetch(`/skill-market/${id}/disable`, { method: 'POST', body: '{}' });
}
export async function forkSkill(id: string, target_scope: 'user' | 'employee', target_id?: string): Promise<any> {
  return apiFetch(`/skill-market/${id}/fork`, { method: 'POST', body: JSON.stringify({ target_scope, target_id }) });
}

/* Phase 3.7: ZIP import — multipart upload */
export async function importSkillFromZip(file: File, scope: 'user' | 'tenant' | 'global' = 'user'): Promise<any> {
  const fd = new FormData();
  fd.append('file', file);
  const token = localStorage.getItem(TOKEN_KEY) || '';
  // We must NOT use apiFetch because it adds Content-Type: application/json which breaks multipart.
  // Use raw fetch and bypass the JSON wrapper.
  const url = `${API_BASE}/skill-market/import?scope=${encodeURIComponent(scope)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!resp.ok) {
    let detail: any = `HTTP ${resp.status}`;
    try { const j = await resp.json(); detail = j.detail || j.message || j; } catch { /* non-json */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return resp.json();
}

export async function deleteSkillBinding(bindingId: string): Promise<{ ok: true }> {
  return apiFetch(`/skill-bindings/${bindingId}`, { method: 'DELETE' });
}

/* Phase 3.9: List skill bindings (used by EmployeeDetail + Skills page) */
export interface SkillBindingRow {
  id: string;
  skill_id: string;
  skill_name: string;
  skill_version: string;
  skill_scope: string;
  skill_category: string;
  target_type: string;
  target_id: string;
  binding_mode: string;
  enabled: boolean;
  locked: boolean;
  created_at: string | null;
}
export async function fetchSkillBindings(opts: {
  target_type?: 'employee' | 'user' | 'tenant';
  target_id?: string;
  skill_id?: string;
} = {}): Promise<SkillBindingRow[]> {
  const q = new URLSearchParams();
  if (opts.target_type) q.set('target_type', opts.target_type);
  if (opts.target_id) q.set('target_id', opts.target_id);
  if (opts.skill_id) q.set('skill_id', opts.skill_id);
  const qs = q.toString();
  const r = await apiFetch<{ items: SkillBindingRow[] }>(`/skill-bindings${qs ? `?${qs}` : ''}`);
  return r.items || [];
}

/* Memory — fork + bind + unbind */

export async function getMemory(id: string): Promise<any> { return apiFetch(`/memories/${id}`); }
export async function forkMemory(id: string, body: { target_scope: 'user' | 'employee'; employee_id?: string }): Promise<any> {
  return apiFetch(`/memories/${id}/fork`, { method: 'POST', body: JSON.stringify(body) });
}
export async function bindMemory(id: string, body: { target_type: string; target_id: string; injection_mode?: string; priority?: number }): Promise<any> {
  return apiFetch(`/memories/${id}/bind`, { method: 'POST', body: JSON.stringify(body) });
}
export async function deleteMemoryBinding(bindingId: string): Promise<{ ok: true }> {
  return apiFetch(`/memory-bindings/${bindingId}`, { method: 'DELETE' });
}


/* ════════════════════════════════════════════════════════════════════════
 * Legacy / shim layer — older components still import these names.  They
 * delegate to the new names above and adapt payloads.
 * ════════════════════════════════════════════════════════════════════════ */

// Conversational-sympathy aliases (old: Conversation, new: same; old: createConversation, new: createSession)
export const fetchConversations = fetchSessions;
async function resolveEmployeeUuid(id: number | string | null | undefined): Promise<string | null> {
  if (id == null) return null;
  if (typeof id === 'string' && id.includes('-')) return id;
  const emps = await fetchEmployees() as any[];
  const cached = emps.find((e: any) => e.id === id || e.__id === id || String(e.id) === String(id));
  return cached?.__id || (typeof id === 'string' ? id : null);
}

function titleFromQuery(query?: string | null) {
  const clean = String(query || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  return clean.length > 42 ? `${clean.slice(0, 42)}...` : clean;
}

export const createConversation = async (employeeId: number | string | null, title?: string) =>
  createSession(await resolveEmployeeUuid(employeeId), titleFromQuery(title));
// Bug 3/4/11 (2026-06-06): createGroupConversation 真传 relays.  之前只
// 调 createSession(employeeIds[0], title) 不传 relays, 后端收到空 list, 群聊
// 变单聊.  现在用 fetchEmployees() 拉一遍 (拿 __id 真 uuid) 把除主员工外的
// 所有员工 ID 传 participant_ids, 后端落库 SessionRecord.participant_ids.
export const createGroupConversation = async (
  employeeIds: (number | string)[] | number | string,
  relayIdsOrTitle?: (number | string)[] | string,
  maybeTitle?: string,
) => {
  const ids = Array.isArray(employeeIds)
    ? employeeIds
    : [employeeIds, ...(Array.isArray(relayIdsOrTitle) ? relayIdsOrTitle : [])];
  const title = typeof relayIdsOrTitle === 'string' ? relayIdsOrTitle : maybeTitle;
  const primary = ids[0] ?? '';
  const relayIds = ids.slice(1) || [];
  if (relayIds.length === 0) {
    return createSession(await resolveEmployeeUuid(primary), title || '群聊', []);
  }
  // relays 可能是 shim int (CommandCenter 调), 必须 fetch 真 uuid
  const emps = await fetchEmployees() as any[];
  const primaryUuid = await resolveEmployeeUuid(primary);
  const relayUuids = relayIds
    .map((id) => {
      const cached = emps.find((e) => (e as any).id === id) as any;
      return cached?.__id || (typeof id === 'string' ? id : null);
    })
    .filter(Boolean) as string[];
  return createSession(primaryUuid, title || '群聊', relayUuids);
};
export const deleteConversation = async (id: string | number) => {
  const realId = await resolveRealSessionId(id);
  return apiFetch<{ ok: true }>(`/sessions/${realId}`, { method: 'DELETE' });
};

// Canvas state — store on the session in the backend
export async function patchCanvasState(sessionId: string | number, state: any): Promise<{ ok: true }> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch<{ ok: true }>(`/sessions/${realId}/canvas-state`, {
    method: 'PATCH',
    body: JSON.stringify(state),
  });
}
export async function getCanvasState(sessionId: string | number): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/canvas-state`);
}
export async function logCanvasEvent(sessionId: string | number, payload?: any): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  const employeeId = payload?.employee_id ? await resolveEmployeeUuid(payload.employee_id).catch(() => payload.employee_id) : null;
  return apiFetch(`/sessions/${realId}/canvas-events`, {
    method: 'POST',
    body: JSON.stringify({
      employee_id: employeeId,
      event_type: payload?.event_type || payload?.type || 'canvas.event',
      node_id: payload?.node_id || payload?.nodeId || '',
      edge_id: payload?.edge_id || payload?.edgeId || '',
      payload: payload || {},
    }),
  });
}

export async function saveSessionTemplate(
  sessionId: string | number,
  body: {
    name: string;
    description?: string;
    category?: string;
    visibility?: string;
    strategy?: string;
    failure_strategy?: string;
    default_prompt?: string;
    output_type?: string;
  },
): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/save-template`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function fetchCollaborationTemplates(): Promise<any[]> {
  const r = await apiFetch<{ items: any[] }>('/collaboration-templates');
  return r.items || [];
}

export async function createSessionFromTemplate(
  templateId: string,
  body: { title?: string } = {},
): Promise<Conversation> {
  const s = await apiFetch<any>(`/collaboration-templates/${templateId}/sessions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return withIdShim({ ...s, status: 'active' }) as any;
}

// Admin / identity
export async function fetchAdminStats(): Promise<any> {
  return fetchDashboardMe();
}
export async function fetchTenants(): Promise<any[]> {
  const r = await apiFetch<{ items: any[] }>('/admin/tenants');
  return r.items || [];
}
export async function patchTenant(id: string, body: any): Promise<any> {
  return apiFetch(`/admin/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function fetchAdminTenantIsolation(id: string): Promise<any> {
  return apiFetch(`/admin/tenants/${id}/isolation`);
}
export async function fetchIdentityOverview(tenantId?: string): Promise<any> {
  const q = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  return apiFetch(`/admin/identity/overview${q}`);
}
export async function fetchOrgUnits(tenantId?: string): Promise<any[]> {
  const q = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  const r = await apiFetch<{ items: any[] }>(`/admin/org-units${q}`);
  return r.items || [];
}
export async function createOrgUnit(body: any): Promise<any> {
  return apiFetch('/admin/org-units', { method: 'POST', body: JSON.stringify(body) });
}
export async function patchOrgUnit(id: string, body: any): Promise<any> {
  return apiFetch(`/admin/org-units/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function deleteOrgUnit(id: string): Promise<{ ok: true }> {
  return apiFetch(`/admin/org-units/${id}`, { method: 'DELETE' });
}
export async function fetchAdminUsers(filter: { tenant_id?: string; org_unit_id?: string; q?: string } = {}): Promise<any[]> {
  const params = new URLSearchParams();
  if (filter.tenant_id) params.set('tenant_id', filter.tenant_id);
  if (filter.org_unit_id) params.set('org_unit_id', filter.org_unit_id);
  if (filter.q) params.set('q', filter.q);
  const qs = params.toString();
  const r = await apiFetch<{ items: any[] }>(`/admin/users${qs ? '?' + qs : ''}`);
  return r.items || [];
}
export async function createAdminUser(body: any): Promise<any> {
  return apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(body) });
}
export async function fetchAdminUserDetail(id: string): Promise<any> {
  return apiFetch(`/admin/users/${id}/detail`);
}
export async function patchAdminUser(id: string, body: any): Promise<any> {
  return apiFetch(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function moveAdminUsersOrg(body: { user_ids: string[]; org_unit_id?: string | null }): Promise<any> {
  return apiFetch('/admin/users/move-org', { method: 'POST', body: JSON.stringify(body) });
}
export async function deleteAdminUser(id: string): Promise<{ ok: true; user: any }> {
  return apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
}
export async function fetchPermissionMatrix(tenantId?: string): Promise<any> {
  const q = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  return apiFetch(`/admin/permission-matrix${q}`);
}
export async function patchPermissionMatrix(body: { tenant_id?: string | null; role: string; capability: string; allowed: boolean }): Promise<any> {
  return apiFetch('/admin/permission-matrix', { method: 'PATCH', body: JSON.stringify(body) });
}
export async function fetchAuditLogs(filter?: any): Promise<AuditLog[]> {
  const params = new URLSearchParams();
  ['action', 'resource_type', 'resource_id', 'user_id', 'since', 'until', 'q',
   'employee_id', 'skill_id', 'file_id', 'session_id'].forEach((key) => {
    if (filter?.[key]) params.set(key, filter[key]);
  });
  if (filter?.limit) params.set('limit', String(filter.limit));
  const qs = params.toString();
  const r = await apiFetch<{ items?: any[] } | any[]>(`/audit${qs ? '?' + qs : ''}`);
  const items = Array.isArray(r) ? r : (r.items || []);
  return items as any;
}

export async function exportAuditCsv(filter?: any): Promise<void> {
  const params = new URLSearchParams();
  params.set('fmt', 'csv');
  ['action', 'resource_type', 'resource_id', 'user_id', 'since', 'until', 'q',
   'employee_id', 'skill_id', 'file_id', 'session_id'].forEach((key) => {
    if (filter?.[key]) params.set(key, filter[key]);
  });
  const tok = getToken();
  const r = await fetch(`${API_BASE}/audit?${params.toString()}`, {
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
  });
  if (!r.ok) throw new Error(`csv export failed: ${r.status}`);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `openatlas-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}
export async function fetchDepartments(): Promise<any[]> {
  return [];
}
export async function fetchKnowledgeBases(): Promise<any[]> {
  return [];
}
export async function fetchSolutions(): Promise<any[]> {
  return [];
}

// Conversational detail (used by CommandCenter)
export async function fetchConversationDetail(id: string | number): Promise<any> {
  // FNV-1a shim safety: callers may pass either the shim int (key={item.id})
  // or a real UUID. Resolve to the real UUID before hitting backend.
  const realId = await resolveRealSessionId(id);
  const meta = await apiFetch<any>(`/sessions/${realId}`);
  const msgs = await fetchSessionMessages(realId);
  return { ...meta, messages: msgs.data || [] };
}

// Resolve a possibly-shimmed session identifier to the real backend UUID.
// Strategy: if `id` is a number OR a short numeric string, look up the full
// session list and find the one whose shim matches. Otherwise pass through.
async function resolveRealSessionId(id: string | number | undefined | null): Promise<string> {
  if (id == null) return '';
  const s = String(id);
  // Looks like a UUID already?
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return s;
  if (/^api_/.test(s)) return s; // hermes sid; pass through (calls may 404 but caller can disambiguate)
  // Try the list lookup
  try {
    const all = await fetchSessions();
    const hit = all.find((x: any) => String(x.id) === s || x.__id === s);
    if (hit?.__id) return hit.__id;
  } catch { /* ignore */ }
  return s; // best effort
}

// executeSkill — for now, return a synthetic tool event
export async function executeSkill(..._payload: any[]): Promise<any> {
  return { ok: true, message: 'skill executed (stub)' };
}

// updateMyQuickPrompts — store in localStorage
export async function updateMyQuickPrompts(prompts: string[]): Promise<{ ok: true; quick_prompts: string[] }> {
  localStorage.setItem('openatlas_quick_prompts', JSON.stringify(prompts));
  return { ok: true, quick_prompts: prompts };
}

// P3.12 (2026-06-07) Bug 7 / 3.4.1: uploadFile 真调后端, 返回 attachment_id
export interface UploadedFile {
  id: string;
  url?: string;  // 现在后端不返 url, 只返 id (前端要拿内容要再调 /api/files/{id})
  name: string;
  mime: string;
  size: number;
  status: string;
  extracted_chars: number;
  summary?: string;
  snippets?: Array<{ index: number; text: string }>;
  expires_at?: string | null;
  is_expired?: boolean;
}

export async function uploadFile(
  file: File,
  opts?: { sessionId?: string; employeeId?: string },
): Promise<UploadedFile> {
  const token = localStorage.getItem('openatlas_access_token') || '';
  const fd = new FormData();
  fd.append('file', file);
  const params = new URLSearchParams();
  if (opts?.sessionId) params.set('session_id', opts.sessionId);
  if (opts?.employeeId) params.set('employee_id', opts.employeeId);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/files/upload${qs ? '?' + qs : ''}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`upload failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  const fa = await res.json();
  return {
    id: fa.id,
    name: fa.original_name,
    mime: fa.mime_type,
    size: fa.size,
    status: fa.status,
    extracted_chars: fa.extracted_chars,
    summary: fa.summary,
    snippets: fa.snippets || [],
    expires_at: fa.expires_at,
    is_expired: fa.is_expired,
  };
}

export async function fetchFiles(opts: {
  sessionId?: string;
  employeeId?: string;
  limit?: number;
} = {}): Promise<UploadedFile[]> {
  const q = new URLSearchParams();
  if (opts.sessionId) q.set('session_id', opts.sessionId);
  if (opts.employeeId) q.set('employee_id', opts.employeeId);
  if (opts.limit) q.set('limit', String(opts.limit));
  const r = await apiFetch<{ items: any[] }>(`/files${q.toString() ? `?${q.toString()}` : ''}`);
  return (r.items || []).map((fa) => ({
    id: fa.id,
    name: fa.original_name,
    mime: fa.mime_type,
    size: fa.size,
    status: fa.status,
    extracted_chars: fa.extracted_chars,
    summary: fa.summary,
    snippets: fa.snippets || [],
    expires_at: fa.expires_at,
    is_expired: fa.is_expired,
  }));
}

export async function deleteFile(fileId: string): Promise<void> {
  await apiFetch(`/files/${fileId}`, { method: 'DELETE' });
}

export async function pruneExpiredFiles(): Promise<{ ok: true; deleted: number; ttl_days: number }> {
  return apiFetch('/files/prune-expired', { method: 'POST' });
}

// routeToEmployee — emit a custom event the router can pick up
export async function routeToEmployee(id: number | string): Promise<{ employee_id: number }> {
  window.dispatchEvent(new CustomEvent('openatlas:route', { detail: { kind: 'employee', id } }));
  const emps = await fetchEmployees().catch(() => []);
  return { employee_id: Number((emps[0] as any)?.id || 1) };
}

/* ════════════════════════════════════════════════════════════════════════
 * Type shims — legacy components import these names.
 * ════════════════════════════════════════════════════════════════════════ */
export type EmployeeDetail = Employee;
export type KnowledgeBase = { id: number; name: string; description: string; doc_count: number; type: string; size: string; status: string; };
export type Department = { id: number; name: string; color: string; employee_count: number; };
export type Solution = { id: number; name: string; description: string; icon: string; employee_count: number; };
export type SkillCreate = { skill_name: string; description?: string; config?: any; };
export type EmployeeCreate = { name: string; avatar_char?: string; department_id: number; system_prompt?: string; status_text?: string; mood?: string; skills: SkillCreate[]; allowed_toolsets?: string[] | null; hermes_skills?: string[] | null; model_override?: string | null; };
export type DismissResponse = { id: number; name: string; was_active: boolean; is_active: boolean; message: string; };
export type AuditLogFilter = any;
export type PlatformStats = any;
export type Tenant = any;
export type Attachment = {
  id?: string;
  url?: string;
  name: string;
  mime: string;
  size: number;
  status?: string;
  extracted_chars?: number;
  summary?: string;
  snippets?: Array<{ index: number; text: string }>;
  expires_at?: string | null;
  is_expired?: boolean;
};
export type CanvasStatePayload = any;
export type CanvasReplay = { employee_name?: string; total?: number; events: any[] };

/* ════════════════════════════════════════════════════════════════════════
 * Function shims — legacy components import these names.
 * ════════════════════════════════════════════════════════════════════════ */

// hireEmployee: alias for createEmployee
export const hireEmployee = createEmployee;

// listSkills: alias for fetchSkillMarket
export const listSkills = fetchSkillMarket;

// chatWithEmployeeStream — P3.12 (2026-06-07) 3.4.2 群聊签名重整:
//   - 单一签名: chatWithEmployeeStream(employeeId, message, opts?)
//   - opts.sessionId, opts.relayEmployeeIds, opts.attachmentIds, opts.signal
//   - 返回 yield 字段统一: { conversation_id } / { content } / { tool } / { memories, files, done, error, aborted }
//   - 删除 _employeeId/_attachments 隐式丢参 (那是 P3.11 之前的 bug)
//   - conversationChatStream 改为 alias 但接新签名
export async function* chatWithEmployeeStream(
  employeeId: string | number,
  userInput: string,
  opts?: {
    sessionId?: string | null;
    relayEmployeeIds?: Array<string | number>;
    attachmentIds?: string[];
    reasoningEffort?: string;
    signal?: AbortSignal;
  },
): AsyncGenerator<any, void, undefined> {
  let sessionId: string = opts?.sessionId || '';
  const primaryEmployeeId = await resolveEmployeeUuid(employeeId);
  let relayUuids: string[] = [];
  if (opts?.relayEmployeeIds && opts.relayEmployeeIds.length > 0) {
    const emps = await fetchEmployees().catch(() => []) as any[];
    relayUuids = opts.relayEmployeeIds
      .map((id) => {
        const cached = emps.find((e: any) => e.id === id || e.__id === id || String(e.id) === String(id));
        return cached?.__id || (typeof id === 'string' && id.includes('-') ? id : null);
      })
      .filter(Boolean) as string[];
  }
  if (!sessionId) {
    const conv = await createSession(primaryEmployeeId, titleFromQuery(userInput), relayUuids);
    // P3.12 late (2026-06-07): FNV-1a shim 后 conv.id 是 number, conv.__id 是真 UUID.
    // 后端 /api/sessions/{sid}/chat/stream 走 db.get(SessionRecord, sid) 必须 UUID, 传 shim int 会 500.
    // shim 数据是 shim 写回 {id: shim_int, __id: real_uuid, ...} — 必须用 __id.
    sessionId = (conv as any).__id || '';
    if (sessionId) {
      yield { conversation_id: sessionId, _origin: 'openatlas' };
    }
  }
  if (!sessionId) {
    yield { error: 'failed to create session' };
    return;
  }
  for await (const ev of streamChat(sessionId, userInput, {
    attachmentIds: opts?.attachmentIds,
    relayEmployeeIds: relayUuids,
    primaryEmployeeId,
    reasoningEffort: opts?.reasoningEffort,
    signal: opts?.signal,
  })) {
    const evAny = ev as any;
    const evName = ev.event || ev.event_type;
    const payload = evAny.data && typeof evAny.data === 'object' ? evAny.data : evAny;
    // P3.12 3.4.3: openatlas_session_id 校验 — 不属于当前 active session 的事件不 yield
    if (ev.openatlas_session_id && ev.openatlas_session_id !== sessionId) {
      // 跨 session 事件, 忽略 (防串台)
      continue;
    }
    if (evName === 'openatlas.memories') {
      yield { memories: payload.items || ev.items || [] };
      continue;
    }
    if (evName === 'openatlas.files') {
      yield { files: payload.items || ev.items || [] };
      continue;
    }
    if (evName === 'openatlas.trace') {
      yield {
        event_type: evName,
        event: evName,
        trace: payload,
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
        openatlas_session_id: payload.openatlas_session_id ?? ev.openatlas_session_id,
      };
      continue;
    }
    if (evName === 'openatlas.reasoning') {
      yield {
        event_type: evName,
        event: evName,
        reasoning: {
          text: payload.text || ev.text || '',
          hermes_run_id: payload.hermes_run_id || ev.hermes_run_id || payload.run_id || ev.run_id,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.approval_required') {
      yield {
        event_type: evName,
        event: evName,
        approval_required: {
          hermes_run_id: payload.hermes_run_id || payload.run_id || ev.hermes_run_id || ev.run_id,
          run_id: payload.run_id || ev.run_id,
          approval_id: payload.approval_id || payload.approvalId,
          command: payload.command,
          description: payload.description,
          pattern_key: payload.pattern_key,
          pattern_keys: payload.pattern_keys,
          choices: payload.choices,
          tool_name: payload.tool_name || payload.tool,
          source: payload.source,
          timeout_ms: payload.timeout_ms || payload.timeoutMs,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.approval_responded') {
      yield {
        event_type: evName,
        event: evName,
        approval_responded: {
          choice: payload.choice,
          resolved: payload.resolved,
          hermes_run_id: payload.hermes_run_id || payload.run_id || ev.hermes_run_id || ev.run_id,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.task_state') {
      yield {
        event_type: evName,
        event: evName,
        task_state: {
          session_id: payload.session_id || payload.openatlas_session_id || ev.openatlas_session_id,
          task_status: payload.task_status,
          reason: payload.reason,
          openatlas_session_id: payload.openatlas_session_id ?? ev.openatlas_session_id,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.context') {
      yield {
        event_type: evName,
        event: evName,
        skills: payload.skills || [],
        memories: payload.memories || [],
        files: payload.files || [],
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
        openatlas_session_id: payload.openatlas_session_id ?? ev.openatlas_session_id,
      };
      continue;
    }
    if (evName === 'agent_join' || evName === 'agent_leave') {
      yield {
        event_type: evName,
        agent_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'run.completed') {
      const usage = payload.usage;
      if (usage) yield {
        event_type: evName,
        event: evName,
        usage,
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'run.started') {
      yield {
        event_type: evName,
        event: evName,
        run_id: payload.run_id || ev.run_id,
        hermes_run_id: payload.hermes_run_id || payload.run_id || ev.hermes_run_id || ev.run_id,
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.run_idle' || evName === 'openatlas.run_detached') {
      yield {
        event_type: evName,
        event: evName,
        message: payload.message || '',
        idle_seconds: payload.idle_seconds,
        idle_timeout_seconds: payload.idle_timeout_seconds,
        detach_after_seconds: payload.detach_after_seconds,
        hermes_run_id: payload.hermes_run_id || ev.hermes_run_id,
        detached: evName === 'openatlas.run_detached',
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'message.started') {
      continue;
    }
    if (evName === 'assistant.delta') {
      const content =
        payload.delta ??
        payload.content ??
        payload.text ??
        payload.message?.content ??
        payload.message?.delta ??
        '';
      if (typeof content === 'string' && content.length > 0) yield {
        content,
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'assistant.completed') {
      continue;
    }
    if (evName === 'tool.started' || evName === 'tool.progress' || evName === 'tool.completed' || evName === 'tool.failed') {
      yield {
        event_type: evName,
        event: evName,
        tool: {
          name: payload.tool_name || payload.name || payload.tool || ev.tool_name || 'tool',
          label: payload.label || payload.preview || payload.command || ev.label || payload.tool_name || ev.tool_name,
          status: evName === 'tool.started' ? 'running' : evName === 'tool.completed' ? 'completed' : evName === 'tool.failed' ? 'failed' : 'progress',
          toolCallId: payload.tool_call_id || payload.id || payload.call_id || ev.tool_call_id,
          args: payload.args ?? payload.input ?? payload.parameters,
          result: payload.result ?? payload.output,
          error: payload.error,
          duration: payload.duration,
          preview: payload.preview,
          command: payload.command,
          delta: payload.delta ?? ev.delta,
          hermes_run_id: payload.hermes_run_id || ev.hermes_run_id,
          runtime_event: evName,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'error') {
      yield { error: ev.message || ev.detail || 'stream error' };
      return;
    }
    if (evName === 'aborted') {
      yield { aborted: true };
      return;
    }
    if (evName === 'done') {
      yield { done: true };
      return;
    }
  }
  yield { done: true };
}
// P3.12 3.4.2: 新签名, 不再是 streamChat alias. 老 streamChat alias 保留 (单聊场景直接用)
export const conversationChatStream = chatWithEmployeeStream;

export async function replayEmployeeEvents(id: number | string): Promise<CanvasReplay> {
  const employeeId = await resolveEmployeeUuid(id).catch(() => String(id));
  const q = new URLSearchParams({ employee_id: employeeId || String(id), limit: '100' });
  const r = await apiFetch<{ items?: any[]; total?: number }>(`/canvas-events?${q.toString()}`);
  return { employee_name: '员工', total: r.total ?? (r.items || []).length, events: r.items || [] };
}
