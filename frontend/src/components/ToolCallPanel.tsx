/**
 * ToolCallPanel — collapsible panel showing the agent's tool activity.
 * Renders the Hermes `hermes.tool.progress` events surfaced through the
 * Atlas SSE stream (M2.3). Each tool shows name, label, and live status.
 */
import { useState } from 'react';

export interface ToolCallItem {
  name: string;
  label?: string;
  status?: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  duration?: number | string;
  preview?: string;
  command?: string;
  delta?: string;
  hermes_run_id?: string;
  runtime_event?: string;
}

// Tool icon glyphs — single-character symbols, not decorative emoji.
// Kept as code points (not <IconXxx />) so the row stays compact and
// aligns with the dim mono text beside it. Per Atlas "calm console"
// guideline (DESIGN.md §3) we don't use full emoji in product UI.
const TOOL_ICON: Record<string, string> = {
  terminal: '⌘',
  file: '⛁',
  web: '◍',
  web_search: '◍',
  browser: '◍',
  vision: '◉',
  session_search: '⌕',
  code_execution: '⟨⟩',
  todo: '✓',
  memory: '❖',
  skills: '◆',
};

function statusColor(status?: string): string {
  if (status === 'completed') return '#3FB950';
  if (status === 'running') return '#4F46E5';
  if (status === 'error' || status === 'failed') return '#EF4444';
  return '#8B8FA3';
}

function statusLabel(status?: string): string {
  if (status === 'running') return '执行中';
  if (status === 'completed') return '完成';
  if (status === 'failed' || status === 'error') return '失败';
  if (status === 'progress') return '进行中';
  return status || '';
}

function compact(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function ToolCallPanel({ tools }: { tools: ToolCallItem[] }) {
  // Phase B (2026-06-04):默认折叠 — 学 Hermes-WebUI 的 Activity: N tools 汇总行,
  // 用户主动点击展开。已完成态折叠避免噪音,运行中态展开方便观察。
  const hasRunning = tools.some(t => t.status === 'running');
  const [open, setOpen] = useState(hasRunning);
  if (!tools || tools.length === 0) return null;

  const running = tools.some(t => t.status === 'running');

  return (
    <div style={{
      marginBottom: 8,
      border: '1px solid rgba(79,70,229,0.25)',
      borderRadius: 10,
      background: 'rgba(79,70,229,0.06)',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px', background: 'transparent', border: 'none',
          cursor: 'pointer', color: '#A9ADBE', fontSize: 12, fontWeight: 600,
        }}
      >
        <span style={{
          display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
          background: running ? '#4F46E5' : '#3FB950',
          animation: running ? 'blink 1s step-end infinite' : 'none',
        }} />
        <span>工具调用 · {tools.length}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7280' }}>
          {open ? '收起 ▲' : '展开 ▼'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '4px 12px 10px' }}>
          {tools.map((t, i) => {
            const args = compact(t.args);
            const result = compact(t.result);
            const error = compact(t.error);
            const hasDetails = Boolean(args || result || error || t.command || t.preview || t.duration || t.toolCallId);
            return (
              <details key={`${t.toolCallId || t.name}-${i}`} open={t.status === 'running' || t.status === 'failed'} style={{
                padding: '5px 0',
                borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)',
              }}>
                <summary style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12.5, cursor: hasDetails ? 'pointer' : 'default',
                  listStyle: 'none',
                }}>
                  <span style={{
                    width: 18, textAlign: 'center', color: '#7C7FE8', fontSize: 13,
                  }}>{TOOL_ICON[t.name] || '▸'}</span>
                  <span style={{ color: '#D5D7E0', fontWeight: 600 }}>{t.name}</span>
                  {t.label && (
                    <span style={{
                      color: '#8B8FA3', fontFamily: 'var(--font-mono, monospace)',
                      fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', maxWidth: 240,
                    }}>{t.label}</span>
                  )}
                  {t.duration != null && (
                    <span style={{ color: '#8B8FA3', fontSize: 11 }}>
                      {t.duration}ms
                    </span>
                  )}
                  <span style={{
                    marginLeft: 'auto', fontSize: 11, fontWeight: 600,
                    color: statusColor(t.status),
                  }}>
                    {statusLabel(t.status)}
                  </span>
                </summary>
                {hasDetails && (
                  <div style={{
                    margin: '7px 0 2px 26px',
                    display: 'grid',
                    gap: 6,
                    color: '#6B7280',
                    fontSize: 11.5,
                  }}>
                    {t.toolCallId && <MetaLine label="ID" value={t.toolCallId} />}
                    {t.command && <MetaBlock label="Command" value={t.command} />}
                    {!t.command && t.preview && <MetaBlock label="Preview" value={t.preview} />}
                    {args && <MetaBlock label="Args" value={args} />}
                    {result && <MetaBlock label="Result" value={result} />}
                    {error && <MetaBlock label="Error" value={error} tone="danger" />}
                  </div>
                )}
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: 8 }}>
      <span style={{ color: '#8B8FA3' }}>{label}</span>
      <span style={{
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: 'var(--font-mono, monospace)',
        color: '#4B5563',
      }}>{value}</span>
    </div>
  );
}

function MetaBlock({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  const display = value.length > 1400 ? `${value.slice(0, 1400)}\n...` : value;
  return (
    <div>
      <div style={{ color: '#8B8FA3', marginBottom: 3 }}>{label}</div>
      <pre style={{
        margin: 0,
        maxHeight: 180,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        border: '1px solid rgba(148,163,184,0.22)',
        borderRadius: 6,
        padding: '7px 8px',
        background: tone === 'danger' ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.55)',
        color: tone === 'danger' ? '#B91C1C' : '#374151',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 11,
        lineHeight: 1.45,
      }}>{display}</pre>
    </div>
  );
}
