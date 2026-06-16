import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, Modal, Space, message } from 'antd';
import AtlasOrb from '../components/AtlasOrb';
import type { HeaderStyle, Pet, ProfileMode } from '../components/ChatHeader';
import LeftAside from '../components/LeftAside';
import CenterMain from '../components/CenterMain';
import RightAside from '../components/RightAside';
import type { CanvasHandle } from '../components/CollaborationCanvas';
import { canvasApi } from '../services/canvasApi';
import { ApartmentOutlined, HistoryOutlined } from '@ant-design/icons';
import type { DispatchTunnel } from '../types/dispatch';
import {
  IconPaperclip, IconImage, IconMic,
  IconSend, IconTrash, IconHistory, IconSettings, IconUsers,
} from '../components/Icons';
import {
  chatWithEmployeeStream, conversationChatStream,
  fetchEmployees, fetchConversationDetail,
  fetchEmployeeDetail, routeToEmployee, fetchConversations,
  createConversation, createGroupConversation, deleteConversation, uploadFile,
  patchSession,
  approveHermesRun, stopHermesRun,
  fetchCurrentUser, updateMyQuickPrompts,
  refreshSessionSummary, patchSessionTaskStatus, archiveArtifact,
  fetchCollaborationTemplates, createSessionFromTemplate,
  fetchRunQueue, resumeSessionTask,
  replayEmployeeEvents, type CanvasReplay,  // M5
  type Conversation, type Attachment, type Employee,
} from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { productVisible, showTestFixtures } from '../utils/productVisibility';

const CollaborationCanvas = lazy(() => import('../components/CollaborationCanvas'));

// ============================================================
// CommandCenter v3.1 (Phase 2 — Aside-Fix + Upload-Real + D + E)
//
//   Aside 左：真实会话列表（按 activeEmployee 过滤，可切换）
//   Aside 左：顶部 `+ 新建会话` 按钮
//   Aside 左：每条会话 hover 显示删除按钮
//   顶栏中央 chip：「正在和「XX」对话 · [切换]」
//   Input 附件/图片按钮接 file input → 真实上传 → 元数据进 message
//   语音按钮灰掉 + tooltip「即将支持」
//   Bug A 修复保留：已选员工时不再走 LLM router
// ============================================================

type OrbState = 'idle' | 'thinking' | 'dispatch' | 'speaking';

interface FloatingHubPosition {
  x: number;
  y: number;
}

const CANVAS_HUB_SIZE = 56;
const CANVAS_HUB_MARGIN = 16;
const CANVAS_HUB_STORAGE_KEY = 'atlas-canvas-hub-position';
const EMPLOYEE_DOCK_STORAGE_KEY = 'atlas-employee-dock-shortcuts';

function clampCanvasHubPosition(pos: FloatingHubPosition): FloatingHubPosition {
  if (typeof window === 'undefined') return pos;
  return {
    x: Math.min(Math.max(CANVAS_HUB_MARGIN, pos.x), window.innerWidth - CANVAS_HUB_SIZE - CANVAS_HUB_MARGIN),
    y: Math.min(Math.max(CANVAS_HUB_MARGIN, pos.y), window.innerHeight - CANVAS_HUB_SIZE - CANVAS_HUB_MARGIN),
  };
}

function getInitialCanvasHubPosition(): FloatingHubPosition {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(CANVAS_HUB_STORAGE_KEY) || 'null') as Partial<FloatingHubPosition> | null;
    if (typeof saved?.x === 'number' && typeof saved?.y === 'number') {
      return clampCanvasHubPosition({ x: saved.x, y: saved.y });
    }
  } catch {}
  return clampCanvasHubPosition({
    x: window.innerWidth - CANVAS_HUB_SIZE - 28,
    y: window.innerHeight - CANVAS_HUB_SIZE - 88,
  });
}

function taskStatusLabel(status: string) {
  const map: Record<string, string> = {
    draft: '草稿',
    running: '进行中',
    needs_input: '需补充',
    completed: '已完成',
    failed: '失败',
  };
  return map[status] || status;
}

interface ToolCall {
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
}

interface Msg {
  role: 'user' | string;
  sender: string;
  avatar: string;
  color: string;
  text: string;
  tools?: ToolCall[];
  attachments?: Attachment[];
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  token_count?: number;
  reasoning?: string[];
}

interface Tunnel extends DispatchTunnel {}

function coerceToolCalls(raw: any): ToolCall[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((t: any) => ({
      name: String(t?.name || t?.tool_name || t?.tool || 'tool'),
      label: t?.label || t?.preview || t?.command || undefined,
      status: t?.status,
      toolCallId: t?.toolCallId || t?.tool_call_id || t?.id,
      args: t?.args,
      result: t?.result,
      error: t?.error,
      duration: t?.duration,
      preview: t?.preview,
      command: t?.command,
      delta: t?.delta,
      hermes_run_id: t?.hermes_run_id,
      runtime_event: t?.runtime_event,
    }))
    .filter((t: ToolCall) => t.name);
}

function mergeToolCall(list: ToolCall[], incoming: Partial<ToolCall> & { name?: string }): ToolCall[] {
  const next: ToolCall = {
    name: String(incoming.name || 'tool'),
    label: incoming.label || incoming.preview || incoming.command,
    status: incoming.status,
    toolCallId: incoming.toolCallId,
    args: incoming.args,
    result: incoming.result,
    error: incoming.error,
    duration: incoming.duration,
    preview: incoming.preview,
    command: incoming.command,
    delta: incoming.delta,
    hermes_run_id: incoming.hermes_run_id,
    runtime_event: incoming.runtime_event,
  };
  const idx = list.findIndex((x) =>
    (next.toolCallId && x.toolCallId === next.toolCallId)
    || (!next.toolCallId && x.name === next.name && (x.label || '') === (next.label || ''))
    || (!next.toolCallId && ['completed', 'failed'].includes(String(next.status || '')) && x.name === next.name && ['running', 'progress'].includes(String(x.status || '')))
  );
  if (idx < 0) return [...list, next];
  return list.map((item, i) => {
    if (i !== idx) return item;
    const merged = { ...item, ...next };
    if (!next.toolCallId) merged.toolCallId = item.toolCallId;
    if (!next.label || next.label === next.name || next.label === 'tool') merged.label = item.label;
    return merged;
  });
}

interface CollaborationTemplateItem {
  id: string;
  name: string;
  description?: string;
  primary_employee_id?: string | null;
  participant_ids?: string[];
  canvas_state?: {
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
    version?: number;
  };
  updated_at?: string;
}

interface SessionMeta {
  id?: string;
  task_status?: string;
  task_reason?: string;
  task_summary?: string;
  summary_updated_at?: string | null;
  summary?: any;
  artifacts?: any[];
  context_injections?: any[];
}

// Phase 2.6: 快捷指令默认值（DB 加载前的占位 + 兜底）
const DEFAULT_QUICK_PROMPTS = ['检查围标', '审合同', '差旅报销', '休假规则'];

// 员工信息缓存 (含 __id 真 UUID, 不要丢)
let employeesCache: Array<{ id: number; __id?: string; name: string; avatar_char: string; department?: { name: string; color: string } | null }> = [];

const realSessionId = (v: any): string => String(v?.__id || v?.id || v || '');
const toEmployeeChip = (emp: any, fallbackId?: number) => ({
  id: Number(emp?.id ?? fallbackId ?? 0),
  uuid: emp?.__id,
  name: emp?.name || emp?.display_name || `员工 #${fallbackId ?? '?'}`,
  avatar: emp?.avatar_char || emp?.avatar || emp?.name?.[0] || '?',
  color: emp?.department?.color || '#4F46E5',
  department: emp?.department?.name,
  allowedToolsets: emp?.allowed_toolsets,
});

function formatTraceLine(trace: any): string {
  const title = trace?.title || trace?.stage || '执行事件';
  const detail = trace?.detail ? ` · ${trace.detail}` : '';
  return `${title}${detail}`;
}

function appendTraceLine(lines: string[] | undefined, line: string): string[] {
  const next = [...(lines || [])];
  if (!line || next.includes(line)) return next;
  return [...next, line].slice(-8);
}

type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

type PendingApproval = {
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
};

function approvalChoiceText(choice: ApprovalChoice): string {
  if (choice === 'deny') return '已拒绝执行';
  if (choice === 'session') return '已批准本会话，继续执行';
  if (choice === 'always') return '已永久批准该类操作，继续执行';
  return '已批准一次，继续执行';
}

function requestApprovalChoice(approval: any): Promise<ApprovalChoice> {
  return new Promise((resolve) => {
    let settled = false;
    let destroy: (() => void) | undefined;
    const choices = Array.isArray(approval?.choices) ? approval.choices : [];
    const canUse = (choice: ApprovalChoice) => !choices.length || choices.includes(choice);
    const finish = (choice: ApprovalChoice) => {
      if (settled) return;
      settled = true;
      destroy?.();
      resolve(choice);
    };
    const modal = Modal.confirm({
      title: '危险操作确认',
      content: (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ color: '#6B7280' }}>
            Hermes 判断这一步需要人工确认：{approval?.description || approval?.pattern_key || '高风险操作'}
          </div>
          {approval?.command && (
            <pre style={{
              margin: 0,
              padding: 10,
              borderRadius: 6,
              background: '#111827',
              color: '#E5E7EB',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
            }}>{approval.command}</pre>
          )}
          <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.6 }}>
            建议只在你明确理解命令影响时批准。本会话批准会在当前会话内复用信任，永久批准会影响后续同类操作。
          </div>
          <Space wrap>
            {canUse('session') && (
              <Button size="small" onClick={() => finish('session')}>本会话批准</Button>
            )}
            {canUse('always') && (
              <Button size="small" danger onClick={() => finish('always')}>永久批准</Button>
            )}
            {canUse('deny') && (
              <Button size="small" onClick={() => finish('deny')}>拒绝执行</Button>
            )}
          </Space>
        </div>
      ),
      okText: '批准一次',
      cancelText: '拒绝',
      okButtonProps: { danger: true },
      onOk: () => finish('once'),
      onCancel: () => finish('deny'),
    });
    destroy = () => modal.destroy();
  });
}

async function initEmployees() {
  try {
    employeesCache = await fetchEmployees() as any;
  } catch (e) {
    console.error('Failed to fetch employees:', e);
  }
}

async function selectEmployee(input: string): Promise<{ id: number; uuid?: string; name: string; avatar: string; color: string }> {
  // 优先用第一个 cache 员工,带 __id
  const first = employeesCache[0] as any;
  const defaultEmployee = first
    ? { id: first.id, __id: first.__id, name: first.name, avatar_char: first.avatar_char, department: first.department }
    : { id: 1, name: 'Atlas', avatar_char: 'A', department: { name: '总调度', color: '#4F46E5' } };
  try {
    const route = await routeToEmployee(input);
    const matched = employeesCache.find(e => e.id === route.employee_id);
    if (matched) {
      return { id: matched.id, uuid: (matched as any).__id, name: matched.name, avatar: matched.avatar_char, color: matched.department?.color || '#4F46E5' };
    }
  } catch (e) {
    console.error('Route failed, using default:', e);
  }
  return { id: defaultEmployee.id, uuid: (defaultEmployee as any).__id, name: defaultEmployee.name, avatar: defaultEmployee.avatar_char, color: defaultEmployee.department?.color || '#4F46E5' };
}

