import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, Modal, Space, message } from 'antd';
import AtlasOrb from '../components/AtlasOrb';
import type { HeaderStyle, Pet, ProfileMode } from '../components/ChatHeader';
import LeftAside from '../components/LeftAside';
import CenterMain from '../components/CenterMain';
import MentionPopover from '../components/MentionPopover';
import RightAside from '../components/RightAside';
import type { CanvasHandle } from '../components/CollaborationCanvas';
import { canvasApi } from '../services/canvasApi';
import { ApartmentOutlined, HistoryOutlined } from '@ant-design/icons';
import type { DispatchTunnel } from '../types/dispatch';
import type { ProgressStage } from '../types/progress';
import {
  IconPaperclip, IconImage, IconMic,
  IconSend, IconTrash, IconHistory, IconSettings, IconUsers,
} from '../components/Icons';
import {
  chatWithEmployeeStream, conversationChatStream,
  streamSessionEvents,
  fetchEmployees, fetchConversationDetail,
  fetchEmployeeDetail, routeToEmployee, fetchConversations,
  createConversation, createGroupConversation, deleteConversation, uploadFile,
  patchSession,
  approveHermesRun, stopHermesRun,
  fetchCurrentUser, updateMyQuickPrompts,
  refreshSessionSummary, patchSessionTaskStatus, archiveArtifact, patchArtifact,
  fetchCollaborationTemplates, createSessionFromTemplate,
  fetchRunQueue, resumeSessionTask, recoverSessionTask,
  replayEmployeeEvents, replaySessionEvents, actionWorkflowNode, resumeWorkflowCheckpoint, actionWorkflowStep, type CanvasReplay,  // M5
  type Conversation, type Attachment, type Employee,
} from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { productVisible, showTestFixtures } from '../utils/productVisibility';
import { filesFromClipboardData } from '../utils/clipboardFiles';

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

function isImeComposingEvent(e: React.KeyboardEvent | React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number; which?: number };
  return Boolean(native.isComposing) || e.key === 'Process' || native.keyCode === 229 || native.which === 229;
}

const CANVAS_HUB_SIZE = 56;
const CANVAS_HUB_MARGIN = 16;
const CANVAS_HUB_STORAGE_KEY = 'atlas-canvas-hub-position:v3';
const CANVAS_HUB_DEFAULT_RIGHT_GUTTER = 392; // keep clear of the right progress rail and its border
const EMPLOYEE_DOCK_STORAGE_KEY = 'atlas-employee-dock-shortcuts';
const COMMAND_RAIL_PREF_STORAGE_KEY = 'atlas-command-rail-prefs:v1';
const DEFAULT_LEFT_RAIL_WIDTH = 280;
const DEFAULT_RIGHT_RAIL_WIDTH = 360;
const COLLAPSED_RAIL_WIDTH = 48;
const LEFT_RAIL_MIN_WIDTH = 240;
const LEFT_RAIL_MAX_WIDTH = 380;
const RIGHT_RAIL_MIN_WIDTH = 320;
const RIGHT_RAIL_MAX_WIDTH = 540;

interface CommandRailPrefs {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getInitialCommandRailPrefs(): CommandRailPrefs {
  if (typeof window === 'undefined') {
    return {
      leftWidth: DEFAULT_LEFT_RAIL_WIDTH,
      rightWidth: DEFAULT_RIGHT_RAIL_WIDTH,
      leftCollapsed: false,
      rightCollapsed: false,
    };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(COMMAND_RAIL_PREF_STORAGE_KEY) || 'null') as Partial<CommandRailPrefs> | null;
    if (saved) {
      return {
        leftWidth: clampNumber(Number(saved.leftWidth) || DEFAULT_LEFT_RAIL_WIDTH, LEFT_RAIL_MIN_WIDTH, LEFT_RAIL_MAX_WIDTH),
        rightWidth: clampNumber(Number(saved.rightWidth) || DEFAULT_RIGHT_RAIL_WIDTH, RIGHT_RAIL_MIN_WIDTH, RIGHT_RAIL_MAX_WIDTH),
        leftCollapsed: Boolean(saved.leftCollapsed),
        rightCollapsed: Boolean(saved.rightCollapsed),
      };
    }
  } catch {}
  return {
    leftWidth: DEFAULT_LEFT_RAIL_WIDTH,
    rightWidth: DEFAULT_RIGHT_RAIL_WIDTH,
    leftCollapsed: typeof window !== 'undefined' && window.innerWidth < 1440,
    rightCollapsed: false,
  };
}

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
  const rightGutter = window.innerWidth <= 960 ? 24 : CANVAS_HUB_DEFAULT_RIGHT_GUTTER;
  const bottomGutter = window.innerWidth <= 960 ? 84 : 96;
  return clampCanvasHubPosition({
    x: window.innerWidth - CANVAS_HUB_SIZE - rightGutter,
    y: window.innerHeight - CANVAS_HUB_SIZE - bottomGutter,
  });
}

function taskStatusLabel(status: string) {
  const map: Record<string, string> = {
    draft: '草稿',
    queued: '排队中',
    running: '进行中',
    needs_input: '需补充',
    waiting_input: '需补充',
    waiting_approval: '待审批',
    quota_waiting: '限流等待',
    stalled: '后台处理中',
    completed: '已完成',
    done: '已完成',
    failed: '失败',
  };
  return map[status] || status;
}

function taskDisplayCopy(status?: string, fallback?: string) {
  const s = String(status || 'draft');
  const map: Record<string, { label: string; detail: string }> = {
    draft: { label: '等待任务', detail: '当前会话还没有正在执行的任务。' },
    queued: { label: '排队中', detail: '任务已进入调度队列，等待 Hermes 接管执行。' },
    running: { label: '工作中 · Hermes 正在执行', detail: '正在接收模型、工具和文件事件；长程任务可能会出现短暂静默。' },
    waiting_approval: { label: '等待人工确认', detail: 'Hermes 请求确认高风险或不确定操作，确认后会继续推进。' },
    quota_waiting: { label: '限流等待', detail: '模型服务触发额度或频率限制，本轮任务已保留，可稍后继续或换员工接力。' },
    needs_input: { label: '需要补充信息', detail: '任务暂缺上下文，请补充资料后继续。' },
    waiting_input: { label: '需要补充信息', detail: '任务暂缺上下文，请补充资料后继续。' },
    stalled: { label: '后台处理中 · 自动同步中', detail: 'Hermes 暂时没有新事件，Atlas 会继续监听并自动同步结果；这不等于失败。' },
    failed: { label: '失败 · 可重试', detail: '任务已进入失败态，可从检查点回放或重新执行。' },
    completed: { label: '已完成', detail: '任务已完成，可以查看交付物、总结和输入来源。' },
    done: { label: '已完成', detail: '任务已完成，可以查看交付物、总结和输入来源。' },
  };
  const item = map[s] || { label: fallback || taskStatusLabel(s), detail: '正在同步最新任务状态。' };
  const weakFallback = new Set(['执行中', '进行中', '已停滞', '已停滞，可恢复', '后台守护中，可恢复']);
  return { ...item, label: fallback && !weakFallback.has(fallback) ? fallback : item.label };
}

function formatTaskTime(value?: string) {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms < 60_000) return '刚刚更新';
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))} 分钟前更新`;
  if (ms < 86_400_000) return `${Math.max(1, Math.round(ms / 3_600_000))} 小时前更新`;
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function buildTaskActivity(meta: any, isProcessing: boolean, latestUserTask: string, activeEmployee?: { name?: string } | null) {
  const progress = meta?.progress || meta?.health?.progress;
  const status = String(progress?.status || meta?.task_status || (isProcessing ? 'running' : 'draft'));
  const activeStatuses = new Set(['running', 'queued', 'waiting_approval', 'quota_waiting', 'needs_input', 'waiting_input', 'stalled']);
  if (!activeStatuses.has(status) && !isProcessing) return null;

  const copy = taskDisplayCopy(status, progress?.phase_label);
  const counts = progress?.counts || {};
  const node = progress?.current_node;
  const step = progress?.current_step;
  const capabilityPlan = meta?.capability_plan || meta?.capabilityPlan;
  const requiredCapabilities = Array.isArray(capabilityPlan?.required_capabilities) ? capabilityPlan.required_capabilities : [];
  const gaps = Array.isArray(capabilityPlan?.gaps) ? capabilityPlan.gaps : [];
  const routing = capabilityPlan?.routing_applied || capabilityPlan?.auto_route;
  const collaborationPolicy = meta?.collaboration_policy || meta?.collaborationPolicy;
  const headline =
    latestUserTask
    || progress?.headline
    || meta?.task_summary
    || meta?.last_message
    || '正在处理当前任务';
  const nodeName =
    node?.label
    || node?.employee_name
    || node?.node_id
    || activeEmployee?.name
    || '';

  return {
    status,
    label: copy.label,
    detail: progress?.recovery_hint && status === 'stalled' && !String(progress.recovery_hint).includes('任务已保留检查点')
      ? progress.recovery_hint
      : copy.detail,
    headline,
    nodeName,
    stepTitle: step?.title || step?.event_type || '',
    stepCount: Number(counts.steps || 0),
    checkpointCount: Number(counts.checkpoints || 0),
    artifactCount: Array.isArray(meta?.artifacts)
      ? meta.artifacts.filter((a: any) => !a.archived && isTaskDeliverableArtifact(a)).length
      : Number(meta?.health?.counts?.artifacts || 0),
    updatedText: formatTaskTime(progress?.updated_at || meta?.updated_at),
    capabilitySummary: capabilityPlan?.summary || '',
    capabilityLabels: requiredCapabilities.slice(0, 4).map((item: any) => String(item.label || item.key || '')).filter(Boolean),
    gapLabels: gaps.slice(0, 3).map((item: any) => String(item.label || item.key || '')).filter(Boolean),
    routedTo: routing?.to_employee_name || routing?.employee_name || '',
    collaborationMode: collaborationPolicy?.mode || '',
  };
}

function upsertProgressStage(stages: ProgressStage[] | undefined, incoming: ProgressStage): ProgressStage[] {
  const next = [...(stages || [])];
  const idx = next.findIndex((s) => s.id === incoming.id);
  const stage = { ...incoming, updatedAt: incoming.updatedAt || Date.now() };
  if (idx >= 0) {
    next[idx] = { ...next[idx], ...stage };
  } else {
    next.push(stage);
  }
  return next.slice(-10);
}

function settleProgressStages(stages: ProgressStage[] | undefined): ProgressStage[] | undefined {
  if (!stages?.length) return stages;
  return stages.map((stage) => {
    if (stage.status === 'running' || stage.status === 'waiting') {
      return { ...stage, status: 'completed' as const, updatedAt: stage.updatedAt || Date.now() };
    }
    return stage;
  });
}

function safeStageText(value: unknown, fallback = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (/assistant produced a final response/i.test(raw)) return '模型已返回最终回复。';
  if (/using run events/i.test(raw) || /Run Events/i.test(raw)) return '执行链路已连接，正在监听模型和工具事件。';
  return raw
    .replace(/后台守护中，可恢复/g, '后台处理中，自动同步中')
    .replace(/已停滞，可恢复/g, '后台处理中，自动同步中')
    .replace(/后台补同步/g, '后台自动同步')
    .replace(/本轮已停止等待/g, '本轮已转入后台自动同步')
    .replace(/quota|rate limit|too many requests/gi, '模型额度或频率限制')
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/?\S*/gi, '本地运行链路')
    .replace(/\b(?:run|thread|session|conv)_[a-z0-9_-]{10,}\b/gi, '运行实例')
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '内部标识')
    .replace(/\b[a-f0-9]{24,}\b/gi, '内部标识')
    .slice(0, 220);
}

function stageMetaLabel(stage: string) {
  const key = stage.toLowerCase();
  if (key === 'artifact' || key === 'output') return '输出';
  if (key === 'context' || key === 'files' || key === 'memory') return '输入';
  if (key === 'skill') return 'Skill';
  if (key === 'search' || key === 'web') return '检索';
  if (key === 'quota') return '限流';
  if (key === 'tool') return '工具';
  if (key === 'reasoning' || key === 'thinking') return '思考';
  if (key === 'approval') return '审批';
  if (key === 'done' || key === 'completed') return '完成';
  if (key === 'error' || key === 'failed') return '错误';
  return '进展';
}

function toolStageTitle(name: string, status: ProgressStage['status']) {
  const key = name.toLowerCase();
  const action =
    key.includes('skill') ? '调用 Skill'
      : key.includes('search') || key.includes('browser') || key.includes('web') ? '检索资料'
        : key.includes('file') || key.includes('read') ? '读取文件'
          : key.includes('write') || key.includes('artifact') ? '生成交付物'
            : '调用工具';
  if (status === 'completed') return `${action}完成 · ${name}`;
  if (status === 'failed') return `${action}失败 · ${name}`;
  return `正在${action} · ${name}`;
}

function formatElapsedMs(value: number | string | undefined): string | undefined {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n < 1000) return `${Math.max(1, Math.round(n))}ms`;
  const secondsTotal = n / 1000;
  if (secondsTotal < 10) return `${secondsTotal.toFixed(1)}s`;
  if (secondsTotal < 60) return `${Math.round(secondsTotal)}s`;
  const minutes = Math.floor(secondsTotal / 60);
  const seconds = Math.round(secondsTotal % 60);
  return `${minutes}m${seconds ? ` ${seconds}s` : ''}`;
}

function parseTimeMs(value?: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function formatToolWait(tool: Partial<ToolCall>, status: ProgressStage['status']): string | undefined {
  const explicit = formatElapsedMs(tool.waitDurationMs);
  if (explicit) return status === 'running' ? `已等待 ${explicit}` : `等待 ${explicit}`;
  const started = parseTimeMs(tool.startedAt);
  if (started) {
    const ended = parseTimeMs(tool.completedAt) || Date.now();
    const elapsed = formatElapsedMs(Math.max(0, ended - started));
    if (elapsed) return status === 'running' ? `已等待 ${elapsed}` : `等待 ${elapsed}`;
  }
  if (tool.duration != null && tool.duration !== '') {
    const n = typeof tool.duration === 'number' ? tool.duration : Number(tool.duration);
    if (Number.isFinite(n) && n > 0) return `工具耗时 ${formatElapsedMs(n * 1000)}`;
  }
  return undefined;
}

function toolStage(tool: Partial<ToolCall>): ProgressStage {
  const normalizedStatus = normalizeToolStatus(tool.status, tool.error);
  const status = normalizedStatus === 'completed'
    ? 'completed'
    : normalizedStatus === 'failed' || normalizedStatus === 'error'
      ? 'failed'
      : normalizedStatus === 'progress'
        ? 'running'
        : 'running';
  const label = safeStageText(tool.label || tool.preview || tool.command || '');
  const name = String(tool.name || 'tool');
  return {
    id: `tool:${tool.toolCallId || name}:${label.slice(0, 80)}`,
    kind: 'tool',
    status,
    title: toolStageTitle(name, status),
    detail: label || (status === 'completed' ? '工具已返回结果。' : '等待 Hermes 工具事件返回。'),
    meta: formatToolWait(tool, status),
    action: status === 'failed' ? 'replay' : undefined,
    actionLabel: status === 'failed' ? '回放' : undefined,
  };
}

function traceStage(trace: any): ProgressStage {
  const stage = String(trace?.stage || trace?.kind || 'info');
  const rawTitle = String(trace?.title || '任务进展');
  const rawDetail = String(trace?.detail || trace?.summary || '').trim();
  const title = safeStageText(rawTitle, '任务进展');
  const detail = safeStageText(rawDetail);
  const fingerprint = `${stage} ${rawTitle} ${rawDetail} ${trace?.event_type || ''}`.toLowerCase();
  const failed = /failed|error|失败|异常/.test(fingerprint);
  const completed = /completed|complete|done|finished|完成|已返回|最终回复|交付物|artifact|context|files|memory/.test(fingerprint);
  const waiting = /approval|confirm|waiting|stalled|idle|等待|确认|后台/.test(fingerprint);
  return {
    id: `trace:${stage}:${title}`,
    kind: stage === 'artifact' ? 'artifact' : stage === 'context' || stage === 'files' || stage === 'memory' || stage === 'skill' ? 'context' : stage === 'quota' ? 'quota' : 'info',
    status: failed ? 'failed' : completed ? 'completed' : waiting ? 'waiting' : 'running',
    title,
    detail,
    meta: stageMetaLabel(stage),
    action: stage === 'artifact' ? 'outputs' : stage === 'quota' ? 'retry' : undefined,
    actionLabel: stage === 'artifact' ? '输出物' : undefined,
  };
}

function waitStage(ms: number, detached = false): ProgressStage {
  if (detached) {
    return {
      id: 'wait:detached',
      kind: 'wait',
      status: 'waiting',
      title: '后台处理中',
      detail: 'Hermes 可能仍在继续执行，Atlas 会自动同步最新结果，也可以打开回放查看检查点。',
      meta: '自动同步',
      action: 'replay',
      actionLabel: '回放',
    };
  }
  if (ms >= 45_000) {
    return {
      id: 'wait:45',
      kind: 'wait',
      status: 'waiting',
      title: '长步骤仍在执行',
      detail: '当前步骤耗时较长，可能正在读取大文件、执行脚本或生成交付物。',
      meta: '45s+',
    };
  }
  if (ms >= 20_000) {
    return {
      id: 'wait:20',
      kind: 'wait',
      status: 'running',
      title: '等待工具返回',
      detail: 'Hermes 暂时没有新事件，Atlas 仍在前台监听。',
      meta: '20s+',
    };
  }
  return {
    id: 'wait:8',
    kind: 'wait',
    status: 'running',
    title: '仍在执行',
    detail: '正在等待模型或工具返回，不是卡死。',
    meta: '8s+',
  };
}

function taskStateStage(state: any): ProgressStage {
  const raw = String(state?.task_status || state?.status || 'running');
  const status: ProgressStage['status'] =
    raw === 'completed' || raw === 'done'
      ? 'completed'
      : raw === 'failed'
        ? 'failed'
        : raw === 'needs_input' || raw === 'waiting_input' || raw === 'waiting_approval' || raw === 'quota_waiting' || raw === 'stalled'
          ? 'waiting'
          : 'running';
  return {
    id: `task:${raw}`,
    kind: raw === 'quota_waiting' ? 'quota' : raw === 'stalled' ? 'wait' : 'runtime',
    status,
    title: taskDisplayCopy(raw, state?.label).label,
    detail: safeStageText(state?.reason || state?.task_summary || taskDisplayCopy(raw).detail),
    meta: '任务状态',
    action: raw === 'quota_waiting' ? 'retry' : raw === 'stalled' || raw === 'failed' ? 'replay' : undefined,
    actionLabel: raw === 'quota_waiting' ? '稍后重试' : raw === 'stalled' ? '回放/恢复' : raw === 'failed' ? '回放' : undefined,
  };
}

function capabilityPlanStage(plan: any, policy: any): ProgressStage {
  const required = Array.isArray(plan?.required_capabilities) ? plan.required_capabilities : [];
  const gaps = Array.isArray(plan?.gaps) ? plan.gaps : [];
  const routing = plan?.routing_applied || plan?.auto_route;
  const labels = required.slice(0, 4).map((item: any) => item.label || item.key).filter(Boolean).join(' / ');
  const mode = String(policy?.mode || '');
  const modeText = mode.includes('synthesis')
    ? '多员工协作 · 合稿交付'
    : mode.includes('serial')
      ? '串行接力'
      : '能力预检';
  const routedName = routing?.to_employee_name || routing?.employee_name || '';
  return {
    id: `capability:${required.map((item: any) => item.key || item.label).join('|') || 'none'}:${routedName || modeText}`,
    kind: 'capability',
    status: gaps.length > 0 && !routing ? 'waiting' : 'completed',
    title: routedName ? `能力路由给 ${routedName}` : '能力清单已生成',
    detail: safeStageText(plan?.summary || (labels ? `识别到能力: ${labels}` : '本轮任务未识别到特殊工具能力需求。')),
    meta: modeText,
  };
}

interface ToolCall {
  name: string;
  label?: string;
  status?: string;
  toolCallId?: string;
  args?: any;
  result?: any;
  error?: any;
  duration?: number | string;
  waitDurationMs?: number | string;
  startedAt?: string;
  completedAt?: string;
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
  progressStages?: ProgressStage[];
}

interface Tunnel extends DispatchTunnel {}

function normalizeToolError(value: any): any {
  if (value === false || value == null || value === '') return undefined;
  if (typeof value === 'string') {
    const clean = value.trim().toLowerCase();
    if (!clean || clean === 'false' || clean === 'null' || clean === 'undefined') return undefined;
  }
  return value;
}

function isFalseErrorMarker(value: any): boolean {
  return value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false');
}

function normalizeToolStatus(status: any, error: any): string | undefined {
  const raw = status == null ? '' : String(status);
  if (isFalseErrorMarker(error) && (raw === 'failed' || raw === 'error')) return 'completed';
  return raw || undefined;
}

function coerceToolCalls(raw: any): ToolCall[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((t: any) => ({
      name: String(t?.name || t?.tool_name || t?.tool || 'tool'),
      label: t?.label || t?.preview || t?.command || undefined,
      status: normalizeToolStatus(t?.status, t?.error),
      toolCallId: t?.toolCallId || t?.tool_call_id || t?.id,
      args: t?.args,
      result: t?.result,
      error: normalizeToolError(t?.error),
      duration: t?.duration,
      waitDurationMs: t?.waitDurationMs ?? t?.wait_duration_ms,
      startedAt: t?.startedAt ?? t?.started_at,
      completedAt: t?.completedAt ?? t?.completed_at,
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
    status: normalizeToolStatus(incoming.status, incoming.error),
    toolCallId: incoming.toolCallId,
    args: incoming.args,
    result: incoming.result,
    error: normalizeToolError(incoming.error),
    duration: incoming.duration,
    waitDurationMs: incoming.waitDurationMs,
    startedAt: incoming.startedAt,
    completedAt: incoming.completedAt,
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
  updated_at?: string | null;
  last_message?: string;
  message_count?: number;
  summary_updated_at?: string | null;
  summary?: any;
  artifacts?: any[];
  context_injections?: any[];
  health?: any;
  progress?: any;
  capability_plan?: any;
  collaboration_policy?: any;
}

const SESSION_AUTO_SYNC_INTERVAL_MS = 6_000;
const SESSION_AUTO_SYNC_BACKGROUND_TAIL_MS = 20 * 60_000;
const SESSION_AUTO_SYNC_NORMAL_TAIL_POLLS = 2;
const SESSION_BUSY_STATUSES = new Set(['queued', 'running', 'waiting_approval', 'quota_waiting', 'stalled']);
const SESSION_ATTENTION_STATUSES = new Set(['waiting_approval', 'needs_input', 'waiting_input', 'quota_waiting']);
const SESSION_TERMINAL_STATUSES = new Set(['completed', 'done', 'failed', 'stopped', 'cancelled']);
// The cross-session todo surface is temporarily hidden until approval state
// reconciliation is strict enough to avoid stale Hermes approvals.
const SHOW_GLOBAL_SESSION_TODOS = false;

function mergeHydratedMessage(current: Msg | undefined, incoming: Msg): Msg {
  if (!current) return incoming;
  const merged: Msg = {
    ...current,
    ...incoming,
    progressStages: current.progressStages || incoming.progressStages,
  };
  const currentText = String(current.text || '');
  const incomingText = String(incoming.text || '');
  if (currentText && incomingText && currentText.length > incomingText.length && currentText.startsWith(incomingText.slice(0, 80))) {
    merged.text = currentText;
  }
  if ((current.tools || []).length > (incoming.tools || []).length) merged.tools = current.tools;
  if ((current.attachments || []).length > (incoming.attachments || []).length) merged.attachments = current.attachments;
  if ((current.reasoning || []).length > (incoming.reasoning || []).length) merged.reasoning = current.reasoning;
  return merged;
}

function mergeHydratedMessages(current: Msg[], incoming: Msg[]): Msg[] {
  if (incoming.length === 0) return current;
  if (current.length === 0) return incoming;
  const maxLen = Math.max(current.length, incoming.length);
  const next: Msg[] = [];
  for (let i = 0; i < maxLen; i += 1) {
    const cur = current[i];
    const inc = incoming[i];
    if (!inc) {
      if (cur) next.push(cur);
      continue;
    }
    if (!cur) {
      next.push(inc);
      continue;
    }
    if (cur.role === inc.role) {
      next.push(mergeHydratedMessage(cur, inc));
    } else {
      next.push(inc);
    }
  }
  return next;
}

function messagesFingerprint(list: Msg[]): string {
  return JSON.stringify(list.map((m) => [
    m.role,
    String(m.text || '').length,
    String(m.text || '').slice(-160),
    (m.attachments || []).length,
    (m.tools || []).map((t) => `${t.name}:${t.status || ''}:${t.label || ''}`).join('|'),
  ]));
}

function sessionHasBackgroundWork(detail: any): boolean {
  const progress = detail?.progress || detail?.health?.progress || {};
  const timeline = Array.isArray(progress?.timeline) ? progress.timeline : [];
  const latestRun = progress?.latest_run || {};
  const latestWorkflow = progress?.workflow_run || {};
  const participantIds = Array.isArray(detail?.participant_ids) ? detail.participant_ids : [];
  const eventText = JSON.stringify([
    latestRun?.status,
    latestRun?.last_event_type,
    latestWorkflow?.status,
    progress?.current_step?.event_type,
    progress?.current_step?.status,
    ...timeline.map((t: any) => [t?.event_type, t?.status, t?.title, t?.summary]),
  ]).toLowerCase();
  return (
    participantIds.length > 0
    || Boolean(detail?.is_group)
    || /run_detached|run_idle|stalled|后台|自动同步|runtime\.reconciled/.test(eventText)
    || ['running', 'stalled', 'waiting_approval', 'quota_waiting'].includes(String(detail?.task_status || latestRun?.status || latestWorkflow?.status || ''))
  );
}

// Phase 2.6: 快捷指令默认值（DB 加载前的占位 + 兜底）
const DEFAULT_QUICK_PROMPTS = ['检查围标', '审合同', '差旅报销', '休假规则'];

// 员工信息缓存 (含 __id 真 UUID, 不要丢)
let employeesCache: Array<{ id: number; __id?: string; name: string; avatar_char: string; department?: { name: string; color: string } | null; allowed_toolsets?: string[] | null; toolsets?: string[] | null; allowedToolsets?: string[] | null }> = [];

const realSessionId = (v: any): string => String(v?.__id || v?.id || v || '');
const receptionistEmployeeName = '行政小六';
const isAbortLikeError = (err: unknown, signal?: AbortSignal) => (
  Boolean(signal?.aborted)
  || (err instanceof DOMException && err.name === 'AbortError')
  || (typeof err === 'object' && err !== null && 'name' in err && String((err as { name?: unknown }).name) === 'AbortError')
);
const nonEmptyToolsets = (...values: unknown[]): string[] | null => {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value.map(String);
  }
  return null;
};
const toEmployeeChip = (emp: any, fallbackId?: number) => ({
  id: Number(emp?.id ?? fallbackId ?? 0),
  uuid: emp?.__id,
  name: emp?.name || emp?.display_name || `员工 #${fallbackId ?? '?'}`,
  avatar: emp?.avatar_char || emp?.avatar || emp?.name?.[0] || '?',
  color: emp?.department?.color || '#4F46E5',
  department: emp?.department?.name,
  allowedToolsets: nonEmptyToolsets(emp?.allowed_toolsets, emp?.toolsets, emp?.allowedToolsets),
});

