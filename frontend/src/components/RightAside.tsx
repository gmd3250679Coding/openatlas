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
import { useMemo, useState } from 'react';
import { DownloadOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import type { DispatchTunnel, DispatchConclusion, DispatchFile } from '../types/dispatch';
import DispatchPanel from './DispatchPanel';
import { IconPaperclip } from './Icons';

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
  };
  runQueue?: any[];
  onOpenRun?: (sessionId: string) => void;
  onResumeTask?: () => Promise<void> | void;
  onRecoverSession?: () => Promise<void> | void;
  onPatchTaskStatus?: (status: string) => Promise<void> | void;
  onRefreshSummary?: () => Promise<void> | void;
  onArchiveArtifact?: (artifactId: string) => Promise<void> | void;
  refreshingSummary?: boolean;
}

interface GeneratedOutput {
  artifactId?: string;
  name: string;
  meta: string;
  content: string;
  mime: string;
  kind: string;
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
  onPatchTaskStatus,
  onRefreshSummary,
  onArchiveArtifact,
  refreshingSummary = false,
}: Props) {
  const [tab, setTab] = useState<'progress' | 'summary' | 'context' | 'employee'>('progress');
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
      .filter((a: any) => !a.archived && a.content)
      .map((a: any, i: number) => ({
        artifactId: a.id,
        name: a.name || `交付物-${i + 1}.${extensionForKind(a.kind, a.mime_type)}`,
        meta: artifactMeta(a),
        content: a.kind === 'html' ? wrapHtml(String(a.content || '')) : String(a.content || ''),
        mime: a.mime_type || mimeForKind(a.kind),
        kind: inferKindFromName(a.name || a.kind || 'FILE'),
      }));
    return dedupeOutputs([
      ...backendOutputs,
      ...files.map((f) => ({
        name: String(f),
        meta: '生成文件',
        content: String(f),
        mime: 'text/plain;charset=utf-8',
        kind: inferKindFromName(String(f)),
      })),
    ]);
  }, [files, sessionMeta?.artifacts]);

  const allEmpty = tunnels.length === 0 && conclusions.length === 0 && files.length === 0 && messages.length === 0;
  const savedSummary = sessionMeta?.task_summary?.trim();
  const taskStatus = sessionMeta?.task_status || (isProcessing ? 'running' : messages.length > 0 ? 'completed' : 'draft');
  const health = sessionMeta?.health;
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

  const tabButton = (key: typeof tab, label: string) => (
    <button
      onClick={() => setTab(key)}
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

  return (
    <aside style={{
      background: 'var(--bg-secondary)',
      borderLeft: '1px solid var(--border-subtle)',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
        {tabButton('progress', '进展')}
        {tabButton('summary', '总结')}
        {tabButton('context', '上下文')}
        {tabButton('employee', '员工')}
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
            当前会话进展
          </div>
          <div style={{ padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{
                flexShrink: 0,
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: taskStatusDot(isProcessing ? 'running' : taskStatus),
              }} />
              <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>{taskStatusLabel(isProcessing ? 'running' : taskStatus)}</strong>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>
                {tunnels.length > 0 ? `${tunnels.length} 个员工节点` : '无活动节点'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, wordBreak: 'break-word' }}>
              {latestUserMessage?.text || currentRunQueue[0]?.last_message || sessionMeta?.task_summary || '当前会话还没有任务输入。'}
            </div>
          </div>
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
                {healthLabel(health.status)} · 上下文 {health.counts?.context_injections || 0} · 交付物 {health.counts?.artifacts || 0}
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
                  补同步 / 恢复会话
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
      {tab === 'progress' && otherRunQueue.length > 0 && (
        <div style={{
          padding: '14px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--ls-uppercase)',
            marginBottom: 10,
          }}>
            其他运行中任务
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
                    {item.is_stale ? '可能中断' : taskStatusLabel(item.task_status)}
                  </span>
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {item.employee_name || (item.is_group ? '群聊协作' : '数字员工')} · {item.is_stale ? '超过 30 分钟没有更新，建议打开确认或重新发起' : (item.last_message || item.task_summary || '等待下一步')}
                </div>
              </button>
            ))}
          </div>
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
            任务闭环
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span style={{
              padding: '3px 8px',
              borderRadius: 999,
              background: taskStatusTone(taskStatus),
              color: taskStatus === 'failed' ? '#991b1b' : '#065f46',
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
            本轮上下文
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
        </div>
      )}

      {tab === 'summary' && generatedOutputs.length > 0 && (
        <div style={{ padding: '14px 12px' }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--ls-uppercase)',
            marginBottom: 10,
          }}>
            输出物
          </div>
          {generatedOutputs.map((f, i) => (
            <button key={i} type="button" onClick={() => downloadOutput(f.name, f.content, f.mime)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 0',
              width: '100%',
              borderBottom: i < generatedOutputs.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              background: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
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
                }}>{f.name}</div>
                <div style={{
                  fontSize: 10, color: 'var(--text-tertiary)',
                }}>{f.meta}</div>
              </div>
              <span
                title="下载到本地"
                aria-label="下载到本地"
                style={{
                  marginLeft: 'auto',
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  color: 'var(--text-tertiary)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <DownloadOutlined />
              </span>
              {f.artifactId && onArchiveArtifact && (
                <span
                  role="button"
                  tabIndex={0}
                  title="归档交付物"
                  aria-label="归档交付物"
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchiveArtifact(f.artifactId!);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onArchiveArtifact(f.artifactId!);
                    }
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    color: 'var(--text-tertiary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <InboxOutlined />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {tab === 'employee' && (
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
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: activeEmployee.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                  {activeEmployee.avatar}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{activeEmployee.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{activeEmployee.department || '未分配部门'}</div>
                </div>
              </div>
              <InfoRow label="部门" value={activeEmployee.department || '未分配部门'} />
              <InfoRow label="员工 ID" value={activeEmployee.uuid || String(activeEmployee.id)} />
              <InfoRow label="工具权限" value={activeEmployee.allowedToolsets?.join(', ') || '默认'} />
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

function artifactMeta(a: any) {
  const bits = [`${a.kind || 'artifact'}`, `${String(a.content || '').length} 字`];
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

function taskStatusTone(status: string) {
  if (status === 'failed') return '#fee2e2';
  if (status === 'needs_input') return '#fef3c7';
  if (status === 'running') return '#dbeafe';
  if (status === 'completed') return '#d1fae5';
  return 'var(--accent-soft)';
}

function taskStatusDot(status: string) {
  if (status === 'stale') return '#d97706';
  if (status === 'failed') return '#ef4444';
  if (status === 'needs_input') return '#f59e0b';
  if (status === 'running') return '#3b82f6';
  if (status === 'completed') return '#10b981';
  return '#8b8fa3';
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
  const last = String(item?.last_message || item?.task_summary || '').replace(/\s+/g, ' ').trim();
  if (!last) return '未命名任务';
  return last.length > 24 ? `${last.slice(0, 24)}...` : last;
}

function statusColor(status: string) {
  const s = String(status || '').toLowerCase();
  if (s.includes('fail') || s.includes('missing') || s.includes('error')) return '#dc2626';
  if (s.includes('skip')) return '#d97706';
  return 'var(--text-tertiary)';
}
