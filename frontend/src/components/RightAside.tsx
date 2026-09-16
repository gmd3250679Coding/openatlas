/**
 * RightAside — Phase B 拆分 (2026-06-04)
 *
 * 替换原 CommandCenter L1137-L1250 的手搓 <aside>。功能:
 *   1. 顶部"工作进展"区 — 调 <DispatchPanel /> 渲染 tunnel cards
 *   2. 中部"对话结论"区 — 每条带 IconCheck,分隔线
 *   3. 下部"生成文件"区 — 每条带 IconPaperclip,点击预留(Phase 2 接下载)
 *   4. 三区都为空时显示"暂无调度任务"占位
 *
 * 消费 token:--bg-secondary / --border-subtle / --text-primary / --text-secondary
 *            / --text-tertiary / --accent-soft / --color-success / --ls-uppercase
 *
 * 行为(与原 CommandCenter 一致):
 *   - tunnel 完成后:opacity 0.7(isProcessing=false 时)
 *   - conclusions / files 空时不渲染对应区
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowUpOutlined, DownloadOutlined, EyeOutlined, FileOutlined, FolderOpenOutlined, HistoryOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import type { DispatchTunnel, DispatchConclusion, DispatchFile } from '../types/dispatch';
import {
  downloadProtectedFile,
  fetchFiles,
  fetchWorkspaceFiles,
  previewArtifact,
  previewUploadedFile,
  previewWorkspaceFile,
  type FilePreviewPayload,
  type UploadedFile,
  type WorkspaceFileItem,
} from '../services/api';
import ArtifactPreviewDrawer from './ArtifactPreviewDrawer';
import ArtifactPreviewContent from './ArtifactPreviewContent';
import DispatchPanel from './DispatchPanel';
import { IconPaperclip } from './Icons';

function isSessionWorkspaceMissing(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /session not found|API 404/i.test(msg);
}

interface AsideMessage {
  role: 'user' | string;
  sender: string;
  avatar: string;
  color: string;
  text: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  token_count?: number;
  attachments?: Array<{
    id?: string;
    name?: string;
    original_name?: string;
    mime?: string;
    mime_type?: string;
    status?: string;
    extracted_chars?: number;
    summary?: string;
    snippets?: Array<{ index?: number; text?: string }>;
  }>;
}

interface ActiveEmployee {
  id: number;
  uuid?: string;
  name: string;
  avatar: string;
  color: string;
  department?: string;
  allowedToolsets?: string[] | null;
}

interface Props {
  tunnels: DispatchTunnel[];
  conclusions: DispatchConclusion[];
  files: DispatchFile[];
  isProcessing: boolean;
  messages?: AsideMessage[];
  activeEmployee?: ActiveEmployee | null;
  activeSessionId?: string | null;
  sessionMeta?: {
    id?: string;
    task_status?: string;
    task_reason?: string;
    task_summary?: string;
    summary_updated_at?: string | null;
    artifacts?: any[];
    context_injections?: any[];
    health?: any;
    progress?: any;
  };
  runQueue?: any[];
  onOpenRun?: (sessionId: string) => void;
  onResumeTask?: () => Promise<void> | void;
  onRecoverSession?: () => Promise<void> | void;
  onOpenReplay?: () => Promise<void> | void;
  onPatchTaskStatus?: (status: string) => Promise<void> | void;
  onRefreshSummary?: () => Promise<void> | void;
  onArchiveArtifact?: (artifactId: string) => Promise<void> | void;
  onUpdateArtifact?: (artifactId: string, patch: { name?: string; status?: string }) => Promise<void> | void;
  refreshingSummary?: boolean;
}

interface GeneratedOutput {
  artifactId?: string;
  name: string;
  meta: string;
  content: string;
  mime: string;
  kind: string;
  previewKind?: string;
  downloadUrl?: string;
  size?: number;
  status?: string;
  version?: number;
}

function cleanTaskText(value: unknown, fallback = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return raw
    .replace(/后台守护中，可恢复/g, '后台处理中，自动同步中')
    .replace(/已停滞，可恢复/g, '后台处理中，自动同步中')
    .replace(/后台补同步/g, '后台自动同步')
    .replace(/本轮已停止等待/g, '本轮已转入后台自动同步');
}

export default function RightAside({
  tunnels,
  conclusions,
  files,
  isProcessing,
  messages = [],
  activeEmployee,
  activeSessionId,
  sessionMeta,
  runQueue = [],
  onOpenRun,
  onResumeTask,
  onRecoverSession,
  onOpenReplay,
  onPatchTaskStatus,
  onRefreshSummary,
  onArchiveArtifact,
  onUpdateArtifact,
  refreshingSummary = false,
}: Props) {
  const [tab, setTab] = useState<'progress' | 'summary' | 'context' | 'employee'>('progress');
  const [previewOutput, setPreviewOutput] = useState<GeneratedOutput | null>(null);
  const [workspaceScope, setWorkspaceScope] = useState<'workspace' | 'uploads'>('workspace');
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceFileItem[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const assistantMessages = messages.filter((m) => m.role !== 'user' && m.text.trim());
  const userMessages = messages.filter((m) => m.role === 'user' && m.text.trim());
  const latestUserMessage = [...userMessages].reverse().find((m) => m.text.trim());
  const summary = useMemo(() => {
    const inputChars = userMessages.reduce((n, m) => n + m.text.length, 0);
    const outputChars = assistantMessages.reduce((n, m) => n + m.text.length, 0);
    const speakers = Array.from(new Set(assistantMessages.map((m) => m.sender))).filter(Boolean);
    const inputTokens = userMessages.reduce((n, m) => n + (m.input_tokens || m.token_count || 0), 0);
    const outputTokens = assistantMessages.reduce((n, m) => n + (m.output_tokens || m.token_count || 0), 0);
    const recentUsers = userMessages.slice(-3).map((m) => m.text.slice(0, 90));
    const recentAssistants = assistantMessages.slice(-3).map((m) => `${m.sender}: ${m.text.slice(0, 120)}`);
    return {
      inputChars,
      outputChars,
      inputTokens: inputTokens || Math.max(0, Math.round(inputChars / 3)),
      outputTokens: outputTokens || Math.max(0, Math.round(outputChars / 3)),
      turns: messages.length,
      speakers,
      text: messages.length === 0
        ? '本会话还没有可总结的对话内容。'
        : [
            `本会话累计 ${userMessages.length} 轮输入、${assistantMessages.length} 条回复。`,
            recentUsers.length ? `主要问题: ${recentUsers.join(' / ')}` : '',
            recentAssistants.length ? `主要结论: ${recentAssistants.join(' / ')}` : '',
          ].filter(Boolean).join('\n'),
    };
  }, [messages, userMessages, assistantMessages]);

  const generatedOutputs = useMemo(() => {
    const backendOutputs: GeneratedOutput[] = (sessionMeta?.artifacts || [])
      .filter((a: any) => !a.archived && isDeliverableArtifact(a))
      .map((a: any, i: number) => ({
        artifactId: a.id,
        name: a.name || `交付物-${i + 1}.${extensionForKind(a.kind, a.mime_type)}`,
        meta: artifactMeta(a),
        content: a.content && a.kind === 'html' ? wrapHtml(String(a.content || '')) : String(a.content || ''),
        mime: a.mime_type || mimeForKind(a.kind),
        kind: inferKindFromName(a.name || a.kind || 'FILE'),
        previewKind: a.preview_kind || a.kind,
        downloadUrl: a.download_url || (a.id ? `/api/artifacts/${encodeURIComponent(a.id)}/download` : ''),
        size: Number(a.storage_size || a.size || 0),
        status: a.status,
        version: a.version,
      }));
    return dedupeOutputs(backendOutputs);
  }, [sessionMeta?.artifacts]);

  const allEmpty = tunnels.length === 0 && conclusions.length === 0 && files.length === 0 && messages.length === 0;
  const savedSummary = sessionMeta?.task_summary?.trim();
  const taskStatus = sessionMeta?.task_status || (isProcessing ? 'running' : messages.length > 0 ? 'completed' : 'draft');
  const rawHealth = sessionMeta?.health;
  const taskIsTerminal = taskStatus === 'completed' || taskStatus === 'done';
  const health = useMemo(() => {
    if (!rawHealth) return null;
    const staleRunPattern = /Hermes\s*Run|可追踪|同步最新|仍有|stale|recover/i;
    const issues = (rawHealth.issues || []).filter((issue: any) => {
      const code = String(issue.code || '');
      const message = String(issue.message || '');
      if (taskIsTerminal && (staleRunPattern.test(code) || staleRunPattern.test(message))) return false;
      return true;
    });
    const recommendedActions = (rawHealth.recommended_actions || []).filter((action: any) => {
      const kind = String(action.kind || action.key || '');
      if (taskIsTerminal && (kind === 'recover' || kind === 'resume' || kind === 'replay')) return false;
      return true;
    });
    return {
      ...rawHealth,
      status: taskIsTerminal && issues.length === 0 ? 'ok' : rawHealth.status,
      issues,
      recommended_actions: recommendedActions,
    };
  }, [rawHealth, taskIsTerminal]);
  const progress = sessionMeta?.progress || health?.progress;
  const progressStatus = taskIsTerminal ? taskStatus : (progress?.status || (isProcessing ? 'running' : taskStatus));
  const progressTimeline = Array.isArray(progress?.timeline) ? progress.timeline : [];
  const displayProgressTimeline = useMemo(
    () => normalizeProgressTimeline(progressTimeline, taskIsTerminal),
    [progressTimeline, taskIsTerminal],
  );
  const progressActions = Array.isArray(progress?.actions) ? progress.actions : [];
  const progressCopy = taskProgressCopy(progressStatus, progress?.phase_label);
  const progressUpdatedText = formatProgressTime(progress?.updated_at || (sessionMeta as any)?.updated_at);
  const contextRows = sessionMeta?.context_injections || [];
  const currentRunQueue = runQueue.filter((item: any) => activeSessionId && String(item.id) === String(activeSessionId));
  const otherRunQueue = runQueue.filter((item: any) => !activeSessionId || String(item.id) !== String(activeSessionId));
  const contextItems = useMemo(() => {
    const queryRows = latestUserMessage ? [{
      kind: 'query',
      name: '用户 Query',
      source_id: 'current-user-query',
      scope: 'user',
      status: 'provided',
      summary: latestUserMessage.text,
      payload: {},
    }] : [];
    const attachmentRows = userMessages.flatMap((m, msgIndex) =>
      (m.attachments || []).map((file, fileIndex) => ({
        kind: 'attachment',
        name: file.name || file.original_name || `附件-${msgIndex + 1}-${fileIndex + 1}`,
        source_id: file.id || `${msgIndex}-${fileIndex}`,
        scope: 'session',
        status: file.status || 'uploaded',
        summary: [
          file.summary,
          typeof file.extracted_chars === 'number' ? `已提取 ${file.extracted_chars} 字` : '',
          file.snippets?.[0]?.text ? `片段: ${file.snippets[0].text}` : '',
        ].filter(Boolean).join(' · ') || '用户上传附件',
        payload: file,
      }))
    );
    const seen = new Set<string>();
    return [...queryRows, ...attachmentRows, ...contextRows].filter((row: any) => {
      const key = `${row.kind}:${row.source_id}:${row.summary}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [contextRows, latestUserMessage, userMessages]);

  useEffect(() => {
    let cancelled = false;
    if (!activeSessionId) {
      setWorkspaceItems([]);
      setUploadedFiles([]);
      setWorkspaceError('');
      return;
    }
    setWorkspaceLoading(true);
    setWorkspaceError('');
	    Promise.all([
	      fetchWorkspaceFiles({ sessionId: activeSessionId, scope: workspaceScope, path: workspaceScope === 'workspace' ? workspacePath : '' })
	        .catch((err) => {
	          if (workspaceScope === 'workspace' && !isSessionWorkspaceMissing(err)) throw err;
	          return { items: [], scope: workspaceScope, path: '' } as any;
	        }),
      fetchFiles({ sessionId: activeSessionId, limit: 80 }).catch(() => []),
    ])
      .then(([workspace, uploads]) => {
        if (cancelled) return;
        setWorkspaceItems(workspace.items || []);
        setUploadedFiles(uploads || []);
      })
	      .catch((err) => {
	        if (cancelled) return;
	        setWorkspaceItems([]);
	        setWorkspaceError(isSessionWorkspaceMissing(err) ? '' : (err instanceof Error ? err.message : String(err)));
	      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, workspacePath, workspaceScope]);

  const tabButton = (key: typeof tab, label: string) => (
    <button
      onClick={() => setTab(key)}
      aria-label={`切换到${label}`}
      style={{
        flex: 1,
        padding: '8px 6px',
        border: 'none',
        borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
        background: 'transparent',
        color: tab === key ? 'var(--accent)' : 'var(--text-tertiary)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );

  const openWorkspaceItem = async (item: WorkspaceFileItem) => {
    if (item.kind === 'directory') {
      setWorkspacePath(item.path);
      return;
    }
    const preview = await previewWorkspaceFile({ sessionId: activeSessionId, scope: workspaceScope, path: item.path });
    setPreviewOutput(outputFromPreview(preview));
  };

  const downloadWorkspaceItem = async (item: WorkspaceFileItem) => {
    if (item.kind !== 'file') return;
    const preview = await previewWorkspaceFile({ sessionId: activeSessionId, scope: workspaceScope, path: item.path });
    await downloadProtectedFile(preview.download_url, item.name);
  };

  const openUploadedFile = async (file: UploadedFile) => {
    const preview = await previewUploadedFile(file.id);
    setPreviewOutput(outputFromPreview(preview));
  };

  const downloadUploadedFile = async (file: UploadedFile) => {
    const preview = await previewUploadedFile(file.id);
    await downloadProtectedFile(preview.download_url, file.name);
  };

  const openGeneratedOutput = async (output: GeneratedOutput) => {
    if (!output.artifactId) {
      setPreviewOutput(output);
      return;
    }
    try {
      const preview = await previewArtifact(output.artifactId);
      setPreviewOutput(outputFromPreview(preview));
    } catch {
      setPreviewOutput(output);
    }
  };

  const downloadGeneratedOutput = async (output: GeneratedOutput) => {
    if (output.downloadUrl) {
      await downloadProtectedFile(output.downloadUrl, output.name);
      return;
    }
    downloadOutput(output.name, output.content, output.mime);
  };

  const goWorkspaceParent = () => {
    const parts = workspacePath.split('/').filter(Boolean);
    parts.pop();
    setWorkspacePath(parts.join('/'));
  };

  return (
    <>
    <aside style={{
      background: 'var(--bg-secondary)',
      borderLeft: '1px solid var(--border-subtle)',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
        {tabButton('progress', '进展')}
        {tabButton('summary', '总结')}
        {tabButton('context', '输入来源')}
      </div>

      {tab === 'progress' && (
        <div style={{
          padding: '14px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--ls-uppercase)',
            marginBottom: 10,
          }}>
            当前任务驾驶舱
          </div>
          <div className={`atlas-progress-cockpit atlas-progress-cockpit--${progressStatus}`} style={{ padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span className="atlas-progress-cockpit__dot" style={{
                flexShrink: 0,
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: taskStatusDot(progressStatus),
              }} />
              <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>{progressCopy.label}</strong>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>
                {progress?.counts?.nodes?.total ? `${progress.counts.nodes.completed || 0}/${progress.counts.nodes.total} 节点` : (tunnels.length > 0 ? `${tunnels.length} 个员工节点` : '无活动节点')}
              </span>
            </div>
            <div className="atlas-progress-cockpit__live">
              <span className="atlas-progress-cockpit__live-dot" />
              <span>{progressCopy.detail}</span>
              {progressUpdatedText && <span> · {progressUpdatedText}</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, wordBreak: 'break-word' }}>
              {cleanTaskText(progress?.headline || latestUserMessage?.text || currentRunQueue[0]?.last_message || sessionMeta?.task_summary, '当前会话还没有任务输入。')}
            </div>
            {latestUserMessage?.text && progress?.headline && progress.headline !== latestUserMessage.text && (
              <div style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px dashed var(--border-subtle)',
                fontSize: 11,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                wordBreak: 'break-word',
              }}>
                <span style={{ color: 'var(--text-tertiary)' }}>原始任务：</span>{latestUserMessage.text}
              </div>
            )}
            {progress?.current_node && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <MiniPill label="当前节点" value={progress.current_node.label || progress.current_node.node_id || '节点'} />
                <MiniPill label="步骤" value={String(progress?.counts?.steps || 0)} />
                <MiniPill label="检查点" value={String(progress?.counts?.checkpoints || 0)} />
                <MiniPill label="恢复分支" value={String(progress?.counts?.forks || 0)} />
              </div>
            )}
            {(onRecoverSession || onOpenReplay || onResumeTask) && progressActions.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {progressActions.slice(0, 4).map((action: any) => {
                  const kind = String(action.kind || action.key || '');
                  const disabled =
                    (kind === 'recover' && !onRecoverSession)
                    || (kind === 'replay' && !onOpenReplay)
                    || (kind === 'resume' && !onResumeTask)
                    || (kind === 'task_status' && !onPatchTaskStatus);
                  return (
                    <button
                      key={`${action.key}-${action.kind}`}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (kind === 'recover') onRecoverSession?.();
                        if (kind === 'replay') onOpenReplay?.();
                        if (kind === 'resume') onResumeTask?.();
                        if (kind === 'task_status' && action.value && onPatchTaskStatus) onPatchTaskStatus(action.value);
                      }}
                      style={{
                        border: `1px solid ${action.primary ? 'var(--accent)' : 'var(--border-subtle)'}`,
                        background: action.primary ? 'var(--accent-soft)' : 'transparent',
                        color: action.primary ? 'var(--accent)' : 'var(--text-secondary)',
                        borderRadius: 999,
                        minHeight: 26,
                        padding: '4px 9px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.45 : 1,
                      }}
                    >
                      {kind === 'replay' && <HistoryOutlined style={{ marginRight: 4 }} />}
                      {action.label || kind}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {displayProgressTimeline.length > 0 && (
            <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>最近执行轨迹</strong>
                {onOpenReplay && (
                  <button
                    type="button"
                    onClick={() => onOpenReplay()}
                    style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', padding: 0 }}
                  >
                    打开回放
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gap: 7 }}>
                {displayProgressTimeline.slice(0, 5).map((step: any) => (
                  <div key={step.id || `${step.event_type}-${step.created_at}`} style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: 8, alignItems: 'start' }}>
                    <span style={{ width: 7, height: 7, marginTop: 5, borderRadius: 999, background: taskStatusDot(step.status), boxShadow: step.recoverable ? '0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent)' : undefined }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {step.title || step.event_type}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.45, wordBreak: 'break-word' }}>
                        {safeAsideText(step.summary || step.tool_name || step.event_type || '').slice(0, 120)}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: statusColor(step.status), whiteSpace: 'nowrap' }}>{taskStatusLabel(step.status)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {health && (
            <div style={{
              marginTop: 10,
              padding: 10,
              border: `1px solid ${healthBorder(health.status)}`,
              borderRadius: 8,
              background: healthBg(health.status),
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>会话健康</strong>
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  fontWeight: 800,
                  color: healthText(health.status),
                }}>
                  {health.score ?? '-'} / 100
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                {healthLabel(health.status)} · 上下文 {health.counts?.context_injections || 0} · 交付物 {generatedOutputs.length}
              </div>
              {(health.issues || []).slice(0, 2).map((issue: any) => (
                <div key={issue.code} style={{ marginTop: 6, fontSize: 11, color: healthText(health.status), lineHeight: 1.45 }}>
                  {issue.message}
                </div>
              ))}
              {onRecoverSession && (health.recommended_actions || []).some((a: any) => a.kind === 'recover') && (
                <button
                  type="button"
                  onClick={() => onRecoverSession()}
                  style={{
                    marginTop: 8,
                    border: `1px solid ${healthBorder(health.status)}`,
                    background: 'var(--bg-primary)',
                    color: healthText(health.status),
                    borderRadius: 7,
                    height: 28,
                    padding: '0 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  同步最新结果
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {tab === 'progress' && tunnels.length > 0 && (
        <div style={{
          padding: '14px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <DispatchPanel tunnels={tunnels} visible={true} />
        </div>
      )}
      {false && tab === 'progress' && otherRunQueue.length > 0 && (
        <div style={{
          padding: '14px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--ls-uppercase)',
            marginBottom: 10,
          }}>
            任务队列
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {otherRunQueue.slice(0, 6).map((item: any) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenRun?.(item.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-primary)',
                  borderRadius: 8,
                  padding: 9,
                  cursor: onOpenRun ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{
                    flexShrink: 0,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: taskStatusDot(item.is_stale ? 'stale' : item.task_status),
                  }} />
                  <strong style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                  }}>{readableRunTitle(item)}</strong>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>
                    {item.is_stale ? '后台处理中' : taskStatusLabel(item.task_status)}
                  </span>
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {item.employee_name || (item.is_group ? '群聊协作' : '数字员工')} · {item.is_stale ? '长时间无新事件，Atlas 正在后台监听并自动同步；也可打开回放查看检查点' : cleanTaskText(item.last_message || item.task_summary, '等待下一步')}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === 'progress' && (
        <div style={{
          padding: '14px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--ls-uppercase)',
            marginBottom: 10,
          }}>
            员工详情
          </div>
          {activeEmployee ? (
            <div style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: activeEmployee?.color || '#4F46E5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                  {activeEmployee?.avatar || '?'}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{activeEmployee?.name || '未命名员工'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{activeEmployee?.department || '未分配部门'}</div>
                </div>
              </div>
              <InfoRow label="部门" value={activeEmployee?.department || '未分配部门'} />
              <InfoRow label="员工 ID" value={activeEmployee?.uuid || String(activeEmployee?.id || '')} />
              <InfoRow label="工具权限" value={activeEmployee?.allowedToolsets?.join(', ') || '默认'} />
            </div>
          ) : (
            <div style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)', fontSize: 12, color: 'var(--text-tertiary)' }}>
              暂无选中的员工。
            </div>
          )}
          {summary.speakers.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {summary.speakers.map((s) => (
                <div key={s} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'progress' && tunnels.length === 0 && runQueue.length === 0 && !latestUserMessage && (
        <div style={{ padding: '24px 12px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
          {isProcessing ? '正在启动调度…' : '暂无调度任务'}
        </div>
      )}

      {tab === 'summary' && (
        <div style={{
          padding: '14px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--ls-uppercase)',
            marginBottom: 10,
          }}>
            任务结果
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span style={{
              padding: '3px 8px',
              borderRadius: 999,
              background: taskStatusTone(taskStatus),
              color: taskStatusText(taskStatus),
              fontSize: 11,
              fontWeight: 700,
            }}>
              {taskStatusLabel(taskStatus)}
            </span>
            {onRefreshSummary && (
              <button
                type="button"
                onClick={() => onRefreshSummary()}
                disabled={refreshingSummary}
                style={{
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                  borderRadius: 7,
                  height: 28,
                  padding: '0 9px',
                  fontSize: 11,
                  cursor: refreshingSummary ? 'wait' : 'pointer',
                }}
              >
                <ReloadOutlined spin={refreshingSummary} /> {savedSummary ? '刷新总结' : '生成总结'}
              </button>
            )}
          </div>
          {onPatchTaskStatus && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              marginBottom: 12,
            }}>
              <TaskActionButton
                disabled={taskStatus === 'completed'}
                label="标记完成"
                tone="success"
                onClick={() => onPatchTaskStatus('completed')}
              />
              <TaskActionButton
                disabled={taskStatus === 'needs_input'}
                label="需补充"
                tone="warning"
                onClick={() => onPatchTaskStatus('needs_input')}
              />
              <TaskActionButton
                disabled={taskStatus === 'running'}
                label="重新进行"
                tone="info"
                onClick={() => onPatchTaskStatus('running')}
              />
              <TaskActionButton
                disabled={taskStatus === 'failed'}
                label="标记失败"
                tone="danger"
                onClick={() => onPatchTaskStatus('failed')}
              />
            </div>
          )}
          {taskStatus === 'needs_input' && (
            <div style={{
              marginBottom: 12,
              padding: 10,
              borderRadius: 8,
              border: '1px solid #fde68a',
              background: '#fffbeb',
              color: '#92400e',
              fontSize: 12,
              lineHeight: 1.55,
            }}>
              <strong>需要补充信息</strong>
              <div style={{ marginTop: 4 }}>
                {sessionMeta?.task_reason || '模型需要更多上下文才能继续推进任务。'}
              </div>
              {onResumeTask && (
                <button
                  type="button"
                  onClick={() => onResumeTask()}
                  style={{
                    marginTop: 8,
                    border: '1px solid #f59e0b',
                    background: '#fff7ed',
                    color: '#92400e',
                    borderRadius: 7,
                    height: 28,
                    padding: '0 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  继续补充
                </button>
              )}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <Metric label="输入 Token" value={summary.inputTokens} />
            <Metric label="输出 Token" value={summary.outputTokens} />
            <Metric label="输入字数" value={summary.inputChars} />
            <Metric label="输出字数" value={summary.outputChars} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.6, padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)' }}>
            {savedSummary || summary.text}
          </div>
          {sessionMeta?.summary_updated_at && (
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-tertiary)' }}>
              总结更新时间: {new Date(sessionMeta.summary_updated_at).toLocaleString('zh-CN', { hour12: false })}
            </div>
          )}
          {summary.speakers.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-tertiary)' }}>
              参与员工: {summary.speakers.join(' / ')}
            </div>
          )}
        </div>
      )}

      {tab === 'context' && (
        <div style={{ padding: '14px 12px' }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--ls-uppercase)',
            marginBottom: 10,
          }}>
            本轮输入与来源
          </div>
          {contextItems.length === 0 ? (
            <div style={{ padding: 18, textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)' }}>
              暂无 Query、附件、Skill、文件或记忆记录。
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {contextItems.slice(0, 50).map((row: any, i: number) => (
                <div key={row.id || `${row.kind}-${row.source_id}-${i}`} style={{ padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: '#fff',
                      background: contextKindTone(row.kind),
                      borderRadius: 4,
                      padding: '2px 5px',
                      textTransform: 'uppercase',
                    }}>{row.kind}</span>
                    <strong style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.name || row.source_id || '未命名'}
                    </strong>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: statusColor(row.status) }}>{row.status || 'injected'}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                    {row.scope ? `${row.scope} · ` : ''}{String(row.summary || '').slice(0, 180) || '已参与本轮上下文构造'}
                  </div>
                </div>
              ))}
            </div>
          )}
          <RemoteWorkspacePanel
            workspaceLoading={workspaceLoading}
            workspaceError={workspaceError}
            workspaceScope={workspaceScope}
            workspacePath={workspacePath}
            workspaceItems={workspaceItems}
            uploadedFiles={uploadedFiles}
            setWorkspaceScope={setWorkspaceScope}
            setWorkspacePath={setWorkspacePath}
            goWorkspaceParent={goWorkspaceParent}
            openWorkspaceItem={openWorkspaceItem}
            downloadWorkspaceItem={downloadWorkspaceItem}
            openUploadedFile={openUploadedFile}
            downloadUploadedFile={downloadUploadedFile}
            setWorkspaceError={setWorkspaceError}
          />
        </div>
      )}

      {tab === 'summary' && generatedOutputs.length > 0 && (
        <div style={{ padding: '14px 12px' }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--ls-uppercase)',
            marginBottom: 10,
          }}>
            任务交付物
          </div>
          {generatedOutputs.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 0',
              width: '100%',
              borderBottom: i < generatedOutputs.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 4,
                background: outputKindTone(f.kind),
                color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 0,
                flexShrink: 0,
              }}>
                {f.kind || <IconPaperclip size={14} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 500, color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {f.name}
                  {f.version && f.version > 1 ? <span style={{ color: 'var(--accent)', marginLeft: 6 }}>v{f.version}</span> : null}
                  {f.status === 'final' ? <span style={{ color: 'var(--color-success)', marginLeft: 6 }}>终稿</span> : null}
                </div>
                <div style={{
                  fontSize: 10, color: 'var(--text-tertiary)',
                }}>{f.meta}</div>
              </div>
              {f.artifactId && onUpdateArtifact && f.status !== 'final' && (
                <button
                  type="button"
                  title="标记为终稿"
                  aria-label="标记为终稿"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateArtifact(f.artifactId!, { status: 'final' });
                  }}
                  style={{
                    marginLeft: 'auto',
                    padding: '4px 7px',
                    borderRadius: 6,
                    border: 'none',
                    color: 'var(--color-success)',
                    background: 'rgba(16,185,129,0.08)',
                    fontSize: 10,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  终稿
                </button>
              )}
              {f.artifactId && onUpdateArtifact && (
                <button
                  type="button"
                  title="重命名交付物"
                  aria-label="重命名交付物"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = window.prompt('交付物名称', f.name);
                    if (next && next.trim() && next.trim() !== f.name) {
                      onUpdateArtifact(f.artifactId!, { name: next.trim() });
                    }
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    color: 'var(--text-tertiary)',
                    background: 'transparent',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                >
                  改
                </button>
              )}
              <button
                type="button"
                title="在线打开"
                aria-label="在线打开"
                onClick={(e) => {
                  e.stopPropagation();
                  void openGeneratedOutput(f);
                }}
                style={{
                  marginLeft: f.artifactId && onUpdateArtifact && f.status !== 'final' ? 0 : 'auto',
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  color: 'var(--accent)',
                  background: 'var(--accent-soft)',
                  border: '1px solid color-mix(in srgb, var(--accent) 22%, var(--border-subtle))',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <EyeOutlined />
              </button>
              <button
                type="button"
                title="下载到本地"
                aria-label="下载到本地"
                onClick={() => void downloadGeneratedOutput(f).catch((err) => setWorkspaceError(err instanceof Error ? err.message : String(err)))}
                style={{
                  marginLeft: 0,
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  color: 'var(--text-tertiary)',
                  background: 'transparent',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <DownloadOutlined />
              </button>
              {f.artifactId && onArchiveArtifact && (
                <button
                  type="button"
                  title="归档交付物"
                  aria-label="归档交付物"
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchiveArtifact(f.artifactId!);
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    color: 'var(--text-tertiary)',
                    background: 'transparent',
                    border: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <InboxOutlined />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {false && tab === 'employee' && (
        <div style={{ padding: '14px 12px' }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--ls-uppercase)',
            marginBottom: 10,
          }}>
            员工详情
          </div>
          {activeEmployee ? (
            <div style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: activeEmployee?.color || '#4F46E5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                  {activeEmployee?.avatar || '?'}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{activeEmployee?.name || '未命名员工'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{activeEmployee?.department || '未分配部门'}</div>
                </div>
              </div>
              <InfoRow label="部门" value={activeEmployee?.department || '未分配部门'} />
              <InfoRow label="员工 ID" value={activeEmployee?.uuid || String(activeEmployee?.id || '')} />
              <InfoRow label="工具权限" value={activeEmployee?.allowedToolsets?.join(', ') || '默认'} />
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>暂无选中的员工。</div>
          )}
          {summary.speakers.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {summary.speakers.map((s) => (
                <div key={s} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {allEmpty && (
        <div style={{
          padding: '24px 12px', fontSize: 12,
          color: 'var(--text-tertiary)', textAlign: 'center',
        }}>
          暂无调度任务
        </div>
      )}
    </aside>
    <ArtifactPreviewDrawer
      open={Boolean(previewOutput)}
      onClose={() => setPreviewOutput(null)}
      title={previewOutput ? `${previewOutput.name} · 在线预览` : '交付物预览'}
    >
      {previewOutput ? <DeliverablePreview output={previewOutput} /> : null}
    </ArtifactPreviewDrawer>
    </>
  );
}

function TaskActionButton({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  tone: 'success' | 'warning' | 'info' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    success: { bg: '#ecfdf5', border: '#a7f3d0', text: '#047857' },
    warning: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
    info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
    danger: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
  };
  const c = colors[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.text,
        borderRadius: 7,
        height: 30,
        padding: '0 8px',
        fontSize: 11,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: 8, borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function RemoteWorkspacePanel({
  workspaceLoading,
  workspaceError,
  workspaceScope,
  workspacePath,
  workspaceItems,
  uploadedFiles,
  setWorkspaceScope,
  setWorkspacePath,
  goWorkspaceParent,
  openWorkspaceItem,
  downloadWorkspaceItem,
  openUploadedFile,
  downloadUploadedFile,
  setWorkspaceError,
}: {
  workspaceLoading: boolean;
  workspaceError: string;
  workspaceScope: 'workspace' | 'uploads';
  workspacePath: string;
  workspaceItems: WorkspaceFileItem[];
  uploadedFiles: UploadedFile[];
  setWorkspaceScope: (scope: 'workspace' | 'uploads') => void;
  setWorkspacePath: (path: string) => void;
  goWorkspaceParent: () => void;
  openWorkspaceItem: (item: WorkspaceFileItem) => Promise<void>;
  downloadWorkspaceItem: (item: WorkspaceFileItem) => Promise<void>;
  openUploadedFile: (file: UploadedFile) => Promise<void>;
  downloadUploadedFile: (file: UploadedFile) => Promise<void>;
  setWorkspaceError: (message: string) => void;
}) {
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>远程文件工作区</strong>
        {workspaceLoading && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>加载中...</span>}
        <div style={{ marginLeft: 'auto', display: 'inline-flex', padding: 2, borderRadius: 999, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
          {(['workspace', 'uploads'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => {
                setWorkspaceScope(scope);
                setWorkspacePath('');
              }}
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 700,
                color: workspaceScope === scope ? 'var(--accent)' : 'var(--text-tertiary)',
                background: workspaceScope === scope ? 'var(--accent-soft)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {scope === 'workspace' ? '工作区' : '上传'}
            </button>
          ))}
        </div>
      </div>
      {workspaceError && (
        <div style={{ marginBottom: 8, padding: 8, borderRadius: 8, color: '#991b1b', background: '#fee2e2', fontSize: 11, lineHeight: 1.45 }}>
          {workspaceError}
        </div>
      )}
      {workspaceScope === 'workspace' ? (
        <div style={{ display: 'grid', gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>
            <button
              type="button"
              disabled={!workspacePath}
              onClick={goWorkspaceParent}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-primary)',
                color: 'var(--text-tertiary)',
                cursor: workspacePath ? 'pointer' : 'not-allowed',
                opacity: workspacePath ? 1 : 0.45,
              }}
            >
              <ArrowUpOutlined />
            </button>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              /{workspacePath || ''}
            </span>
          </div>
          {workspaceItems.length === 0 ? (
            <div style={{ padding: 14, border: '1px dashed var(--border-subtle)', borderRadius: 8, color: 'var(--text-tertiary)', fontSize: 11, textAlign: 'center' }}>
              暂无服务端工作区文件。Hermes 后续生成的文件会出现在这里。
            </div>
          ) : workspaceItems.map((item) => (
            <button
              key={`${item.kind}:${item.path}`}
              type="button"
              onClick={() => void openWorkspaceItem(item).catch((err) => setWorkspaceError(err instanceof Error ? err.message : String(err)))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                minHeight: 36,
                padding: '7px 8px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              {item.kind === 'directory' ? <FolderOpenOutlined style={{ color: 'var(--accent)' }} /> : <FileOutlined style={{ color: 'var(--text-tertiary)' }} />}
              <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{item.name}</span>
              {item.kind === 'file' && (
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <EyeOutlined style={{ color: 'var(--accent)' }} />
                  <DownloadOutlined
                    style={{ color: 'var(--text-tertiary)' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void downloadWorkspaceItem(item).catch((err) => setWorkspaceError(err instanceof Error ? err.message : String(err)));
                    }}
                  />
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 7 }}>
          {uploadedFiles.length === 0 ? (
            <div style={{ padding: 14, border: '1px dashed var(--border-subtle)', borderRadius: 8, color: 'var(--text-tertiary)', fontSize: 11, textAlign: 'center' }}>
              当前会话暂无上传文件。
            </div>
          ) : uploadedFiles.map((file) => (
            <div key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)' }}>
              <IconPaperclip size={14} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{file.status} · {file.extracted_chars || 0} 字</div>
              </div>
              <button type="button" aria-label="预览上传文件" onClick={() => void openUploadedFile(file).catch((err) => setWorkspaceError(err instanceof Error ? err.message : String(err)))} style={miniIconButtonStyle('var(--accent)')}>
                <EyeOutlined />
              </button>
              <button type="button" aria-label="下载上传文件" onClick={() => void downloadUploadedFile(file).catch((err) => setWorkspaceError(err instanceof Error ? err.message : String(err)))} style={miniIconButtonStyle('var(--text-tertiary)')}>
                <DownloadOutlined />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function outputFromPreview(preview: FilePreviewPayload): GeneratedOutput {
  const kindMap: Record<string, string> = {
    html: 'HTML',
    markdown: 'MD',
    json: 'JSON',
    csv: 'CSV',
    docx_html: inferKindFromName(preview.name),
    document_text: inferKindFromName(preview.name),
    pdf_text: 'PDF',
    image: inferKindFromName(preview.name),
    text: inferKindFromName(preview.name),
  };
  return {
    name: preview.name,
    meta: `${preview.source || 'server'} · ${preview.renderable ? '可在线预览' : '仅下载'} · ${preview.size || 0} bytes`,
    content: preview.content || '',
    mime: preview.mime_type || mimeForKind(kindMap[preview.preview_kind]),
    kind: kindMap[preview.preview_kind] || inferKindFromName(preview.name),
    previewKind: preview.preview_kind,
    downloadUrl: preview.download_url,
    size: preview.size,
  };
}

function miniIconButtonStyle(color: string): CSSProperties {
  return {
    width: 26,
    height: 26,
    borderRadius: 6,
    color,
    background: 'transparent',
    border: '1px solid var(--border-subtle)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  };
}

function DeliverablePreview({ output }: { output: GeneratedOutput }) {
  return (
    <ArtifactPreviewContent
      preview={{
        id: output.artifactId,
        name: output.name,
        mime_type: output.mime,
        preview_kind: output.previewKind || output.kind,
        kind: output.kind,
        content: output.content,
        size: output.size,
        download_url: output.downloadUrl,
        meta: output.meta,
      }}
    />
  );
}

function DocumentArtifactPreview({ output }: { output: GeneratedOutput }) {
  const kind = String(output.kind || 'FILE').toUpperCase();
  const text = String(output.content || '').trim();
  return (
    <div style={{
      minHeight: '100%',
      padding: 22,
      borderRadius: 14,
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: outputKindTone(kind),
          color: '#fff',
          fontWeight: 800,
          fontSize: 12,
        }}>
          {kind}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {output.name}
          </div>
          <div style={{ marginTop: 3, fontSize: 12, color: 'var(--text-tertiary)' }}>
            {output.meta || '文档交付物'}
          </div>
        </div>
      </div>
      {text ? (
        <article style={{
          maxWidth: 880,
          margin: '0 auto',
          padding: '22px 24px',
          borderRadius: 12,
          background: 'color-mix(in srgb, var(--bg-secondary) 52%, transparent)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
          fontSize: 14,
          lineHeight: 1.78,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {text}
        </article>
      ) : (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          暂无可在线渲染内容，可先下载到本地查看原文件。
        </div>
      )}
    </div>
  );
}

function JsonArtifactPreview({ output }: { output: GeneratedOutput }) {
  let formatted = output.content;
  try {
    formatted = JSON.stringify(JSON.parse(output.content), null, 2);
  } catch {
    formatted = output.content;
  }
  return (
    <div style={{ padding: 18, borderRadius: 12, border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)' }}>
      <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{output.name}</div>
      <pre style={{
        margin: 0,
        padding: 14,
        borderRadius: 10,
        overflow: 'auto',
        background: 'color-mix(in srgb, var(--text-primary) 6%, var(--bg-secondary))',
        color: 'var(--text-primary)',
        fontSize: 12,
        lineHeight: 1.6,
      }}><code>{formatted}</code></pre>
    </div>
  );
}

function CsvArtifactPreview({ output }: { output: GeneratedOutput }) {
  const rows = parseCsvPreview(output.content).slice(0, 80);
  const header = rows[0] || [];
  const body = rows.slice(1);
  if (rows.length <= 1 || header.length <= 1) {
    return <DocumentArtifactPreview output={output} />;
  }
  return (
    <div style={{ padding: 18, borderRadius: 12, border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)' }}>
      <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{output.name}</strong>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>预览前 {rows.length} 行</span>
      </div>
      <div style={{ overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th key={i} style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                  padding: '9px 10px',
                  borderBottom: '1px solid var(--border-subtle)',
                  whiteSpace: 'nowrap',
                }}>{cell || `列 ${i + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {header.map((_, c) => (
                  <td key={c} style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                  }}>{row[c] || ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseCsvPreview(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function MiniPill({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      maxWidth: '100%',
      padding: '3px 7px',
      borderRadius: 999,
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-secondary)',
      color: 'var(--text-secondary)',
      fontSize: 10,
      lineHeight: 1.2,
    }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <strong style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</strong>
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

function downloadOutput(filename: string, content: string, mime: string) {
  const safeName = sanitizeFilename(filename || `openatlas-output-${Date.now()}.txt`);
  const blob = new Blob([content || ''], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string) {
  return name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || `openatlas-output-${Date.now()}.txt`;
}

function dedupeOutputs(outputs: GeneratedOutput[]) {
  const seen = new Set<string>();
  return outputs.filter((output) => {
    const contentKey = String(output.content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
    const key = `${String(output.kind || '').toUpperCase()}::${contentKey || output.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractMessageDeliverables(message: AsideMessage, messageIndex: number): GeneratedOutput[] {
  const text = String(message.text || '');
  const sender = sanitizeFilename(message.sender || 'Atlas') || 'Atlas';
  const outputs: GeneratedOutput[] = [];
  let blockIndex = 1;

  const blocks = extractFencedBlocksWithLang(text);
  blocks.forEach((block) => {
    const normalized = normalizeDeliverableLang(block.lang);
    if (!normalized) return;
    const ext = extensionForKind(normalized);
    const content = normalized === 'HTML' ? wrapHtml(block.content) : block.content.trim();
    if (!content) return;
    outputs.push({
      name: `${sender}-交付物-${messageIndex + 1}-${blockIndex}.${ext}`,
      meta: `从回复中识别 · ${content.length} 字`,
      content,
      mime: mimeForKind(normalized),
      kind: normalized,
    });
    blockIndex += 1;
  });

  if (!outputs.some((output) => output.kind === 'HTML')) {
    const html = extractStandaloneHtml(text);
    if (html) {
      outputs.push({
        name: `${sender}-交付物-${messageIndex + 1}-${blockIndex}.html`,
        meta: `从回复中识别 · ${html.length} 字`,
        content: wrapHtml(html),
        mime: mimeForKind('HTML'),
        kind: 'HTML',
      });
    }
  }

  return outputs;
}

function extractFencedBlocksWithLang(text: string) {
  const blocks: Array<{ lang: string; content: string }> = [];
  const re = /```([a-zA-Z0-9_+\-]*)[ \t]*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const lang = String(match[1] || '').trim();
    const content = String(match[2] || '').trim();
    if (lang && content) blocks.push({ lang, content });
  }
  return blocks;
}

function normalizeDeliverableLang(lang: string) {
  const normalized = lang.trim().toLowerCase();
  if (['html', 'htm'].includes(normalized)) return 'HTML';
  if (['markdown', 'md'].includes(normalized)) return 'MD';
  if (['json'].includes(normalized)) return 'JSON';
  if (['csv'].includes(normalized)) return 'CSV';
  if (['mermaid', 'mmd'].includes(normalized)) return 'MMD';
  return '';
}

function isDeliverableArtifact(a: any) {
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

function extractFencedBlocks(text: string, languages: string[]) {
  const wanted = new Set(languages.map((s) => s.toLowerCase()));
  const blocks: string[] = [];
  const re = /```([a-zA-Z0-9_+\-]*)[ \t]*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const lang = String(match[1] || '').toLowerCase();
    if (wanted.has(lang)) blocks.push(String(match[2] || '').trim());
  }
  return blocks.filter(Boolean);
}

function extractStandaloneHtml(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (/^\s*<!doctype html/i.test(trimmed) || /^\s*<html[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/(<(?:section|article|main|div|html|body|table|style|script)[\s\S]*<\/(?:section|article|main|div|html|body|table|style|script)>)/i);
  return match?.[1]?.trim() || '';
}

function wrapHtml(html: string) {
  const trimmed = html.trim();
  if (/^\s*<!doctype/i.test(trimmed) || /^\s*<html/i.test(trimmed)) return trimmed;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenAtlas Artifact</title>
</head>
<body>
${trimmed}
</body>
</html>`;
}

function inferKindFromName(name: string) {
  const ext = name.split('.').pop()?.toUpperCase() || 'FILE';
  if (['MD', 'HTML', 'JSON', 'CSV', 'PDF', 'DOCX', 'XLSX', 'TXT', 'MMD'].includes(ext)) return ext;
  return 'FILE';
}

function outputKindTone(kind: string) {
  const normalized = kind.toUpperCase();
  if (normalized === 'HTML') return '#f97316';
  if (normalized === 'MD') return '#2563eb';
  if (normalized === 'JSON') return '#8b5cf6';
  if (normalized === 'CSV' || normalized === 'XLSX') return '#10b981';
  if (normalized === 'MMD') return '#7c3aed';
  if (normalized === 'PDF') return '#ef4444';
  if (normalized === 'DOCX') return '#3b82f6';
  return 'var(--accent)';
}

function safeAsideText(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/assistant produced a final response/i.test(raw)) return '模型已返回最终回复。';
  if (/using run events/i.test(raw) || /Run Events/i.test(raw)) return '执行链路已连接，正在监听模型和工具事件。';
  return raw
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/?\S*/gi, '本地运行链路')
    .replace(/\b(?:run|thread|session|conv)_[a-z0-9_-]{10,}\b/gi, '运行实例')
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '内部标识')
    .replace(/\b[a-f0-9]{24,}\b/gi, '内部标识');
}

