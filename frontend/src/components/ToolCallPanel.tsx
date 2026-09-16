/**
 * ToolCallPanel — collapsible panel showing the agent's tool activity.
 * Renders the Hermes `hermes.tool.progress` events surfaced through the
 * InsightLab SSE stream (M2.3). Each tool shows name, label, and live status.
 */
import { useState } from 'react';

export interface ToolCallItem {
  name: string;
  label?: string;
  status?: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
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

// Tool icon glyphs — single-character symbols, not decorative emoji.
// Kept as code points (not <IconXxx />) so the row stays compact and
// aligns with the dim mono text beside it. Per InsightLab "calm console"
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

function statusColor(status?: string, softened = false): string {
  if (softened && (status === 'failed' || status === 'error')) return '#F59E0B';
  if (status === 'completed') return '#3FB950';
  if (status === 'running') return '#4F46E5';
  if (status === 'error' || status === 'failed') return '#EF4444';
  return '#8B8FA3';
}

function statusLabel(status?: string, softened = false): string {
  if (status === 'running') return '执行中';
  if (status === 'completed') return '完成';
  if (status === 'failed' || status === 'error') return softened ? '未采用' : '失败';
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

function compactError(value: unknown): string {
  if (value === false || value == null || value === '') return '';
  if (typeof value === 'string') {
    const clean = value.trim().toLowerCase();
    if (!clean || clean === 'false' || clean === 'null' || clean === 'undefined') return '';
  }
  if (value === true) return '工具调用失败，但运行时没有返回具体错误信息。';
  return compact(value);
}

function isFalseErrorMarker(value: unknown): boolean {
  return value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false');
}

function displayStatus(status: string | undefined, rawError: unknown): string | undefined {
  if (isFalseErrorMarker(rawError) && (status === 'failed' || status === 'error')) return 'completed';
  return status;
}

function formatElapsedMs(value: number | string | undefined): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
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

function formatToolWait(t: ToolCallItem, status?: string): string {
  const explicit = formatElapsedMs(t.waitDurationMs);
  if (explicit) return status === 'running' || status === 'progress' ? `已等待 ${explicit}` : `等待 ${explicit}`;
  const started = parseTimeMs(t.startedAt);
  if (started) {
    const ended = parseTimeMs(t.completedAt) || Date.now();
    const elapsed = formatElapsedMs(Math.max(0, ended - started));
    if (elapsed) return status === 'running' || status === 'progress' ? `已等待 ${elapsed}` : `等待 ${elapsed}`;
  }
  if (t.duration != null && t.duration !== '') {
    const n = typeof t.duration === 'number' ? t.duration : Number(t.duration);
    if (Number.isFinite(n) && n > 0) return `工具耗时 ${formatElapsedMs(n * 1000)}`;
  }
  return '';
}

export default function ToolCallPanel({ tools, hasDeliverables = false }: { tools: ToolCallItem[]; hasDeliverables?: boolean }) {
  // Phase B (2026-06-04):默认折叠 — 学 Hermes-WebUI 的 Activity: N tools 汇总行,
  // 用户主动点击展开。已完成态折叠避免噪音,运行中态展开方便观察。
  const hasRunning = tools.some(t => displayStatus(t.status, t.error) === 'running');
  const [open, setOpen] = useState(hasRunning);
  if (!tools || tools.length === 0) return null;

  const running = tools.some(t => displayStatus(t.status, t.error) === 'running');
  const failedCount = tools.filter(t => ['failed', 'error'].includes(displayStatus(t.status, t.error) || '')).length;
  const completedCount = tools.filter(t => displayStatus(t.status, t.error) === 'completed').length;
  const softenFailures = hasDeliverables && completedCount > 0 && failedCount > 0;

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
          background: running ? '#4F46E5' : softenFailures ? '#F59E0B' : failedCount > 0 ? '#EF4444' : '#3FB950',
          animation: running ? 'blink 1s step-end infinite' : 'none',
        }} />
        <span>
          工具调用 · {tools.length}
          {softenFailures ? ' · 部分未采用' : failedCount > 0 ? ` · ${failedCount} 个失败` : ''}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7280' }}>
          {open ? '收起 ▲' : '展开 ▼'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '4px 12px 10px' }}>
          {tools.map((t, i) => {
            const args = compact(t.args);
            const result = compact(t.result);
            const error = compactError(t.error);
            const status = displayStatus(t.status, t.error);
            const softened = softenFailures && (status === 'failed' || status === 'error');
            const durationText = formatToolWait(t, status);
            const hasDetails = Boolean(args || result || error || t.command || t.preview || durationText || t.toolCallId);
            return (
              <details key={`${t.toolCallId || t.name}-${i}`} open={status === 'running' || status === 'failed'} style={{
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
                  {durationText && (
                    <span style={{ color: '#8B8FA3', fontSize: 11 }}>
                      {durationText}
                    </span>
                  )}
                  <span style={{
                    marginLeft: 'auto', fontSize: 11, fontWeight: 600,
                    color: statusColor(status, softened),
                  }}>
                    {statusLabel(status, softened)}
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
                    {softened && (
                      <MetaLine label="说明" value="本轮已有交付物入库，该工具结果未被最终采用。" />
                    )}
                    {error && <MetaBlock label="Error" value={error} tone={softened ? undefined : "danger"} />}
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