export default function CommandCenter() {
  const [orbState, setOrbState] = useState<OrbState>('idle');
  // P3.12 (2026-06-07) Bug 3.4.3: messagesBySession[sessionId] 替代全局 messages
  // 切会话时只换 activeSessionId, 不会丢 / 串其他会话的 token
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Msg[]>>({});
  const [sessionMetaById, setSessionMetaById] = useState<Record<string, SessionMeta>>({});
  const [refreshingSummary, setRefreshingSummary] = useState(false);
  const [runQueue, setRunQueue] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // 兼容老代码 — active messages 派生 (不存 state, 避免脏写)
  const messages = activeSessionId ? (messagesBySession[activeSessionId] || []) : [];
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const approvalResolverRef = useRef<((choice: ApprovalChoice) => void) | null>(null);
  // P3.12 3.4.3: AbortController 切会话时取消前台流
  const streamAbortRef = useRef<AbortController | null>(null);
  const activeHermesRunIdsRef = useRef<Set<string>>(new Set());
  // P3.12 3.4.3: 每次发送的 stream session id, 用于归属校验
  const streamSessionIdRef = useRef<string | null>(null);
  // P3.12 3.4.3: setMessages 包装 — 写 activeSessionId 对应的桶
  // 接受 (updater | value) | (updater, sid) — 第二形式允许 hydrate 时桶还没 active
  // 顺序问题 (P3.12 late): setActiveSessionIdSafe 要在 setMessages 之前, 但有时相反 (例 group 入口)
  // 解法:targetSid 缺失时回退到 activeSessionId 再读, 若仍空就返回
  const setMessages = useCallback((updaterOrValue: any, sid?: string | null) => {
    const targetSid = sid || activeSessionId;
    if (!targetSid) {
      return;
    }
    setMessagesBySession((prev) => {
      const cur = prev[targetSid] || [];
      const next = typeof updaterOrValue === 'function' ? updaterOrValue(cur) : updaterOrValue;
      return { ...prev, [targetSid]: next };
    });
  }, [activeSessionId]);

  const requestApprovalChoiceInline = useCallback((approval: PendingApproval): Promise<ApprovalChoice> => {
    return new Promise((resolve) => {
      approvalResolverRef.current = resolve;
      setPendingApproval(approval);
    });
  }, []);

  const resolvePendingApproval = useCallback((choice: ApprovalChoice) => {
    const resolve = approvalResolverRef.current;
    approvalResolverRef.current = null;
    setPendingApproval(null);
    resolve?.(choice);
  }, []);

  const markInjectedFiles = useCallback((sid: string | null | undefined, injectedFiles: Attachment[]) => {
    if (!sid || injectedFiles.length === 0) return;
    setMessages((prev: Msg[]) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].role === 'user') {
          const existing = next[i].attachments || [];
          const merged = existing.length > 0
            ? existing.map((old) => injectedFiles.find((f) => f.id && f.id === old.id) || old)
            : injectedFiles;
          next[i] = { ...next[i], attachments: merged };
          break;
        }
      }
      return next;
    }, sid);
  }, [setMessages]);

  const rememberSessionMeta = useCallback((detail: any, sidHint?: string | null) => {
    const sid = sidHint || realSessionId(detail);
    if (!sid) return;
    setSessionMetaById((prev) => ({
      ...prev,
      [sid]: {
        ...(prev[sid] || {}),
        id: sid,
        task_status: detail?.task_status,
        task_summary: detail?.task_summary,
        summary_updated_at: detail?.summary_updated_at,
        summary: detail?.summary,
        artifacts: Array.isArray(detail?.artifacts) ? detail.artifacts : (prev[sid]?.artifacts || []),
        context_injections: Array.isArray(detail?.context_injections) ? detail.context_injections : (prev[sid]?.context_injections || []),
      },
    }));
  }, []);

  const mergeLiveContext = useCallback((sid: string | null | undefined, chunk: any) => {
    if (!sid) return;
    const turn = chunk.turn_index ?? null;
    const speakerId = chunk.speaker_employee_id ?? null;
    const speakerName = chunk.speaker_name ?? '';
    const rows = [
      ...(chunk.skills || []).map((s: any) => ({
        kind: 'skill',
        name: s.name || s.slug || s.skill_name || 'Skill',
        source_id: s.id || s.skill_id || s.slug,
        scope: s.source || s.scope || 'skill',
        status: s.status || 'injected',
        summary: s.summary || s.description || s.version || '',
        payload: s,
        turn_index: turn,
        employee_id: speakerId,
        speaker_name: speakerName,
        created_at: new Date().toISOString(),
      })),
      ...(chunk.files || []).map((f: any) => ({
        kind: 'file',
        name: f.name || f.original_name || '文件',
        source_id: f.id,
        scope: 'attachment',
        status: f.status || 'injected',
        summary: f.summary || `${f.extracted_chars || 0} 字`,
        payload: f,
        turn_index: turn,
        employee_id: speakerId,
        speaker_name: speakerName,
        created_at: new Date().toISOString(),
      })),
      ...(chunk.memories || []).map((m: any) => ({
        kind: 'memory',
        name: m.title || '记忆',
        source_id: m.__id || m.id,
        scope: m.scope || 'memory',
        status: 'injected',
        summary: m.content || '',
        payload: m,
        turn_index: turn,
        employee_id: speakerId,
        speaker_name: speakerName,
        created_at: new Date().toISOString(),
      })),
    ];
    if (rows.length === 0) return;
    setSessionMetaById((prev) => {
      const current = prev[sid] || {};
      const merged = [...rows, ...(current.context_injections || [])].slice(0, 120);
      return { ...prev, [sid]: { ...current, context_injections: merged } };
    });
  }, []);

  const loadRunQueue = useCallback(async () => {
    try {
      setRunQueue(await fetchRunQueue());
    } catch (e) {
      console.warn('[RunQueue] load failed:', e);
    }
  }, []);

  const mergeTaskState = useCallback((sid: string | null | undefined, state: any) => {
    if (!sid || !state?.task_status) return;
    setSessionMetaById((prev) => ({
      ...prev,
      [sid]: {
        ...(prev[sid] || {}),
        task_status: state.task_status,
        task_reason: state.reason,
      },
    }));
    setConversations((prev) => prev.map((c: any) => (
      realSessionId(c) === sid ? { ...c, task_status: state.task_status } : c
    )));
    loadRunQueue();
  }, [loadRunQueue]);

  const refreshActiveSummary = useCallback(async () => {
    if (!activeSessionId) return;
    setRefreshingSummary(true);
    try {
      const res = await refreshSessionSummary(activeSessionId);
      setSessionMetaById((prev) => ({
        ...prev,
        [activeSessionId]: {
          ...(prev[activeSessionId] || {}),
          task_summary: res.task_summary,
          summary_updated_at: res.summary_updated_at,
          task_status: res.task_status,
        },
      }));
      message.success('会话总结已刷新');
    } catch (e: any) {
      message.error(`生成总结失败: ${e?.message || e}`);
    } finally {
      setRefreshingSummary(false);
    }
  }, [activeSessionId]);

  const patchActiveTaskStatus = useCallback(async (status: string) => {
    if (!activeSessionId) return;
    try {
      const res = await patchSessionTaskStatus(activeSessionId, status);
      const nextStatus = res?.task_status || status;
      mergeTaskState(activeSessionId, {
        task_status: nextStatus,
        reason: 'manual task status update',
      });
      setSessionMetaById((prev) => ({
        ...prev,
        [activeSessionId]: {
          ...(prev[activeSessionId] || {}),
          task_status: nextStatus,
          task_reason: 'manual task status update',
        },
      }));
      message.success(`任务状态已更新为：${taskStatusLabel(nextStatus)}`);
    } catch (e: any) {
      message.error(`更新任务状态失败：${e?.message || e}`);
    }
  }, [activeSessionId, mergeTaskState]);

  const archiveActiveArtifact = useCallback(async (artifactId: string) => {
    if (!activeSessionId || !artifactId) return;
    try {
      await archiveArtifact(artifactId);
      setSessionMetaById((prev) => {
        const current = prev[activeSessionId] || {};
        return {
          ...prev,
          [activeSessionId]: {
            ...current,
            artifacts: (current.artifacts || []).map((a: any) =>
              a.id === artifactId ? { ...a, archived: true, status: 'archived' } : a
            ),
          },
        };
      });
      message.success('交付物已归档');
    } catch (e: any) {
      message.error(`归档失败: ${e?.message || e}`);
    }
  }, [activeSessionId]);
  // P3.12 3.4.3: setActiveSessionIdSafe — 切会话时先 abort 当前流, 再切
  const setActiveSessionIdSafe = useCallback((sid: string | null) => {
    if (sid !== activeSessionId) {
      if (streamAbortRef.current) {
        try { streamAbortRef.current.abort(); } catch { /* ignore */ }
        streamAbortRef.current = null;
      }
    }
    setActiveSessionId(sid);
  }, [activeSessionId]);
  const [input, setInput] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState(() => {
    try { return localStorage.getItem('atlas.reasoning_effort:draft') || ''; } catch { return ''; }
  });
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  // Bug #2 修复 (2026-06-03):tunnels / conclusions / files 持久化到 localStorage,
  // 切会话/切员工/刷新页面后从 localStorage 读取恢复。
  // key 方案:dispatch:<conversationId> — 一个会话一个调度日志,跨员工/跨 session 隔离。
  // 用 state 而非 ref 追踪 conversationId,让 useEffect 在切换时自动重读。
  const DISPATCH_LS_PREFIX = 'atlas.dispatch';
  const dispatchListKey = `${DISPATCH_LS_PREFIX}:index`;

  // 工具函数:读 / 写 当前会话的 dispatch state
  const readDispatchFor = (cid: number | string) => {
    try {
      const t = localStorage.getItem(`${DISPATCH_LS_PREFIX}:session:${cid}:tunnels`);
      const c = localStorage.getItem(`${DISPATCH_LS_PREFIX}:session:${cid}:conclusions`);
      const f = localStorage.getItem(`${DISPATCH_LS_PREFIX}:session:${cid}:files`);
      return {
        tunnels: t ? JSON.parse(t) : [],
        conclusions: c ? JSON.parse(c) : [],
        files: f ? JSON.parse(f) : [],
      };
    } catch {
      return { tunnels: [], conclusions: [], files: [] };
    }
  };

  useEffect(() => {
    const key = activeSessionId ? `atlas.reasoning_effort:${activeSessionId}` : 'atlas.reasoning_effort:draft';
    try {
      setReasoningEffort(localStorage.getItem(key) || localStorage.getItem('atlas.reasoning_effort:draft') || '');
    } catch {
      setReasoningEffort('');
    }
  }, [activeSessionId]);

  useEffect(() => {
    const key = activeSessionId ? `atlas.reasoning_effort:${activeSessionId}` : 'atlas.reasoning_effort:draft';
    try { localStorage.setItem(key, reasoningEffort); } catch { /* ignore */ }
  }, [activeSessionId, reasoningEffort]);
  // dispatchCid 是 state(不是 ref),变更触发 useEffect 重新加载/清理
  const [dispatchCid, setDispatchCid] = useState<string | null>(null);
  // 提前声明 isProcessing / conclusions / files state(原文件在 useEffect 后,会让 TS
  // 报"use before declaration";useState 顺序不变,useEffect 引用合法)
  const [isProcessing, setIsProcessing] = useState(false);
  const [conclusions, setConclusions] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);

  // dispatchCid 变化时,从 localStorage 读旧 dispatch state 渲染
  useEffect(() => {
    if (dispatchCid == null) {
      setTunnels([]); setConclusions([]); setFiles([]);
      return;
    }
    const d = readDispatchFor(dispatchCid);
    setTunnels(d.tunnels);
    setConclusions(d.conclusions);
    setFiles(d.files);
  }, [dispatchCid]);

  // tunnels / conclusions / files 变化时,同步写 localStorage(per dispatchCid)
  useEffect(() => {
    if (dispatchCid == null) return;
    try {
      localStorage.setItem(`${DISPATCH_LS_PREFIX}:session:${dispatchCid}:tunnels`, JSON.stringify(tunnels));
      const idx = JSON.parse(localStorage.getItem(dispatchListKey) || '[]') as string[];
      if (!idx.includes(String(dispatchCid))) {
        idx.push(String(dispatchCid));
        localStorage.setItem(dispatchListKey, JSON.stringify(idx));
      }
    } catch {}
  }, [tunnels, dispatchCid]);
  useEffect(() => {
    if (dispatchCid == null) return;
    try { localStorage.setItem(`${DISPATCH_LS_PREFIX}:session:${dispatchCid}:conclusions`, JSON.stringify(conclusions)); } catch {}
  }, [conclusions, dispatchCid]);
  useEffect(() => {
    if (dispatchCid == null) return;
    try { localStorage.setItem(`${DISPATCH_LS_PREFIX}:session:${dispatchCid}:files`, JSON.stringify(files)); } catch {}
  }, [files, dispatchCid]);
  // P3.12 3.4.3: 老的 conversationIdRef 已废弃, 统一用 activeSessionId state
  // (useCallback 包装的 setActiveSessionIdSafe 切会话时 abort 前台流)
  // 保留 declaration 兼容老代码 grep, 实际不再使用
  const conversationIdRef = useRef<string | null>(null);
  // Bug A 修复：已预选的员工（从 /overview?employee={id} 进入时锁定）
  const [activeEmployee, setActiveEmployee] = useState<{ id: number; uuid?: string; name: string; avatar: string; color: string; department?: string; allowedToolsets?: string[] | null } | null>(null);
  // Phase 2 Aside-Fix：左侧 aside 的会话列表（按 activeEmployee 过滤）
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  // Phase 2 Upload-Real：发送前的待发附件
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  // M4.2 (Group Chat): 接力员工 ID 列表(@ 召唤下拉选中的员工)
  const [relayEmployeeIds, setRelayEmployeeIds] = useState<number[]>([]);
  // M4.2 (Group Chat): 接力员工详情(用于显示在 Composer chip)
  const [relayChips, setRelayChips] = useState<Employee[]>([]);
  // M4.2 (Group Chat): 员工列表(给 MentionPopover 用)
  const [allEmployeesForMention, setAllEmployeesForMention] = useState<Employee[]>([]);
  // Phase 2 E：员工选择器 modal
  const [showSwitcher, setShowSwitcher] = useState(false);
  // M4.3: 协作画布全屏 Modal
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [collabTemplates, setCollabTemplates] = useState<CollaborationTemplateItem[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [usingTemplateId, setUsingTemplateId] = useState<string | null>(null);
  // M5 (Event Log): Replay Modal 状态
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayData, setReplayData] = useState<CanvasReplay | null>(null);
  // M4.4.4: 浮动按钮 badge 计数 (画布节点 done/总数)
  const [canvasBadge, setCanvasBadge] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  // M4.4: 协作画布 imperative handle (用 Callback ref,因为 Ant Modal wrap)
  const canvasRef = useRef<CanvasHandle>(null);
  const canvasBtnRef = useRef<HTMLButtonElement>(null);
  const [canvasHubOpen, setCanvasHubOpen] = useState(false);
  const [canvasHubPos, setCanvasHubPos] = useState<FloatingHubPosition>(() => getInitialCanvasHubPosition());
  const canvasHubDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    hasMoved: boolean;
  } | null>(null);
  const suppressCanvasHubClickRef = useRef(false);
  // M4.5.1: 当前会话的 canvas_state (打开画布时注入,回访恢复)
  const [initialCanvasState, setInitialCanvasState] = useState<{
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    version: number;
  } | null>(null);
  const [canvasSessionParticipants, setCanvasSessionParticipants] = useState<{
    employee_id?: string | null;
    participant_ids?: string[];
  } | null>(null);
  const [allEmployees, setAllEmployees] = useState<typeof employeesCache>([]);
  const [headerStyle, setHeaderStyle] = useState<HeaderStyle>(() => {
    const s = localStorage.getItem('atlas-header-style');
    return (s === 'pixel' || s === 'aura' || s === 'hud') ? s : 'pixel';
  });
  const [pet, setPet] = useState<Pet>(() => {
    if (localStorage.getItem('atlas-pet') !== 'marmot') {
      localStorage.setItem('atlas-pet', 'marmot');
    }
    return 'marmot';
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Phase 2.6: 用户级可配置快捷指令
  const [quickPrompts, setQuickPrompts] = useState<string[]>(DEFAULT_QUICK_PROMPTS);
  const [editingPrompts, setEditingPrompts] = useState(false);
  const [promptDraft, setPromptDraft] = useState<string[]>([]);
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [dockSettingsOpen, setDockSettingsOpen] = useState(false);
  const [employeeDockIds, setEmployeeDockIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(EMPLOYEE_DOCK_STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const isWarRoom = messages.length > 0;

  // 初始化员工数据
  useEffect(() => {
    initEmployees();
  }, []);

  useEffect(() => {
    localStorage.setItem(EMPLOYEE_DOCK_STORAGE_KEY, JSON.stringify(employeeDockIds));
  }, [employeeDockIds]);

  // Phase 2 Aside-Fix：拉当前用户的会话列表（按 activeEmployee 过滤）
  const loadConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const list = await fetchConversations();
      const employeeMap = new Set<string>();
      [...allEmployeesForMention, ...allEmployees].forEach((e: any) => {
        employeeMap.add(String(e.id));
        if (e.__id) employeeMap.add(String(e.__id));
      });
      const visible = productVisible(list.filter(c => c.status !== 'archived')).filter((c) => {
        if (showTestFixtures()) return true;
        if (c.is_group) return true;
        if (c.employee_id == null) return false;
        return employeeMap.has(String(c.employee_id));
      });
      setConversations(visible);
      loadRunQueue();
    } catch (e) {
      console.error('Failed to load conversations:', e);
    } finally {
      setLoadingConvs(false);
    }
  }, [allEmployees, allEmployeesForMention, loadRunQueue]);

  const loadCollaborationTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const rows = await fetchCollaborationTemplates();
      setCollabTemplates(rows as CollaborationTemplateItem[]);
    } catch (e) {
      console.error('Failed to load collaboration templates:', e);
      message.error('加载协作方案失败');
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const handleOpenTemplateLibrary = useCallback(async () => {
    setTemplateOpen(true);
    await loadCollaborationTemplates();
  }, [loadCollaborationTemplates]);

  const handleUseTemplate = useCallback(async (tpl: CollaborationTemplateItem) => {
    setUsingTemplateId(tpl.id);
    try {
      const session = await createSessionFromTemplate(tpl.id, { title: tpl.name });
      const sid = realSessionId(session);
      const primaryEmpId = (session as any).employee_id || tpl.primary_employee_id;
      let templateEmployee: { id: number; name: string; avatar: string; color: string } | null = null;
      if (primaryEmpId) {
        const emp = await fetchEmployeeDetail(primaryEmpId).catch(() => null);
        if (emp) {
          templateEmployee = {
            id: emp.id,
            name: emp.name,
            avatar: emp.avatar_char,
            color: emp.department?.color || '#4F46E5',
          };
          setActiveEmployee({
            ...templateEmployee,
            uuid: (emp as any).__id || String(primaryEmpId),
            department: emp.department?.name,
            allowedToolsets: emp.allowed_toolsets,
          });
        }
      }
      setActiveSessionIdSafe(sid);
      setDispatchCid(sid);
      setMessages(templateEmployee ? [{
        role: String(templateEmployee.id),
        sender: templateEmployee.name,
        avatar: templateEmployee.avatar,
        color: templateEmployee.color,
        text: `已载入协作方案「${tpl.name}」。你可以直接在本会话中继续发起任务。`,
      }] : [], sid);
      setInitialCanvasState(tpl.canvas_state ? {
        nodes: tpl.canvas_state.nodes || [],
        edges: tpl.canvas_state.edges || [],
        version: tpl.canvas_state.version || 1,
      } : null);
      setTemplateOpen(false);
      setCanvasOpen(true);
      await loadConversations();
      message.success('已从协作方案创建新会话');
    } catch (e: any) {
      console.error('Use collaboration template failed:', e);
      message.error(`使用协作方案失败: ${e?.message || e}`);
    } finally {
      setUsingTemplateId(null);
    }
  }, [loadConversations, setActiveSessionIdSafe, setMessages]);

  const persistCanvasHubPosition = useCallback((pos: FloatingHubPosition) => {
    const clamped = clampCanvasHubPosition(pos);
    try {
      localStorage.setItem(CANVAS_HUB_STORAGE_KEY, JSON.stringify(clamped));
    } catch {}
    setCanvasHubPos(clamped);
  }, []);

  useEffect(() => {
    const handleResize = () => persistCanvasHubPosition(canvasHubPos);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [canvasHubPos, persistCanvasHubPosition]);

  const openCollaborationCanvas = useCallback(async () => {
    // M4.5.1: 打开时拉一次 detail → 取 canvas_state 注入 (回访恢复)
    const cid = activeSessionId;
    if (cid) {
      try {
        const detail = await fetchConversationDetail(cid);
        rememberSessionMeta(detail, realSessionId(detail));
        setCanvasSessionParticipants({
          employee_id: detail.employee_id || null,
          participant_ids: Array.isArray(detail.participant_ids) ? detail.participant_ids : [],
        });
        if (detail.canvas_state) {
          setInitialCanvasState({
            nodes: detail.canvas_state.nodes as Array<Record<string, unknown>>,
            edges: detail.canvas_state.edges as Array<Record<string, unknown>>,
            version: detail.canvas_state.version,
          });
        } else {
          setInitialCanvasState(null);
        }
      } catch (e) {
        console.warn('[M4.5.1] fetchConversationDetail for canvas_state failed:', e);
        setInitialCanvasState(null);
        setCanvasSessionParticipants(null);
      }
    } else {
      setInitialCanvasState(null);
      setCanvasSessionParticipants(null);
    }
    setCanvasOpen(true);
  }, [activeSessionId, rememberSessionMeta]);

  const handleReplayEvents = useCallback(async () => {
    if (activeEmployee?.id) {
      setReplayOpen(true);
      try {
        const replay = await replayEmployeeEvents(activeEmployee.id);
        setReplayData(replay);
      } catch (e) {
        console.warn('[M5] replay failed:', e);
        setReplayData(null);
      }
    } else {
      message.warning('请先选员工');
    }
  }, [activeEmployee?.id]);

  const handleCanvasHubPointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    canvasHubDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: canvasHubPos.x,
      originY: canvasHubPos.y,
      hasMoved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [canvasHubPos]);

  const handleCanvasHubPointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = canvasHubDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      drag.hasMoved = true;
      suppressCanvasHubClickRef.current = true;
      setCanvasHubOpen(false);
    }
    if (drag.hasMoved) {
      persistCanvasHubPosition({ x: drag.originX + dx, y: drag.originY + dy });
    }
  }, [persistCanvasHubPosition]);

  const handleCanvasHubPointerUp = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = canvasHubDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    canvasHubDragRef.current = null;
    window.setTimeout(() => {
      suppressCanvasHubClickRef.current = false;
    }, 0);
  }, []);

  const handleCanvasHubMainClick = useCallback(async () => {
    if (suppressCanvasHubClickRef.current) return;
    if (!canvasHubOpen) {
      setCanvasHubOpen(true);
      return;
    }
    setCanvasHubOpen(false);
    await openCollaborationCanvas();
  }, [canvasHubOpen, openCollaborationCanvas]);

  // M4.2 (Group Chat): 加载员工列表(给 @ 召唤下拉用)
  // 不依赖 activeEmployee,所有员工都拉
  const loadAllEmployeesForMention = useCallback(async () => {
    try {
      const list = await fetchEmployees();
      setAllEmployeesForMention(list);
      setAllEmployees(list as any);
    } catch (e) {
      console.error('[M4.2] fetchEmployees for mention failed:', e);
    }
  }, []);

  // M4.2: 启动时预加载(为 MentionPopover 数据源)
  useEffect(() => {
    loadAllEmployeesForMention();
  }, [loadAllEmployeesForMention]);

  const employeeForSpeaker = useCallback((speakerId?: string | number | null, speakerName?: string) => {
    const pools = [...allEmployeesForMention, ...allEmployees] as any[];
    const found = pools.find((e: any) =>
      e.__id === speakerId || e.id === speakerId || String(e.id) === String(speakerId)
    );
    if (found) return toEmployeeChip(found);
    return {
      id: typeof speakerId === 'number' ? speakerId : 0,
      uuid: typeof speakerId === 'string' ? speakerId : undefined,
      name: speakerName || `员工 #${speakerId ?? '?'}`,
      avatar: (speakerName || '?')[0],
      color: '#4F46E5',
    };
  }, [allEmployeesForMention, allEmployees]);

  // M4.2: @ 召唤选员工
  const handleMentionPick = useCallback((emp: Employee) => {
    if (relayEmployeeIds.includes(emp.id)) return;  // 重复
    if (relayEmployeeIds.length >= 3) {  // 上限 3 跳
      message.warning('接力员工最多 3 个');
      return;
    }
    setRelayEmployeeIds(prev => [...prev, emp.id]);
    setRelayChips(prev => [...prev, emp]);
    // input 末尾追加 @员工名 + 空格
    setInput(prev => {
      // 去掉末尾的 @xxx 部分
      const atIdx = prev.lastIndexOf('@');
      const base = atIdx !== -1 ? prev.slice(0, atIdx) : prev;
      return `${base}@${emp.name} `;
    });
  }, [relayEmployeeIds]);

  // M4.2: 移除接力 chip
  const handleRemoveRelay = useCallback((employeeId: number) => {
    setRelayEmployeeIds(prev => prev.filter(id => id !== employeeId));
    setRelayChips(prev => prev.filter(e => e.id !== employeeId));
  }, []);

  // activeEmployee 变化时刷新会话列表
  useEffect(() => {
    loadConversations();
  }, [activeEmployee, loadConversations]);

  // 从 URL 参数恢复对话或预选员工
  useEffect(() => {
    const convId = searchParams.get('conversation');
    const empId = searchParams.get('employee');

    if (convId) {
      fetchConversationDetail(convId)
        .then(async (detail) => {
          if (!detail) return; // P3.12 防御: 404 等情况下 detail 可能是 undefined
          rememberSessionMeta(detail, realSessionId(detail));
          // M4.2: 群聊时 employee_id 可能为 null — 用 detail.messages 第一条 assistant 的 speaker_employee_id
          // 或 fallback 到 activeEmployee(已有),最简:try fetch,失败跳到 fallback
          let empId = detail.employee_id;
          if (empId == null) {
            // 群聊:从 messages 中找第一个 assistant 的 speaker
            const firstAssistant = detail.messages.find((m: any) => m.role === 'assistant' && m.speaker_employee_id);
            empId = firstAssistant?.speaker_employee_id ?? null;
          }
          if (empId == null) {
            // 找不到 — fallback 保留 null(只设 messages,不动 activeEmployee)
            const restored: Msg[] = detail.messages.map((m: any) => ({
              role: m.role === 'user' ? 'user' : String(m.speaker_employee_id ?? '?'),
              sender: m.role === 'user' ? '你' : `员工 #${m.speaker_employee_id ?? '?'}`,
              avatar: m.role === 'user' ? '你'[0] : '?',
              color: m.role === 'user' ? 'var(--text-secondary)' : '#4F46E5',
              text: m.content,
              reasoning: Array.isArray(m.reasoning) ? m.reasoning : (m.reasoning ? [String(m.reasoning)] : []),
              tools: coerceToolCalls(m.tool_calls || m.tools),
              attachments: m.attachments ?? [],
              input_tokens: m.input_tokens,
              output_tokens: m.output_tokens,
              total_tokens: m.total_tokens,
              token_count: m.token_count,
            }));
            const sid = realSessionId(detail);
            setActiveSessionIdSafe(sid);
            setMessages(restored, sid);
            setDispatchCid(sid);
            return;
          }
          const emp = await fetchEmployeeDetail(empId).catch(() => null);
          const name = emp?.name || `员工 #${empId}`;
          const avatar = emp?.avatar_char || '?';
          const color = emp?.department?.color || '#4F46E5';
          // FNV-1a shim safety: include uuid so the next chat stream uses real backend UUID, not shim int.
          setActiveEmployee({ id: (emp as any)?.id ?? empId, uuid: (emp as any)?.__id ?? empId, name, avatar, color, department: emp?.department?.name, allowedToolsets: emp?.allowed_toolsets });

          const restored: Msg[] = detail.messages.map((m: any) => ({
            role: m.role === 'user' ? 'user' : String(m.speaker_employee_id ?? empId),
            sender: m.role === 'user' ? '你' : (m.speaker_name || name),
            avatar: m.role === 'user' ? '你'[0] : (m.speaker_name || name)[0],
            color: m.role === 'user' ? 'var(--text-secondary)' : color,
            text: m.content,
            reasoning: Array.isArray(m.reasoning) ? m.reasoning : (m.reasoning ? [String(m.reasoning)] : []),
            tools: coerceToolCalls(m.tool_calls || m.tools),
            attachments: m.attachments ?? [],
            input_tokens: m.input_tokens,
            output_tokens: m.output_tokens,
            total_tokens: m.total_tokens,
            token_count: m.token_count,
          }));

          const sid = realSessionId(detail);
          setActiveSessionIdSafe(sid);
          setMessages(restored, sid);
          setDispatchCid(sid); // Bug #2 修复:触发 dispatch 读
        })
        .catch((e) => console.error('Failed to restore conversation:', e))
        .finally(() => setSearchParams({}, { replace: true }));
    } else if (empId) {
      fetchEmployeeDetail(empId)
        .then((emp) => {
          setActiveEmployee({ id: emp.id, uuid: (emp as any).__id, name: emp.name, avatar: emp.avatar_char, color: emp.department?.color || '#4F46E5', department: emp.department?.name, allowedToolsets: emp.allowed_toolsets });

          // 加欢迎气泡（Phase 2 不再自动 setMessages 进 war room；只在 has 历史会话后才进）
          // 这里只预选员工，不立即进 war room — 用户在 aside 选历史或新建会话才进入
        })
        .catch((e) => console.error('Failed to pre-select employee:', e))
        .finally(() => setSearchParams({}, { replace: true }));
    }
  }, [setSearchParams, searchParams]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; }
  }, [input]);

  useEffect(() => { if (!isWarRoom) inputRef.current?.focus(); }, [isWarRoom]);

  // Phase 2.6: 拉当前用户的 quickPrompts（用户级配置）
  useEffect(() => {
    fetchCurrentUser()
      .then(u => {
        if (u.quick_prompts && Array.isArray(u.quick_prompts) && u.quick_prompts.length > 0) {
          setQuickPrompts(u.quick_prompts);
        }
      })
      .catch(e => console.warn('fetchCurrentUser quick_prompts failed:', e));
  }, []);

  // M4.4.4: 浮动按钮 badge 轮询 (1.5s 间隔,轻量,canvas modal 开时有效)
  useEffect(() => {
    if (!canvasOpen) return;
    const id = setInterval(() => {
      const handle = canvasRef.current;
      if (handle) setCanvasBadge(handle.getStatusCount());
    }, 1500);
    return () => clearInterval(id);
  }, [canvasOpen]);

  // M4.4: 群聊 click → 气泡 scrollIntoView + highlight 3s (M4.4.2 互高亮 chat→canvas)
  useEffect(() => {
    const unregister = canvasApi.registerChat((msgId) => {
      const sel = `[data-message-id="${msgId}"]`;
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('m44-highlight');
        setTimeout(() => el.classList.remove('m44-highlight'), 3000);
      }
    });
    return unregister;
  }, []);

  // M4.4.3: 画布全 done → 记录本地完成事件，后续可由后端总结服务接管
  useEffect(() => {
    const unregister = canvasApi.subscribeAllDone(() => {
      const summaryMsg = {
        id: `sys-${Date.now()}`,
        role: 'system' as const,
        sender: '协作画布',
        content: `协作画布任务完成 · 节点状态: ${canvasBadge.done}/${canvasBadge.total} 已完成`,
        ts: Date.now(),
        kind: 'canvas-summary' as const,
      };
      // 通过 dispatch / setMessages 追加 (简化: 直接 push 到 messagesCache 即可)
      try {
        const raw = localStorage.getItem('atlas_canvas_summary_log') || '[]';
        const arr = JSON.parse(raw);
        arr.push(summaryMsg);
        localStorage.setItem('atlas_canvas_summary_log', JSON.stringify(arr.slice(-20)));
      } catch { /* ignore */ }
      // toast 提示用户
      console.log('[M4.4.3] canvas all done, summary:', summaryMsg.content);
    });
    return unregister;
  }, [canvasBadge]);

  // Phase 2.6: 编辑入口 — 打开模态
  const handleOpenPromptEditor = useCallback(() => {
    setPromptDraft([...quickPrompts]);
    setEditingPrompts(true);
  }, [quickPrompts]);

  // Phase 2.6: 保存用户快捷指令
  const handleSavePrompts = useCallback(async () => {
    const cleaned = promptDraft.map(s => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      message.warning('至少保留 1 个快捷指令');
      return;
    }
    if (cleaned.length > 8) {
      message.warning('最多 8 个快捷指令');
      return;
    }
    if (cleaned.some(s => s.length > 32)) {
      message.warning('单个指令不超过 32 字符');
      return;
    }
    setSavingPrompts(true);
    try {
      const updated = await updateMyQuickPrompts(cleaned);
      setQuickPrompts(updated.quick_prompts || cleaned);
      setEditingPrompts(false);
    } catch (e: any) {
      console.error('save quick_prompts failed:', e);
      message.error(`保存失败: ${e?.message || e}`);
    } finally {
      setSavingPrompts(false);
    }
  }, [promptDraft]);

  const handleStyleChange = useCallback((s: HeaderStyle) => {
    setHeaderStyle(s);
    localStorage.setItem('atlas-header-style', s);
  }, []);
  const handlePetChange = useCallback((_p: Pet) => {
    setPet('marmot');
    localStorage.setItem('atlas-pet', 'marmot');
  }, []);
  // Phase 2 Aside-Fix：切换到某个历史会话
  const switchToConversation = useCallback(async (conv: Conversation) => {
    const requestedSid = realSessionId(conv);
    if (requestedSid === activeSessionId) return;
    setIsProcessing(true);
    try {
      const detail = await fetchConversationDetail(requestedSid);
      rememberSessionMeta(detail, realSessionId(detail));
      // M4.2: 群聊 employee_id 可能为 null — fallback 到 messages[0].speaker_employee_id
      let empId = detail.employee_id;
      if (empId == null) {
        const firstAssistant = detail.messages.find((m: any) => m.role === 'assistant' && m.speaker_employee_id);
        empId = firstAssistant?.speaker_employee_id ?? null;
      }
      const emp = activeEmployee ?? (empId != null ? await fetchEmployeeDetail(empId).catch(() => null) : null);
      const name = (emp as any)?.name || `员工 #${empId ?? '?'}`;
      const avatar = (emp as any)?.avatar_char || '?';
      const color = (emp as any)?.department?.color || '#4F46E5';

      const restored: Msg[] = detail.messages.map((m: any) => ({
        role: m.role === 'user' ? 'user' : String(m.speaker_employee_id ?? empId ?? '?'),
        sender: m.role === 'user' ? '你' : (m.speaker_name || (m.speaker_employee_id ? name : `员工 #${m.speaker_employee_id}`)),
        avatar: m.role === 'user' ? '你'[0] : (m.speaker_name || name)[0],
        color: m.role === 'user' ? 'var(--text-secondary)' : color,
        text: m.content,
        reasoning: Array.isArray(m.reasoning) ? m.reasoning : (m.reasoning ? [String(m.reasoning)] : []),
        tools: coerceToolCalls(m.tool_calls || m.tools),
        attachments: m.attachments ?? [],
        input_tokens: m.input_tokens,
        output_tokens: m.output_tokens,
        total_tokens: m.total_tokens,
        token_count: m.token_count,
      }));
      const sid = realSessionId(detail);
      setActiveSessionIdSafe(sid);
      setMessages(restored, sid);
      setDispatchCid(sid); // Bug #2 修复
      // 把 setActiveEmployee 也更新（防止 activeEmployee 是 null 时）
      if (!activeEmployee && emp && empId != null) {
        // FNV-1a shim safety: include uuid so the next chat stream uses real backend UUID, not shim int.
        setActiveEmployee({ id: (emp as any)?.id ?? empId, uuid: (emp as any).__id ?? empId, name, avatar, color });
      }
    } catch (e) {
      console.error('Failed to switch conversation:', e);
    } finally {
      setIsProcessing(false);
    }
  }, [activeEmployee, rememberSessionMeta]);

  // Phase 2 Aside-Fix：新建会话（清空 messages，conversationId 置空；调用后端 create 返回新 conv）
  const handleNewConversation = useCallback(async () => {
    if (!activeEmployee) {
      // 没预选员工时，弹员工选择器（async load fresh，避免用空 cache）
      console.warn('[handleNewConversation] no activeEmployee — opening switcher');
      try {
        const list = await fetchEmployees();
        setAllEmployees(list);
        setShowSwitcher(true);
      } catch (e) {
        console.error('[handleNewConversation] fetchEmployees failed:', e);
        message.error('无法加载员工列表，请刷新页面重试');
      }
      return;
    }
    console.log('[handleNewConversation] creating conv for emp', activeEmployee.id);
    try {
      // 真 UUID: 优先用 activeEmployee.uuid (从 fetchEmployeeDetail 拿), 兜底 allEmployees
      let realEmpId: string = (activeEmployee as any).uuid || String(activeEmployee.id);
      if (!(activeEmployee as any).uuid) {
        const realEmp = allEmployees.find((e) => e.id === activeEmployee.id);
        if (realEmp && (realEmp as any).__id) realEmpId = (realEmp as any).__id;
      }
      const conv = await createConversation(realEmpId, `${activeEmployee.name} 会话`);
      console.log('[handleNewConversation] conv created:', conv);
      const sid = realSessionId(conv);
      setActiveSessionIdSafe(sid);
      setDispatchCid(sid); // Bug #2 修复
      setMessages([{
        role: String(activeEmployee.id),
        sender: activeEmployee.name,
        avatar: activeEmployee.avatar,
        color: activeEmployee.color,
        text: `你好，我是${activeEmployee.name}。有什么可以帮你的？`,
      }], sid);
      // 加进列表头部
      setConversations(prev => [conv, ...prev]);
    } catch (e: any) {
      console.error('[handleNewConversation] failed:', e);
      message.error(`新建会话失败：${e?.message || e}`);
    }
  }, [activeEmployee]);

  // Phase 2.6: 切换到已有会话（focus mode 顶部 chip + aside 共用）
  const handleSwitchConversation = useCallback(async (convId: number | string) => {
    try {
      const detail = await fetchConversationDetail(convId);
      if (!detail) return; // P3.12 防御: 404 等情况下 detail 可能是 undefined
      rememberSessionMeta(detail, realSessionId(detail));
      // M4.2: 群聊 employee_id 可能为 null
      let empId = detail.employee_id;
      if (empId == null) {
        const firstAssistant = detail.messages.find((m: any) => m.role === 'assistant' && m.speaker_employee_id);
        empId = firstAssistant?.speaker_employee_id ?? null;
      }
      if (empId == null) {
        message.warning('该会话无法定位发言人(可能是空群聊)');
        return;
      }
      const emp = await fetchEmployeeDetail(empId).catch(() => null);
      const name = emp?.name || `员工 #${empId}`;
      const avatar = emp?.avatar_char || '?';
      const color = emp?.department?.color || '#4F46E5';
      // FNV-1a shim safety: include uuid so the next chat stream uses real backend UUID, not shim int.
      setActiveEmployee({ id: empId, uuid: (emp as any)?.__id, name, avatar, color });
      if (detail && detail.id != null) {
        const sid = realSessionId(detail);
        setActiveSessionIdSafe(sid);
        setDispatchCid(sid); // Bug #2 修复
        const restored: Msg[] = (detail.messages || []).map((m: any) => ({
          role: m.role === 'user' ? 'user' : String(m.speaker_employee_id ?? empId),
          sender: m.role === 'user' ? '你' : (m.speaker_name || name),
          avatar: m.role === 'user' ? '你'[0] : (m.speaker_name || name)[0],
          color: m.role === 'user' ? 'var(--text-secondary)' : color,
          text: m.content,
          reasoning: Array.isArray(m.reasoning) ? m.reasoning : (m.reasoning ? [String(m.reasoning)] : []),
          tools: coerceToolCalls(m.tool_calls || m.tools),
          input_tokens: m.input_tokens,
          output_tokens: m.output_tokens,
          total_tokens: m.total_tokens,
          token_count: m.token_count,
        }));
        setActiveSessionIdSafe(sid);
        setMessages(restored, sid);
        setSearchParams({ conversation: sid });
      }
      // M4.4.1: 群聊(>=2 个不同 speaker_employee_id) → 自动开协作画布
      const distinctSpeakers = new Set(
        (detail?.messages || [])
          .filter((m: any) => m.role === 'assistant' && m.speaker_employee_id)
          .map((m: any) => m.speaker_employee_id)
      );
      if (distinctSpeakers.size >= 2) {
        setCanvasOpen(true);
        console.log('[M4.4.1] group chat detected, auto-opened canvas (speakers:', distinctSpeakers.size + ')');
      }
    } catch (e: any) {
      console.error('[handleSwitchConversation] failed:', e);
      message.error(`切换会话失败:${e?.message || e}`);
    }
  }, [setSearchParams, rememberSessionMeta]);

  // Phase 2 Aside-Fix：删除会话（软删除）
  const handleDeleteConversation = useCallback(async (convId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    Modal.confirm({
      title: '确认删除该会话？',
      content: '删除后会从当前会话列表移除。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteConversation(convId);
          setConversations(prev => prev.filter(c => c.id !== convId));
          if (activeSessionId === String(convId)) {
            // 删除的是当前会话 → 清空消息
            setActiveSessionIdSafe(null);
            setDispatchCid(null); // Bug #2 修复:清 dispatch
            if (activeEmployee) {
              setMessages([{
                role: String(activeEmployee.id),
                sender: activeEmployee.name,
                avatar: activeEmployee.avatar,
                color: activeEmployee.color,
                text: `你好，我是${activeEmployee.name}。有什么可以帮你的？`,
              }]);
            } else {
              setMessagesBySession({});
            }
          }
          message.success('会话已删除');
        } catch (err: any) {
          console.error('Failed to delete conversation:', err);
          message.error(`删除失败: ${err?.message || err}`);
        }
      },
    });
  }, [activeEmployee]);

  const handlePatchConversation = useCallback(async (
    conv: Conversation,
    patch: Partial<Pick<Conversation, 'title' | 'pinned' | 'workspace' | 'model_override'>>,
  ) => {
    try {
      const updated = await patchSession((conv as any).__id || conv.id, patch);
      const updatedSid = realSessionId(updated);
      setConversations(prev => {
        const merged = prev.map(c => realSessionId(c) === updatedSid ? { ...c, ...updated } : c);
        if (!prev.some(c => realSessionId(c) === updatedSid)) merged.unshift(updated);
        return merged.sort((a, b) => {
          if (Boolean((a as any).pinned) !== Boolean((b as any).pinned)) return (a as any).pinned ? -1 : 1;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });
      });
      setSessionMetaById(prev => ({
        ...prev,
        [updatedSid]: {
          ...(prev[updatedSid] || {}),
          title: updated.title,
          pinned: updated.pinned,
          workspace: updated.workspace,
          model_override: updated.model_override,
        },
      }));
      message.success('会话设置已更新');
    } catch (e: any) {
      message.error(`更新会话失败: ${e?.message || e}`);
    }
  }, []);

  // M4.2 (Group Chat): 新建群聊(简化:复用 activeEmployee 当主员工,接力从 @ 召唤下拉选)
  const handleNewGroupConversation = useCallback(async () => {
    const fallbackEmp = (allEmployeesForMention[0] || allEmployees[0]) as Employee | undefined;
    const primary = activeEmployee ?? (fallbackEmp ? {
      id: fallbackEmp.id,
      uuid: (fallbackEmp as any).__id,
      name: fallbackEmp.name,
      avatar: fallbackEmp.avatar_char || fallbackEmp.avatar || fallbackEmp.name?.[0] || '?',
      color: fallbackEmp.department?.color || '#4F46E5',
      department: fallbackEmp.department?.name,
      allowedToolsets: fallbackEmp.allowed_toolsets,
    } : null);
    if (!primary) {
      message.warning('暂无可用员工，先去数智员工页面创建一个员工');
      return;
    }
    try {
      setActiveEmployee(primary);
      const group = await createGroupConversation(
        [primary.uuid || primary.id],
        `群聊: ${primary.name}`,
      );
      const sid = realSessionId(group);
      setActiveSessionIdSafe(sid);
      setDispatchCid(sid);
      setMessages([{
        role: String(primary.id),
        sender: primary.name,
        avatar: primary.avatar,
        color: primary.color,
        text: `欢迎来到群聊。我是「${primary.name}」,你可以在输入框中输入 @ 召唤其他员工接力。`,
      }], sid);
      await loadConversations();
    } catch (e) {
      console.error('[M4.2] createGroupConversation failed:', e);
      message.error(`建群失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [activeEmployee, allEmployees, allEmployeesForMention, loadConversations]);

  // Phase 2 E：员工切换器
  const handleSwitchEmployee = useCallback(async (emp: { id: number; name: string; avatar_char: string; department?: { name: string; color: string } | null }) => {
    setActiveEmployee({
      id: emp.id,
      uuid: (emp as any).__id,
      name: emp.name,
      avatar: emp.avatar_char,
      color: emp.department?.color || '#4F46E5',
    });
    setShowSwitcher(false);
    setMessages([]); // 清空
    setActiveSessionIdSafe(null);
    setDispatchCid(null); // Bug #2 修复:切员工时清 dispatch
  }, []);

  const handleEmployeeShortcut = useCallback(async (emp: Employee) => {
    if (isProcessing) return;
    const employee = toEmployeeChip(emp);
    setActiveEmployee(employee);
    setInput('');
    setRelayEmployeeIds([]);
    setRelayChips([]);
    try {
      const realEmpId = (emp as any).__id || String(emp.id);
      const conv = await createConversation(realEmpId, `${employee.name} 会话`);
      const sid = realSessionId(conv);
      setActiveSessionIdSafe(sid);
      setDispatchCid(sid);
      setMessages([{
        role: String(employee.id),
        sender: employee.name,
        avatar: employee.avatar,
        color: employee.color,
        text: `你好，我是${employee.name}。你可以直接输入任务，也可以 @ 其他员工加入协作。`,
      }], sid);
      setConversations(prev => [conv, ...prev.filter((c) => realSessionId(c) !== sid)]);
    } catch (e: any) {
      console.error('[handleEmployeeShortcut] failed:', e);
      message.error(`创建员工会话失败:${e?.message || e}`);
    }
  }, [isProcessing, setActiveSessionIdSafe, setMessages]);

  const handleOpenCustomOrchestration = useCallback(async () => {
    let list = allEmployees as any[];
    if (list.length === 0) {
      try {
        list = await fetchEmployees();
        setAllEmployees(list as any);
        setAllEmployeesForMention(list);
      } catch (e) {
        console.warn('[custom orchestration] fetchEmployees failed:', e);
      }
    }
    if (!activeSessionId) {
      const seed = activeEmployee
        ? list.find((e: any) => e.id === activeEmployee.id || e.__id === activeEmployee.uuid)
        : list[0];
      if (seed) {
        const employee = toEmployeeChip(seed);
        setActiveEmployee(employee);
        try {
          const conv = await createConversation(seed.__id || String(seed.id), '自定义编排草稿');
          const sid = realSessionId(conv);
          setActiveSessionIdSafe(sid);
          setDispatchCid(sid);
          setConversations(prev => [conv, ...prev.filter((c) => realSessionId(c) !== sid)]);
          setMessages([{
            role: String(employee.id),
            sender: employee.name,
            avatar: employee.avatar,
            color: employee.color,
            text: `已创建自定义编排草稿。打开画布后可以添加员工节点、配置属性并保存为方案。`,
          }], sid);
        } catch (e: any) {
          console.error('[custom orchestration] create draft session failed:', e);
          message.error(`创建编排草稿失败:${e?.message || e}`);
          return;
        }
      }
    }
    await openCollaborationCanvas();
  }, [activeEmployee, activeSessionId, allEmployees, openCollaborationCanvas, setActiveSessionIdSafe, setMessages]);

  // Phase 2 Upload-Real：上传文件/图片
  const handleFileSelected = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const result = await uploadFile(file);
      setPendingAttachments((prev: Attachment[]) => [...prev, result]);
    } catch (e) {
      console.error('Upload failed:', e);
      message.error(`上传失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setUploading(false);
    }
  }, []);

  // Phase 2 Upload-Real：移除待发附件
  const removePendingAttachment = useCallback((key: string) => {
    setPendingAttachments(prev => prev.filter(a => (a.url || a.id) !== key));
  }, []);

  const handleAbortCurrentRun = useCallback(async () => {
    const runIds = Array.from(activeHermesRunIdsRef.current);
    if (streamAbortRef.current) {
      try { streamAbortRef.current.abort(); } catch { /* ignore */ }
      streamAbortRef.current = null;
    }
    if (runIds.length > 0) {
      activeHermesRunIdsRef.current.clear();
      Promise.allSettled(runIds.map((runId) => stopHermesRun(runId, 'user_clicked_stop'))).then((results) => {
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          console.warn('[Hermes Stop] failed to stop some runs', results);
        }
      });
    }
    setTunnels(prev => prev.map(t => t.isComplete ? t : {
      ...t,
      status: '已停止',
      outputLines: appendTraceLine(t.outputLines, runIds.length ? `用户已停止当前运行 · Hermes stop ${runIds.length} 个 run` : '用户已停止当前运行'),
      isComplete: true,
    }));
    setOrbState('idle');
    setIsProcessing(false);
  }, []);

  const handleResumeActiveTask = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await resumeSessionTask(activeSessionId);
      mergeTaskState(activeSessionId, { task_status: 'draft', reason: 'waiting for user follow-up' });
    } catch (e) {
      console.warn('[RunQueue] resume marker failed:', e);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [activeSessionId, mergeTaskState]);

  // Phase B (2026-06-04):Profile 模式计算
  //   1) 员工没选 → normal
  //   2) 后端 Employee.allowed_toolsets 非空 + 不含 terminal/write → read-only
  //   3) 否则 → normal
  // audit 模式留 Phase C(等后端 audit log 关联 API)
  const getProfileMode = useCallback((): ProfileMode => {
    if (!activeEmployee) return 'normal';
    const ts = activeEmployee.allowedToolsets;
    if (!ts || ts.length === 0) return 'normal';
    const hasWrite = ts.some(t => /terminal|file|write|bash/i.test(t));
    return hasWrite ? 'normal' : 'read-only';
  }, [activeEmployee]);

  const simulateDispatch = useCallback(async (userInput: string) => {
    // Bug A 修复：已预选员工时直接锁定，不再走 LLM router
    let employee: { id: number; uuid?: string; name: string; avatar: string; color: string };
    if (activeEmployee) {
      employee = activeEmployee;
    } else {
      employee = await selectEmployee(userInput);
      setActiveEmployee(employee);
    }

    const displayName = user?.username || '用户';

    const newTunnel: Tunnel = {
      id: employee.id.toString(),
      name: employee.name,
      avatar: employee.avatar,
      color: employee.color,
      department: 'AI 员工',
      status: '思考中',
      task: '分析问题并生成回复',
      outputLines: [],
      isComplete: false,
    };
    setTunnels(prev => [...prev, newTunnel]);
    setOrbState('thinking');
    setTunnels(prev => prev.map(t => t.id === employee.id.toString() ? { ...t, outputLines: ['接收问题...', '分析意图...'] } : t));

    // 取出待发附件（snapshot 当前值，然后清空）
    const attachmentsToSend = pendingAttachments;
    setPendingAttachments([]);

    // P3.12 3.4.3: 新建 AbortController 接管流, 切会话自动 abort
    const ac = new AbortController();

    try {
      setOrbState('dispatch');
      setTunnels(prev => prev.map(t => t.id === employee.id.toString() ? { ...t, status: '生成回复中', outputLines: ['接收问题...', '分析意图...', '调用模型...'] } : t));

      let fullResponse = '';
      let wasAborted = false;
      const toolCalls: ToolCall[] = [];
      let assistantUsage: Partial<Msg> = {};
      // 真 UUID: 优先用 employee.uuid, 兜底 allEmployees.find().__id
      let realEmpId: string = (employee as any).uuid || String(employee.id);
      if (!(employee as any).uuid) {
        const realEmp = allEmployees.find((e) => e.id === employee.id);
        if (realEmp && (realEmp as any).__id) realEmpId = (realEmp as any).__id;
      }
      let targetSessionId = activeSessionId;
      if (!targetSessionId) {
        const conv = await createConversation(realEmpId, userInput);
        targetSessionId = realSessionId(conv);
        setActiveSessionIdSafe(targetSessionId);
        setDispatchCid(targetSessionId);
        setConversations(prev => [conv, ...prev.filter((c) => realSessionId(c) !== targetSessionId)]);
        setMessages([{
          role: 'user',
          sender: displayName,
          avatar: displayName[0],
          color: '#6B7280',
          text: userInput,
          attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
        }], targetSessionId);
      }
      streamSessionIdRef.current = targetSessionId;
      streamAbortRef.current = ac;
      const stream = chatWithEmployeeStream(realEmpId, userInput, {
        sessionId: targetSessionId,
        attachmentIds: attachmentsToSend?.map((a: any) => a.id) || [],
        reasoningEffort,
        signal: ac.signal,
      });

      for await (const chunk of stream) {
        if (chunk._origin === 'openatlas' && chunk.conversation_id) {
          // openatlas session uuid — 用来串后续 message
          targetSessionId = String(chunk.conversation_id);
          setActiveSessionIdSafe(chunk.conversation_id);
          setDispatchCid(chunk.conversation_id);
        } else if (chunk.conversation_id && !chunk._origin) {
          // hermes sid 或未知 — 不覆盖 openatlas uuid
          console.log('[simulateDispatch] skipping non-openatlas conversation_id:', chunk.conversation_id);
        }
        if (chunk.error) {
          throw new Error(chunk.error);
        }
        if (chunk.aborted) {
          wasAborted = true;
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, status: '已停止', outputLines: appendTraceLine(t.outputLines, '运行已停止'), isComplete: true }
            : t));
          break;
        }
        if (chunk.event_type === 'run.started') {
          const runId = chunk.hermes_run_id || chunk.run_id;
          if (runId) {
            activeHermesRunIdsRef.current.add(String(runId));
            setTunnels(prev => prev.map(t => t.id === employee.id.toString()
              ? { ...t, outputLines: appendTraceLine(t.outputLines, `Hermes run started · ${String(runId).slice(0, 12)}`) }
              : t));
          }
          continue;
        }
        if (chunk.event_type === 'openatlas.run_idle' || chunk.event_type === 'openatlas.run_detached') {
          const line = chunk.message || (chunk.detached ? 'Hermes 后台继续运行，稍后自动补同步' : 'Hermes 暂无新事件，继续等待');
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, status: chunk.detached ? '后台运行' : '运行中', outputLines: appendTraceLine(t.outputLines, line), isComplete: !!chunk.detached }
            : t));
          continue;
        }
        if (chunk.task_state?.task_status) {
          mergeTaskState(targetSessionId, chunk.task_state);
          continue;
        }
        if (chunk.event_type === 'openatlas.trace' || chunk.trace) {
          const line = formatTraceLine(chunk.trace || chunk);
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, outputLines: appendTraceLine(t.outputLines, line) }
            : t));
          continue;
        }
        if (chunk.approval_required) {
          const approval = chunk.approval_required;
          const runId = approval.hermes_run_id || approval.run_id;
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, status: '等待确认', outputLines: appendTraceLine(t.outputLines, `等待人工确认 · ${approval.description || approval.command || '高风险操作'}`) }
            : t));
          const choice = await requestApprovalChoiceInline(approval);
          if (runId) {
            try {
              await approveHermesRun(String(runId), choice, choice === 'always', approval.approval_id);
              setTunnels(prev => prev.map(t => t.id === employee.id.toString()
                ? { ...t, status: choice === 'deny' ? '已拒绝' : '继续执行', outputLines: appendTraceLine(t.outputLines, approvalChoiceText(choice)) }
                : t));
            } catch (err: any) {
              setTunnels(prev => prev.map(t => t.id === employee.id.toString()
                ? { ...t, status: '审批失败', outputLines: appendTraceLine(t.outputLines, `审批提交失败 · ${err?.message || err}`) }
                : t));
            }
          }
          continue;
        }
        if (chunk.approval_responded) {
          const choice = chunk.approval_responded.choice || '';
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, outputLines: appendTraceLine(t.outputLines, `审批响应 · ${choice}`) }
            : t));
          continue;
        }
        if (chunk.reasoning?.text) {
          const reasoningText = String(chunk.reasoning.text);
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, outputLines: appendTraceLine(t.outputLines, `思考摘要 · ${reasoningText.slice(0, 80)}`) }
            : t));
          setMessages((prev: Msg[]) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === employee.id.toString()) {
              return [...prev.slice(0, -1), { ...lastMsg, reasoning: [...(lastMsg.reasoning || []), reasoningText] }];
            }
            return [...prev, { role: employee.id.toString(), sender: employee.name, avatar: employee.avatar, color: employee.color, text: fullResponse, reasoning: [reasoningText], tools: toolCalls.length ? [...toolCalls] : undefined, ...assistantUsage }];
          }, targetSessionId);
          continue;
        }
        if (chunk.event_type === 'openatlas.context' || chunk.skills || chunk.memories) {
          mergeLiveContext(targetSessionId, chunk);
          if (chunk.files) {
            const injected = (chunk.files || []).map((f: any) => ({
              id: f.id,
              name: f.name || f.original_name,
              mime: f.mime || f.mime_type,
              size: f.size,
              status: f.status,
              extracted_chars: f.extracted_chars || 0,
            })) as Attachment[];
            markInjectedFiles(targetSessionId, injected);
          }
          continue;
        }
        if (chunk.files) {
          const injected = (chunk.files || []).map((f: any) => ({
            id: f.id,
            name: f.name || f.original_name,
            mime: f.mime || f.mime_type,
            size: f.size,
            status: f.status,
            extracted_chars: f.extracted_chars || 0,
          })) as Attachment[];
          markInjectedFiles(targetSessionId, injected);
          continue;
        }
        if (chunk.usage) {
          assistantUsage = {
            ...assistantUsage,
            input_tokens: chunk.usage.input_tokens,
            output_tokens: chunk.usage.output_tokens,
            total_tokens: chunk.usage.total_tokens,
            token_count: chunk.usage.total_tokens || chunk.usage.output_tokens,
          };
          setMessages((prev: Msg[]) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === employee.id.toString()) {
              return [...prev.slice(0, -1), { ...lastMsg, ...assistantUsage }];
            }
            return prev;
          }, targetSessionId);
          continue;
        }
        if (chunk.tool) {
          const t = chunk.tool;
          const merged = mergeToolCall(toolCalls, t);
          toolCalls.splice(0, toolCalls.length, ...merged);
          setTunnels(prev => prev.map(tn => tn.id === employee.id.toString()
            ? { ...tn, outputLines: [
              ...(tn.outputLines || []),
              ...toolCalls.map(tc => `[tool] ${tc.name}${tc.label ? ' · ' + tc.label : ''} (${tc.status || ''})`),
            ].filter(Boolean).slice(-8) }
            : tn));
          setMessages((prev: Msg[]) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === employee.id.toString()) {
              return [...prev.slice(0, -1), { ...lastMsg, tools: [...toolCalls], ...assistantUsage }];
            }
            // Bug 5 (2026-06-06): tool-only chunk 不直接 push 空 fullResponse 气泡,
            // 因为可能 assistant 还没开始输出.  改为 null 占位, 等第一个有 content 的
            // chunk 进来再 push.  这里加 1 个临时占位: text='' 但只在 tools 列表非空时
            // 才允许推送 (因为 tool 事件本身有信息量).
            if (toolCalls.length === 0) return prev;
            return [...prev, { role: employee.id.toString(), sender: employee.name, avatar: employee.avatar, color: employee.color, text: fullResponse, tools: [...toolCalls], ...assistantUsage }];
          }, targetSessionId);
          continue;
        }
        if (chunk.done) break;
        // Bug 5 (2026-06-06): chunk.content 必须真存在再累计 + push.  之前
        // chunk.content 是 undefined 时 fullResponse += undefined → "undefined"
        // 字面量拼到末尾, 显示 "AI 回复先 undefined 再 LLM".  现在跳过.
        if (typeof chunk.content !== 'string' || chunk.content.length === 0) continue;
        fullResponse += chunk.content;
        setMessages((prev: Msg[]) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === employee.id.toString()) {
            return [...prev.slice(0, -1), { ...lastMsg, text: fullResponse, tools: toolCalls.length ? [...toolCalls] : lastMsg.tools, ...assistantUsage }];
          }
          return [...prev, { role: employee.id.toString(), sender: employee.name, avatar: employee.avatar, color: employee.color, text: fullResponse, tools: toolCalls.length ? [...toolCalls] : undefined, ...assistantUsage }];
        }, targetSessionId);
      }

      if (!wasAborted) {
        setTunnels(prev => prev.map(t => t.id === employee.id.toString()
          ? { ...t, status: '完成', outputLines: appendTraceLine(t.outputLines, `生成回复完成 · ${fullResponse.length} 字`), isComplete: true }
          : t));
        setOrbState('speaking');
        await new Promise(r => setTimeout(r, 300));
      }
      // Bug #1 修复 (2026-06-03):显示"工作成果" — 真实产出的长度 + 摘要进 conclusions,
      // 不再在完成后立即清空 files;如果本次有 markdown/文件产出,通过 conclusions 告知。
      // 占位策略:把"回复内容"视为隐式产出,文件名格式:"回复-{employee}-{timestamp}.md"
      setConclusions((prev) => prev.length > 0 ? prev : []);
      // 不再清空 files — 保留之前所有生成文件;如果本次有真实文件产出,会在
      // 上游 setFiles([...prev, newFile]) 累积
      // (旧版 setFiles([]) 移除:会清空之前的所有产出)

      if (streamAbortRef.current === ac) {
        streamAbortRef.current = null;
      }
      setOrbState('idle');
      setIsProcessing(false);

      // 刷新会话列表（让新建的/更新的会话标题/时间排到最前）
      await loadConversations();
      if (targetSessionId) {
        fetchConversationDetail(targetSessionId).then((detail) => rememberSessionMeta(detail, targetSessionId)).catch(() => {});
      }

    } catch (error: any) {
      if (error?.name === 'AbortError') {
        // P3.12 3.4.3: 用户切会话/点新消息主动 abort — 静默
        console.debug('[Chat] aborted by user/session-switch');
      } else {
        console.error('Chat error:', error);
        setActiveSessionIdSafe(null);
        setDispatchCid(null); // Bug #2 修复:chat 失败清 dispatch
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        setMessages((prev: Msg[]) => [...prev, {
          role: 'atlas',
          sender: 'Atlas',
          avatar: 'A',
          color: '#EF4444',
          text: `抱歉，处理您的请求时出现错误：${errorMessage}`
        }], activeSessionId);
        setTunnels(prev => prev.map(t => t.id === employee.id.toString() ? { ...t, status: '失败', isComplete: true } : t));
      }
    }

    if (streamAbortRef.current === ac) {
      streamAbortRef.current = null;
    }
    activeHermesRunIdsRef.current.clear();
    setOrbState('idle');
    setIsProcessing(false);
  }, [activeEmployee, pendingAttachments, loadConversations, user, activeSessionId, allEmployees, markInjectedFiles, mergeLiveContext, mergeTaskState, rememberSessionMeta, reasoningEffort, requestApprovalChoiceInline]);

  // ─────────────────────────────────────────────────────────────────────
  // M4.2 (Group Chat): 群聊 dispatch — 用 conversationChatStream 替代 chatWithEmployeeStream
  // 接力员工循环:每个员工独立 stream + 写新 Message
  // ─────────────────────────────────────────────────────────────────────
  const simulateGroupDispatch = useCallback(async (userInput: string, primaryEmp: typeof activeEmployee, relays: Employee[]) => {
    if (!primaryEmp) return;

    setOrbState('thinking');
    const attachmentsToSend = pendingAttachments;
    setPendingAttachments([]);

    // P3.12 3.4.3: 新建 AbortController 接管流, 切会话自动 abort
    const ac = new AbortController();

    // 显示所有接力员工的 tunnel
    const newTunnels: Tunnel[] = [primaryEmp, ...relays].map((emp, i) => ({
      id: emp.id.toString(),
      name: emp.name,
      avatar: (emp as any).avatar_char || (emp.name ? emp.name[0] : 'A'),
      color: (emp as any).color || (emp as any).department?.color || 'var(--accent)',
      department: 'AI 员工' + (i > 0 ? ` · 接力` : ''),
      status: '等待中',
      task: i === 0 ? '主发言' : '接力发言',
      outputLines: [],
      isComplete: false,
    }));
    setTunnels(prev => [...prev, ...newTunnels]);

    try {
      setOrbState('dispatch');

      // 群聊/接力:已有会话内的 @员工 是本轮接力, 不新开窗口; 没有会话时才创建群聊草稿.
      let convId = activeSessionId;
      if (!convId) {
        const group = await createGroupConversation(
          primaryEmp.id,
          relays.map(r => r.id),
          userInput.slice(0, 50),
        );
        convId = realSessionId(group);
        setActiveSessionIdSafe(convId);
        setDispatchCid(convId);
        setConversations(prev => [group, ...prev.filter((c) => realSessionId(c) !== convId)]);
      }
      const groupUserMsg: Msg = {
        role: 'user',
        sender: user?.username || '用户',
        avatar: (user?.username || '用')[0],
        color: '#6B7280',
        text: userInput,
        attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
      };
      setMessages((prev: Msg[]) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'user' && last.text === userInput) return prev;
        return [...prev, groupUserMsg];
      }, convId);
      streamAbortRef.current = ac;

      // 调会话级流式端点
      const stream = conversationChatStream(
        primaryEmp.id,
        userInput,
        {
          sessionId: convId,
          relayEmployeeIds: relays.map(r => r.id),
          attachmentIds: attachmentsToSend?.map((a: any) => a.id) || [],
          reasoningEffort,
          signal: ac.signal,
        },
      );

      // 按 speaker_employee_id 分桶,每个员工独立累 fullResponse
      const fullByAgent = new Map<string, string>();
      const toolByAgent = new Map<string, ToolCall[]>();
      const usageByAgent = new Map<string, Partial<Msg>>();
      let activeAgentId: string = String(primaryEmp.uuid || primaryEmp.id);  // 当前正在发言的员工
      let activeSpeakerName = primaryEmp.name;
      let wasAborted = false;

      for await (const chunk of stream) {
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.aborted) {
          wasAborted = true;
          setTunnels(prev => prev.map(t => t.isComplete ? t : {
            ...t,
            status: '已停止',
            outputLines: appendTraceLine(t.outputLines, '运行已停止'),
            isComplete: true,
          }));
          break;
        }
        if (chunk.event_type === 'run.started') {
          const runId = chunk.hermes_run_id || chunk.run_id;
          const runSpeakerId = String(chunk.speaker_employee_id || activeAgentId);
          if (chunk.speaker_employee_id) {
            activeAgentId = runSpeakerId;
            activeSpeakerName = chunk.speaker_name || activeSpeakerName;
          }
          if (runId) {
            activeHermesRunIdsRef.current.add(String(runId));
            const activeEmp = employeeForSpeaker(runSpeakerId, chunk.speaker_name || activeSpeakerName);
            setTunnels(prev => prev.map(t =>
              t.id === String(activeEmp.id) || t.name === activeEmp.name
                ? { ...t, outputLines: appendTraceLine(t.outputLines, `Hermes run started · ${String(runId).slice(0, 12)}`) }
                : t
            ));
          }
          continue;
        }
        if (chunk.event_type === 'openatlas.run_idle' || chunk.event_type === 'openatlas.run_detached') {
          const idleSpeakerId = String(chunk.speaker_employee_id || activeAgentId);
          const idleEmp = employeeForSpeaker(idleSpeakerId, chunk.speaker_name || activeSpeakerName);
          const line = chunk.message || (chunk.detached ? 'Hermes 后台继续运行，稍后自动补同步' : 'Hermes 暂无新事件，继续等待');
          setTunnels(prev => prev.map(t =>
            t.id === String(idleEmp.id) || t.name === idleEmp.name
              ? { ...t, status: chunk.detached ? '后台运行' : '运行中', outputLines: appendTraceLine(t.outputLines, line), isComplete: !!chunk.detached }
              : t
          ));
          continue;
        }
        if (chunk.task_state?.task_status) {
          mergeTaskState(convId, chunk.task_state);
          continue;
        }
        if (chunk.conversation_id) {
          setActiveSessionIdSafe(chunk.conversation_id);
          setDispatchCid(chunk.conversation_id);
        }
        if (chunk.event_type === 'openatlas.context' || chunk.skills || chunk.memories) {
          mergeLiveContext(convId, chunk);
          if (chunk.files) {
            const injected = (chunk.files || []).map((f: any) => ({
              id: f.id,
              name: f.name || f.original_name,
              mime: f.mime || f.mime_type,
              size: f.size,
              status: f.status,
              extracted_chars: f.extracted_chars || 0,
            })) as Attachment[];
            markInjectedFiles(convId, injected);
          }
          continue;
        }
        if (chunk.files) {
          const injected = (chunk.files || []).map((f: any) => ({
            id: f.id,
            name: f.name || f.original_name,
            mime: f.mime || f.mime_type,
            size: f.size,
            status: f.status,
            extracted_chars: f.extracted_chars || 0,
          })) as Attachment[];
          markInjectedFiles(convId, injected);
          continue;
        }

        // 切发言员工
        const chunkSpeakerId = chunk.speaker_employee_id || chunk.agent_id;
        if (chunkSpeakerId && String(chunkSpeakerId) !== activeAgentId) {
          activeAgentId = String(chunkSpeakerId);
          activeSpeakerName = chunk.speaker_name || activeSpeakerName;
        }

        if (chunk.event_type === 'openatlas.trace' || chunk.trace) {
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          const line = formatTraceLine(chunk.trace || chunk);
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, outputLines: appendTraceLine(t.outputLines, line) }
              : t
          ));
          continue;
        }

        if (chunk.approval_required) {
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          const approval = chunk.approval_required;
          const runId = approval.hermes_run_id || approval.run_id;
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, status: '等待确认', outputLines: appendTraceLine(t.outputLines, `等待人工确认 · ${approval.description || approval.command || '高风险操作'}`) }
              : t
          ));
          const choice = await requestApprovalChoiceInline(approval);
          if (runId) {
            try {
              await approveHermesRun(String(runId), choice, choice === 'always', approval.approval_id);
              setTunnels(prev => prev.map(t =>
                t.id === String(activeEmp.id) || t.name === activeEmp.name
                  ? { ...t, status: choice === 'deny' ? '已拒绝' : '继续执行', outputLines: appendTraceLine(t.outputLines, approvalChoiceText(choice)) }
                  : t
              ));
            } catch (err: any) {
              setTunnels(prev => prev.map(t =>
                t.id === String(activeEmp.id) || t.name === activeEmp.name
                  ? { ...t, status: '审批失败', outputLines: appendTraceLine(t.outputLines, `审批提交失败 · ${err?.message || err}`) }
                  : t
              ));
            }
          }
          continue;
        }

        if (chunk.approval_responded) {
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          const choice = chunk.approval_responded.choice || '';
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, outputLines: appendTraceLine(t.outputLines, `审批响应 · ${choice}`) }
              : t
          ));
          continue;
        }

        if (chunk.reasoning?.text) {
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          const reasoningText = String(chunk.reasoning.text);
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, outputLines: appendTraceLine(t.outputLines, `思考摘要 · ${reasoningText.slice(0, 80)}`) }
              : t
          ));
          setMessages((prev: Msg[]) => {
            const last = prev[prev.length - 1];
            if (last && last.role === activeAgentId) {
              return [...prev.slice(0, -1), { ...last, reasoning: [...(last.reasoning || []), reasoningText] }];
            }
            return [...prev, {
              role: activeAgentId,
              sender: activeEmp.name,
              avatar: activeEmp.avatar,
              color: activeEmp.color,
              text: fullByAgent.get(activeAgentId) || '',
              tools: toolByAgent.get(activeAgentId),
              reasoning: [reasoningText],
              ...usageByAgent.get(activeAgentId),
            }];
          }, convId);
          continue;
        }

        if (chunk.event_type === 'agent_join') {
          if (chunkSpeakerId) activeAgentId = String(chunkSpeakerId);
          activeSpeakerName = chunk.speaker_name || activeSpeakerName;
          setOrbState('thinking');
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, status: '思考中', outputLines: appendTraceLine(t.outputLines, '接收问题...') }
              : t
          ));
        }
        if (chunk.event_type === 'agent_leave') {
          const txt = fullByAgent.get(activeAgentId) || '';
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name ? {
              ...t, status: '完成',
              outputLines: appendTraceLine(t.outputLines, '生成回复完成 · ' + txt.length + ' 字'),
              isComplete: true,
            } : t
          ));
        }

        if (chunk.usage) {
          usageByAgent.set(activeAgentId, {
            input_tokens: chunk.usage.input_tokens,
            output_tokens: chunk.usage.output_tokens,
            total_tokens: chunk.usage.total_tokens,
            token_count: chunk.usage.total_tokens || chunk.usage.output_tokens,
          });
          setMessages((prev: Msg[]) => {
            const last = prev[prev.length - 1];
            if (last && last.role === activeAgentId) {
              return [...prev.slice(0, -1), { ...last, ...usageByAgent.get(activeAgentId) }];
            }
            return prev;
          }, convId);
          continue;
        }

        if (chunk.tool) {
          const arr = mergeToolCall(toolByAgent.get(activeAgentId) ?? [], chunk.tool);
          toolByAgent.set(activeAgentId, arr);
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          const toolLine = `[tool] ${chunk.tool.name}${chunk.tool.label ? ' · ' + chunk.tool.label : ''} (${chunk.tool.status || ''})`;
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, outputLines: appendTraceLine(t.outputLines, toolLine) }
              : t
          ));
          setMessages((prev: Msg[]) => {
            const last = prev[prev.length - 1];
            if (last && last.role === activeAgentId) {
              return [...prev.slice(0, -1), { ...last, tools: [...arr], ...usageByAgent.get(activeAgentId) }];
            }
            return [...prev, {
              role: activeAgentId,
              sender: activeEmp.name,
              avatar: activeEmp.avatar,
              color: activeEmp.color,
              text: fullByAgent.get(activeAgentId) || '',
              tools: [...arr],
              ...usageByAgent.get(activeAgentId),
            }];
          }, convId);
        }

        if (chunk.done) break;

        if (chunk.content) {
          const cur = (fullByAgent.get(activeAgentId) ?? '') + chunk.content;
          fullByAgent.set(activeAgentId, cur);

          // 找到 active agent 的 employee 信息
          const activeEmp = employeeForSpeaker(activeAgentId, chunk.speaker_name || activeSpeakerName);
          setMessages((prev: Msg[]) => {
            const last = prev[prev.length - 1];
            if (last && last.role === activeAgentId) {
              return [...prev.slice(0, -1), { ...last, text: cur, tools: toolByAgent.get(activeAgentId), ...usageByAgent.get(activeAgentId) }];
            }
            return [...prev, {
              role: activeAgentId,
              sender: activeEmp.name,
              avatar: activeEmp.avatar,
              color: activeEmp.color,
              text: cur,
              tools: toolByAgent.get(activeAgentId),
              ...usageByAgent.get(activeAgentId),
            }];
          }, convId);
        }
      }

      if (!wasAborted) {
        setOrbState('speaking');
        await new Promise(r => setTimeout(r, 300));
      }
      setOrbState('idle');

      // 收尾:刷新会话列表(因为新群聊会话已建)
      await loadConversations();
      if (convId) {
        fetchConversationDetail(convId).then((detail) => rememberSessionMeta(detail, convId)).catch(() => {});
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        console.debug('[M4.2] group chat aborted by user/session-switch');
      } else {
        console.error('[M4.2] group chat error:', e);
        message.error(`群聊失败: ${e instanceof Error ? e.message : '未知错误'}`);
      }
      setOrbState('idle');
    } finally {
      if (streamAbortRef.current === ac) {
        streamAbortRef.current = null;
      }
      activeHermesRunIdsRef.current.clear();
      // 清空接力 chips
      setRelayEmployeeIds([]);
      setRelayChips([]);
      setIsProcessing(false);
    }
  }, [pendingAttachments, loadConversations, user, employeeForSpeaker, activeSessionId, markInjectedFiles, mergeLiveContext, mergeTaskState, rememberSessionMeta, reasoningEffort, requestApprovalChoiceInline]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isProcessing) return;
    const displayName = user?.username || '用户';
    // Phase 2 Upload-Real：user message 带上 pending attachments
    const userMsg: Msg = {
      role: 'user',
      sender: displayName,
      avatar: displayName[0],
      color: '#6B7280',
      text,
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
    };
    setMessages((prev: Msg[]) => [...prev, userMsg]);
    setInput('');
    setIsProcessing(true);

    // M4.2: @员工 = 当前会话内本轮接力, 不再把第一个 @ 员工提升成新窗口主员工.
    if (relayChips.length > 0) {
      const primaryEmp = activeEmployee || toEmployeeChip(relayChips[0]);
      const relays = activeEmployee ? relayChips : relayChips.slice(1);
      simulateGroupDispatch(text, primaryEmp, relays);
    } else {
      // 单聊兼容 M1-M3.5
      simulateDispatch(text);
    }
  }, [input, isProcessing, simulateDispatch, simulateGroupDispatch, user, pendingAttachments, relayEmployeeIds, relayChips, activeEmployee]);

  const handlePrompt = (prompt: string) => {
    const fullText = prompt === '检查围标' ? '该批采购是否存在围标串标迹象？请启动全面检测。'
      : prompt === '审合同' ? '帮我起草一份采购合同的风险评审清单'
      : prompt === '差旅报销' ? '把这个月的差旅报销规则讲清楚'
      : '员工年休假能跨年使用吗？';
    setMessages([{ role: 'user', sender: user?.username || '用户', avatar: (user?.username || '用')[0], color: '#6B7280', text: fullText }]);
    setIsProcessing(true);
    simulateDispatch(fullText);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const employeePool = (allEmployeesForMention.length > 0 ? allEmployeesForMention : allEmployees as any) as Employee[];
  const getEmployeeDockKey = (emp: Employee) => String((emp as any).__id || emp.id);
  const selectedDockSet = new Set(employeeDockIds);
  const configuredDockEmployees = employeePool.filter((emp) => selectedDockSet.has(getEmployeeDockKey(emp)));
  const launchEmployees = (employeeDockIds.length > 0 ? configuredDockEmployees : employeePool).slice(0, 6);
  const userDisplayName = user?.username || user?.email?.split('@')[0] || '用户';
  const continuationConversations = [...conversations]
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      const statusRank = (s?: string) => s === 'running' ? 0 : s === 'needs_input' ? 1 : 2;
      const rank = statusRank(a.task_status) - statusRank(b.task_status);
      if (rank !== 0) return rank;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    })
    .slice(0, 3);

  const shortcutSettingsModal = (
    <Modal
      title="自定义员工 Dock"
      open={dockSettingsOpen}
      onCancel={() => setDockSettingsOpen(false)}
      footer={[
        <Button key="reset" onClick={() => setEmployeeDockIds([])}>恢复默认</Button>,
        <Button key="done" type="primary" onClick={() => setDockSettingsOpen(false)}>完成</Button>,
      ]}
      width={520}
    >
      <div className="atlas-dock-settings">
        <div className="atlas-dock-settings-note">
          选择首页 Dock 展示的员工，最多展示 6 个。未选择时自动展示前 6 个常用员工。
        </div>
        <div className="atlas-dock-settings-list">
          {employeePool.map((emp, index) => {
            const key = getEmployeeDockKey(emp);
            const checked = employeeDockIds.includes(key);
            const color = emp.department?.color || ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#6366F1'][index % 6];
            return (
              <label key={key} className={`atlas-dock-settings-item ${checked ? 'is-selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    setEmployeeDockIds((prev) => {
                      if (e.target.checked) {
                        return prev.includes(key) ? prev : [...prev, key].slice(0, 6);
                      }
                      return prev.filter((id) => id !== key);
                    });
                  }}
                />
                <span className="atlas-dock-settings-avatar" style={{ '--agent-color': color } as any}>
                  {emp.avatar_char || emp.avatar || emp.name?.[0] || '?'}
                </span>
                <span className="atlas-dock-settings-copy">
                  <strong>{emp.name}</strong>
                  <span>{emp.department?.name || '企业能力员工'}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );

  // Phase 2.6: 编辑模态 JSX — 在两处 return 中复用（focus mode & war room 都能调）
  const promptsModal = editingPrompts ? (
    <div onClick={() => !savingPrompts && setEditingPrompts(false)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(29, 29, 31, 0.45)',
        backdropFilter: 'blur(6px)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.18s ease',
      }}
    >
      <div onClick={e => e.stopPropagation()}
        style={{
          background: '#FFFFFF', borderRadius: 14, padding: 28,
          width: 480, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <IconSettings size={18} />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#1D1D1F' }}>
            自定义快捷指令
          </h2>
        </div>
        <p style={{ margin: '4px 0 20px', fontSize: 13, color: '#6E6E73', lineHeight: 1.5 }}>
          设置你最常用的查询指令，1-8 个，每个不超过 32 字。改动会跨设备同步（保存在你的账户下）。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {promptDraft.map((text, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: 'var(--accent-soft)', color: 'var(--accent)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600, flexShrink: 0,
              }}>{i + 1}</span>
              <input
                type="text"
                value={text}
                maxLength={32}
                placeholder={`指令 ${i + 1}（例如：检查围标风险）`}
                onChange={e => {
                  const next = [...promptDraft];
                  next[i] = e.target.value;
                  setPromptDraft(next);
                }}
                style={{
                  flex: 1, padding: '8px 12px', fontSize: 14,
                  border: '1px solid #D2D2D7', borderRadius: 8, outline: 'none',
                  fontFamily: 'inherit', color: '#1D1D1F', background: '#FAFAFB',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e => e.currentTarget.style.borderColor = '#D2D2D7'}
              />
              {promptDraft.length > 1 && (
                <button onClick={() => setPromptDraft(promptDraft.filter((_, j) => j !== i))}
                  title="删除这一行"
                  style={{
                    background: 'none', border: 'none', padding: 4,
                    color: '#98989E', cursor: 'pointer', borderRadius: 4,
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = '#FF3B30'}
                  onMouseLeave={e => e.currentTarget.style.color = '#98989E'}
                ><IconTrash size={14} /></button>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {promptDraft.length < 8 && (
            <button onClick={() => setPromptDraft([...promptDraft, ''])}
              style={{
                background: 'none', border: '1px dashed #D2D2D7', borderRadius: 8,
                padding: '6px 12px', fontSize: 13, color: '#6E6E73', cursor: 'pointer',
              }}
            >+ 添加一行</button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#98989E', alignSelf: 'center' }}>
            {promptDraft.filter(s => s.trim()).length} / 8
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <button onClick={() => setEditingPrompts(false)} disabled={savingPrompts}
            style={{
              padding: '8px 18px', fontSize: 14, color: '#1D1D1F',
              background: '#F5F5F7', border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >取消</button>
          <button onClick={handleSavePrompts} disabled={savingPrompts}
            style={{
              padding: '8px 18px', fontSize: 14, color: '#FFFFFF', fontWeight: 500,
              background: savingPrompts ? '#98989E' : 'var(--accent)',
              border: 'none', borderRadius: 8,
              cursor: savingPrompts ? 'wait' : 'pointer',
            }}
          >{savingPrompts ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  ) : null;

  const templateLibraryModal = (
    <Modal
      title="协作方案库"
      open={templateOpen}
      onCancel={() => setTemplateOpen(false)}
      footer={null}
      width={720}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '16px 20px' } }}
    >
      {loadingTemplates && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          正在加载协作方案…
        </div>
      )}
      {!loadingTemplates && collabTemplates.length === 0 && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          暂无协作方案。先进入会话，打开协作画布并点击“保存为方案”。
        </div>
      )}
      {!loadingTemplates && collabTemplates.length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          {collabTemplates.map((tpl) => {
            const nodes = tpl.canvas_state?.nodes || [];
            const nodeCount = nodes.length;
            const employeeLabels = nodes
              .map((node) => (node.data || {}) as Record<string, unknown>)
              .filter((data) => data.role === 'employee')
              .map((data) => String(data.label || data.employeeId || '员工'))
              .filter(Boolean);
            const relayCount = tpl.participant_ids?.length || 0;
            const totalEmployees = (tpl.primary_employee_id ? 1 : 0) + relayCount;
            return (
              <div
                key={tpl.id}
                data-collab-template-card
                style={{
                  padding: 14,
                  borderRadius: 8,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {tpl.name}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {tpl.description || '从协作画布保存的多员工协作方案。'}
                    </div>
                  </div>
                  <button
                    disabled={usingTemplateId === tpl.id}
                    onClick={() => handleUseTemplate(tpl)}
                    style={{
                      minWidth: 96,
                      height: 32,
                      borderRadius: 8,
                      border: '1px solid var(--accent)',
                      background: usingTemplateId === tpl.id ? 'var(--accent-soft)' : 'var(--accent)',
                      color: usingTemplateId === tpl.id ? 'var(--text-secondary)' : '#fff',
                      cursor: usingTemplateId === tpl.id ? 'wait' : 'pointer',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {usingTemplateId === tpl.id ? '创建中…' : '使用方案'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-tertiary)' }}>
                  <span>画布节点 {nodeCount}</span>
                  <span>参与员工 {totalEmployees || employeeLabels.length}</span>
                  <span>接力员工 {relayCount}</span>
                  {tpl.updated_at && <span>更新 {new Date(tpl.updated_at).toLocaleString('zh-CN', { hour12: false })}</span>}
                </div>
                {employeeLabels.length > 0 && (
                  <div style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                  }}>
                    {employeeLabels.map((label, index) => (
                      <span key={`${tpl.id}-${label}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: index === 0 ? 'var(--accent-soft)' : 'var(--bg-primary)',
                          border: '1px solid var(--border-subtle)',
                          color: index === 0 ? 'var(--accent)' : 'var(--text-secondary)',
                          fontWeight: index === 0 ? 700 : 500,
                        }}>
                          {index === 0 ? '主' : `接力 ${index}`} · {label}
                        </span>
                        {index < employeeLabels.length - 1 && <span style={{ color: 'var(--text-tertiary)' }}>→</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );

  const canvasHubLayer = (
    <div
      className={`atlas-canvas-hub ${canvasHubOpen ? 'is-open' : ''}`}
      style={{ left: canvasHubPos.x, top: canvasHubPos.y }}
    >
      <button
        className="atlas-canvas-hub-action atlas-canvas-hub-action--template"
        onClick={() => { setCanvasHubOpen(false); void handleOpenTemplateLibrary(); }}
        title="协作方案库"
        aria-label="打开协作方案库"
        data-collab-template-hub-action="true"
        disabled={!canvasHubOpen}
        aria-hidden={!canvasHubOpen}
        tabIndex={canvasHubOpen ? 0 : -1}
      >
        <ApartmentOutlined />
        <span>方案库</span>
      </button>
      <button
        className="atlas-canvas-hub-action atlas-canvas-hub-action--replay"
        onClick={() => { setCanvasHubOpen(false); void handleReplayEvents(); }}
        title="事件流回放"
        aria-label="回放当前会话事件流"
        data-m5-replay-trigger="true"
        disabled={!canvasHubOpen}
        aria-hidden={!canvasHubOpen}
        tabIndex={canvasHubOpen ? 0 : -1}
      >
        <HistoryOutlined />
        <span>回放</span>
      </button>
      <button
        ref={canvasBtnRef}
        className="atlas-canvas-hub-main"
        onPointerDown={handleCanvasHubPointerDown}
        onPointerMove={handleCanvasHubPointerMove}
        onPointerUp={handleCanvasHubPointerUp}
        onPointerCancel={handleCanvasHubPointerUp}
        onClick={() => { void handleCanvasHubMainClick(); }}
        title={canvasHubOpen ? '打开协作画布；拖拽可移动' : '展开协作入口；拖拽可移动'}
        data-m43-toggle="true"
        data-m44-canvas-trigger="true"
        aria-expanded={canvasHubOpen}
        aria-label={canvasHubOpen ? '打开协作画布' : '展开协作入口'}
      >
        <ApartmentOutlined />
        {canvasBadge.total > 0 && (
          <span className="atlas-canvas-hub-badge" data-m44-canvas-badge>
            {canvasBadge.done}/{canvasBadge.total}
          </span>
        )}
      </button>
    </div>
  );

  const collaborationCanvasLayer = (
    <Suspense fallback={null}>
      <CollaborationCanvas
        ref={canvasRef}
        open={canvasOpen}
        onClose={() => setCanvasOpen(false)}
        conversationId={activeSessionId}
        initialCanvasState={initialCanvasState}
        sessionParticipants={canvasSessionParticipants}
      />
    </Suspense>
  );

  // =============== SCENE 1: Focus Mode (no messages) ===============
  if (!isWarRoom) {
    return (
      <div className="atlas-home-shell" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', position: 'relative' }}>
        {promptsModal}
        {shortcutSettingsModal}
        {templateLibraryModal}
        {canvasHubLayer}
        {collaborationCanvasLayer}
        <div className="atlas-home-ambient" />

        <section className="atlas-home-hero">
          <AtlasOrb state={orbState} size={172} showLabel={false} staticMode />
          <div className="atlas-home-hero-copy">
            <h1>Atlas</h1>
          </div>
        </section>

        <section className="atlas-home-workzone">
          <div className="atlas-launchpad atlas-launchpad--minimal atlas-launchpad--cockpit">
            <div className="atlas-home-intro">
              <p>你好，{userDisplayName}，有什么可以帮您。</p>
              <div className="atlas-home-status">
                <span />
                {orbState === 'idle' ? 'ONLINE · STANDBY' : orbState === 'thinking' ? 'ANALYZING' : orbState === 'dispatch' ? 'DISPATCHING' : 'REPLYING'}
              </div>
            </div>

            {/* 待发附件 chip 区 */}
            {pendingAttachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {pendingAttachments.map(a => (
                  <span key={a.url || a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--accent-soft)', borderRadius: 12, fontSize: 12, color: 'var(--accent)' }}>
                    {a.mime.startsWith('image/') ? '图片' : '附件'} {a.name}
                    <button onClick={() => removePendingAttachment(a.url || a.id || '')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
            )}

            <div className="atlas-command-composer" style={{
              display: 'flex', alignItems: 'flex-end', gap: 10,
              padding: '12px 14px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--elev-2)',
              transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            }}>
              {/* 隐藏 file inputs */}
              <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={e => {
                const f = e.target.files?.[0]; if (f) handleFileSelected(f);
                e.target.value = '';
              }} />
              <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                const f = e.target.files?.[0]; if (f) handleFileSelected(f);
                e.target.value = '';
              }} />
              {/* 附件按钮：真实 onClick */}
              <button title="附件" disabled={uploading} onClick={() => fileInputRef.current?.click()}
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', borderRadius: 6, transition: 'all 0.15s ease', opacity: uploading ? 0.4 : 1 }}
                onMouseEnter={e => { (e.target as HTMLElement).closest('button')!.style.color = 'var(--accent)'; (e.target as HTMLElement).closest('button')!.style.background = 'var(--accent-soft)'; }}
                onMouseLeave={e => { (e.target as HTMLElement).closest('button')!.style.color = 'var(--text-tertiary)'; (e.target as HTMLElement).closest('button')!.style.background = 'transparent'; }}
              ><IconPaperclip size={18} /></button>
              {/* 图片按钮：真实 onClick */}
              <button title="图片" disabled={uploading} onClick={() => imageInputRef.current?.click()}
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', borderRadius: 6, transition: 'all 0.15s ease', opacity: uploading ? 0.4 : 1 }}
                onMouseEnter={e => { (e.target as HTMLElement).closest('button')!.style.color = 'var(--accent)'; (e.target as HTMLElement).closest('button')!.style.background = 'var(--accent-soft)'; }}
                onMouseLeave={e => { (e.target as HTMLElement).closest('button')!.style.color = 'var(--text-tertiary)'; (e.target as HTMLElement).closest('button')!.style.background = 'transparent'; }}
              ><IconImage size={18} /></button>
              {/* 语音按钮：灰掉 + tooltip */}
              <button title="语音输入 — 即将支持" disabled
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', borderRadius: 6, transition: 'all 0.15s ease', opacity: 0.3, cursor: 'not-allowed' }}
              ><IconMic size={18} /></button>
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown} placeholder="跟 Atlas 说点什么…" disabled={isProcessing} rows={1}
                style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: 15, fontFamily: 'var(--font-family)', color: 'var(--text-primary)', background: 'transparent', lineHeight: 1.5, maxHeight: 140, minHeight: 24, padding: '6px 4px' }}
              />
              <button onClick={handleSend} disabled={!input.trim() || isProcessing}
                style={{
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8,
                  color: input.trim() && !isProcessing ? '#fff' : 'var(--text-tertiary)',
                  background: input.trim() && !isProcessing ? 'var(--accent)' : 'transparent',
                  cursor: input.trim() && !isProcessing ? 'pointer' : 'default',
                  opacity: input.trim() && !isProcessing ? 1 : 0.5,
                  transition: 'all 0.15s ease',
                }}
              ><IconSend size={17} /></button>
            </div>
            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}>
              回车发送 · Shift+回车换行 · Atlas 遵循企业权限与审计策略
            </div>

            <section className="atlas-continuation-strip">
              <div className="atlas-continuation-head">
                <span><IconHistory size={12} /> 继续任务</span>
                <button
                  type="button"
                  onClick={() => navigate('/history')}
                  style={{
                    minHeight: 30,
                    padding: '0 12px',
                    borderRadius: 999,
                    border: '1px solid rgba(124, 119, 255, 0.18)',
                    background: 'rgba(255,255,255,0.58)',
                    color: 'var(--text-secondary)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  全部历史
                </button>
              </div>
              <div className="atlas-continuation-list">
                {continuationConversations.length > 0 ? continuationConversations.map((c) => (
                  <button key={c.id} className="atlas-continuation-pill" onClick={() => handleSwitchConversation(c.id)} title={c.title || '新会话'}>
                    <span className={`atlas-continuation-dot atlas-continuation-dot--${c.task_status || 'draft'}`} />
                    <span className="atlas-continuation-title">{c.pinned ? '置顶 · ' : ''}{c.title || '新会话'}</span>
                    <span className="atlas-continuation-meta">{c.message_count || 0} 条</span>
                  </button>
                )) : (
                  <button className="atlas-continuation-pill atlas-continuation-pill--empty" onClick={() => navigate('/history')}>
                    还没有可继续的任务
                  </button>
                )}
              </div>
            </section>

            <section className="atlas-dock-panel">
              <div className="atlas-launchpad-head">
                <div className="atlas-launchpad-actions">
                  <button
                    className="atlas-launchpad-link"
                    onClick={() => navigate('/workforce')}
                    disabled={isProcessing}
                  >
                    全部员工
                  </button>
                  <button
                    className="atlas-launchpad-link"
                    onClick={() => setDockSettingsOpen(true)}
                    disabled={isProcessing}
                  >
                    自定义 Dock
                  </button>
                </div>
              </div>

              <div className="atlas-agent-grid">
                {launchEmployees.map((emp: Employee, index: number) => {
                  const color = emp.department?.color || ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#6366F1'][index % 6];
                  const skills = Array.isArray(emp.toolsets) ? emp.toolsets.slice(0, 1) : [];
                  return (
                    <button
                      key={(emp as any).__id || emp.id}
                      className="atlas-agent-card"
                      onClick={() => handleEmployeeShortcut(emp)}
                      disabled={isProcessing}
                      title={`和 ${emp.name} 开始对话`}
                      style={{ '--agent-color': color, '--agent-index': `"${String(index + 1).padStart(2, '0')}"` } as any}
                    >
                      <span className="atlas-agent-card-glow" />
                      <span className="atlas-agent-card-status">ONLINE</span>
                      <div className="atlas-agent-card-main">
                        <span className="atlas-agent-avatar">
                          {emp.avatar_char || emp.avatar || emp.name?.[0] || '?'}
                        </span>
                        <span className="atlas-agent-copy">
                          <span className="atlas-agent-name">{emp.name}</span>
                          <span className="atlas-agent-role">{skills.length > 0 ? skills.join(' · ') : '企业能力员工'}</span>
                        </span>
                      </div>
                      <div className="atlas-agent-description">
                        {emp.description || '点击进入对话，可继续 @ 其他员工接力协作。'}
                      </div>
                      <div className="atlas-agent-skill-row">
                        {(skills.length > 0 ? skills : ['chat']).map((skill) => (
                          <span key={`${emp.id}-${skill}`} className="atlas-agent-skill">{skill}</span>
                        ))}
                      </div>
                    </button>
                  );
                })}
                <button
                  className="atlas-agent-card atlas-agent-card--action"
                  onClick={handleNewGroupConversation}
                  disabled={isProcessing}
                  title="创建多员工群聊"
                >
                  <span className="atlas-agent-card-glow" />
                  <div className="atlas-agent-card-main">
                    <span className="atlas-action-icon"><IconUsers size={20} /></span>
                    <span className="atlas-agent-copy">
                      <span className="atlas-agent-name">多员工群聊</span>
                      <span className="atlas-agent-role">Relay · @ 召唤</span>
                    </span>
                  </div>
                  <div className="atlas-agent-description">先创建协作会话，再用 @ 选择员工进行接力回答。</div>
                  <div className="atlas-agent-skill-row">
                    <span className="atlas-agent-skill">group</span>
                    <span className="atlas-agent-skill">relay</span>
                  </div>
                </button>
                <button
                  className="atlas-agent-card atlas-agent-card--action atlas-agent-card--orchestrate"
                  onClick={handleOpenCustomOrchestration}
                  disabled={isProcessing}
                  title="编排数智员工"
                >
                  <span className="atlas-agent-card-glow" />
                  <div className="atlas-agent-card-main">
                    <span className="atlas-action-icon"><ApartmentOutlined /></span>
                    <span className="atlas-agent-copy">
                      <span className="atlas-agent-name">自定义编排</span>
                      <span className="atlas-agent-role">Canvas · Relay · Template</span>
                    </span>
                  </div>
                  <div className="atlas-agent-description">拖拽员工节点，配置角色、Skill、输出类型与失败策略。</div>
                  <div className="atlas-agent-skill-row">
                    <span className="atlas-agent-skill">orchestration</span>
                    <span className="atlas-agent-skill">canvas</span>
                  </div>
                </button>
                <button
                  className="atlas-agent-card atlas-agent-card--action atlas-agent-card--template"
                  onClick={handleOpenTemplateLibrary}
                  disabled={isProcessing}
                  title="编排模板库"
                  data-collab-template-trigger="true"
                >
                  <span className="atlas-agent-card-glow" />
                  <div className="atlas-agent-card-main">
                    <span className="atlas-action-icon"><HistoryOutlined /></span>
                    <span className="atlas-agent-copy">
                      <span className="atlas-agent-name">模板库</span>
                      <span className="atlas-agent-role">Multi-agent Demos</span>
                    </span>
                  </div>
                  <div className="atlas-agent-description">从经营分析、合同评审、市场方案等固定编排快速开始。</div>
                  <div className="atlas-agent-skill-row">
                    <span className="atlas-agent-skill">5 demos</span>
                    <span className="atlas-agent-skill">relay</span>
                  </div>
                </button>
              </div>
            </section>
          </div>
        </section>

        {/* Phase 2 E：员工切换器 modal */}
        {showSwitcher && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: 24, width: 420, maxHeight: 500, overflowY: 'auto' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>选择员工开始对话</h3>
              {allEmployees.map(emp => (
                <button key={emp.id} onClick={() => handleSwitchEmployee(emp)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: emp.department?.color || '#4F46E5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{emp.avatar_char}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{emp.department?.name || '未分配'}</div>
                  </div>
                </button>
              ))}
              <button onClick={() => setShowSwitcher(false)} style={{ marginTop: 12, width: '100%', padding: 8, background: 'var(--bg-secondary)', border: 'none', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer' }}>取消</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const lastPetMessage = messages[messages.length - 1];
  const petAwakeSignal = [
    input.trim().length > 0 ? `input:${input.length}` : 'input:0',
    isProcessing ? 'processing' : 'idle',
    `messages:${messages.length}`,
    `last:${lastPetMessage?.role ?? 'none'}:${lastPetMessage?.text?.length ?? 0}`,
  ].join('|');

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'var(--sider-width, 240px) 1fr var(--workspace-width, 280px)', overflow: 'hidden' }}>
      {promptsModal}
      {templateLibraryModal}

      {/* ============================================================
          LEFT — Phase B 拆分:LeftAside (token --sider-width 控制宽度)
          ============================================================ */}
      <LeftAside
        conversations={conversations}
        loading={loadingConvs}
        activeId={activeSessionId}
        onNew={handleNewConversation}
        onNewGroup={handleNewGroupConversation}
        onSelect={switchToConversation}
        onDelete={handleDeleteConversation}
        onPatch={handlePatchConversation}
      />

      {/* ============================================================
          CENTER — Phase B 拆分:CenterMain (含 ChatHeader + messages + Composer)
          ============================================================ */}
      <CenterMain
        messages={messages}
        isProcessing={isProcessing}
        input={input} setInput={setInput}
        pendingAttachments={pendingAttachments}
        uploading={uploading}
        onSend={handleSend}
        onAbort={handleAbortCurrentRun}
        onKeyDown={handleKeyDown}
        onFileSelect={handleFileSelected}
        onRemoveAttachment={removePendingAttachment}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={setReasoningEffort}
        relayChips={relayChips}
        onRemoveRelay={handleRemoveRelay}
        mentionEmployees={allEmployeesForMention}
        mentionSelectedIds={relayEmployeeIds}
        onMentionPick={handleMentionPick}
        onMentionClose={() => {/* MentionPopover 通过 input 变化自动隐藏,这里 noop */}}
        orbState={orbState}
        headerStyle={headerStyle}
        onStyleChange={handleStyleChange}
        pet={pet}
        onPetChange={handlePetChange}
        petAwakeSignal={petAwakeSignal}
        profile={getProfileMode()}
        activeEmployee={activeEmployee}
        onSwitchEmployee={() => { setAllEmployees(employeesCache); setShowSwitcher(true); }}
      />

      {pendingApproval && (
        <div className="atlas-approval-panel">
          <div className="atlas-approval-kicker">终端授权</div>
          <div className="atlas-approval-title">运行前请确认命令</div>
          <div className="atlas-approval-desc">
            {pendingApproval.description || pendingApproval.pattern_key || 'Hermes 判断这一步需要人工确认。'}
          </div>
          {(pendingApproval.tool_name || pendingApproval.source) && (
            <div className="atlas-approval-meta">
              {pendingApproval.tool_name && <span>工具: {pendingApproval.tool_name}</span>}
              {pendingApproval.source && <span>来源: {pendingApproval.source}</span>}
            </div>
          )}
          {pendingApproval.command && (
            <pre className="atlas-approval-command">{pendingApproval.command}</pre>
          )}
          <div className="atlas-approval-actions">
            {(!pendingApproval.choices?.length || pendingApproval.choices.includes('once')) && (
              <Button type="primary" onClick={() => resolvePendingApproval('once')}>仅本次允许</Button>
            )}
            {(!pendingApproval.choices?.length || pendingApproval.choices.includes('session')) && (
              <Button onClick={() => resolvePendingApproval('session')}>本会话允许</Button>
            )}
            {(!pendingApproval.choices?.length || pendingApproval.choices.includes('always')) && (
              <Button onClick={() => resolvePendingApproval('always')}>始终允许</Button>
            )}
            {(!pendingApproval.choices?.length || pendingApproval.choices.includes('deny')) && (
              <Button danger onClick={() => resolvePendingApproval('deny')}>拒绝</Button>
            )}
          </div>
        </div>
      )}

      {/* ============================================================
          RIGHT — Phase B 拆分:RightAside (内部调 <DispatchPanel />)
          ============================================================ */}
      <RightAside
        tunnels={tunnels}
        conclusions={conclusions}
        files={files}
        isProcessing={isProcessing}
        messages={messages}
        activeEmployee={activeEmployee}
        activeSessionId={activeSessionId}
        sessionMeta={activeSessionId ? sessionMetaById[activeSessionId] : undefined}
        runQueue={runQueue}
        onOpenRun={(sid) => handleSwitchConversation(sid)}
        onResumeTask={handleResumeActiveTask}
        onPatchTaskStatus={patchActiveTaskStatus}
        onRefreshSummary={refreshActiveSummary}
        onArchiveArtifact={archiveActiveArtifact}
        refreshingSummary={refreshingSummary}
      />

      {/* Phase 2 E：员工切换器 modal (war room 也用同一个) */}
      {showSwitcher && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: 24, width: 420, maxHeight: 500, overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>选择员工</h3>
            {allEmployees.map(emp => (
              <button key={emp.id} onClick={() => handleSwitchEmployee(emp)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: emp.department?.color || '#4F46E5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{emp.avatar_char}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{emp.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{emp.department?.name || '未分配'}</div>
                </div>
              </button>
            ))}
            <button onClick={() => setShowSwitcher(false)} style={{ marginTop: 12, width: '100%', padding: 8, background: 'var(--bg-secondary)', border: 'none', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      )}

      {/* M4.3/M5: 可拖拽协作入口 Hub。默认只露一个按钮，展开后给 Replay 与模板库。 */}
      <div
        className={`atlas-canvas-hub ${canvasHubOpen ? 'is-open' : ''}`}
        style={{ left: canvasHubPos.x, top: canvasHubPos.y }}
      >
        <button
          className="atlas-canvas-hub-action atlas-canvas-hub-action--template"
          onClick={() => { setCanvasHubOpen(false); void handleOpenTemplateLibrary(); }}
          title="编排模板库"
          aria-label="打开协作方案库"
          data-collab-template-hub-action="true"
          disabled={!canvasHubOpen}
          aria-hidden={!canvasHubOpen}
          tabIndex={canvasHubOpen ? 0 : -1}
        >
          <ApartmentOutlined />
          <span>方案库</span>
        </button>
        <button
          className="atlas-canvas-hub-action atlas-canvas-hub-action--replay"
          onClick={() => { setCanvasHubOpen(false); void handleReplayEvents(); }}
          title="事件流 Replay (M5)"
          aria-label="回放当前会话事件流"
          data-m5-replay-trigger="true"
          disabled={!canvasHubOpen}
          aria-hidden={!canvasHubOpen}
          tabIndex={canvasHubOpen ? 0 : -1}
        >
          <HistoryOutlined />
          <span>回放</span>
        </button>
        <button
          ref={canvasBtnRef}
          className="atlas-canvas-hub-main"
          onPointerDown={handleCanvasHubPointerDown}
          onPointerMove={handleCanvasHubPointerMove}
          onPointerUp={handleCanvasHubPointerUp}
          onPointerCancel={handleCanvasHubPointerUp}
          onClick={() => { void handleCanvasHubMainClick(); }}
          title={canvasHubOpen ? '打开协作画布；拖拽可移动' : '展开协作入口；拖拽可移动'}
          data-m43-toggle="true"
          data-m44-canvas-trigger="true"
          aria-expanded={canvasHubOpen}
          aria-label={canvasHubOpen ? '打开协作画布' : '展开协作入口'}
        >
          <ApartmentOutlined />
          {canvasBadge.total > 0 && (
            <span className="atlas-canvas-hub-badge" data-m44-canvas-badge>
              {canvasBadge.done}/{canvasBadge.total}
            </span>
          )}
        </button>
      </div>

      {false && <Modal
        title="协作方案库"
        open={templateOpen}
        onCancel={() => setTemplateOpen(false)}
        footer={null}
        width={720}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '16px 20px' } }}
      >
        {loadingTemplates && (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            正在加载协作方案…
          </div>
        )}
        {!loadingTemplates && collabTemplates.length === 0 && (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            暂无协作方案。先进入会话，打开协作画布并点击“保存为方案”。
          </div>
        )}
        {!loadingTemplates && collabTemplates.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {collabTemplates.map((tpl) => {
              const nodes = tpl.canvas_state?.nodes || [];
              const nodeCount = nodes.length;
              const employeeLabels = nodes
                .map((node) => (node.data || {}) as Record<string, unknown>)
                .filter((data) => data.role === 'employee')
                .map((data) => String(data.label || data.employeeId || '员工'))
                .filter(Boolean);
              const relayCount = tpl.participant_ids?.length || 0;
              const totalEmployees = (tpl.primary_employee_id ? 1 : 0) + relayCount;
              return (
                <div
                  key={tpl.id}
                  data-collab-template-card
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {tpl.name}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {tpl.description || '从协作画布保存的多员工协作方案。'}
                      </div>
                    </div>
                    <button
                      disabled={usingTemplateId === tpl.id}
                      onClick={() => handleUseTemplate(tpl)}
                      style={{
                        minWidth: 96,
                        height: 32,
                        borderRadius: 8,
                        border: '1px solid var(--accent)',
                        background: usingTemplateId === tpl.id ? 'var(--accent-soft)' : 'var(--accent)',
                        color: usingTemplateId === tpl.id ? 'var(--text-secondary)' : '#fff',
                        cursor: usingTemplateId === tpl.id ? 'wait' : 'pointer',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {usingTemplateId === tpl.id ? '创建中…' : '使用方案'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-tertiary)' }}>
                    <span>画布节点 {nodeCount}</span>
                    <span>参与员工 {totalEmployees || employeeLabels.length}</span>
                    <span>接力员工 {relayCount}</span>
                    {tpl.updated_at && <span>更新 {new Date(tpl.updated_at).toLocaleString('zh-CN', { hour12: false })}</span>}
                  </div>
                  {employeeLabels.length > 0 && (
                    <div style={{
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                    }}>
                      {employeeLabels.map((label, index) => (
                        <span key={`${tpl.id}-${label}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: index === 0 ? 'var(--accent-soft)' : 'var(--bg-primary)',
                            border: '1px solid var(--border-subtle)',
                            color: index === 0 ? 'var(--accent)' : 'var(--text-secondary)',
                            fontWeight: index === 0 ? 700 : 500,
                          }}>
                            {index === 0 ? '主' : `接力 ${index}`} · {label}
                          </span>
                          {index < employeeLabels.length - 1 && <span style={{ color: 'var(--text-tertiary)' }}>→</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>}

      {/* M5 (Event Log): Replay Modal — 时间轴 + 跳回原 conv */}
      <Modal
        title={`事件流 Replay — ${replayData?.employee_name ?? '加载中…'}`}
        open={replayOpen}
        onCancel={() => setReplayOpen(false)}
        footer={null}
        width={760}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '16px 24px' } }}
      >
        {replayData && replayData.events.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)' }}>
            暂无事件。打开画布 → click 节点 → 关闭画布后再来。
          </div>
        )}
        {replayData && replayData.events.length > 0 && (
          <div data-m5-replay-timeline>
            {replayData.events.map((evt, idx) => (
              <div
                key={evt.id}
                data-m5-replay-event
                data-event-type={evt.event_type}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', marginBottom: 6,
                  borderRadius: 10, cursor: 'pointer',
                  background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  transition: 'background 0.2s',
                }}
                onClick={() => {
                  // 跳回原 conv
                  message.info(`跳回 conv #${evt.conversation_id} — ${evt.conversation_title}`);
                  setReplayOpen(false);
                  // 切到 conv (调用 fetchConversationDetail 然后切 active)
                  fetchConversationDetail(evt.conversation_id).then((d) => {
                    const sid = realSessionId(d);
                    setActiveSessionIdSafe(sid);
                    setDispatchCid(sid);
                    if (d.employee_id) {
                      const emp = allEmployees.find((e) => e.id === d.employee_id);
                      setActiveEmployee(emp ? toEmployeeChip(emp, d.employee_id) : null);
                    }
                  }).catch((e) => console.warn('[M5] switch conv failed:', e));
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139,127,232,0.12)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)')}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: 4,
                  background: ({
                    click: '#8B7FE8', drag: '#F59E0B', add: '#10B981', delete: '#EF4444',
                    connect: '#3B82F6', disconnect: '#6B7280',
                  } as Record<string, string>)[evt.event_type] || '#9CA3AF',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', minWidth: 140 }}>
                  {new Date(evt.created_at).toLocaleString('zh-CN', { hour12: false })}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 80 }}>
                  {evt.event_type}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {evt.node_id ? `节点: ${evt.node_id}` : evt.edge_id ? `边: ${evt.edge_id}` : '(无 target)'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  conv: {evt.conversation_title ?? `#${evt.conversation_id}`}
                </span>
              </div>
            ))}
            <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
              共 {replayData.total} 个事件 (显示最近 {replayData.events.length})
            </div>
          </div>
        )}
      </Modal>

      {/* M4.3 + M4.4: 协作画布全屏 Modal — ref 暴露 imperative API 给 canvasApi */}
      <Suspense fallback={null}>
        <CollaborationCanvas
          ref={canvasRef}
          open={canvasOpen}
          onClose={() => setCanvasOpen(false)}
          // M4.5.1: 注入 conversationId + initialCanvasState (debounce 写后端 + 回访恢复)
          conversationId={activeSessionId}
          initialCanvasState={initialCanvasState}
          sessionParticipants={canvasSessionParticipants}
        />
      </Suspense>
    </div>
  );
}