function artifactMeta(a: any) {
  const bits = [`${a.kind || 'artifact'}`, `${String(a.content || '').length} 字`];
  if (a.version) bits.push(`v${a.version}`);
  if (a.status && a.status !== 'active') bits.push(String(a.status));
  if (a.source) bits.push(String(a.source));
  if (a.storage_ref || a.managed_status === 'managed') bits.push('托管文件');
  const prov = a.provenance || {};
  if (prov.employee_name) bits.push(prov.employee_name);
  const counts = prov.context_counts || {};
  const contextBits = Object.entries(counts).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}:${v}`);
  if (contextBits.length) bits.push(`上下文 ${contextBits.join('/')}`);
  if (prov.query_excerpt) bits.push(`Query: ${String(prov.query_excerpt).slice(0, 28)}`);
  return bits.join(' · ');
}

function healthLabel(status: string) {
  const s = String(status || '');
  if (s === 'action_required') return '需要处理';
  if (s === 'warning') return '有风险';
  if (s === 'running') return '运行中';
  return '健康';
}

function healthBg(status: string) {
  const s = String(status || '');
  if (s === 'action_required') return 'color-mix(in srgb, #ef4444 10%, var(--bg-primary))';
  if (s === 'warning') return 'color-mix(in srgb, #f59e0b 10%, var(--bg-primary))';
  if (s === 'running') return 'color-mix(in srgb, #3b82f6 10%, var(--bg-primary))';
  return 'color-mix(in srgb, #10b981 10%, var(--bg-primary))';
}

function healthBorder(status: string) {
  const s = String(status || '');
  if (s === 'action_required') return 'color-mix(in srgb, #ef4444 36%, var(--border-subtle))';
  if (s === 'warning') return 'color-mix(in srgb, #f59e0b 36%, var(--border-subtle))';
  if (s === 'running') return 'color-mix(in srgb, #3b82f6 36%, var(--border-subtle))';
  return 'color-mix(in srgb, #10b981 36%, var(--border-subtle))';
}

function healthText(status: string) {
  const s = String(status || '');
  if (s === 'action_required') return 'color-mix(in srgb, #ef4444 82%, var(--text-primary))';
  if (s === 'warning') return 'color-mix(in srgb, #f59e0b 82%, var(--text-primary))';
  if (s === 'running') return 'color-mix(in srgb, #3b82f6 82%, var(--text-primary))';
  return 'color-mix(in srgb, #10b981 82%, var(--text-primary))';
}

function mimeForKind(kind?: string) {
  const k = String(kind || '').toLowerCase();
  if (k === 'html') return 'text/html;charset=utf-8';
  if (k === 'markdown' || k === 'md') return 'text/markdown;charset=utf-8';
  if (k === 'json') return 'application/json;charset=utf-8';
  if (k === 'csv') return 'text/csv;charset=utf-8';
  if (k === 'mermaid' || k === 'mmd') return 'text/plain;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

function extensionForKind(kind?: string, mime?: string) {
  const k = String(kind || '').toLowerCase();
  if (k === 'html' || String(mime || '').includes('html')) return 'html';
  if (k === 'markdown' || k === 'md') return 'md';
  if (k === 'json') return 'json';
  if (k === 'csv') return 'csv';
  if (k === 'mermaid' || k === 'mmd') return 'mmd';
  return 'txt';
}

function normalizeProgressTimeline(timeline: any[], taskIsTerminal: boolean) {
  return (timeline || []).map((step) => {
    const raw = String(step?.status || '').toLowerCase();
    const text = `${step?.event_type || ''} ${step?.title || ''} ${step?.summary || ''}`.toLowerCase();
    let status = raw || 'running';
    if (taskIsTerminal && !['failed', 'error', 'waiting_approval', 'needs_input', 'waiting_input'].includes(status)) {
      status = 'completed';
    } else if (/completed|done|finished|完成|最终回复|交付物/.test(text) && !['failed', 'error'].includes(status)) {
      status = 'completed';
    } else if ((status === 'stalled' || status === 'idle') && taskIsTerminal) {
      status = 'completed';
    }
    return { ...step, status };
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
    skipped: '已跳过',
  };
  return map[status] || status;
}

function taskProgressCopy(status: string, fallback?: string) {
  const s = String(status || 'draft');
  const map: Record<string, { label: string; detail: string }> = {
    draft: { label: '等待任务', detail: '当前会话还没有正在执行的任务。' },
    queued: { label: '排队中', detail: '任务已进入调度队列，等待 Hermes 接管执行。' },
    running: { label: '工作中 · Hermes 正在执行', detail: '正在接收模型、工具和文件事件；长程任务可能会短暂静默。' },
    waiting_approval: { label: '等待人工确认', detail: 'Hermes 请求确认高风险或不确定操作，确认后会继续推进。' },
    quota_waiting: { label: '限流等待', detail: '模型服务触发额度或频率限制，本轮任务已保留，可稍后继续或换员工接力。' },
    needs_input: { label: '需要补充信息', detail: '任务暂缺上下文，请补充资料后继续。' },
    waiting_input: { label: '需要补充信息', detail: '任务暂缺上下文，请补充资料后继续。' },
    stalled: { label: '后台处理中 · 自动同步中', detail: 'Hermes 暂时没有新事件，Atlas 正在继续监听并会自动更新结果；这不等于失败。' },
    failed: { label: '失败 · 可重试', detail: '任务已进入失败态，可从检查点回放或重新执行。' },
    completed: { label: '已完成', detail: '任务已完成，可以查看交付物、总结和输入来源。' },
    done: { label: '已完成', detail: '任务已完成，可以查看交付物、总结和输入来源。' },
  };
  const item = map[s] || { label: fallback || taskStatusLabel(s), detail: '正在同步最新任务状态。' };
  const weakFallback = new Set(['执行中', '进行中', '已停滞', '已停滞，可恢复', '后台守护中，可恢复']);
  return { ...item, label: fallback && !weakFallback.has(fallback) ? fallback : item.label };
}

function formatProgressTime(value?: string) {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms < 60_000) return '刚刚更新';
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))} 分钟前更新`;
  if (ms < 86_400_000) return `${Math.max(1, Math.round(ms / 3_600_000))} 小时前更新`;
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function taskStatusTone(status: string) {
  if (status === 'failed') return '#fee2e2';
  if (status === 'needs_input' || status === 'waiting_input' || status === 'waiting_approval' || status === 'quota_waiting' || status === 'stalled') return '#fef3c7';
  if (status === 'running') return '#dbeafe';
  if (status === 'completed' || status === 'done') return '#d1fae5';
  return 'var(--accent-soft)';
}