function findReceptionistEmployee(list: typeof employeesCache) {
  return list.find((emp) => String(emp.name || '').trim() === receptionistEmployeeName)
    || list.find((emp) => /行政小六|行政|接待|atlas/i.test(String(emp.name || '')))
    || list[0];
}

function messagesFromConversationDetail(detail: any, fallbackEmployee?: any): Msg[] {
  const rows = Array.isArray(detail?.messages) ? detail.messages : [];
  return rows.map((m: any) => {
    if (m.role === 'user') {
      return {
        role: 'user',
        sender: '你',
        avatar: '你',
        color: 'var(--text-secondary)',
        text: m.content || '',
        attachments: m.attachments ?? [],
        input_tokens: m.input_tokens,
        output_tokens: m.output_tokens,
        total_tokens: m.total_tokens,
        token_count: m.token_count,
      };
    }
    const speakerId = String(m.speaker_employee_id ?? detail?.employee_id ?? fallbackEmployee?.uuid ?? fallbackEmployee?.id ?? '?');
    const cached = employeesCache.find((e: any) => String(e.__id || e.id) === speakerId || String(e.id) === speakerId);
    const sender = m.speaker_name || cached?.name || fallbackEmployee?.name || `员工 #${speakerId}`;
    return {
      role: speakerId,
      sender,
      avatar: sender[0] || '?',
      color: cached?.department?.color || fallbackEmployee?.color || '#4F46E5',
      text: m.content || '',
      reasoning: Array.isArray(m.reasoning) ? m.reasoning : (m.reasoning ? [String(m.reasoning)] : []),
      tools: coerceToolCalls(m.tool_calls || m.tools),
      attachments: m.attachments ?? [],
      input_tokens: m.input_tokens,
      output_tokens: m.output_tokens,
      total_tokens: m.total_tokens,
      token_count: m.token_count,
    };
  });
}

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
  session_id?: string;
  command?: string;
  description?: string;
  pattern_key?: string;
  pattern_keys?: string[];
  choices?: string[];
  tool_name?: string;
  source?: string;
};

type QueuedRunIntent = 'queue';

type QueuedRunItem = {
  id: string;
  sid: string;
  text: string;
  intent: QueuedRunIntent;
  attachments?: Attachment[];
  primaryEmployee?: any;
  relayEmployees?: Employee[];
  createdAt: number;
};

type SessionRunState = {
  isProcessing?: boolean;
  status?: string;
  reason?: string;
  queue?: QueuedRunItem[];
  pendingApproval?: PendingApproval | null;
  needsInput?: boolean;
  updatedAt?: number;
};

type SessionRunRuntime = {
  abortController?: AbortController | null;
  hermesRunIds: Set<string>;
};

type SessionTodo = {
  id: string;
  sid: string;
  type: 'approval' | 'needs_input';
  title: string;
  detail?: string;
  approval?: PendingApproval;
  createdAt: number;
};

type SendConflictDraft = {
  sid: string;
  text: string;
  attachments: Attachment[];
  primaryEmployee?: any;
  relayEmployees: Employee[];
};

function approvalChoiceText(choice: ApprovalChoice): string {
  if (choice === 'deny') return '已拒绝执行';
  if (choice === 'session') return '已批准本会话，继续执行';
  if (choice === 'always') return '已永久批准该类操作，继续执行';
  return '已批准一次，继续执行';
}

function isStaleApprovalError(err: unknown): boolean {
  const text = String((err as any)?.message || err || '').toLowerCase();
  return text.includes('approval_not_pending') || text.includes('no pending approval') || text.includes('没有可处理的审批');
}

function isActionableHermesApproval(approval: PendingApproval | any): boolean {
  const source = String(approval?.source || '').toLowerCase();
  const event = String(approval?.event || approval?.event_type || '').toLowerCase();
  const approvalId = String(approval?.approval_id || approval?.id || '');
  if (source.includes('openatlas') || event.includes('synthetic') || approvalId.includes('synthetic')) {
    return false;
  }
  return Boolean(approval?.hermes_run_id || approval?.run_id);
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

async function ensureEmployeesCache() {
  if (employeesCache.length > 0) return employeesCache;
  try {
    employeesCache = await fetchEmployees() as any;
  } catch (e) {
    console.error('Failed to fetch employees:', e);
  }
  return employeesCache;
}

async function selectEmployee(input: string): Promise<{ id: number; uuid?: string; name: string; avatar: string; color: string; department?: string; allowedToolsets?: string[] | null }> {
  const availableEmployees = await ensureEmployeesCache();
  // 默认走接待员工,避免无 @ 时随机落到某个业务岗位.
  const receptionist = findReceptionistEmployee(availableEmployees) as any;
  const defaultEmployee = receptionist
    ? {
      id: receptionist.id,
      __id: receptionist.__id,
      name: receptionist.name,
      avatar_char: receptionist.avatar_char,
      department: receptionist.department,
      allowed_toolsets: receptionist.allowed_toolsets,
      toolsets: receptionist.toolsets,
      allowedToolsets: receptionist.allowedToolsets,
    }
    : { id: 1, name: 'Atlas', avatar_char: 'A', department: { name: '总调度', color: '#4F46E5' } };
  try {
    const route = await routeToEmployee(input);
    const matched = availableEmployees.find(e => e.id === route.employee_id);
    if (matched) {
      return {
        id: matched.id,
        uuid: (matched as any).__id,
        name: matched.name,
        avatar: matched.avatar_char,
        color: matched.department?.color || '#4F46E5',
        department: matched.department?.name,
        allowedToolsets: nonEmptyToolsets((matched as any).allowed_toolsets, (matched as any).toolsets, (matched as any).allowedToolsets),
      };
    }
  } catch (e) {
    console.error('Route failed, using default:', e);
  }
  return {
    id: defaultEmployee.id,
    uuid: (defaultEmployee as any).__id,
    name: defaultEmployee.name,
    avatar: defaultEmployee.avatar_char,
    color: defaultEmployee.department?.color || '#4F46E5',
    department: defaultEmployee.department?.name,
    allowedToolsets: nonEmptyToolsets((defaultEmployee as any).allowed_toolsets, (defaultEmployee as any).toolsets, (defaultEmployee as any).allowedToolsets),
  };
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
  // 当前主对话员工。多个 hydrate / stream callback 都会读取它, 必须在这些 callback 之前初始化。
  const [activeEmployee, setActiveEmployee] = useState<{ id: number; uuid?: string; name: string; avatar: string; color: string; department?: string; allowedToolsets?: string[] | null } | null>(null);
  // 兼容老代码 — active messages 派生 (不存 state, 避免脏写)
  const messages = activeSessionId ? (messagesBySession[activeSessionId] || []) : [];
  const activeSyncStatus = activeSessionId
    ? String(sessionMetaById[activeSessionId]?.progress?.status || sessionMetaById[activeSessionId]?.task_status || '')
    : '';
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const approvalResolverRef = useRef<((choice: ApprovalChoice) => void) | null>(null);
  // AbortController 只用于“停止当前任务”。普通切会话不能取消 Hermes 长任务,
  // 否则后台 run 会停在 run.started, 迟到消息/交付物无法自动回收。
  const streamAbortRef = useRef<AbortController | null>(null);
  const activeHermesRunIdsRef = useRef<Set<string>>(new Set());
  const backgroundSyncSessionIdsRef = useRef<Set<string>>(new Set());
  const switchSeqRef = useRef(0);
  const imeComposingRef = useRef(false);
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

  const markSessionBackgroundSync = useCallback((sid: string | null | undefined) => {
    if (!sid) return;
    backgroundSyncSessionIdsRef.current.add(sid);
  }, []);

  const appendProgressStage = useCallback((
    sid: string | null | undefined,
    speaker: { role: string; sender: string; avatar: string; color: string },
    stage: ProgressStage,
  ) => {
    if (!sid) return;
    setMessages((prev: Msg[]) => {
      const lastUserIndex = Math.max(0, prev.map((m) => m.role).lastIndexOf('user'));
      let idx = -1;
      for (let i = prev.length - 1; i >= lastUserIndex; i -= 1) {
        if (prev[i]?.role === speaker.role) {
          idx = i;
          break;
        }
      }
      const next = [...prev];
      if (idx >= 0) {
        next[idx] = {
          ...next[idx],
          progressStages: upsertProgressStage(next[idx].progressStages, stage),
        };
        return next;
      }
      return [
        ...next,
        {
          role: speaker.role,
          sender: speaker.sender,
          avatar: speaker.avatar,
          color: speaker.color,
          text: '',
          progressStages: [stage],
        },
      ];
    }, sid);
  }, [setMessages]);

  const ensureSpeakerMessage = useCallback((
    sid: string | null | undefined,
    speaker: { role: string; sender: string; avatar: string; color: string },
    patch?: Partial<Msg>,
  ) => {
    if (!sid) return;
    setMessages((prev: Msg[]) => {
      const lastUserIndex = Math.max(0, prev.map((m) => m.role).lastIndexOf('user'));
      let idx = -1;
      for (let i = prev.length - 1; i >= lastUserIndex; i -= 1) {
        if (prev[i]?.role === speaker.role) {
          idx = i;
          break;
        }
      }
      const next = [...prev];
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...patch };
        return next;
      }
      return [
        ...next,
        {
          role: speaker.role,
          sender: speaker.sender,
          avatar: speaker.avatar,
          color: speaker.color,
          text: '',
          ...patch,
        },
      ];
    }, sid);
  }, [setMessages]);

  const startProgressHeartbeat = useCallback((
    getSid: () => string | null | undefined,
    getSpeaker: () => { role: string; sender: string; avatar: string; color: string },
    getLastEventAt: () => number,
  ) => {
    const emitted = new Set<string>();
    const timer = window.setInterval(() => {
      const sid = getSid();
      if (!sid) return;
      const idleMs = Date.now() - getLastEventAt();
      if (idleMs < 8_000) return;
      const stage = waitStage(idleMs);
      if (emitted.has(stage.id)) return;
      emitted.add(stage.id);
      appendProgressStage(sid, getSpeaker(), stage);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [appendProgressStage]);

  const requestApprovalChoiceInline = useCallback((approval: PendingApproval, sid?: string | null): Promise<ApprovalChoice> => {
    return new Promise((resolve) => {
      approvalResolverRef.current = resolve;
      setPendingApproval({ ...approval, session_id: sid || approval.session_id });
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
        updated_at: detail?.updated_at || prev[sid]?.updated_at,
        last_message: detail?.last_message || prev[sid]?.last_message,
        message_count: detail?.message_count ?? prev[sid]?.message_count,
        summary_updated_at: detail?.summary_updated_at,
        summary: detail?.summary,
        health: detail?.health || prev[sid]?.health,
        progress: detail?.progress || detail?.health?.progress || prev[sid]?.progress,
        artifacts: Array.isArray(detail?.artifacts) ? detail.artifacts : (prev[sid]?.artifacts || []),
        context_injections: Array.isArray(detail?.context_injections) ? detail.context_injections : (prev[sid]?.context_injections || []),
      },
    }));
  }, []);

  const hydrateSessionFromDetail = useCallback((detail: any, sidHint?: string | null) => {
    const sid = sidHint || realSessionId(detail);
    if (!sid || !detail) return;
    rememberSessionMeta(detail, sid);
    const nextMessages = messagesFromConversationDetail(detail, activeEmployee);
    const detailStatus = String(detail?.progress?.status || detail?.task_status || '');
    const hasArtifacts = Array.isArray(detail?.artifacts) && detail.artifacts.length > 0;
    const hasPersistedAssistant = nextMessages.some((m) => m.role !== 'user' && String(m.text || '').trim());
    const terminalStatuses = new Set(['completed', 'done', 'failed', 'stopped', 'cancelled', 'needs_input', 'waiting_input']);
    if (nextMessages.length > 0) {
      setMessagesBySession((prev) => {
        const current = prev[sid] || [];
        const shouldReplace =
          terminalStatuses.has(detailStatus)
          || detailStatus === 'stalled'
          || hasArtifacts
          || hasPersistedAssistant
          || nextMessages.length >= current.length;
        if (!shouldReplace) return prev;
        const merged = mergeHydratedMessages(current, nextMessages);
        if (messagesFingerprint(current) === messagesFingerprint(merged)) return prev;
        return { ...prev, [sid]: merged };
      });
    }
    setConversations((prev) => prev.map((c: any) => (
      realSessionId(c) === sid
        ? {
            ...c,
            task_status: detail.task_status || c.task_status,
            task_summary: detail.task_summary || c.task_summary,
            last_message: detail.last_message || c.last_message,
            message_count: detail.message_count ?? c.message_count,
            updated_at: detail.updated_at || c.updated_at,
          }
        : c
    )));
  }, [activeEmployee, rememberSessionMeta]);

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

  const mergeLiveArtifacts = useCallback((sid: string | null | undefined, artifacts: any[]) => {
    if (!sid || !Array.isArray(artifacts) || artifacts.length === 0) return;
    setSessionMetaById((prev) => {
      const current = prev[sid] || {};
      const existing = Array.isArray(current.artifacts) ? current.artifacts : [];
      const seen = new Set(existing.map((a: any) => String(a.id || `${a.name || ''}:${a.source || ''}`)));
      const nextItems = artifacts.filter((a: any) => {
        const key = String(a?.id || `${a?.name || ''}:${a?.source || ''}`);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (nextItems.length === 0) return prev;
      return {
        ...prev,
        [sid]: {
          ...current,
          id: sid,
          artifacts: [...nextItems, ...existing].slice(0, 80),
        },
      };
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
    if (!sid || !state) return;
    setSessionMetaById((prev) => ({
      ...prev,
      [sid]: {
        ...(prev[sid] || {}),
        task_status: state.task_status || prev[sid]?.task_status,
        task_reason: state.reason || prev[sid]?.task_reason,
        capability_plan: state.capability_plan || prev[sid]?.capability_plan,
        collaboration_policy: state.collaboration_policy || prev[sid]?.collaboration_policy,
      },
    }));
    if (state.task_status) {
      setConversations((prev) => prev.map((c: any) => (
        realSessionId(c) === sid ? { ...c, task_status: state.task_status } : c
      )));
      loadRunQueue();
    }
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

  const updateActiveArtifact = useCallback(async (artifactId: string, patch: { name?: string; status?: string }) => {
    if (!activeSessionId || !artifactId) return;
    try {
      const updated = await patchArtifact(artifactId, patch);
      setSessionMetaById((prev) => {
        const current = prev[activeSessionId] || {};
        return {
          ...prev,
          [activeSessionId]: {
            ...current,
            artifacts: (current.artifacts || []).map((a: any) =>
              a.id === artifactId ? { ...a, ...updated } : a
            ),
          },
        };
      });
      message.success(patch.status === 'final' ? '已标记为终稿' : '交付物已更新');
    } catch (e: any) {
      message.error(`更新交付物失败: ${e?.message || e}`);
    }
  }, [activeSessionId]);

  const recoverActiveSession = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const res = await recoverSessionTask(activeSessionId);
      setSessionMetaById((prev) => ({
        ...prev,
        [activeSessionId]: {
          ...(prev[activeSessionId] || {}),
          id: activeSessionId,
          task_status: res?.task_status || prev[activeSessionId]?.task_status,
          task_summary: res?.task_summary || prev[activeSessionId]?.task_summary,
          summary_updated_at: res?.summary_updated_at || prev[activeSessionId]?.summary_updated_at,
          artifacts: Array.isArray(res?.artifacts) ? res.artifacts : (prev[activeSessionId]?.artifacts || []),
          health: res?.health || prev[activeSessionId]?.health,
          progress: res?.progress || res?.health?.progress || prev[activeSessionId]?.progress,
        },
      }));
      await loadRunQueue();
      message.success(`已同步 ${res?.imported || 0} 条 Hermes 记录`);
    } catch (e: any) {
      message.error(`恢复失败: ${e?.message || e}`);
    }
  }, [activeSessionId, loadRunQueue]);
  // 切换会话只是离开当前视图；运行中的流继续归属到原 session。
  // 真正取消任务只发生在 handleAbortCurrentRun。
  const setActiveSessionIdSafe = useCallback((sid: string | null) => {
    if (sid !== activeSessionId && streamSessionIdRef.current && streamSessionIdRef.current !== sid) {
      markSessionBackgroundSync(streamSessionIdRef.current);
    }
    setActiveSessionId(sid);
  }, [activeSessionId, markSessionBackgroundSync]);
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
  const conversationsRef = useRef<Conversation[]>([]);
  const [runStateBySession, _setRunStateBySession] = useState<Record<string, SessionRunState>>({});
  const runStateBySessionRef = useRef<Record<string, SessionRunState>>({});
  const runRuntimeBySessionRef = useRef<Record<string, SessionRunRuntime>>({});
  const [sessionTodos, setSessionTodos] = useState<Record<string, SessionTodo[]>>({});
  const [runConflictDraft, setRunConflictDraft] = useState<SendConflictDraft | null>(null);
  const drainQueuedRunRef = useRef<((sid: string) => void) | null>(null);

  const setSessionRunState = useCallback((
    sid: string | null | undefined,
    patchOrUpdater: Partial<SessionRunState> | ((prev: SessionRunState) => SessionRunState),
  ) => {
    if (!sid) return;
    const prev = runStateBySessionRef.current;
    const current = prev[sid] || {};
    const next = typeof patchOrUpdater === 'function'
      ? patchOrUpdater(current)
      : { ...current, ...patchOrUpdater };
    const merged = { ...next, updatedAt: next.updatedAt || Date.now() };
    const all = { ...prev, [sid]: merged };
    runStateBySessionRef.current = all;
    _setRunStateBySession(all);
  }, []);

  const getSessionRuntime = useCallback((sid: string | null | undefined): SessionRunRuntime | null => {
    if (!sid) return null;
    if (!runRuntimeBySessionRef.current[sid]) {
      runRuntimeBySessionRef.current[sid] = { abortController: null, hermesRunIds: new Set<string>() };
    }
    return runRuntimeBySessionRef.current[sid];
  }, []);

  const setSessionAbortController = useCallback((sid: string | null | undefined, controller: AbortController | null) => {
    const runtime = getSessionRuntime(sid);
    if (!runtime) return;
    runtime.abortController = controller;
  }, [getSessionRuntime]);

  const addSessionHermesRunId = useCallback((sid: string | null | undefined, runId: string | null | undefined) => {
    const runtime = getSessionRuntime(sid);
    if (!runtime || !runId) return;
    runtime.hermesRunIds.add(String(runId));
  }, [getSessionRuntime]);

  const getSessionHermesRunIds = useCallback((sid: string | null | undefined): string[] => {
    const runtime = sid ? runRuntimeBySessionRef.current[sid] : null;
    return runtime ? Array.from(runtime.hermesRunIds) : [];
  }, []);

  const clearSessionRuntime = useCallback((sid: string | null | undefined) => {
    if (!sid) return;
    delete runRuntimeBySessionRef.current[sid];
  }, []);

  const getKnownSessionStatus = useCallback((sid: string | null | undefined) => {
    if (!sid) return '';
    const state = runStateBySessionRef.current[sid];
    const meta = sessionMetaById[sid];
    const listed = conversationsRef.current.find((item: any) => realSessionId(item) === sid || String(item?.id || '') === sid) as any;
    return String(
      state?.status
      || meta?.progress?.status
      || meta?.task_status
      || listed?.progress?.status
      || listed?.task_status
      || ''
    );
  }, [sessionMetaById]);

  const isSessionBusy = useCallback((sid: string | null | undefined) => {
    if (!sid) return Boolean(isProcessing);
    const state = runStateBySessionRef.current[sid];
    const status = getKnownSessionStatus(sid);
    return Boolean(state?.isProcessing) || SESSION_BUSY_STATUSES.has(status);
  }, [getKnownSessionStatus, isProcessing]);

  const syncSessionRunStateFromDetail = useCallback((detail: any, sidHint?: string | null) => {
    const sid = sidHint || realSessionId(detail);
    if (!sid || !detail) return;
    const nextStatus = String(detail?.progress?.status || detail?.task_status || '');
    if (!nextStatus) return;
    setSessionRunState(sid, {
      isProcessing: SESSION_BUSY_STATUSES.has(nextStatus),
      status: nextStatus,
      reason: detail?.task_reason || detail?.task_summary || detail?.progress?.phase_label,
      needsInput: ['needs_input', 'waiting_input'].includes(nextStatus),
    });
  }, [setSessionRunState]);

  const enqueueSessionTodo = useCallback((todo: SessionTodo) => {
    setSessionTodos((prev) => {
      const rows = prev[todo.sid] || [];
      const nextRows = rows.some((row) => row.id === todo.id) ? rows.map((row) => row.id === todo.id ? todo : row) : [...rows, todo];
      return { ...prev, [todo.sid]: nextRows.slice(-8) };
    });
  }, []);

  const removeSessionTodo = useCallback((sid: string | null | undefined, todoId: string | null | undefined) => {
    if (!sid || !todoId) return;
    setSessionTodos((prev) => {
      const nextRows = (prev[sid] || []).filter((row) => row.id !== todoId);
      const next = { ...prev, [sid]: nextRows };
      if (nextRows.length === 0) delete next[sid];
      return next;
    });
  }, []);

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
  // (useCallback 包装的 setActiveSessionIdSafe 只切视图；运行流继续按 session 归属)
  // 保留 declaration 兼容老代码 grep, 实际不再使用
  const conversationIdRef = useRef<string | null>(null);
  // Phase 2 Aside-Fix：左侧 aside 的会话列表（按 activeEmployee 过滤）
  const [conversations, setConversations] = useState<Conversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
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
  const [warRoomMenuOpen, setWarRoomMenuOpen] = useState(false);
  // M4.3: 协作画布全屏 Modal
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [collabTemplates, setCollabTemplates] = useState<CollaborationTemplateItem[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [usingTemplateId, setUsingTemplateId] = useState<string | null>(null);
  // M5 (Event Log): Replay Modal 状态
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayData, setReplayData] = useState<CanvasReplay | null>(null);
  const [expandedReplayNodes, setExpandedReplayNodes] = useState<Record<string, boolean>>({});
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
  const [railPrefs, setRailPrefs] = useState<CommandRailPrefs>(() => getInitialCommandRailPrefs());
  const [homeConversationRailOpen, setHomeConversationRailOpen] = useState(false);

  const isWarRoom = Boolean(activeSessionId);
  const activeRunState = activeSessionId ? runStateBySession[activeSessionId] : undefined;
  const activeIsProcessing = activeSessionId
    ? Boolean(activeRunState?.isProcessing || SESSION_BUSY_STATUSES.has(activeSyncStatus))
    : Boolean(isProcessing);

  useEffect(() => {
    localStorage.setItem(COMMAND_RAIL_PREF_STORAGE_KEY, JSON.stringify(railPrefs));
  }, [railPrefs]);

  const commandLayoutStyle = {
    '--sider-width': `${railPrefs.leftCollapsed ? COLLAPSED_RAIL_WIDTH : railPrefs.leftWidth}px`,
    '--workspace-width': `${railPrefs.rightCollapsed ? COLLAPSED_RAIL_WIDTH : railPrefs.rightWidth}px`,
  } as CSSProperties;

  const toggleCommandRail = useCallback((side: 'left' | 'right') => {
    setRailPrefs((prev) => ({
      ...prev,
      leftCollapsed: side === 'left' ? !prev.leftCollapsed : prev.leftCollapsed,
      rightCollapsed: side === 'right' ? !prev.rightCollapsed : prev.rightCollapsed,
    }));
  }, []);

  const resetCommandRailWidth = useCallback((side: 'left' | 'right') => {
    setRailPrefs((prev) => ({
      ...prev,
      leftWidth: side === 'left' ? DEFAULT_LEFT_RAIL_WIDTH : prev.leftWidth,
      rightWidth: side === 'right' ? DEFAULT_RIGHT_RAIL_WIDTH : prev.rightWidth,
      leftCollapsed: side === 'left' ? false : prev.leftCollapsed,
      rightCollapsed: side === 'right' ? false : prev.rightCollapsed,
    }));
  }, []);

  const beginCommandRailResize = useCallback((side: 'left' | 'right', e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = side === 'left' ? railPrefs.leftWidth : railPrefs.rightWidth;
    document.body.classList.add('atlas-rail-resizing');

    const onPointerMove = (event: PointerEvent) => {
      const delta = event.clientX - startX;
      const nextWidth = side === 'left'
        ? clampNumber(startWidth + delta, LEFT_RAIL_MIN_WIDTH, LEFT_RAIL_MAX_WIDTH)
        : clampNumber(startWidth - delta, RIGHT_RAIL_MIN_WIDTH, RIGHT_RAIL_MAX_WIDTH);
      setRailPrefs((prev) => ({
        ...prev,
        leftWidth: side === 'left' ? nextWidth : prev.leftWidth,
        rightWidth: side === 'right' ? nextWidth : prev.rightWidth,
        leftCollapsed: side === 'left' ? false : prev.leftCollapsed,
        rightCollapsed: side === 'right' ? false : prev.rightCollapsed,
      }));
    };

    const onPointerUp = () => {
      document.body.classList.remove('atlas-rail-resizing');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }, [railPrefs.leftWidth, railPrefs.rightWidth]);

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
      conversationsRef.current = visible;
      visible.forEach((item: any) => rememberSessionMeta(item, realSessionId(item)));
      setConversations(visible);
      void loadRunQueue();
    } catch (e) {
      console.error('Failed to load conversations:', e);
    } finally {
      setLoadingConvs(false);
    }
  }, [allEmployees, allEmployeesForMention, loadRunQueue, rememberSessionMeta]);

  useEffect(() => {
    const sid = activeSessionId;
    if (!sid) return;
    const activeStatuses = new Set(['running', 'queued', 'waiting_approval', 'needs_input', 'waiting_input', 'quota_waiting', 'stalled', 'completed', 'done', 'failed', 'stopped', 'cancelled']);
    const unlockStatuses = new Set(['completed', 'failed', 'stopped', 'cancelled', 'needs_input', 'waiting_input', 'waiting_approval', 'quota_waiting', 'stalled']);
    const sessionRunState = runStateBySessionRef.current[sid];
    const status = activeSyncStatus || sessionRunState?.status || (sessionRunState?.isProcessing || isProcessing ? 'running' : '');
    if (!activeStatuses.has(status)) return;

    let stopped = false;
    let busy = false;
    let lastFingerprint = '';
    let stableTerminalPolls = 0;
    let sawBackgroundWork = backgroundSyncSessionIdsRef.current.has(sid) || ['running', 'stalled', 'waiting_approval', 'quota_waiting'].includes(status);
    const startedAt = Date.now();

    const syncDetail = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        const detail = await fetchConversationDetail(sid);
        if (stopped || !detail) return;
        const realSid = realSessionId(detail);
        const nextMessages = messagesFromConversationDetail(detail, activeEmployee);
        const lastMessage = nextMessages[nextMessages.length - 1];
        const nextFingerprint = JSON.stringify({
          count: nextMessages.length,
          last: lastMessage?.text?.slice(-120) || '',
          status: detail?.task_status || detail?.progress?.status || '',
          artifacts: Array.isArray(detail?.artifacts) ? detail.artifacts.length : 0,
          updated_at: detail?.updated_at || '',
        });
        if (nextFingerprint !== lastFingerprint) {
          lastFingerprint = nextFingerprint;
          stableTerminalPolls = 0;
          hydrateSessionFromDetail(detail, realSid);
        } else if (['completed', 'failed', 'stopped', 'cancelled'].includes(String(detail?.progress?.status || detail?.task_status || ''))) {
          stableTerminalPolls += 1;
        }
        const nextStatus = String(detail?.progress?.status || detail?.task_status || '');
        if (nextStatus) {
          setSessionRunState(realSid, {
            isProcessing: SESSION_BUSY_STATUSES.has(nextStatus),
            status: nextStatus,
            reason: detail?.task_reason || detail?.task_summary || detail?.progress?.phase_label,
            needsInput: ['needs_input', 'waiting_input'].includes(nextStatus),
          });
        }
        if (unlockStatuses.has(nextStatus)) {
          setIsProcessing(false);
        }
        if (nextStatus && !activeStatuses.has(nextStatus)) {
          await loadConversations();
        }
        if (sessionHasBackgroundWork(detail)) {
          sawBackgroundWork = true;
          backgroundSyncSessionIdsRef.current.add(realSid);
        }
        const terminal = ['completed', 'done', 'failed', 'stopped', 'cancelled'].includes(nextStatus);
        const backgroundTailExpired = Date.now() - startedAt > SESSION_AUTO_SYNC_BACKGROUND_TAIL_MS;
        if (
          terminal
          && (
            (!sawBackgroundWork && stableTerminalPolls >= SESSION_AUTO_SYNC_NORMAL_TAIL_POLLS)
            || (sawBackgroundWork && backgroundTailExpired && stableTerminalPolls >= SESSION_AUTO_SYNC_NORMAL_TAIL_POLLS)
          )
        ) {
          backgroundSyncSessionIdsRef.current.delete(realSid);
          stopped = true;
        }
      } catch (e) {
        console.warn('[SessionAutoSync] failed:', e);
      } finally {
        busy = false;
      }
    };

    syncDetail();
    const timer = window.setInterval(syncDetail, SESSION_AUTO_SYNC_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeSessionId, activeSyncStatus, activeEmployee, isProcessing, loadConversations, hydrateSessionFromDetail, setSessionRunState]);

  useEffect(() => {
    const sid = activeSessionId;
    if (!sid) return;
    const controller = new AbortController();
    let stopped = false;
    let busy = false;
    let pendingHydrate = false;

    const hydrateFromSessionEvent = async () => {
      if (stopped) return;
      if (busy) {
        pendingHydrate = true;
        return;
      }
      busy = true;
      try {
        const detail = await fetchConversationDetail(sid);
        if (stopped || !detail) return;
        const realSid = realSessionId(detail) || sid;
        markSessionBackgroundSync(realSid);
        hydrateSessionFromDetail(detail, realSid);
        const nextStatus = String(detail?.progress?.status || detail?.task_status || '');
        if (nextStatus) {
          setSessionRunState(realSid, {
            isProcessing: SESSION_BUSY_STATUSES.has(nextStatus),
            status: nextStatus,
            reason: detail?.task_reason || detail?.task_summary || detail?.progress?.phase_label,
            needsInput: ['needs_input', 'waiting_input'].includes(nextStatus),
          });
          if (['needs_input', 'waiting_input'].includes(nextStatus)) {
            enqueueSessionTodo({
              id: `needs-input:${realSid}`,
              sid: realSid,
              type: 'needs_input',
              title: '需要补充信息',
              detail: detail?.task_reason || detail?.task_summary || '当前会话需要补充上下文后继续。',
              createdAt: Date.now(),
            });
          }
          if (SESSION_TERMINAL_STATUSES.has(nextStatus)) {
            removeSessionTodo(realSid, `needs-input:${realSid}`);
          }
        }
        await loadConversations();
      } catch (e) {
        if (!isAbortLikeError(e, controller.signal)) {
          console.warn('[SessionEvents] hydrate failed:', e);
        }
      } finally {
        busy = false;
        if (pendingHydrate && !stopped) {
          pendingHydrate = false;
          void hydrateFromSessionEvent();
        }
      }
    };

    void (async () => {
      try {
        for await (const evt of streamSessionEvents(sid, { signal: controller.signal })) {
          if (stopped || evt?.aborted) break;
          const eventName = String(evt?.event_type || evt?.event || '');
          if (eventName === 'session.updated' || eventName === 'message.created') {
            markSessionBackgroundSync(sid);
            void hydrateFromSessionEvent();
          } else if (eventName === 'openatlas.approval_required' || evt?.approval_required) {
            const approval = evt.approval_required || evt;
            const runId = approval.hermes_run_id || approval.run_id;
            if (!isActionableHermesApproval(approval)) {
              appendProgressStage(sid, {
                role: activeEmployee ? String(activeEmployee.id) : 'atlas',
                sender: activeEmployee?.name || 'Atlas',
                avatar: activeEmployee?.avatar || 'A',
                color: activeEmployee?.color || '#4F46E5',
              }, {
                id: `approval-diagnostic:${Date.now()}`,
                kind: 'info',
                status: 'running',
                title: '运行诊断',
                detail: approval.description || approval.command || '收到非 Hermes 原生审批信号，已忽略并继续同步。',
                meta: '诊断',
              });
              markSessionBackgroundSync(sid);
              void hydrateFromSessionEvent();
              continue;
            }
            const approvalTodoId = `approval:${approval.approval_id || runId || approval.command || sid}`;
            setSessionRunState(sid, {
              isProcessing: false,
              status: 'waiting_approval',
              pendingApproval: { ...approval, session_id: sid },
              reason: approval.description || approval.command || 'Hermes 请求人工确认。',
            });
            enqueueSessionTodo({
              id: approvalTodoId,
              sid,
              type: 'approval',
              title: '等待人工确认',
              detail: approval.description || approval.command || 'Hermes 请求确认高风险或不确定操作。',
              approval: { ...approval, session_id: sid },
              createdAt: Date.now(),
            });
            const speaker = {
              role: activeEmployee ? String(activeEmployee.id) : 'atlas',
              sender: activeEmployee?.name || 'Atlas',
              avatar: activeEmployee?.avatar || 'A',
              color: activeEmployee?.color || '#4F46E5',
            };
            appendProgressStage(sid, speaker, {
              id: `approval:${approval.approval_id || runId || approval.command || 'session-event'}`,
              kind: 'approval',
              status: 'waiting',
              title: '等待人工确认',
              detail: approval.description || approval.command || 'Hermes 请求确认高风险或不确定操作。',
              meta: '审批',
            });
            message.warning('Hermes 正在等待人工确认，请在页面底部处理授权。');
            const choice = await requestApprovalChoiceInline(approval, sid);
            if (runId) {
              try {
                await approveHermesRun(String(runId), choice, choice === 'always', approval.approval_id);
                removeSessionTodo(sid, approvalTodoId);
                setSessionRunState(sid, {
                  isProcessing: choice !== 'deny',
                  status: choice === 'deny' ? 'failed' : 'running',
                  pendingApproval: null,
                  reason: approvalChoiceText(choice),
                });
                appendProgressStage(sid, speaker, {
                  id: `approval:${approval.approval_id || runId || approval.command || 'session-event'}`,
                  kind: 'approval',
                  status: choice === 'deny' ? 'failed' : 'completed',
                  title: choice === 'deny' ? '审批已拒绝' : '审批已通过',
                  detail: approvalChoiceText(choice),
                  meta: '审批',
                });
                void hydrateFromSessionEvent();
              } catch (e: any) {
                if (isStaleApprovalError(e)) {
                  removeSessionTodo(sid, approvalTodoId);
                  setPendingApproval(null);
                  setSessionRunState(sid, {
                    isProcessing: true,
                    status: 'running',
                    pendingApproval: null,
                    reason: '审批已不再处于等待状态，正在同步 Hermes 最新结果。',
                  });
                  message.info('审批已过期或已被 Hermes 处理，正在同步最新状态。');
                  void hydrateFromSessionEvent();
                } else {
                  message.error(`审批提交失败：${e?.message || e}`);
                }
              }
            }
          } else if (eventName === 'openatlas.tool_blocked') {
            const reason = evt.reason || evt.blocked_reason || '该工具不在当前员工授权范围内。';
            appendProgressStage(sid, {
              role: activeEmployee ? String(activeEmployee.id) : 'atlas',
              sender: activeEmployee?.name || 'Atlas',
              avatar: activeEmployee?.avatar || 'A',
              color: activeEmployee?.color || '#4F46E5',
            }, {
              id: `tool-blocked:${evt.tool_name || evt.command || Date.now()}`,
              kind: 'tool',
              status: 'failed',
              title: '工具被权限策略阻断',
              detail: reason,
              meta: '权限',
            });
            void hydrateFromSessionEvent();
          } else if (eventName === 'error' && evt?.error) {
            console.warn('[SessionEvents] stream error:', evt.error);
          }
        }
      } catch (e) {
        if (!isAbortLikeError(e, controller.signal)) {
          console.warn('[SessionEvents] stream failed:', e);
        }
      }
    })();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [activeEmployee, activeSessionId, appendProgressStage, enqueueSessionTodo, hydrateSessionFromDetail, loadConversations, markSessionBackgroundSync, removeSessionTodo, requestApprovalChoiceInline, setSessionRunState]);

  useEffect(() => {
    const candidateIds = conversations
      .map((conv) => {
        const sid = realSessionId(conv);
        const stateStatus = runStateBySessionRef.current[sid]?.status;
        const status = String(stateStatus || conv.task_status || '');
        return { sid, status };
      })
      .filter(({ sid, status }) => (
        sid
        && sid !== activeSessionId
        && (
          SESSION_BUSY_STATUSES.has(status)
          || SESSION_ATTENTION_STATUSES.has(status)
          || backgroundSyncSessionIdsRef.current.has(sid)
        )
      ))
      .slice(0, 12);

    if (candidateIds.length === 0) return;
    const controllers: AbortController[] = [];
    let stopped = false;

    const hydrateBackgroundSession = async (sid: string) => {
      try {
        const detail = await fetchConversationDetail(sid);
        if (stopped || !detail) return;
        const realSid = realSessionId(detail) || sid;
        hydrateSessionFromDetail(detail, realSid);
        const status = String(detail?.progress?.status || detail?.task_status || '');
        if (status) {
          setSessionRunState(realSid, {
            isProcessing: SESSION_BUSY_STATUSES.has(status),
            status,
            reason: detail?.task_reason || detail?.task_summary || detail?.progress?.phase_label,
            needsInput: ['needs_input', 'waiting_input'].includes(status),
          });
          if (['needs_input', 'waiting_input'].includes(status)) {
            enqueueSessionTodo({
              id: `needs-input:${realSid}`,
              sid: realSid,
              type: 'needs_input',
              title: '需要补充信息',
              detail: detail?.task_reason || detail?.task_summary || '后台会话需要补充上下文后继续。',
              createdAt: Date.now(),
            });
          }
          if (SESSION_TERMINAL_STATUSES.has(status)) {
            removeSessionTodo(realSid, `needs-input:${realSid}`);
            backgroundSyncSessionIdsRef.current.delete(realSid);
          }
        }
      } catch (e) {
        console.warn('[BackgroundSessionEvents] hydrate failed:', sid, e);
      }
    };

    candidateIds.forEach(({ sid }) => {
      const controller = new AbortController();
      controllers.push(controller);
      void (async () => {
        try {
          for await (const evt of streamSessionEvents(sid, { signal: controller.signal })) {
            if (stopped || evt?.aborted) break;
            const eventName = String(evt?.event_type || evt?.event || '');
            if (eventName === 'session.updated' || eventName === 'message.created') {
              markSessionBackgroundSync(sid);
              void hydrateBackgroundSession(sid);
            } else if (eventName === 'openatlas.approval_required' || evt?.approval_required) {
              const approval = evt.approval_required || evt;
              const runId = approval.hermes_run_id || approval.run_id;
              if (!isActionableHermesApproval(approval)) {
                markSessionBackgroundSync(sid);
                void hydrateBackgroundSession(sid);
                continue;
              }
              const todoId = `approval:${approval.approval_id || runId || approval.command || sid}`;
              setSessionRunState(sid, {
                isProcessing: false,
                status: 'waiting_approval',
                pendingApproval: { ...approval, session_id: sid },
                reason: approval.description || approval.command || 'Hermes 请求人工确认。',
              });
              if (SHOW_GLOBAL_SESSION_TODOS) {
                enqueueSessionTodo({
                  id: todoId,
                  sid,
                  type: 'approval',
                  title: '后台会话等待确认',
                  detail: approval.description || approval.command || 'Hermes 请求确认高风险或不确定操作。',
                  approval: { ...approval, session_id: sid },
                  createdAt: Date.now(),
                });
                message.warning('有后台会话正在等待人工确认，已放入全局待办。');
              }
            } else if (eventName === 'openatlas.needs_input' || evt?.needs_input) {
              setSessionRunState(sid, {
                isProcessing: false,
                status: 'needs_input',
                needsInput: true,
                reason: evt?.reason || evt?.message || '后台会话需要补充信息。',
              });
              enqueueSessionTodo({
                id: `needs-input:${sid}`,
                sid,
                type: 'needs_input',
                title: '后台会话需要补充信息',
                detail: evt?.reason || evt?.message || '请打开会话补充上下文。',
                createdAt: Date.now(),
              });
            }
          }
        } catch (e) {
          if (!isAbortLikeError(e, controller.signal)) {
            console.warn('[BackgroundSessionEvents] stream failed:', sid, e);
          }
        }
      })();
    });

    return () => {
      stopped = true;
      controllers.forEach((controller) => controller.abort());
    };
  }, [activeSessionId, conversations, enqueueSessionTodo, hydrateSessionFromDetail, markSessionBackgroundSync, removeSessionTodo, setSessionRunState]);

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
            allowedToolsets: nonEmptyToolsets(emp.allowed_toolsets, emp.toolsets),
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
      }] : [{
        role: 'atlas',
        sender: 'Atlas',
        avatar: 'A',
        color: '#4F46E5',
        text: `已载入协作方案「${tpl.name}」。画布已打开，你可以检查员工节点、保存/另存方案，或直接发起作战室任务。`,
      }], sid);
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
    if (!activeSessionId && !activeEmployee?.id) {
      message.warning('请先进入一个会话');
      return;
    }
    setReplayOpen(true);
    try {
      const replay = activeSessionId
        ? await replaySessionEvents(activeSessionId)
        : await replayEmployeeEvents(activeEmployee!.id);
      setReplayData(replay);
    } catch (e) {
      console.warn('[M5] replay failed:', e);
      setReplayData(null);
    }
  }, [activeEmployee, activeSessionId]);

  const handleWorkflowNodeAction = useCallback(async (nodeRunId: string, action: 'retry' | 'continue') => {
    if (!activeSessionId || !nodeRunId) return;
    try {
      const res = await actionWorkflowNode(activeSessionId, nodeRunId, action);
      const prompt = String(res?.continuation_message || '').trim();
      if (prompt) {
        setInput(prompt);
        setTimeout(() => inputRef.current?.focus(), 30);
      }
      setSessionMetaById((prev) => ({
        ...prev,
        [activeSessionId]: {
          ...(prev[activeSessionId] || {}),
          task_status: res?.task_status || 'needs_input',
          task_summary: `${action === 'retry' ? '重试' : '继续'}节点已准备，请确认输入框内容后发送。`,
        },
      }));
      const replay = await replaySessionEvents(activeSessionId);
      setReplayData(replay);
      message.success(action === 'retry' ? '已生成节点重试提示' : '已生成节点继续提示');
    } catch (e: any) {
      message.error(`节点操作失败: ${e?.message || e}`);
    }
  }, [activeSessionId]);

  const handleResumeCheckpoint = useCallback((checkpoint: any, node?: any, step?: any) => {
    if (!activeSessionId || !checkpoint?.id) return;
    const checkpointSummary = checkpoint.summary || step?.summary || step?.title || checkpoint.checkpoint_type || '协作检查点';
    const artifactPolicy = checkpoint.artifact_policy || {};
    Modal.confirm({
      title: '从检查点创建恢复分支？',
      okText: '创建分支并继续',
      cancelText: '取消',
      centered: true,
      width: 520,
      content: (
        <div style={{ display: 'grid', gap: 8, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
          <div><strong style={{ color: 'var(--text-primary)' }}>恢复点：</strong>{node?.label || node?.node_id || '协作节点'} · {checkpointSummary}</div>
          <div><strong style={{ color: 'var(--text-primary)' }}>将复用：</strong>检查点之前的会话上下文、员工角色、Skill/文件/记忆注入记录。</div>
          <div><strong style={{ color: 'var(--text-primary)' }}>将重新执行：</strong>该节点从检查点之后的步骤，并把结果写入新的 Replay Fork。</div>
          <div><strong style={{ color: 'var(--text-primary)' }}>交付物策略：</strong>{artifactPolicy.on_resume === 'create_new_version' ? '生成新版本，不覆盖原产物' : '保留原产物并追加恢复结果'}</div>
          {step?.tool_name && <div><strong style={{ color: 'var(--text-primary)' }}>相关工具：</strong>{step.tool_name}</div>}
          {(step?.risk_level === 'high' || step?.status === 'waiting_approval') && (
            <div style={{ color: '#b45309' }}>该步骤涉及高风险或人工确认，恢复执行时可能再次触发审批。</div>
          )}
        </div>
      ),
      async onOk() {
        try {
          const res = await resumeWorkflowCheckpoint(activeSessionId, checkpoint.id, { mode: 'fork_resume' });
          setSessionMetaById((prev) => ({
            ...prev,
            [activeSessionId]: {
              ...(prev[activeSessionId] || {}),
              task_status: res?.task_status || 'running',
              task_summary: '已创建恢复分支，正在从检查点继续执行。',
            },
          }));
          message.success('已创建 Replay Fork，正在后台恢复执行');
          const replay = await replaySessionEvents(activeSessionId);
          setReplayData(replay);
        } catch (e: any) {
          message.error(`恢复检查点失败: ${e?.message || e}`);
          throw e;
        }
      },
    });
  }, [activeSessionId]);

  const handleWorkflowStepAction = useCallback((step: any, action: 'retry' | 'skip', node?: any) => {
    if (!activeSessionId || !step?.id) return;
    const actionText = action === 'retry' ? '重试工具步骤' : '跳过工具并继续';
    Modal.confirm({
      title: `${actionText}？`,
      okText: action === 'retry' ? '重试并继续' : '跳过并继续',
      cancelText: '取消',
      centered: true,
      width: 520,
      content: (
        <div style={{ display: 'grid', gap: 8, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
          <div><strong style={{ color: 'var(--text-primary)' }}>节点：</strong>{node?.label || node?.node_id || '协作节点'}</div>
          <div><strong style={{ color: 'var(--text-primary)' }}>步骤：</strong>{step.title || step.event_type}</div>
          <div><strong style={{ color: 'var(--text-primary)' }}>工具：</strong>{step.tool_name || '未知工具'}</div>
          <div><strong style={{ color: 'var(--text-primary)' }}>当前状态：</strong>{step.status}</div>
          <div><strong style={{ color: 'var(--text-primary)' }}>恢复方式：</strong>{action === 'retry' ? '创建恢复分支，优先重新调用或替代该工具完成目标。' : '创建恢复分支，明确记录跳过影响，并继续产出可用结果。'}</div>
          <div style={{ color: 'var(--text-tertiary)' }}>恢复结果会作为新分支写入回放，不会覆盖原始执行记录。</div>
        </div>
      ),
      async onOk() {
        try {
          const res = await actionWorkflowStep(activeSessionId, step.id, action);
          setSessionMetaById((prev) => ({
            ...prev,
            [activeSessionId]: {
              ...(prev[activeSessionId] || {}),
              task_status: res?.task_status || 'running',
              task_summary: action === 'retry' ? '已创建工具重试分支。' : '已创建跳过并继续分支。',
            },
          }));
          message.success(action === 'retry' ? '已创建工具重试分支' : '已创建跳过并继续分支');
          const replay = await replaySessionEvents(activeSessionId);
          setReplayData(replay);
        } catch (e: any) {
          message.error(`步骤操作失败: ${e?.message || e}`);
          throw e;
        }
      },
    });
  }, [activeSessionId]);

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
  const loadAllEmployeesForMention = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await fetchEmployees(signal ? { signal } : undefined);
      if (signal?.aborted) return;
      employeesCache = list as any;
      setAllEmployeesForMention(list);
      setAllEmployees(list as any);
    } catch (e) {
      if (isAbortLikeError(e, signal)) return;
      console.error('[M4.2] fetchEmployees for mention failed:', e);
    }
  }, []);

  // M4.2: 启动时预加载(为 MentionPopover 数据源)
  useEffect(() => {
    const ac = new AbortController();
    loadAllEmployeesForMention(ac.signal);
    return () => ac.abort();
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

  const handleMentionClose = useCallback(() => {
    setInput(prev => prev.replace(/@[^\s\n,，。.;；]*$/, '').trimEnd());
  }, []);

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
    const whiteboardHandoff = searchParams.get('whiteboard');

    if (whiteboardHandoff === 'handoff') {
      try {
        const raw = localStorage.getItem('atlas.whiteboard.handoff') || '';
        const payload = raw ? JSON.parse(raw) : null;
        const prompt = String(payload?.prompt || '').trim();
        if (prompt) {
          setInput(prompt);
          setTimeout(() => inputRef.current?.focus(), 30);
          message.success(`已载入白板提示词${payload?.title ? `: ${payload.title}` : ''}`);
        }
      } catch (e) {
        console.warn('[whiteboard handoff] failed:', e);
      } finally {
        setSearchParams({}, { replace: true });
      }
    } else if (convId) {
      fetchConversationDetail(convId)
        .then(async (detail) => {
          if (!detail) return; // P3.12 防御: 404 等情况下 detail 可能是 undefined
          const detailSid = realSessionId(detail);
          rememberSessionMeta(detail, detailSid);
          syncSessionRunStateFromDetail(detail, detailSid);
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
            const sid = detailSid;
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
          setActiveEmployee({ id: (emp as any)?.id ?? empId, uuid: (emp as any)?.__id ?? empId, name, avatar, color, department: emp?.department?.name, allowedToolsets: nonEmptyToolsets(emp?.allowed_toolsets, emp?.toolsets) });

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

          const sid = detailSid;
          setActiveSessionIdSafe(sid);
          setMessages(restored, sid);
          setDispatchCid(sid); // Bug #2 修复:触发 dispatch 读
        })
        .catch((e) => console.error('Failed to restore conversation:', e));
    } else if (empId) {
      fetchEmployeeDetail(empId)
        .then((emp) => {
          setActiveEmployee({ id: emp.id, uuid: (emp as any).__id, name: emp.name, avatar: emp.avatar_char, color: emp.department?.color || '#4F46E5', department: emp.department?.name, allowedToolsets: nonEmptyToolsets(emp.allowed_toolsets, emp.toolsets) });

          // 加欢迎气泡（Phase 2 不再自动 setMessages 进 war room；只在 has 历史会话后才进）
          // 这里只预选员工，不立即进 war room — 用户在 aside 选历史或新建会话才进入
        })
        .catch((e) => console.error('Failed to pre-select employee:', e))
        .finally(() => setSearchParams({}, { replace: true }));
    }
  }, [setSearchParams, searchParams, syncSessionRunStateFromDetail, rememberSessionMeta]);

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
    if (requestedSid === activeSessionId) {
      setSearchParams({ conversation: requestedSid });
      return;
    }
    setActiveSessionIdSafe(requestedSid);
    setDispatchCid(requestedSid);
    setSearchParams({ conversation: requestedSid });
    setMessages([], requestedSid);
    const hintedStatus = String(conv.progress?.status || conv.task_status || '');
    if (hintedStatus) {
      setSessionRunState(requestedSid, {
        isProcessing: SESSION_BUSY_STATUSES.has(hintedStatus),
        status: hintedStatus,
        reason: conv.task_summary || conv.progress?.phase_label,
        needsInput: ['needs_input', 'waiting_input'].includes(hintedStatus),
      });
    }
    const switchSeq = ++switchSeqRef.current;
    const isLatestSwitch = () => switchSeq === switchSeqRef.current;
    try {
      const detail = await fetchConversationDetail(requestedSid);
      if (!isLatestSwitch()) return;
      rememberSessionMeta(detail, realSessionId(detail));
      // M4.2: 群聊 employee_id 可能为 null — fallback 到 messages[0].speaker_employee_id
      let empId = detail.employee_id;
      if (empId == null) {
        const firstAssistant = detail.messages.find((m: any) => m.role === 'assistant' && m.speaker_employee_id);
        empId = firstAssistant?.speaker_employee_id ?? null;
      }
      const emp = empId != null ? await fetchEmployeeDetail(empId).catch(() => null) : null;
      if (!isLatestSwitch()) return;
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
      const nextStatus = String(detail?.progress?.status || detail?.task_status || '');
      if (nextStatus) {
        setSessionRunState(sid, {
          isProcessing: SESSION_BUSY_STATUSES.has(nextStatus),
          status: nextStatus,
          reason: detail?.task_reason || detail?.task_summary || detail?.progress?.phase_label,
          needsInput: ['needs_input', 'waiting_input'].includes(nextStatus),
        });
      }
      setSearchParams({ conversation: sid });
      // 切会话必须以该会话真实员工为准，不能复用上一个 activeEmployee。
      if (emp && empId != null) {
        // FNV-1a shim safety: include uuid so the next chat stream uses real backend UUID, not shim int.
        setActiveEmployee({ id: (emp as any)?.id ?? empId, uuid: (emp as any).__id ?? empId, name, avatar, color });
      } else if (empId == null) {
        setActiveEmployee(null);
      }
    } catch (e) {
      console.error('Failed to switch conversation:', e);
    }
  }, [activeSessionId, rememberSessionMeta, setActiveSessionIdSafe, setMessages, setSearchParams, setSessionRunState]);

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
    const switchSeq = ++switchSeqRef.current;
    const isLatestSwitch = () => switchSeq === switchSeqRef.current;
    try {
      const detail = await fetchConversationDetail(convId);
      if (!isLatestSwitch()) return;
      if (!detail) return; // P3.12 防御: 404 等情况下 detail 可能是 undefined
      rememberSessionMeta(detail, realSessionId(detail));
      // M4.2: 群聊 employee_id 可能为 null
      let empId = detail.employee_id;
      if (empId == null) {
        const firstAssistant = detail.messages.find((m: any) => m.role === 'assistant' && m.speaker_employee_id);
        empId = firstAssistant?.speaker_employee_id ?? null;
      }
      const emp = empId != null ? await fetchEmployeeDetail(empId).catch(() => null) : null;
      if (!isLatestSwitch()) return;
      const name = emp?.name || (empId != null ? `员工 #${empId}` : 'Atlas');
      const avatar = emp?.avatar_char || 'A';
      const color = emp?.department?.color || '#4F46E5';
      if (empId != null) {
        // FNV-1a shim safety: include uuid so the next chat stream uses real backend UUID, not shim int.
        setActiveEmployee({
          id: (emp as any)?.id ?? (typeof empId === 'number' ? empId : 0),
          uuid: (emp as any)?.__id ?? String(empId),
          name,
          avatar,
          color,
        });
      } else {
        setActiveEmployee(null);
      }
      if (detail && detail.id != null) {
        const sid = realSessionId(detail);
        setActiveSessionIdSafe(sid);
        setDispatchCid(sid); // Bug #2 修复
        hydrateSessionFromDetail(detail, sid);
        if (!Array.isArray(detail.messages) || detail.messages.length === 0) {
          setMessages([{
            role: 'atlas',
            sender: 'Atlas',
            avatar: 'A',
            color: '#4F46E5',
            text: '这是一个新的作战室。你可以在输入框中用 @ 选择一位或多位数智员工，例如：@行政小六 帮我分诊，或 @项目交付经理 @法务合规顾问 一起处理任务。',
          }], sid);
        }
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
  }, [setSearchParams, rememberSessionMeta, hydrateSessionFromDetail, setActiveSessionIdSafe, setMessages]);

  // Phase 2 Aside-Fix：删除会话（软删除）
  const handleDeleteConversation = useCallback(async (convId: number | string, e: React.MouseEvent) => {
    e.stopPropagation();
    const deleteSid = String(convId);
    Modal.confirm({
      title: '确认删除该会话？',
      content: '删除后会从当前会话列表移除。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteConversation(convId);
          setConversations(prev => prev.filter(c => realSessionId(c) !== deleteSid && String(c.id) !== deleteSid));
          if (activeSessionId === deleteSid) {
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

  // M4.2 (Group Chat): 新建空群聊,由 Atlas 引导用户用 @ 召唤员工接力。
  const handleNewGroupConversation = useCallback(async () => {
    try {
      setWarRoomMenuOpen(false);
      setActiveEmployee(null);
      setRelayEmployeeIds([]);
      setRelayChips([]);
      const group = await createGroupConversation([], '多员工群聊');
      const sid = realSessionId(group);
      setActiveSessionIdSafe(sid);
      setDispatchCid(sid);
      setMessages([{
        role: 'atlas',
        sender: 'Atlas',
        avatar: 'A',
        color: '#4F46E5',
        text: '已创建多员工群聊。请在输入框中用 @ 选择一位或多位数智员工，例如：@翻书人 PageTurner 帮我分析这份 PDF。Atlas 会按你选择的员工组织接力。',
      }], sid);
      setConversations(prev => [group, ...prev.filter((c) => realSessionId(c) !== sid)]);
    } catch (e) {
      console.error('[M4.2] createGroupConversation failed:', e);
      message.error(`建群失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [setActiveSessionIdSafe, setMessages]);

  const handleWarRoomMenuSingle = useCallback(() => {
    setWarRoomMenuOpen(false);
    setShowSwitcher(true);
  }, []);

  const handleWarRoomMenuPlan = useCallback(async () => {
    setWarRoomMenuOpen(false);
    await handleOpenTemplateLibrary();
  }, [handleOpenTemplateLibrary]);

  // Phase 2 E：员工切换器
  const handleSwitchEmployee = useCallback(async (emp: { id: number; name: string; avatar_char: string; department?: { name: string; color: string } | null }) => {
    setActiveEmployee({
      id: emp.id,
      uuid: (emp as any).__id,
      name: emp.name,
      avatar: emp.avatar_char,
      color: emp.department?.color || '#4F46E5',
      department: emp.department?.name,
      allowedToolsets: nonEmptyToolsets((emp as any).allowed_toolsets, (emp as any).toolsets, (emp as any).allowedToolsets),
    });
    setShowSwitcher(false);
    setMessages([]); // 清空
    setActiveSessionIdSafe(null);
    setDispatchCid(null); // Bug #2 修复:切员工时清 dispatch
  }, []);

  const handleEmployeeShortcut = useCallback(async (emp: Employee) => {
    if (activeSessionId && isSessionBusy(activeSessionId)) return;
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
  }, [activeSessionId, isSessionBusy, setActiveSessionIdSafe, setMessages]);

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

  const handleNewCollaborationPlan = useCallback(async () => {
    setWarRoomMenuOpen(false);
    await handleOpenCustomOrchestration();
  }, [handleOpenCustomOrchestration]);

  const uploadPendingFiles = useCallback(async (filesInput: Iterable<File>) => {
    const filesToUpload = Array.from(filesInput).filter(Boolean);
    if (filesToUpload.length === 0) return;

    setUploading(true);
    const uploaded: Attachment[] = [];
    const failed: string[] = [];
    for (const file of filesToUpload) {
      try {
        const result = await uploadFile(file);
        uploaded.push(result);
      } catch (e) {
        console.error('Upload failed:', e);
        failed.push(file.name || '剪贴板文件');
      }
    }
    if (uploaded.length > 0) {
      setPendingAttachments((prev: Attachment[]) => [...prev, ...uploaded]);
      if (filesToUpload.length > 1) {
        message.success(`已上传 ${uploaded.length} 个文件`);
      }
    }
    if (failed.length > 0) {
      message.error(`上传失败: ${failed.slice(0, 3).join('、')}${failed.length > 3 ? ' 等' : ''}`);
    }
    setUploading(false);
  }, []);

  // Phase 2 Upload-Real：上传文件/图片
  const handleFileSelected = useCallback((file: File) => {
    void uploadPendingFiles([file]);
  }, [uploadPendingFiles]);

  const handlePasteUpload = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles = filesFromClipboardData(e.clipboardData);
    if (clipboardFiles.length === 0) return;
    e.preventDefault();
    if (uploading) {
      message.warning('正在上传文件，请稍后再粘贴');
      return;
    }
    void uploadPendingFiles(clipboardFiles);
  }, [uploadPendingFiles, uploading]);

  const handleCompositionStart = useCallback(() => {
    imeComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    window.setTimeout(() => {
      imeComposingRef.current = false;
    }, 0);
  }, []);

  // Phase 2 Upload-Real：移除待发附件
  const removePendingAttachment = useCallback((key: string) => {
    setPendingAttachments(prev => prev.filter(a => (a.url || a.id) !== key));
  }, []);

  const handleAbortCurrentRun = useCallback(async (sidOverride?: string | null) => {
    const sid = typeof sidOverride === 'string' ? sidOverride : activeSessionId;
    const runtime = sid ? runRuntimeBySessionRef.current[sid] : null;
    const runIds = sid ? getSessionHermesRunIds(sid) : Array.from(activeHermesRunIdsRef.current);
    const abortController = runtime?.abortController || streamAbortRef.current;
    if (abortController) {
      try { abortController.abort(); } catch { /* ignore */ }
      if (streamAbortRef.current === abortController) streamAbortRef.current = null;
    }
    if (sid) {
      setSessionRunState(sid, {
        isProcessing: false,
        status: 'stopped',
        reason: '用户已停止当前任务。',
      });
      mergeTaskState(sid, {
        task_status: 'stopped',
        reason: '用户已停止当前任务。',
        openatlas_session_id: sid,
      });
      setSessionMetaById((prev) => ({
        ...prev,
        [sid]: {
          ...(prev[sid] || {}),
          id: sid,
          task_status: 'stopped',
          task_summary: '用户已停止当前任务。',
        },
      }));
      appendProgressStage(sid, {
        role: activeEmployee ? String(activeEmployee.id) : 'atlas',
        sender: activeEmployee?.name || 'Atlas',
        avatar: activeEmployee?.avatar || 'A',
        color: activeEmployee?.color || '#4F46E5',
      }, {
        id: `runtime:stopped:${Date.now()}`,
        kind: 'runtime',
        status: 'failed',
        title: '已停止当前任务',
        detail: runIds.length > 0 ? `已向 Hermes 发送停止请求（${runIds.length} 个 run）。` : '已停止前端等待，当前会话状态已更新。',
        meta: '停止',
      });
      patchSessionTaskStatus(sid, 'stopped').catch((e) => {
        console.warn('[Hermes Stop] failed to patch session task status', e);
      });
    }
    if (runIds.length > 0) {
      if (sid) clearSessionRuntime(sid);
      activeHermesRunIdsRef.current.clear();
      const results = await Promise.allSettled(runIds.map((runId) => stopHermesRun(runId, 'user_clicked_stop')));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        console.warn('[Hermes Stop] failed to stop some runs', results);
      }
    }
    setTunnels(prev => prev.map(t => t.isComplete ? t : {
      ...t,
      status: '已停止',
      outputLines: appendTraceLine(t.outputLines, runIds.length ? `用户已停止当前运行 · Hermes stop ${runIds.length} 个 run` : '用户已停止当前运行'),
      isComplete: true,
    }));
    setOrbState('idle');
    setIsProcessing(false);
    message.info(runIds.length > 0 ? '已停止当前任务，正在同步 Hermes 状态。' : '已停止当前等待。');
  }, [activeEmployee, activeSessionId, appendProgressStage, clearSessionRuntime, getSessionHermesRunIds, mergeTaskState, setSessionRunState]);

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

  const simulateDispatch = useCallback(async (
    userInput: string,
    options?: { attachments?: Attachment[]; targetSessionId?: string | null },
  ) => {
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
    const attachmentsToSend = options?.attachments ?? pendingAttachments;
    if (!options?.attachments) setPendingAttachments([]);

    // P3.12 3.4.3: 新建 AbortController 接管流, 切会话自动 abort
    const ac = new AbortController();
    let stopHeartbeat: (() => void) | null = null;
    let targetSessionId: string | null = options?.targetSessionId ?? activeSessionId;

    try {
      setOrbState('dispatch');
      setTunnels(prev => prev.map(t => t.id === employee.id.toString() ? { ...t, status: '生成回复中', outputLines: ['接收问题...', '分析意图...', '调用模型...'] } : t));

      let fullResponse = '';
      let wasAborted = false;
      let wasQuotaWaiting = false;
      const toolCalls: ToolCall[] = [];
      let assistantUsage: Partial<Msg> = {};
      // 真 UUID: 优先用 employee.uuid, 兜底 allEmployees.find().__id
      let realEmpId: string = (employee as any).uuid || String(employee.id);
      if (!(employee as any).uuid) {
        const realEmp = allEmployees.find((e) => e.id === employee.id);
        if (realEmp && (realEmp as any).__id) realEmpId = (realEmp as any).__id;
      }
      targetSessionId = targetSessionId || activeSessionId;
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
      setSessionRunState(targetSessionId, {
        isProcessing: true,
        status: 'running',
        reason: `${employee.name} 正在执行任务。`,
      });
      setSessionAbortController(targetSessionId, ac);
      streamAbortRef.current = ac;
      const stream = chatWithEmployeeStream(realEmpId, userInput, {
        sessionId: targetSessionId,
        attachmentIds: attachmentsToSend?.map((a: any) => a.id) || [],
        reasoningEffort,
        signal: ac.signal,
      });
      let lastStreamEventAt = Date.now();
      const singleSpeaker = () => ({
        role: employee.id.toString(),
        sender: employee.name,
        avatar: employee.avatar,
        color: employee.color,
      });
      appendProgressStage(targetSessionId, singleSpeaker(), {
        id: 'runtime:accepted',
        kind: 'runtime',
        status: 'running',
        title: `${employee.name} 已接管任务`,
        detail: attachmentsToSend.length > 0
          ? `正在注入 ${attachmentsToSend.length} 个附件并启动 Hermes。`
          : '正在启动 Hermes，并准备会话上下文。',
        meta: '开始',
      });
      stopHeartbeat = startProgressHeartbeat(() => targetSessionId, singleSpeaker, () => lastStreamEventAt);

      for await (const chunk of stream) {
        lastStreamEventAt = Date.now();
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
        if (chunk.event_type === 'openatlas.capability_plan' || chunk.capability_plan) {
          const plan = chunk.capability_plan || {};
          const policy = chunk.collaboration_policy || {};
          mergeTaskState(targetSessionId, {
            task_status: 'running',
            reason: plan.summary || '能力清单已生成',
            capability_plan: plan,
            collaboration_policy: policy,
          });
          appendProgressStage(targetSessionId, singleSpeaker(), capabilityPlanStage(plan, policy));
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, outputLines: appendTraceLine(t.outputLines, plan.summary || '能力清单已生成') }
            : t));
          continue;
        }
        if (chunk.event_type === 'run.started') {
          const runId = chunk.hermes_run_id || chunk.run_id;
          if (runId) {
            addSessionHermesRunId(targetSessionId, String(runId));
            activeHermesRunIdsRef.current.add(String(runId));
            appendProgressStage(targetSessionId, singleSpeaker(), {
              id: `runtime:run:${runId}`,
              kind: 'runtime',
              status: 'running',
              title: '执行已启动',
              detail: '已进入执行链路，正在接收模型、工具和文件事件。',
              meta: '执行',
            });
            setTunnels(prev => prev.map(t => t.id === employee.id.toString()
              ? { ...t, outputLines: appendTraceLine(t.outputLines, `Hermes run started · ${String(runId).slice(0, 12)}`) }
              : t));
          }
          continue;
        }
        if (chunk.event_type === 'openatlas.run_idle' || chunk.event_type === 'openatlas.run_detached') {
          const line = chunk.message || (chunk.detached ? 'Hermes 后台继续运行，Atlas 会自动同步' : 'Hermes 暂无新事件，继续等待');
          const idleMs = Number(chunk.idle_seconds || 0) > 0 ? Number(chunk.idle_seconds) * 1000 : Date.now() - lastStreamEventAt;
          markSessionBackgroundSync(targetSessionId);
          setSessionRunState(targetSessionId, {
            isProcessing: !chunk.detached,
            status: chunk.detached ? 'stalled' : 'running',
            reason: line,
          });
          mergeTaskState(targetSessionId, {
            task_status: chunk.detached ? 'stalled' : 'running',
            reason: line,
          });
          appendProgressStage(targetSessionId, singleSpeaker(), waitStage(idleMs, !!chunk.detached));
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, status: chunk.detached ? '后台运行' : '运行中', outputLines: appendTraceLine(t.outputLines, line), isComplete: !!chunk.detached }
            : t));
          continue;
        }
        if (chunk.task_state?.task_status) {
          setSessionRunState(targetSessionId, {
            isProcessing: !SESSION_TERMINAL_STATUSES.has(String(chunk.task_state.task_status)) && !['needs_input', 'waiting_input', 'waiting_approval', 'quota_waiting', 'stalled'].includes(String(chunk.task_state.task_status)),
            status: String(chunk.task_state.task_status),
            reason: chunk.task_state.reason || chunk.task_state.task_summary,
            needsInput: ['needs_input', 'waiting_input'].includes(String(chunk.task_state.task_status)),
          });
          if (chunk.task_state.task_status === 'quota_waiting') {
            wasQuotaWaiting = true;
            const reason = safeStageText(chunk.task_state.reason || '模型服务限流等待，可稍后继续。');
            setTunnels(prev => prev.map(t => t.id === employee.id.toString()
              ? { ...t, status: '限流等待', outputLines: appendTraceLine(t.outputLines, reason), isComplete: true }
              : t));
            setOrbState('idle');
          }
          mergeTaskState(targetSessionId, chunk.task_state);
          appendProgressStage(targetSessionId, singleSpeaker(), taskStateStage(chunk.task_state));
          continue;
        }
        if (chunk.event_type === 'openatlas.trace' || chunk.trace) {
          const line = formatTraceLine(chunk.trace || chunk);
          appendProgressStage(targetSessionId, singleSpeaker(), traceStage(chunk.trace || chunk));
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, outputLines: appendTraceLine(t.outputLines, line) }
            : t));
          continue;
        }
        if (chunk.event_type === 'openatlas.tool_blocked' || chunk.blocked === true) {
          const reason = safeStageText(chunk.reason || chunk.blocked_reason || '该工具不在当前员工授权范围内。');
          appendProgressStage(targetSessionId, singleSpeaker(), {
            id: `tool-blocked:${chunk.tool_name || chunk.name || chunk.command || Date.now()}`,
            kind: 'tool',
            status: 'failed',
            title: '工具被权限策略阻断',
            detail: reason,
            meta: '权限',
          });
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, status: '权限阻断', outputLines: appendTraceLine(t.outputLines, reason) }
            : t));
          continue;
        }
        if (chunk.approval_required) {
          const approval = chunk.approval_required;
          const runId = approval.hermes_run_id || approval.run_id;
          if (!isActionableHermesApproval(approval)) {
            appendProgressStage(targetSessionId, singleSpeaker(), {
              id: `approval-diagnostic:${Date.now()}`,
              kind: 'info',
              status: 'running',
              title: '运行诊断',
              detail: approval.description || approval.command || '收到非 Hermes 原生审批信号，已忽略。',
              meta: '诊断',
            });
            continue;
          }
          setSessionRunState(targetSessionId, {
            isProcessing: false,
            status: 'waiting_approval',
            pendingApproval: { ...approval, session_id: targetSessionId || undefined },
            reason: approval.description || approval.command || 'Hermes 请求人工确认。',
          });
          if (targetSessionId) {
            enqueueSessionTodo({
              id: `approval:${approval.approval_id || runId || approval.command || targetSessionId}`,
              sid: targetSessionId,
              type: 'approval',
              title: '等待人工确认',
              detail: approval.description || approval.command || 'Hermes 请求确认高风险或不确定操作。',
              approval: { ...approval, session_id: targetSessionId },
              createdAt: Date.now(),
            });
          }
          appendProgressStage(targetSessionId, singleSpeaker(), {
            id: `approval:${approval.approval_id || runId || approval.command || 'pending'}`,
            kind: 'approval',
            status: 'waiting',
            title: '等待人工确认',
            detail: approval.description || approval.command || 'Hermes 请求确认高风险或不确定操作。',
            meta: '审批',
          });
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, status: '等待确认', outputLines: appendTraceLine(t.outputLines, `等待人工确认 · ${approval.description || approval.command || '高风险操作'}`) }
            : t));
          const choice = await requestApprovalChoiceInline(approval, targetSessionId);
          if (runId) {
            try {
              await approveHermesRun(String(runId), choice, choice === 'always', approval.approval_id);
              if (targetSessionId) removeSessionTodo(targetSessionId, `approval:${approval.approval_id || runId || approval.command || targetSessionId}`);
              setSessionRunState(targetSessionId, {
                isProcessing: choice !== 'deny',
                status: choice === 'deny' ? 'failed' : 'running',
                pendingApproval: null,
                reason: approvalChoiceText(choice),
              });
              setTunnels(prev => prev.map(t => t.id === employee.id.toString()
                ? { ...t, status: choice === 'deny' ? '已拒绝' : '继续执行', outputLines: appendTraceLine(t.outputLines, approvalChoiceText(choice)) }
                : t));
              appendProgressStage(targetSessionId, singleSpeaker(), {
                id: `approval:${approval.approval_id || runId || approval.command || 'pending'}`,
                kind: 'approval',
                status: choice === 'deny' ? 'failed' : 'completed',
                title: choice === 'deny' ? '审批已拒绝' : '审批已通过',
                detail: approvalChoiceText(choice),
                meta: '审批',
              });
            } catch (err: any) {
              if (isStaleApprovalError(err)) {
                if (targetSessionId) removeSessionTodo(targetSessionId, `approval:${approval.approval_id || runId || approval.command || targetSessionId}`);
                setPendingApproval(null);
                setSessionRunState(targetSessionId, {
                  isProcessing: true,
                  status: 'running',
                  pendingApproval: null,
                  reason: '审批已不再等待，正在同步最新状态。',
                });
                message.info('审批已过期或已被 Hermes 处理，正在同步最新状态。');
              } else {
                setTunnels(prev => prev.map(t => t.id === employee.id.toString()
                  ? { ...t, status: '审批失败', outputLines: appendTraceLine(t.outputLines, `审批提交失败 · ${err?.message || err}`) }
                  : t));
              }
            }
          }
          continue;
        }
        if (chunk.approval_responded) {
          const choice = chunk.approval_responded.choice || '';
          const reason = safeStageText(chunk.approval_responded.reason || '');
          const policyBlocked = choice === 'deny' && /blocked_by_employee_toolsets|权限|toolsets|not allowed/i.test(reason);
          appendProgressStage(targetSessionId, singleSpeaker(), {
            id: `approval:responded:${choice}`,
            kind: policyBlocked ? 'tool' : 'approval',
            status: choice === 'deny' ? 'failed' : 'completed',
            title: policyBlocked ? '工具权限策略已执行' : '审批响应已同步',
            detail: policyBlocked ? reason : `审批选择：${choice}`,
            meta: policyBlocked ? '权限' : '审批',
          });
          setTunnels(prev => prev.map(t => t.id === employee.id.toString()
            ? { ...t, outputLines: appendTraceLine(t.outputLines, policyBlocked ? `权限策略阻断 · ${reason}` : `审批响应 · ${choice}`) }
            : t));
          continue;
        }
        if (chunk.reasoning?.text) {
          const reasoningText = String(chunk.reasoning.text);
          appendProgressStage(targetSessionId, singleSpeaker(), {
            id: `reasoning:${reasoningText.slice(0, 60)}`,
            kind: 'reasoning',
            status: 'completed',
            title: '思考摘要已更新',
            detail: reasoningText.slice(0, 140),
            meta: '思考',
          });
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
        if (chunk.event_type === 'openatlas.artifacts' || chunk.artifacts?.length) {
          mergeLiveArtifacts(targetSessionId, chunk.artifacts || chunk.items || []);
          const count = (chunk.artifacts || chunk.items || []).length;
          appendProgressStage(targetSessionId, singleSpeaker(), {
            id: `artifact:${count}:${Date.now()}`,
            kind: 'artifact',
            status: 'completed',
            title: '交付物已入库',
            detail: count > 0 ? `本轮新增 ${count} 个交付物，可在右侧总结/交付物区域查看。` : '检测到新的交付物事件。',
            meta: '输出',
            action: 'outputs',
            actionLabel: '查看',
          });
          continue;
        }
        if (chunk.event_type === 'openatlas.context' || chunk.skills || chunk.memories) {
          mergeLiveContext(targetSessionId, chunk);
          const skillCount = Array.isArray(chunk.skills) ? chunk.skills.length : 0;
          const memoryCount = Array.isArray(chunk.memories) ? chunk.memories.length : 0;
          const fileCount = Array.isArray(chunk.files) ? chunk.files.length : 0;
          appendProgressStage(targetSessionId, singleSpeaker(), {
            id: `context:${skillCount}:${memoryCount}:${fileCount}`,
            kind: 'context',
            status: 'completed',
            title: '上下文已注入',
            detail: `Skill ${skillCount} 个，记忆 ${memoryCount} 条，文件 ${fileCount} 个。`,
            meta: '输入',
          });
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
          appendProgressStage(targetSessionId, singleSpeaker(), {
            id: `files:${injected.map((f) => f.id || f.name).join('|')}`,
            kind: 'context',
            status: 'completed',
            title: '附件内容已准备',
            detail: injected.map((f) => `${f.name || '文件'}${f.extracted_chars ? ` · ${f.extracted_chars} 字` : ''}`).join('\n'),
            meta: '文件',
          });
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
          appendProgressStage(targetSessionId, singleSpeaker(), toolStage(t));
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
        if (!fullResponse) {
          appendProgressStage(targetSessionId, singleSpeaker(), {
            id: 'runtime:first-token',
            kind: 'runtime',
            status: 'running',
            title: '开始生成回复',
            detail: '已收到模型输出，正在流式渲染。',
            meta: '输出',
          });
        }
        fullResponse += chunk.content;
        setMessages((prev: Msg[]) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === employee.id.toString()) {
            return [...prev.slice(0, -1), { ...lastMsg, text: fullResponse, tools: toolCalls.length ? [...toolCalls] : lastMsg.tools, ...assistantUsage }];
          }
          return [...prev, { role: employee.id.toString(), sender: employee.name, avatar: employee.avatar, color: employee.color, text: fullResponse, tools: toolCalls.length ? [...toolCalls] : undefined, ...assistantUsage }];
        }, targetSessionId);
      }

      if (!wasAborted && !wasQuotaWaiting) {
        appendProgressStage(targetSessionId, singleSpeaker(), {
          id: 'runtime:done',
          kind: 'done',
          status: 'completed',
          title: '本轮任务完成',
          detail: fullResponse.length > 0 ? `已生成 ${fullResponse.length} 字回复。` : 'Hermes 已结束本轮运行。',
          meta: '完成',
          action: 'outputs',
          actionLabel: '交付物',
        });
        setMessages((prev: Msg[]) => prev.map((m) => (
          m.role === employee.id.toString() ? { ...m, progressStages: settleProgressStages(m.progressStages) } : m
        )), targetSessionId);
        setTunnels(prev => prev.map(t => t.id === employee.id.toString()
          ? { ...t, status: '完成', outputLines: appendTraceLine(t.outputLines, `生成回复完成 · ${fullResponse.length} 字`), isComplete: true }
          : t));
        setOrbState('speaking');
        await new Promise(r => setTimeout(r, 300));
      }
      setSessionRunState(targetSessionId, {
        isProcessing: false,
        status: wasAborted ? 'stopped' : wasQuotaWaiting ? 'quota_waiting' : 'completed',
        reason: wasAborted ? '用户已停止当前任务。' : wasQuotaWaiting ? '模型服务限流等待。' : '本轮任务完成。',
      });
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
      clearSessionRuntime(targetSessionId);
      setOrbState('idle');
      setIsProcessing(false);

      // 刷新会话列表（让新建的/更新的会话标题/时间排到最前）
      await loadConversations();
      if (targetSessionId) {
        fetchConversationDetail(targetSessionId).then((detail) => hydrateSessionFromDetail(detail, targetSessionId)).catch(() => {});
      }

    } catch (error: any) {
      if (error?.name === 'AbortError') {
        console.debug('[Chat] aborted by explicit stop');
      } else {
        console.error('Chat error:', error);
        if (!targetSessionId) {
          setActiveSessionIdSafe(null);
          setDispatchCid(null); // Bug #2 修复:chat 失败清 dispatch
        }
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        setMessages((prev: Msg[]) => [...prev, {
          role: 'atlas',
          sender: 'Atlas',
          avatar: 'A',
          color: '#EF4444',
          text: `抱歉，处理您的请求时出现错误：${errorMessage}`
        }], targetSessionId || activeSessionId);
        appendProgressStage(targetSessionId || activeSessionId, {
          role: employee.id.toString(),
          sender: employee.name,
          avatar: employee.avatar,
          color: employee.color,
        }, {
          id: `runtime:error:${Date.now()}`,
          kind: 'runtime',
          status: 'failed',
          title: '运行失败',
          detail: errorMessage,
          meta: '错误',
          action: 'replay',
          actionLabel: '回放',
        });
        setTunnels(prev => prev.map(t => t.id === employee.id.toString() ? { ...t, status: '失败', isComplete: true } : t));
        setSessionRunState(targetSessionId || activeSessionId, {
          isProcessing: false,
          status: 'failed',
          reason: errorMessage,
        });
      }
    }

    stopHeartbeat?.();
    if (streamAbortRef.current === ac) {
      streamAbortRef.current = null;
    }
    if (targetSessionId) {
      clearSessionRuntime(targetSessionId);
      const queuedSid = targetSessionId;
      window.setTimeout(() => drainQueuedRunRef.current?.(queuedSid), 300);
    }
    activeHermesRunIdsRef.current.clear();
    setOrbState('idle');
    setIsProcessing(false);
  }, [activeEmployee, pendingAttachments, loadConversations, user, activeSessionId, allEmployees, markInjectedFiles, mergeLiveArtifacts, mergeLiveContext, mergeTaskState, markSessionBackgroundSync, rememberSessionMeta, hydrateSessionFromDetail, reasoningEffort, requestApprovalChoiceInline, appendProgressStage, startProgressHeartbeat, setSessionRunState, setSessionAbortController, addSessionHermesRunId, clearSessionRuntime, enqueueSessionTodo, removeSessionTodo]);

  // ─────────────────────────────────────────────────────────────────────
  // M4.2 (Group Chat): 群聊 dispatch — 用 conversationChatStream 替代 chatWithEmployeeStream
  // 接力员工循环:每个员工独立 stream + 写新 Message
  // ─────────────────────────────────────────────────────────────────────
  const simulateGroupDispatch = useCallback(async (
    userInput: string,
    primaryEmp: typeof activeEmployee,
    relays: Employee[],
    options?: { attachments?: Attachment[]; targetSessionId?: string | null },
  ) => {
    if (!primaryEmp) return;

    setOrbState('thinking');
    const attachmentsToSend = options?.attachments ?? pendingAttachments;
    if (!options?.attachments) setPendingAttachments([]);

    // P3.12 3.4.3: 新建 AbortController 接管流, 切会话自动 abort
    const ac = new AbortController();
    let stopHeartbeat: (() => void) | null = null;
    let convId: string | null = options?.targetSessionId ?? activeSessionId;

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
	      convId = convId || activeSessionId;
	      const primaryRealId = (primaryEmp as any).uuid || String(primaryEmp.id);
	      const relayRealIds = relays.map((r: any) => r.__id || r.uuid || String(r.id));
	      if (!convId) {
	        const group = await createGroupConversation(
	          primaryRealId,
	          relayRealIds,
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
      setSessionRunState(convId, {
        isProcessing: true,
        status: 'running',
        reason: `${primaryEmp.name} 正在组织 ${relays.length + 1} 位员工接力。`,
      });
      setSessionAbortController(convId, ac);
      streamAbortRef.current = ac;

      // 调会话级流式端点
	      const stream = conversationChatStream(
	        primaryRealId,
	        userInput,
	        {
	          sessionId: convId,
	          relayEmployeeIds: relayRealIds,
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
      let wasQuotaWaiting = false;
      let lastStreamEventAt = Date.now();
      const stageSpeakerFor = () => {
        const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
        return {
          role: String(activeAgentId),
          sender: activeEmp.name,
          avatar: activeEmp.avatar,
          color: activeEmp.color,
        };
      };
      appendProgressStage(convId, stageSpeakerFor(), {
        id: 'runtime:group-accepted',
        kind: 'handoff',
        status: 'running',
        title: `${primaryEmp.name} 已接管群聊任务`,
        detail: relays.length > 0
          ? `准备接力 ${relays.map((r) => r.name).join('、')}。`
          : '正在启动 Hermes 群聊执行。',
        meta: '接力',
      });
      stopHeartbeat = startProgressHeartbeat(() => convId, stageSpeakerFor, () => lastStreamEventAt);

      for await (const chunk of stream) {
        lastStreamEventAt = Date.now();
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
        if (chunk.event_type === 'openatlas.capability_plan' || chunk.capability_plan) {
          const plan = chunk.capability_plan || {};
          const policy = chunk.collaboration_policy || {};
          mergeTaskState(convId, {
            task_status: 'running',
            reason: plan.summary || '能力清单已生成',
            capability_plan: plan,
            collaboration_policy: policy,
          });
          appendProgressStage(convId, stageSpeakerFor(), capabilityPlanStage(plan, policy));
          setTunnels(prev => prev.map(t => t.isComplete ? t : {
            ...t,
            outputLines: appendTraceLine(t.outputLines, plan.summary || '能力清单已生成'),
          }));
          continue;
        }
        if (chunk.event_type === 'run.started') {
          const runId = chunk.hermes_run_id || chunk.run_id;
          const runSpeakerId = String(chunk.speaker_employee_id || activeAgentId);
          if (chunk.speaker_employee_id) {
            activeAgentId = runSpeakerId;
            activeSpeakerName = chunk.speaker_name || activeSpeakerName;
          }
          if (runId) {
            addSessionHermesRunId(convId, String(runId));
            activeHermesRunIdsRef.current.add(String(runId));
            const activeEmp = employeeForSpeaker(runSpeakerId, chunk.speaker_name || activeSpeakerName);
            appendProgressStage(convId, stageSpeakerFor(), {
              id: `runtime:run:${runId}`,
              kind: 'runtime',
              status: 'running',
              title: `${activeEmp.name} 开始执行`,
              detail: '已进入执行链路，正在接收模型、工具和文件事件。',
              meta: '执行',
            });
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
          if (idleSpeakerId) activeAgentId = idleSpeakerId;
          activeSpeakerName = chunk.speaker_name || activeSpeakerName;
          const idleEmp = employeeForSpeaker(idleSpeakerId, chunk.speaker_name || activeSpeakerName);
          const line = chunk.message || (chunk.detached ? 'Hermes 后台继续运行，Atlas 会自动同步' : 'Hermes 暂无新事件，继续等待');
          const idleMs = Number(chunk.idle_seconds || 0) > 0 ? Number(chunk.idle_seconds) * 1000 : Date.now() - lastStreamEventAt;
          markSessionBackgroundSync(convId);
          setSessionRunState(convId, {
            isProcessing: !chunk.detached,
            status: chunk.detached ? 'stalled' : 'running',
            reason: line,
          });
          mergeTaskState(convId, {
            task_status: chunk.detached ? 'stalled' : 'running',
            reason: line,
          });
          appendProgressStage(convId, stageSpeakerFor(), waitStage(idleMs, !!chunk.detached));
          setTunnels(prev => prev.map(t =>
            t.id === String(idleEmp.id) || t.name === idleEmp.name
              ? { ...t, status: chunk.detached ? '后台运行' : '运行中', outputLines: appendTraceLine(t.outputLines, line), isComplete: !!chunk.detached }
              : t
          ));
          continue;
        }
        if (chunk.task_state?.task_status) {
          setSessionRunState(convId, {
            isProcessing: !SESSION_TERMINAL_STATUSES.has(String(chunk.task_state.task_status)) && !['needs_input', 'waiting_input', 'waiting_approval', 'quota_waiting', 'stalled'].includes(String(chunk.task_state.task_status)),
            status: String(chunk.task_state.task_status),
            reason: chunk.task_state.reason || chunk.task_state.task_summary,
            needsInput: ['needs_input', 'waiting_input'].includes(String(chunk.task_state.task_status)),
          });
          if (chunk.task_state.task_status === 'quota_waiting') {
            wasQuotaWaiting = true;
            const reason = safeStageText(chunk.task_state.reason || '模型服务限流等待，可稍后继续。');
            setTunnels(prev => prev.map(t =>
              t.id === String(activeAgentId) || t.name === activeSpeakerName
                ? { ...t, status: '限流等待', outputLines: appendTraceLine(t.outputLines, reason), isComplete: true }
                : t
            ));
            setOrbState('idle');
          }
          mergeTaskState(convId, chunk.task_state);
          appendProgressStage(convId, stageSpeakerFor(), taskStateStage(chunk.task_state));
          continue;
        }
        if (chunk.conversation_id) {
          setActiveSessionIdSafe(chunk.conversation_id);
          setDispatchCid(chunk.conversation_id);
        }
        if (chunk.event_type === 'openatlas.artifacts' || chunk.artifacts?.length) {
          mergeLiveArtifacts(convId, chunk.artifacts || chunk.items || []);
          const count = (chunk.artifacts || chunk.items || []).length;
          appendProgressStage(convId, stageSpeakerFor(), {
            id: `artifact:${count}:${Date.now()}`,
            kind: 'artifact',
            status: 'completed',
            title: '交付物已入库',
            detail: count > 0 ? `本轮新增 ${count} 个交付物，可在右侧总结/交付物区域查看。` : '检测到新的交付物事件。',
            meta: '输出',
            action: 'outputs',
            actionLabel: '查看',
          });
          continue;
        }
        if (chunk.event_type === 'openatlas.context' || chunk.skills || chunk.memories) {
          mergeLiveContext(convId, chunk);
          const skillCount = Array.isArray(chunk.skills) ? chunk.skills.length : 0;
          const memoryCount = Array.isArray(chunk.memories) ? chunk.memories.length : 0;
          const fileCount = Array.isArray(chunk.files) ? chunk.files.length : 0;
          appendProgressStage(convId, stageSpeakerFor(), {
            id: `context:${skillCount}:${memoryCount}:${fileCount}`,
            kind: 'context',
            status: 'completed',
            title: '上下文已注入',
            detail: `Skill ${skillCount} 个，记忆 ${memoryCount} 条，文件 ${fileCount} 个。`,
            meta: '输入',
          });
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
          appendProgressStage(convId, stageSpeakerFor(), {
            id: `files:${injected.map((f) => f.id || f.name).join('|')}`,
            kind: 'context',
            status: 'completed',
            title: '附件内容已准备',
            detail: injected.map((f) => `${f.name || '文件'}${f.extracted_chars ? ` · ${f.extracted_chars} 字` : ''}`).join('\n'),
            meta: '文件',
          });
          continue;
        }

        // 切发言员工
        const chunkSpeakerId = chunk.speaker_employee_id || chunk.agent_id || chunk.employee_id || chunk.speaker?.employee_id || chunk.speaker?.id;
        const chunkSpeakerName = chunk.speaker_name || chunk.agent_name || chunk.employee_name || chunk.speaker?.name;
        if (chunkSpeakerId && String(chunkSpeakerId) !== activeAgentId) {
          activeAgentId = String(chunkSpeakerId);
          activeSpeakerName = chunkSpeakerName || activeSpeakerName;
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          ensureSpeakerMessage(convId, {
            role: activeAgentId,
            sender: activeEmp.name,
            avatar: activeEmp.avatar,
            color: activeEmp.color,
          }, {
            text: fullByAgent.get(activeAgentId) || '',
            tools: toolByAgent.get(activeAgentId),
            ...usageByAgent.get(activeAgentId),
          });
        }

        if (chunk.event_type === 'openatlas.trace' || chunk.trace) {
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          const line = formatTraceLine(chunk.trace || chunk);
          appendProgressStage(convId, stageSpeakerFor(), traceStage(chunk.trace || chunk));
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, outputLines: appendTraceLine(t.outputLines, line) }
              : t
          ));
          continue;
        }
        if (chunk.event_type === 'openatlas.tool_blocked' || chunk.blocked === true) {
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          const reason = safeStageText(chunk.reason || chunk.blocked_reason || '该工具不在当前员工授权范围内。');
          appendProgressStage(convId, stageSpeakerFor(), {
            id: `tool-blocked:${chunk.tool_name || chunk.name || chunk.command || Date.now()}`,
            kind: 'tool',
            status: 'failed',
            title: '工具被权限策略阻断',
            detail: reason,
            meta: '权限',
          });
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, status: '权限阻断', outputLines: appendTraceLine(t.outputLines, reason) }
              : t
          ));
          continue;
        }

        if (chunk.approval_required) {
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          const approval = chunk.approval_required;
          const runId = approval.hermes_run_id || approval.run_id;
          if (!isActionableHermesApproval(approval)) {
            appendProgressStage(convId, stageSpeakerFor(), {
              id: `approval-diagnostic:${Date.now()}`,
              kind: 'info',
              status: 'running',
              title: '运行诊断',
              detail: approval.description || approval.command || '收到非 Hermes 原生审批信号，已忽略。',
              meta: '诊断',
            });
            continue;
          }
          setSessionRunState(convId, {
            isProcessing: false,
            status: 'waiting_approval',
            pendingApproval: { ...approval, session_id: convId || undefined },
            reason: approval.description || approval.command || 'Hermes 请求人工确认。',
          });
          if (convId) {
            enqueueSessionTodo({
              id: `approval:${approval.approval_id || runId || approval.command || convId}`,
              sid: convId,
              type: 'approval',
              title: '等待人工确认',
              detail: approval.description || approval.command || 'Hermes 请求确认高风险或不确定操作。',
              approval: { ...approval, session_id: convId },
              createdAt: Date.now(),
            });
          }
          appendProgressStage(convId, stageSpeakerFor(), {
            id: `approval:${approval.approval_id || runId || approval.command || 'pending'}`,
            kind: 'approval',
            status: 'waiting',
            title: '等待人工确认',
            detail: approval.description || approval.command || 'Hermes 请求确认高风险或不确定操作。',
            meta: '审批',
          });
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, status: '等待确认', outputLines: appendTraceLine(t.outputLines, `等待人工确认 · ${approval.description || approval.command || '高风险操作'}`) }
              : t
          ));
          const choice = await requestApprovalChoiceInline(approval, convId);
          if (runId) {
            try {
                await approveHermesRun(String(runId), choice, choice === 'always', approval.approval_id);
                if (convId) removeSessionTodo(convId, `approval:${approval.approval_id || runId || approval.command || convId}`);
                setSessionRunState(convId, {
                  isProcessing: choice !== 'deny',
                  status: choice === 'deny' ? 'failed' : 'running',
                  pendingApproval: null,
                  reason: approvalChoiceText(choice),
                });
                setTunnels(prev => prev.map(t =>
                t.id === String(activeEmp.id) || t.name === activeEmp.name
                  ? { ...t, status: choice === 'deny' ? '已拒绝' : '继续执行', outputLines: appendTraceLine(t.outputLines, approvalChoiceText(choice)) }
                  : t
              ));
              appendProgressStage(convId, stageSpeakerFor(), {
                id: `approval:${approval.approval_id || runId || approval.command || 'pending'}`,
                kind: 'approval',
                status: choice === 'deny' ? 'failed' : 'completed',
                title: choice === 'deny' ? '审批已拒绝' : '审批已通过',
                detail: approvalChoiceText(choice),
                meta: '审批',
              });
            } catch (err: any) {
              if (isStaleApprovalError(err)) {
                if (convId) removeSessionTodo(convId, `approval:${approval.approval_id || runId || approval.command || convId}`);
                setPendingApproval(null);
                setSessionRunState(convId, {
                  isProcessing: true,
                  status: 'running',
                  pendingApproval: null,
                  reason: '审批已不再等待，正在同步最新状态。',
                });
                message.info('审批已过期或已被 Hermes 处理，正在同步最新状态。');
              } else {
                setTunnels(prev => prev.map(t =>
                  t.id === String(activeEmp.id) || t.name === activeEmp.name
                    ? { ...t, status: '审批失败', outputLines: appendTraceLine(t.outputLines, `审批提交失败 · ${err?.message || err}`) }
                    : t
                ));
              }
            }
          }
          continue;
        }

        if (chunk.approval_responded) {
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          const choice = chunk.approval_responded.choice || '';
          const reason = safeStageText(chunk.approval_responded.reason || '');
          const policyBlocked = choice === 'deny' && /blocked_by_employee_toolsets|权限|toolsets|not allowed/i.test(reason);
          appendProgressStage(convId, stageSpeakerFor(), {
            id: `approval:responded:${choice}`,
            kind: policyBlocked ? 'tool' : 'approval',
            status: choice === 'deny' ? 'failed' : 'completed',
            title: policyBlocked ? '工具权限策略已执行' : '审批响应已同步',
            detail: policyBlocked ? reason : `审批选择：${choice}`,
            meta: policyBlocked ? '权限' : '审批',
          });
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, outputLines: appendTraceLine(t.outputLines, policyBlocked ? `权限策略阻断 · ${reason}` : `审批响应 · ${choice}`) }
              : t
          ));
          continue;
        }

        if (chunk.reasoning?.text) {
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          const reasoningText = String(chunk.reasoning.text);
          appendProgressStage(convId, stageSpeakerFor(), {
            id: `reasoning:${reasoningText.slice(0, 60)}`,
            kind: 'reasoning',
            status: 'completed',
            title: '思考摘要已更新',
            detail: reasoningText.slice(0, 140),
            meta: '思考',
          });
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
          activeSpeakerName = chunkSpeakerName || activeSpeakerName;
          setOrbState('thinking');
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          ensureSpeakerMessage(convId, {
            role: activeAgentId,
            sender: activeEmp.name,
            avatar: activeEmp.avatar,
            color: activeEmp.color,
          }, {
            text: fullByAgent.get(activeAgentId) || '',
            tools: toolByAgent.get(activeAgentId),
            ...usageByAgent.get(activeAgentId),
          });
          appendProgressStage(convId, stageSpeakerFor(), {
            id: `agent:${activeAgentId}:join`,
            kind: 'handoff',
            status: 'running',
            title: `${activeEmp.name} 开始接力`,
            detail: '上一位员工的上下文已传入，当前员工开始处理自己的部分。',
            meta: '接力',
          });
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name
              ? { ...t, status: '思考中', outputLines: appendTraceLine(t.outputLines, '接收问题...') }
              : t
          ));
          continue;
        }
        if (chunk.event_type === 'agent_leave') {
          const txt = fullByAgent.get(activeAgentId) || '';
          const activeEmp = employeeForSpeaker(activeAgentId, activeSpeakerName);
          appendProgressStage(convId, stageSpeakerFor(), {
            id: `agent:${activeAgentId}:leave`,
            kind: 'handoff',
            status: 'completed',
            title: `${activeEmp.name} 已完成本棒`,
            detail: txt.length > 0 ? `本棒已输出 ${txt.length} 字。` : '已交棒给下一位员工。',
            meta: '接力',
          });
          setTunnels(prev => prev.map(t =>
            t.id === String(activeEmp.id) || t.name === activeEmp.name ? {
              ...t, status: '完成',
              outputLines: appendTraceLine(t.outputLines, '生成回复完成 · ' + txt.length + ' 字'),
              isComplete: true,
            } : t
          ));
          continue;
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
          appendProgressStage(convId, stageSpeakerFor(), toolStage(chunk.tool));
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
          if (!fullByAgent.get(activeAgentId)) {
            appendProgressStage(convId, stageSpeakerFor(), {
              id: `runtime:first-token:${activeAgentId}`,
              kind: 'runtime',
              status: 'running',
              title: `${activeSpeakerName} 开始生成回复`,
              detail: '已收到模型输出，正在流式渲染。',
              meta: '输出',
            });
          }
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

      if (!wasAborted && !wasQuotaWaiting) {
        appendProgressStage(convId, stageSpeakerFor(), {
          id: 'runtime:group-done',
          kind: 'done',
          status: 'completed',
          title: '群聊接力完成',
          detail: `本轮共有 ${1 + relays.length} 位员工参与。`,
          meta: '完成',
          action: 'outputs',
          actionLabel: '交付物',
        });
        setMessages((prev: Msg[]) => prev.map((m) => (
          m.role !== 'user' ? { ...m, progressStages: settleProgressStages(m.progressStages) } : m
        )), convId);
        setOrbState('speaking');
        await new Promise(r => setTimeout(r, 300));
      }
      setSessionRunState(convId, {
        isProcessing: false,
        status: wasAborted ? 'stopped' : wasQuotaWaiting ? 'quota_waiting' : 'completed',
        reason: wasAborted ? '用户已停止当前任务。' : wasQuotaWaiting ? '模型服务限流等待。' : '群聊接力完成。',
      });
      setOrbState('idle');

      // 收尾:刷新会话列表(因为新群聊会话已建)
      await loadConversations();
      if (convId) {
        fetchConversationDetail(convId).then((detail) => hydrateSessionFromDetail(detail, convId)).catch(() => {});
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        console.debug('[M4.2] group chat aborted by explicit stop');
      } else {
        console.error('[M4.2] group chat error:', e);
        message.error(`群聊失败: ${e instanceof Error ? e.message : '未知错误'}`);
        appendProgressStage(convId || activeSessionId, {
          role: String(primaryEmp.id),
          sender: primaryEmp.name,
          avatar: primaryEmp.avatar,
          color: primaryEmp.color,
        }, {
          id: `runtime:group-error:${Date.now()}`,
          kind: 'runtime',
          status: 'failed',
          title: '群聊接力失败',
          detail: e instanceof Error ? e.message : '未知错误',
          meta: '错误',
          action: 'replay',
          actionLabel: '回放',
        });
        setSessionRunState(convId || activeSessionId, {
          isProcessing: false,
          status: 'failed',
          reason: e instanceof Error ? e.message : '未知错误',
        });
      }
      setOrbState('idle');
    } finally {
      stopHeartbeat?.();
      if (streamAbortRef.current === ac) {
        streamAbortRef.current = null;
      }
      if (convId) {
        clearSessionRuntime(convId);
        const queuedSid = convId;
        window.setTimeout(() => drainQueuedRunRef.current?.(queuedSid), 300);
      }
      activeHermesRunIdsRef.current.clear();
      // 清空接力 chips
      setRelayEmployeeIds([]);
      setRelayChips([]);
      setIsProcessing(false);
    }
  }, [pendingAttachments, loadConversations, user, employeeForSpeaker, activeSessionId, markInjectedFiles, mergeLiveArtifacts, mergeLiveContext, mergeTaskState, markSessionBackgroundSync, rememberSessionMeta, hydrateSessionFromDetail, reasoningEffort, requestApprovalChoiceInline, appendProgressStage, startProgressHeartbeat, setSessionRunState, setSessionAbortController, addSessionHermesRunId, clearSessionRuntime, enqueueSessionTodo, removeSessionTodo]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    let sessionBusy = activeSessionId ? isSessionBusy(activeSessionId) : false;
    if (activeSessionId && !sessionBusy && !getKnownSessionStatus(activeSessionId)) {
      try {
        const detail = await fetchConversationDetail(activeSessionId);
        const realSid = realSessionId(detail) || activeSessionId;
        rememberSessionMeta(detail, realSid);
        syncSessionRunStateFromDetail(detail, realSid);
        const nextStatus = String(detail?.progress?.status || detail?.task_status || '');
        sessionBusy = SESSION_BUSY_STATUSES.has(nextStatus);
      } catch (e) {
        console.warn('[send guard] failed to refresh session status before send:', e);
      }
    }
    if (activeSessionId && sessionBusy) {
      setRunConflictDraft({
        sid: activeSessionId,
        text,
        attachments: [...pendingAttachments],
        primaryEmployee: relayChips.length > 0 ? toEmployeeChip(relayChips[0]) : activeEmployee,
        relayEmployees: relayChips.length > 0 ? relayChips.slice(1) : [],
      });
      return;
    }
    const displayName = user?.username || '用户';
    const attachmentsSnapshot = [...pendingAttachments];
    // Phase 2 Upload-Real：user message 带上 pending attachments
    const userMsg: Msg = {
      role: 'user',
      sender: displayName,
      avatar: displayName[0],
      color: '#6B7280',
      text,
      attachments: attachmentsSnapshot.length > 0 ? attachmentsSnapshot : undefined,
    };
    setMessages((prev: Msg[]) => [...prev, userMsg]);
    setInput('');
    setPendingAttachments([]);
    setIsProcessing(true);

    // M4.2 / Hermes-web-ui parity: first @mention owns this turn; remaining mentions relay.
    if (relayChips.length > 0) {
      const primaryEmp = toEmployeeChip(relayChips[0]);
      const relays = relayChips.slice(1);
      simulateGroupDispatch(text, primaryEmp, relays, { attachments: attachmentsSnapshot, targetSessionId: activeSessionId });
    } else {
      // 单聊兼容 M1-M3.5
      simulateDispatch(text, { attachments: attachmentsSnapshot, targetSessionId: activeSessionId });
    }
  }, [input, activeSessionId, isSessionBusy, getKnownSessionStatus, rememberSessionMeta, syncSessionRunStateFromDetail, simulateDispatch, simulateGroupDispatch, user, pendingAttachments, relayChips, activeEmployee]);

  const dispatchQueuedRunItem = useCallback((item: QueuedRunItem) => {
    const displayName = user?.username || '用户';
    const text = item.text;
    setActiveSessionIdSafe(item.sid);
    setDispatchCid(item.sid);
    setMessages((prev: Msg[]) => [...prev, {
      role: 'user',
      sender: displayName,
      avatar: displayName[0],
      color: '#6B7280',
      text,
      attachments: item.attachments && item.attachments.length > 0 ? item.attachments : undefined,
    }], item.sid);
    setSessionRunState(item.sid, {
      isProcessing: true,
      status: 'running',
      reason: '正在执行排队任务。',
    });
    setIsProcessing(true);
    if (item.relayEmployees && item.relayEmployees.length > 0) {
      simulateGroupDispatch(text, item.primaryEmployee || activeEmployee, item.relayEmployees, {
        attachments: item.attachments || [],
        targetSessionId: item.sid,
      });
    } else {
      simulateDispatch(text, {
        attachments: item.attachments || [],
        targetSessionId: item.sid,
      });
    }
  }, [activeEmployee, setActiveSessionIdSafe, setMessages, setSessionRunState, simulateDispatch, simulateGroupDispatch, user]);

  useEffect(() => {
    drainQueuedRunRef.current = (sid: string) => {
      const state = runStateBySessionRef.current[sid];
      const nextItem = state?.queue?.[0];
      if (!nextItem) return;
      if (isSessionBusy(sid)) return;
      setSessionRunState(sid, (prev) => ({
        ...prev,
        queue: (prev.queue || []).slice(1),
        status: 'running',
        isProcessing: true,
        reason: '正在处理排队输入。',
      }));
      window.setTimeout(() => dispatchQueuedRunItem(nextItem), 250);
    };
    return () => {
      drainQueuedRunRef.current = null;
    };
  }, [dispatchQueuedRunItem, isSessionBusy, setSessionRunState]);

  const enqueueConflictDraft = useCallback((intent: QueuedRunIntent) => {
    if (!runConflictDraft) return;
    const item: QueuedRunItem = {
      id: `queued:${runConflictDraft.sid}:${Date.now()}`,
      sid: runConflictDraft.sid,
      text: runConflictDraft.text,
      intent,
      attachments: runConflictDraft.attachments,
      primaryEmployee: runConflictDraft.primaryEmployee,
      relayEmployees: runConflictDraft.relayEmployees,
      createdAt: Date.now(),
    };
    setSessionRunState(runConflictDraft.sid, (prev) => ({
      ...prev,
      status: prev.status || 'queued',
      reason: '输入已排队，当前任务完成后继续执行。',
      queue: [...(prev.queue || []), item],
    }));
    setMessages((prev: Msg[]) => [...prev, {
      role: 'atlas',
      sender: 'Atlas',
      avatar: 'A',
      color: '#4F46E5',
      text: '已加入当前会话队列。当前任务完成后会自动继续处理这条输入。',
    }], runConflictDraft.sid);
    setInput('');
    setPendingAttachments([]);
    setRunConflictDraft(null);
    message.success('已加入会话队列');
  }, [runConflictDraft, setMessages, setSessionRunState]);

  const stopAndRerunConflictDraft = useCallback(async () => {
    if (!runConflictDraft) return;
    const item: QueuedRunItem = {
      id: `rerun:${runConflictDraft.sid}:${Date.now()}`,
      sid: runConflictDraft.sid,
      text: runConflictDraft.text,
      intent: 'queue',
      attachments: runConflictDraft.attachments,
      primaryEmployee: runConflictDraft.primaryEmployee,
      relayEmployees: runConflictDraft.relayEmployees,
      createdAt: Date.now(),
    };
    setRunConflictDraft(null);
    setInput('');
    setPendingAttachments([]);
    await handleAbortCurrentRun(runConflictDraft.sid);
    window.setTimeout(() => dispatchQueuedRunItem(item), 500);
  }, [dispatchQueuedRunItem, handleAbortCurrentRun, runConflictDraft]);

  const pendingGlobalTodos = SHOW_GLOBAL_SESSION_TODOS ? Object.values(sessionTodos).flat() : [];

  const openTodoSession = useCallback((todo: SessionTodo) => {
    const conv = conversations.find((item) => realSessionId(item) === todo.sid);
    if (conv) {
      void switchToConversation(conv);
    } else {
      void handleSwitchConversation(todo.sid);
    }
  }, [conversations, handleSwitchConversation, switchToConversation]);

  const approveTodo = useCallback(async (todo: SessionTodo, choice: ApprovalChoice) => {
    const approval = todo.approval;
    const runId = approval?.hermes_run_id || approval?.run_id;
    if (!runId) {
      message.warning('这个审批缺少 Hermes run id，请打开会话同步最新状态。');
      openTodoSession(todo);
      return;
    }
    try {
      await approveHermesRun(String(runId), choice, choice === 'always', approval?.approval_id);
      removeSessionTodo(todo.sid, todo.id);
      setSessionRunState(todo.sid, {
        isProcessing: choice !== 'deny',
        status: choice === 'deny' ? 'failed' : 'running',
        pendingApproval: null,
        reason: approvalChoiceText(choice),
      });
      message.success(choice === 'deny' ? '已拒绝后台审批' : '已通过后台审批，任务将继续执行');
      fetchConversationDetail(todo.sid)
        .then((detail) => hydrateSessionFromDetail(detail, realSessionId(detail) || todo.sid))
        .catch(() => {});
    } catch (e: any) {
      if (isStaleApprovalError(e)) {
        removeSessionTodo(todo.sid, todo.id);
        setSessionRunState(todo.sid, {
          isProcessing: true,
          status: 'running',
          pendingApproval: null,
          reason: '审批已不再等待，正在同步最新状态。',
        });
        message.info('审批已过期或已被 Hermes 处理，正在同步最新状态。');
        fetchConversationDetail(todo.sid)
          .then((detail) => hydrateSessionFromDetail(detail, realSessionId(detail) || todo.sid))
          .catch(() => {});
      } else {
        message.error(`审批提交失败：${e?.message || e}`);
      }
    }
  }, [hydrateSessionFromDetail, openTodoSession, removeSessionTodo, setSessionRunState]);

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
    const key = e.key.toLowerCase();
    const commandLike = e.metaKey || e.ctrlKey;
    if (commandLike && e.shiftKey && key === 'u') {
      e.preventDefault();
      if (!uploading) fileInputRef.current?.click();
      return;
    }
    if (commandLike && e.shiftKey && key === 'p') {
      e.preventDefault();
      if (!uploading) imageInputRef.current?.click();
      return;
    }
    if (isImeComposingEvent(e) || imeComposingRef.current) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const employeePool = (allEmployeesForMention.length > 0 ? allEmployeesForMention : allEmployees as any) as Employee[];
  const getEmployeeDockKey = (emp: Employee) => String((emp as any).__id || emp.id);
  const configuredDockEmployees = employeeDockIds
    .map((id) => employeePool.find((emp) => getEmployeeDockKey(emp) === id))
    .filter(Boolean) as Employee[];
  const commonDockEmployees = [...employeePool].sort((a: any, b: any) => {
    const score = (emp: any) =>
      Number(emp.conversation_count || 0) * 4
      + Number(emp.today_conversation_count || 0) * 8
      + Number(emp.total_messages || 0)
      + Number(emp.total_tokens || 0) / 1000;
    return score(b) - score(a);
  });
  const launchEmployees = (employeeDockIds.length > 0 ? configuredDockEmployees : commonDockEmployees).slice(0, 5);
  const userDisplayName = user?.username || user?.email?.split('@')[0] || '用户';
  const homeComposerPlaceholder = '输入需求，试试 @行政小六 帮你分诊，或直接 @投资研究分析师 开始任务...';
  const chatComposerPlaceholder = activeEmployee
    ? `给 ${activeEmployee.name} 发任务，也可以 @其他员工加入接力...`
    : '输入需求，试试 @行政小六 或 @市场竞品研究员...';
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
          选择首页 Dock 展示的员工，最多展示 5 个。未选择时自动展示前 5 个常用员工。
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
                        return prev.includes(key) ? prev : [...prev, key].slice(0, 5);
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
        <div style={{ padding: '34px 0', textAlign: 'center', color: 'var(--text-tertiary)', display: 'grid', gap: 14, justifyItems: 'center' }}>
          <div>
            <strong style={{ display: 'block', color: 'var(--text-primary)', fontSize: 15, marginBottom: 6 }}>还没有协作方案</strong>
            <span>先新建一个协作方案，添加员工节点并点击画布右上角“保存/另存为方案”。</span>
          </div>
          <button
            type="button"
            className="atlas-template-empty-action"
            onClick={handleNewCollaborationPlan}
          >
            新建协作方案
          </button>
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
                    {usingTemplateId === tpl.id ? '创建中…' : '使用方案创建作战室'}
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
      {canvasHubOpen && (
        <>
          <button
            className="atlas-canvas-hub-action atlas-canvas-hub-action--template"
            onClick={() => { setCanvasHubOpen(false); void handleOpenTemplateLibrary(); }}
            title="协作方案库"
            aria-label="打开协作方案库"
            data-collab-template-hub-action="true"
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
          >
            <HistoryOutlined />
            <span>回放</span>
          </button>
        </>
      )}
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

  const homeConversationRail = (
    <div
      className={`atlas-home-conversation-rail ${homeConversationRailOpen ? 'is-expanded' : 'is-collapsed'}`}
      style={{ '--home-rail-width': `${railPrefs.leftWidth}px` } as CSSProperties}
    >
      {!homeConversationRailOpen ? (
        <button
          type="button"
          className="atlas-home-rail-tab"
          onClick={() => setHomeConversationRailOpen(true)}
          aria-label="展开会话列表"
          title="展开会话列表"
        >
          <IconHistory size={15} />
          <span>会话</span>
        </button>
      ) : (
        <>
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
          <button
            type="button"
            className="atlas-home-rail-close"
            onClick={() => setHomeConversationRailOpen(false)}
            aria-label="收起会话列表"
            title="收起会话列表"
          >
            ‹
          </button>
          <div
            className="atlas-home-rail-resizer"
            onPointerDown={(e) => beginCommandRailResize('left', e)}
            onDoubleClick={() => resetCommandRailWidth('left')}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖拽调整会话列表宽度，双击恢复默认"
            title="拖拽调整会话列表宽度，双击恢复默认"
          />
        </>
      )}
    </div>
  );

  // =============== SCENE 1: Focus Mode (no messages) ===============
  if (!isWarRoom) {
    return (
      <div className="atlas-home-shell" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', position: 'relative' }}>
        {promptsModal}
        {shortcutSettingsModal}
        {templateLibraryModal}
        {collaborationCanvasLayer}
        {canvasHubLayer}
        {homeConversationRail}
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

            <div className="atlas-home-mention-wrap" style={{ position: 'relative' }}>
              <MentionPopover
                input={input}
                employees={allEmployeesForMention}
                selectedIds={relayEmployeeIds}
                onPick={handleMentionPick}
                onClose={handleMentionClose}
              />
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
              <button title="附件 · ⌘/Ctrl+Shift+U" disabled={uploading} onClick={() => fileInputRef.current?.click()}
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', borderRadius: 6, transition: 'all 0.15s ease', opacity: uploading ? 0.4 : 1 }}
                onMouseEnter={e => { (e.target as HTMLElement).closest('button')!.style.color = 'var(--accent)'; (e.target as HTMLElement).closest('button')!.style.background = 'var(--accent-soft)'; }}
                onMouseLeave={e => { (e.target as HTMLElement).closest('button')!.style.color = 'var(--text-tertiary)'; (e.target as HTMLElement).closest('button')!.style.background = 'transparent'; }}
              ><IconPaperclip size={18} /></button>
              {/* 图片按钮：真实 onClick */}
              <button title="图片 · ⌘/Ctrl+Shift+P" disabled={uploading} onClick={() => imageInputRef.current?.click()}
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', borderRadius: 6, transition: 'all 0.15s ease', opacity: uploading ? 0.4 : 1 }}
                onMouseEnter={e => { (e.target as HTMLElement).closest('button')!.style.color = 'var(--accent)'; (e.target as HTMLElement).closest('button')!.style.background = 'var(--accent-soft)'; }}
                onMouseLeave={e => { (e.target as HTMLElement).closest('button')!.style.color = 'var(--text-tertiary)'; (e.target as HTMLElement).closest('button')!.style.background = 'transparent'; }}
              ><IconImage size={18} /></button>
              {/* 语音按钮：灰掉 + tooltip */}
              <button title="语音输入 — 即将支持" disabled
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', borderRadius: 6, transition: 'all 0.15s ease', opacity: 0.3, cursor: 'not-allowed' }}
              ><IconMic size={18} /></button>
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onPaste={handlePasteUpload} placeholder={homeComposerPlaceholder} disabled={activeIsProcessing} rows={1}
                style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: 15, fontFamily: 'var(--font-family)', color: 'var(--text-primary)', background: 'transparent', lineHeight: 1.5, maxHeight: 140, minHeight: 24, padding: '6px 4px' }}
              />
              <button onClick={handleSend} disabled={!input.trim() || activeIsProcessing}
                style={{
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8,
                  color: input.trim() && !activeIsProcessing ? '#fff' : 'var(--text-tertiary)',
                  background: input.trim() && !activeIsProcessing ? 'var(--accent)' : 'transparent',
                  cursor: input.trim() && !activeIsProcessing ? 'pointer' : 'default',
                  opacity: input.trim() && !activeIsProcessing ? 1 : 0.5,
                  transition: 'all 0.15s ease',
                }}
              ><IconSend size={17} /></button>
              </div>
            </div>
            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}>
              Enter 发送 · Shift+Enter 换行 · 输入法确认不误发 · ⌘/Ctrl+V 粘贴上传 · ⌘/Ctrl+Shift+U 附件 · ⌘/Ctrl+Shift+P 图片
            </div>

            <section className="atlas-continuation-strip">
              <div className="atlas-continuation-head">
                <span><IconHistory size={12} /> 继续任务</span>
                <div className="atlas-continuation-actions">
                  <button
                    type="button"
                    className="atlas-continuation-history-btn"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setHomeConversationRailOpen((open) => !open);
                    }}
                  >
                    {homeConversationRailOpen ? '收起会话栏' : '展开会话栏'}
                  </button>
                  <button
                    type="button"
                    className="atlas-continuation-history-btn"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      navigate('/history');
                    }}
                  >
                    全部历史
                  </button>
                </div>
              </div>
              <div className="atlas-continuation-list">
                {continuationConversations.length > 0 ? continuationConversations.map((c) => (
                  <button key={c.id} className="atlas-continuation-pill" onClick={() => switchToConversation(c)} title={c.title || '新会话'}>
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
                    disabled={activeIsProcessing}
                  >
                    全部员工
                  </button>
                  <button
                    className="atlas-launchpad-link"
                    onClick={() => setDockSettingsOpen(true)}
                    disabled={activeIsProcessing}
                  >
                    自定义 Dock
                  </button>
                </div>
              </div>

              <div
                className="atlas-agent-grid"
                style={{ '--dock-count': Math.max(1, launchEmployees.length + 1) } as CSSProperties}
              >
                {launchEmployees.map((emp: Employee, index: number) => {
                  const color = emp.department?.color || ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#6366F1'][index % 6];
                  const skills = Array.isArray(emp.toolsets) ? emp.toolsets.slice(0, 1) : [];
                  return (
                    <button
                      key={(emp as any).__id || emp.id}
                      className="atlas-agent-card"
                      onClick={() => handleEmployeeShortcut(emp)}
                      disabled={activeIsProcessing}
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
                <div className="atlas-war-room-launch">
                  <button
                    className="atlas-agent-card atlas-agent-card--action"
                    onClick={() => {
                      setHomeConversationRailOpen(false);
                      setWarRoomMenuOpen((v) => !v);
                    }}
                    disabled={activeIsProcessing}
                    title="新建对话或作战室"
                  >
                    <span className="atlas-agent-card-glow" />
                    <div className="atlas-agent-card-main">
                      <span className="atlas-action-icon"><IconUsers size={20} /></span>
                      <span className="atlas-agent-copy">
                        <span className="atlas-agent-name">创建会话</span>
                        <span className="atlas-agent-role">单聊 · 作战室 · 方案</span>
                      </span>
                    </div>
                    <div className="atlas-agent-description">选择单聊、作战室，或从协作方案创建任务。</div>
                    <div className="atlas-agent-skill-row">
                      <span className="atlas-agent-skill">chat</span>
                      <span className="atlas-agent-skill">relay</span>
                    </div>
                  </button>
                  {warRoomMenuOpen && (
                    <div className="atlas-war-room-menu" role="menu">
                      <button type="button" onClick={handleWarRoomMenuSingle}>
                        <strong>新建单聊</strong>
                        <span>选择一个数智员工，进入专属会话。</span>
                      </button>
                      <button type="button" onClick={handleNewGroupConversation}>
                        <strong>新建群聊 / 作战室</strong>
                        <span>先开空作战室，再用 @ 选择多名员工接力。</span>
                      </button>
                      <button type="button" onClick={handleNewCollaborationPlan}>
                        <strong>新建协作方案</strong>
                        <span>打开画布编排员工节点，并保存为可复用方案。</span>
                      </button>
                      <button type="button" onClick={handleWarRoomMenuPlan}>
                        <strong>从方案库创建</strong>
                        <span>选择已保存方案，一键生成新的作战室。</span>
                      </button>
                    </div>
                  )}
                </div>
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
    activeIsProcessing ? 'processing' : 'idle',
    `messages:${messages.length}`,
    `last:${lastPetMessage?.role ?? 'none'}:${lastPetMessage?.text?.length ?? 0}`,
  ].join('|');
  const activeSessionMeta = activeSessionId ? sessionMetaById[activeSessionId] : undefined;
  const latestUserTask = [...messages].reverse().find((m) => m.role === 'user' && m.text.trim())?.text || '';
  const taskActivity = buildTaskActivity(activeSessionMeta, activeIsProcessing, latestUserTask, activeEmployee);

  return (
    <div className="atlas-command-center-layout" style={commandLayoutStyle}>
      {promptsModal}
      {templateLibraryModal}

      {/* ============================================================
          LEFT — Phase B 拆分:LeftAside (token --sider-width 控制宽度)
          ============================================================ */}
      <div className={`atlas-conversation-rail ${railPrefs.leftCollapsed ? 'is-collapsed' : ''}`}>
        {railPrefs.leftCollapsed ? (
          <button
            type="button"
            className="atlas-rail-collapsed-tab atlas-rail-collapsed-tab--left"
            onClick={() => toggleCommandRail('left')}
            aria-label="展开会话列表"
            title="展开会话列表"
          >
            会话
          </button>
        ) : (
          <>
            <LeftAside
              conversations={conversations}
              loading={loadingConvs}
              activeId={activeSessionId}
              onNew={handleNewConversation}
              onSelect={switchToConversation}
              onDelete={handleDeleteConversation}
              onPatch={handlePatchConversation}
            />
            <button
              type="button"
              className="atlas-rail-toggle atlas-rail-toggle--left"
              onClick={() => toggleCommandRail('left')}
              aria-label="收起会话列表"
              title="收起会话列表"
            >
              ‹
            </button>
            <div
              className="atlas-rail-resizer atlas-rail-resizer--left"
              onPointerDown={(e) => beginCommandRailResize('left', e)}
              onDoubleClick={() => resetCommandRailWidth('left')}
              role="separator"
              aria-orientation="vertical"
              aria-label="拖拽调整会话列表宽度，双击恢复默认"
              title="拖拽调整会话列表宽度，双击恢复默认"
            />
          </>
        )}
      </div>

      {/* ============================================================
          CENTER — Phase B 拆分:CenterMain (含 ChatHeader + messages + Composer)
          ============================================================ */}
      <div className="atlas-command-main">
        <CenterMain
          messages={messages}
          artifacts={activeSessionMeta?.artifacts || []}
          isProcessing={activeIsProcessing}
          input={input} setInput={setInput}
          pendingAttachments={pendingAttachments}
          uploading={uploading}
          onSend={handleSend}
          onAbort={handleAbortCurrentRun}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onPasteUpload={handlePasteUpload}
          onFileSelect={handleFileSelected}
          onRemoveAttachment={removePendingAttachment}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
          relayChips={relayChips}
          onRemoveRelay={handleRemoveRelay}
	          mentionEmployees={allEmployeesForMention}
	          mentionSelectedIds={relayEmployeeIds}
	          onMentionPick={handleMentionPick}
	          onMentionClose={handleMentionClose}
	          composerPlaceholder={chatComposerPlaceholder}
	          orbState={orbState}
          headerStyle={headerStyle}
          onStyleChange={handleStyleChange}
          pet={pet}
          onPetChange={handlePetChange}
          petAwakeSignal={petAwakeSignal}
          profile={getProfileMode()}
          activeEmployee={activeEmployee}
          onSwitchEmployee={() => { setAllEmployees(employeesCache); setShowSwitcher(true); }}
          taskActivity={taskActivity}
        />
      </div>

      <Modal
        open={Boolean(runConflictDraft)}
        title="当前会话仍在执行"
        onCancel={() => setRunConflictDraft(null)}
        footer={null}
        width={520}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            这条输入要如何处理？你可以排队等当前任务结束后继续执行，或停止当前任务并重新执行。
          </p>
          <div style={{
            padding: 12,
            borderRadius: 8,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            lineHeight: 1.6,
          }}>
            {runConflictDraft?.text}
          </div>
          <Space wrap>
            <Button type="primary" onClick={() => enqueueConflictDraft('queue')}>
              排队执行
            </Button>
            <Button danger onClick={stopAndRerunConflictDraft}>
              停止当前并重跑
            </Button>
          </Space>
        </div>
      </Modal>

      {SHOW_GLOBAL_SESSION_TODOS && pendingGlobalTodos.length > 0 && (
        <div className="atlas-session-todos-panel">
          <div className="atlas-session-todos-head">
            <strong>全局待办</strong>
            <span>{pendingGlobalTodos.length} 项</span>
          </div>
          {pendingGlobalTodos.slice(0, 4).map((todo) => (
            <div key={todo.id} className="atlas-session-todo-card">
              <button type="button" className="atlas-session-todo-main" onClick={() => openTodoSession(todo)}>
                <span>{todo.title}</span>
                <small>{todo.detail || '打开会话处理'}</small>
              </button>
              {todo.type === 'approval' && (
                <div className="atlas-session-todo-actions">
                  <Button size="small" type="primary" onClick={() => approveTodo(todo, 'once')}>允许</Button>
                  <Button size="small" danger onClick={() => approveTodo(todo, 'deny')}>拒绝</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
      <div className={`atlas-workspace-rail ${railPrefs.rightCollapsed ? 'is-collapsed' : ''}`}>
        {railPrefs.rightCollapsed ? (
          <button
            type="button"
            className="atlas-rail-collapsed-tab atlas-rail-collapsed-tab--right"
            onClick={() => toggleCommandRail('right')}
            aria-label="展开任务进展"
            title="展开任务进展"
          >
            进展
          </button>
        ) : (
          <>
            <div
              className="atlas-rail-resizer atlas-rail-resizer--right"
              onPointerDown={(e) => beginCommandRailResize('right', e)}
              onDoubleClick={() => resetCommandRailWidth('right')}
              role="separator"
              aria-orientation="vertical"
              aria-label="拖拽调整右侧栏宽度，双击恢复默认"
              title="拖拽调整右侧栏宽度，双击恢复默认"
            />
            <button
              type="button"
              className="atlas-rail-toggle atlas-rail-toggle--right"
              onClick={() => toggleCommandRail('right')}
              aria-label="收起任务进展"
              title="收起任务进展"
            >
              ›
            </button>
            <RightAside
              tunnels={tunnels}
              conclusions={conclusions}
              files={files}
              isProcessing={activeIsProcessing}
              messages={messages}
              activeEmployee={activeEmployee}
              activeSessionId={activeSessionId}
              sessionMeta={activeSessionMeta}
              runQueue={runQueue}
              onOpenRun={(sid) => handleSwitchConversation(sid)}
              onResumeTask={handleResumeActiveTask}
              onRecoverSession={recoverActiveSession}
              onOpenReplay={handleReplayEvents}
              onPatchTaskStatus={patchActiveTaskStatus}
              onRefreshSummary={refreshActiveSummary}
              onArchiveArtifact={archiveActiveArtifact}
              onUpdateArtifact={updateActiveArtifact}
              refreshingSummary={refreshingSummary}
            />
          </>
        )}
      </div>

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

      {collaborationCanvasLayer}
      {canvasHubLayer}

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
        title={`协作执行回放 — ${replayData?.session_title || replayData?.employee_name || '加载中…'}`}
        open={replayOpen}
        onCancel={() => setReplayOpen(false)}
        footer={null}
        width={760}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '16px 24px' } }}
      >
        {replayData?.workflow_run?.nodes?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              节点执行
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {replayData?.workflow_run?.nodes.map((node: any) => (
                <div key={node.id} style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-secondary)',
                  display: 'grid',
                  gap: 4,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                      {node.label || node.node_id}
                    </strong>
                    <span style={{ fontSize: 12, color: node.status === 'failed' ? '#ef4444' : node.status === 'done' || node.status === 'completed' ? '#10b981' : 'var(--accent)' }}>
                      {node.status} · {node.event_count || 0} events
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                    {node.output_summary || node.input_summary || node.error || '暂无节点摘要'}
                  </div>
                  {Array.isArray(node.artifact_ids) && node.artifact_ids.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      交付物 {node.artifact_ids.length} 个
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      步骤 {Array.isArray(node.steps) ? node.steps.length : 0}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      检查点 {Array.isArray(node.checkpoints) ? node.checkpoints.length : 0}
                    </span>
                    {Array.isArray(node.steps) && node.steps.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpandedReplayNodes((prev) => ({ ...prev, [node.id]: !prev[node.id] }))}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--accent)',
                          fontSize: 11,
                          padding: 0,
                          cursor: 'pointer',
                        }}
                      >
                        {expandedReplayNodes[node.id] ? '收起步骤' : '展开步骤'}
                      </button>
                    )}
                  </div>
                  {expandedReplayNodes[node.id] && Array.isArray(node.steps) && node.steps.length > 0 && (
                    <div style={{
                      marginTop: 8,
                      display: 'grid',
                      gap: 6,
                      borderTop: '1px solid var(--border-subtle)',
                      paddingTop: 8,
                    }}>
                      {node.steps.map((step: any) => {
                        const checkpoints = Array.isArray(node.checkpoints)
                          ? node.checkpoints.filter((c: any) => c.step_event_id === step.id)
                          : [];
                        const stepColor = step.status === 'failed'
                          ? '#ef4444'
                          : step.status === 'stalled'
                            ? '#f59e0b'
                            : step.status === 'waiting_approval'
                              ? '#8b5cf6'
                              : '#10b981';
                        return (
                          <div key={step.id} style={{
                            display: 'grid',
                            gap: 4,
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-subtle)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 7, height: 7, borderRadius: 999, background: stepColor, flexShrink: 0 }} />
                              <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>{step.title || step.event_type}</strong>
                              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>{step.status}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.45 }}>
                              {step.summary || step.output_summary || step.input_summary || step.event_type}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{step.event_type}</span>
                              {step.tool_name && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>tool: {step.tool_name}</span>}
                              {Array.isArray(step.artifact_ids) && step.artifact_ids.length > 0 && (
                                <span style={{ fontSize: 10, color: 'var(--accent)' }}>交付物 {step.artifact_ids.length}</span>
                              )}
                              {(step.status === 'failed' || step.status === 'stalled' || String(step.event_type || '').startsWith('tool.')) && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleWorkflowStepAction(step, 'retry', node)}
                                    style={{
                                      border: '1px solid rgba(59,130,246,0.3)',
                                      background: 'rgba(59,130,246,0.08)',
                                      color: '#2563eb',
                                      borderRadius: 999,
                                      padding: '3px 8px',
                                      fontSize: 10,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    重试工具
                                  </button>
                                  {(step.status === 'failed' || step.status === 'stalled') && (
                                    <button
                                      type="button"
                                      onClick={() => handleWorkflowStepAction(step, 'skip', node)}
                                      style={{
                                        border: '1px solid rgba(245,158,11,0.35)',
                                        background: 'rgba(245,158,11,0.08)',
                                        color: '#b45309',
                                        borderRadius: 999,
                                        padding: '3px 8px',
                                        fontSize: 10,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      跳过继续
                                    </button>
                                  )}
                                </>
                              )}
                              {checkpoints.map((checkpoint: any) => (
                                <button
                                  key={checkpoint.id}
                                  type="button"
                                  onClick={() => handleResumeCheckpoint(checkpoint, node, step)}
                                  style={{
                                    border: '1px solid rgba(139,127,232,0.35)',
                                    background: 'var(--accent-soft)',
                                    color: 'var(--accent)',
                                    borderRadius: 999,
                                    padding: '3px 8px',
                                    fontSize: 10,
                                    cursor: 'pointer',
                                  }}
                                >
                                  从这里恢复执行
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {activeSessionId && node.id && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleWorkflowNodeAction(node.id, 'continue')}
                        style={{
                          border: '1px solid var(--border-subtle)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-secondary)',
                          borderRadius: 8,
                          padding: '5px 9px',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        从此继续
                      </button>
                      <button
                        type="button"
                        onClick={() => handleWorkflowNodeAction(node.id, 'retry')}
                        style={{
                          border: '1px solid rgba(139,127,232,0.35)',
                          background: 'var(--accent-soft)',
                          color: 'var(--accent)',
                          borderRadius: 8,
                          padding: '5px 9px',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        重试节点
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {replayData?.runs && replayData.runs.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              任务运行状态
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {replayData.runs.map((run: any) => (
                <span key={run.id} style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}>
                  {run.stage || 'run'} · {run.status} · {run.event_count || 0}
                </span>
              ))}
            </div>
          </div>
        )}

        {replayData?.artifacts && replayData.artifacts.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              本次交付物
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {replayData.artifacts.slice(0, 8).map((artifact: any) => (
                <div key={artifact.id} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {artifact.kind?.toUpperCase?.() || 'FILE'} · v{artifact.version || 1} · {artifact.name}
                </div>
              ))}
            </div>
          </div>
        )}

        {replayData && replayData.events.length === 0 && !replayData.workflow_run && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)' }}>
            暂无回放数据。先执行一次会话或协作方案后再来。
          </div>
        )}
        {replayData && replayData.events.length > 0 && (
          <div data-m5-replay-timeline>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              原始事件流
            </div>
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
                  if (!evt.conversation_id) return;
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
                  {evt.conversation_id ? `conv: ${evt.conversation_title ?? `#${evt.conversation_id}`}` : evt.session_id ? `session: ${String(evt.session_id).slice(0, 8)}` : ''}
                </span>
              </div>
            ))}
            <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
              共 {replayData.total} 个事件 (显示最近 {replayData.events.length})
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}

function isTaskDeliverableArtifact(a: any) {
  const kind = String(a?.kind || '').toLowerCase();
  const name = String(a?.name || '').toLowerCase();
  const source = String(a?.source || '').toLowerCase();
  const status = String(a?.status || '').toLowerCase();
  const content = String(a?.content || '');
  if (a?.source_path) return true;
  if (status === 'final' || status === 'approved') return true;
  if (source.includes('tool') || source.includes('path') || source.includes('file')) return true;
  if (['html', 'md', 'markdown', 'json', 'csv', 'xlsx', 'docx', 'pptx', 'pdf', 'mermaid', 'mmd'].includes(kind)) return true;
  if (/\.(html|md|markdown|json|csv|xlsx|docx|pptx|pdf|mmd)$/i.test(name)) return true;
  const looksLikeReplyBackup = source === 'assistant' && /(?:回复|reply)-\d+\.(md|txt)$/i.test(name);
  if (looksLikeReplyBackup) {
    return /```(?:html|csv|json|mermaid)\b/i.test(content)
      || /(?:交付物|终稿|报告已生成|文件已保存|保存到|下载|归档|HTML\s*PPT|投资尽调|管理层看板)/i.test(content);
  }
  return /(?:交付物|终稿|报告|看板|PPT|尽调)\.(md|txt)$/i.test(name);
}