function taskStatusDot(status: string) {
  if (status === 'stale') return '#d97706';
  if (status === 'failed') return '#ef4444';
  if (status === 'needs_input' || status === 'waiting_input' || status === 'waiting_approval' || status === 'quota_waiting' || status === 'stalled') return '#f59e0b';
  if (status === 'running' || status === 'queued') return '#3b82f6';
  if (status === 'completed' || status === 'done') return '#10b981';
  if (status === 'skipped') return '#94a3b8';
  return '#8b8fa3';
}

function taskStatusText(status: string) {
  const s = String(status || '').toLowerCase();
  if (s === 'failed') return '#991b1b';
  if (s === 'needs_input' || s === 'waiting_input' || s === 'waiting_approval' || s === 'quota_waiting' || s === 'stalled') return '#92400e';
  if (s === 'running' || s === 'queued') return '#1d4ed8';
  if (s === 'completed' || s === 'done') return '#065f46';
  return 'var(--text-secondary)';
}

function contextKindTone(kind: string) {
  const k = String(kind || '').toLowerCase();
  if (k === 'query') return '#111827';
  if (k === 'attachment') return '#0ea5e9';
  if (k === 'skill') return '#7c3aed';
  if (k === 'file') return '#2563eb';
  if (k === 'memory') return '#10b981';
  return '#6b7280';
}

function readableRunTitle(item: any) {
  const title = String(item?.title || '').trim();
  if (title && title !== '新会话') return title;
  const last = cleanTaskText(item?.last_message || item?.task_summary).replace(/\s+/g, ' ').trim();
  if (!last) return '未命名任务';
  return last.length > 24 ? `${last.slice(0, 24)}...` : last;
}

function statusColor(status: string) {
  const s = String(status || '').toLowerCase();
  if (s.includes('fail') || s.includes('missing') || s.includes('error')) return '#dc2626';
  if (s.includes('stalled') || s.includes('approval') || s.includes('input') || s.includes('quota')) return '#d97706';
  if (s.includes('running') || s.includes('progress') || s.includes('queued')) return '#2563eb';
  if (s.includes('completed') || s.includes('done')) return '#059669';
  if (s.includes('skip')) return '#d97706';
  return 'var(--text-tertiary)';
}
