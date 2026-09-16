import { lazy, Suspense, useEffect, useState } from 'react';
import { Button, Tag, message } from 'antd';
import {
  fetchDashboardMe, fetchDashboardTenant, fetchDashboardSystem, fetchMe,
  fetchRuntimeStatus, fetchTenantIsolation, maintainStaleSessions,
  fetchArtifacts, archiveArtifact, downloadProtectedFile, previewArtifact,
  type FilePreviewPayload,
} from '../services/api';

const ArtifactPreviewDrawer = lazy(() => import('../components/ArtifactPreviewDrawer'));
const HtmlArtifact = lazy(() => import('../components/HtmlArtifact'));
const MarkdownArtifact = lazy(() => import('../components/MarkdownArtifact'));

type Variant = 'me' | 'tenant' | 'system';

export default function Dashboard() {
  const [variant, setVariant] = useState<Variant | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async (v: Variant) => {
    setLoading(true); setErr(null);
    try {
      let d: any;
      if (v === 'me') d = await fetchDashboardMe();
      else if (v === 'tenant') d = await fetchDashboardTenant();
      else d = await fetchDashboardSystem();
      setData(d);
    } catch (ex: any) {
      setErr(ex?.message || String(ex));
    } finally { setLoading(false); }
  };

  useEffect(() => { (async () => {
    try {
      const m = await fetchMe();
      const role = m?.role || m?.user?.role;
      if (role === 'system_admin') setVariant('system');
      else if (role === 'tenant_admin') setVariant('tenant');
      else setVariant('me');
    } catch (e) { setVariant('me'); }
  })(); }, []);

  useEffect(() => {
    if (variant) void load(variant);
  }, [variant]);

  return (
    <div className="admin-console">
      <section className="admin-hero">
        <div>
          <div className="admin-kicker">Enterprise Control Tower</div>
          <h1 className="admin-title">Dashboard</h1>
          <p className="admin-subtitle">
            按个人、租户、系统三个视角查看数智员工、会话、Token、文件、Skill 健康和 Hermes Runtime 状态。
          </p>
        </div>
      </section>
      <div className="admin-tabs">
        {(['me', 'tenant', 'system'] as Variant[]).map((v) => (
          <button
            key={v}
            onClick={() => setVariant(v)}
            className={`admin-tab ${variant === v ? 'active' : ''}`}
          >
            {v}
          </button>
        ))}
      </div>
      {(loading || !variant) && <div>loading…</div>}
      {err && <div style={{ color: 'var(--color-danger)' }}>error: {err}</div>}
      {!loading && !err && data && variant && (
        <div>
          {variant === 'me' && <MeView data={data} />}
          {variant === 'tenant' && <TenantView data={data} onReload={() => load(variant)} />}
          {variant === 'system' && <SystemView data={data} />}
        </div>
      )}
    </div>
  );
}

function num(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function text(value: any, fallback = '未启动') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function Metric({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
      {sub && <div className="admin-stat-hint">{sub}</div>}
    </div>
  );
}

const filterInputStyle = {
  height: 30,
  borderRadius: 6,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  padding: '0 10px',
  outline: 'none',
} as const;

function MeView({ data }: { data: any }) {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>个人概览</h3>
      <div className="admin-stat-grid">
        <Metric label="员工数" value={num(data.employees)} />
        <Metric label="我的会话" value={num(data.sessions)} />
        <Metric label="个人 Memory" value={num(data.memories)} />
        <Metric label="Token" value={num(data.total_tokens)} sub={`in ${num(data.input_tokens)} / out ${num(data.output_tokens)}`} />
        <Metric label="文件" value={num(data.files)} sub={`${formatBytes(num(data.file_bytes))} · 过期 ${num(data.expired_files)}`} />
      </div>
      <InfoStrip items={[
        ['租户', data.tenant?.name || data.tenant?.slug || '当前租户'],
        ['用户', data.user?.email || '当前用户'],
        ['角色', data.user?.role || data.role || 'user'],
      ]} />
    </div>
  );
}

function TenantView({ data, onReload }: { data: any; onReload?: () => Promise<void> | void }) {
  const gw = data.gateway || {};
  const maturity = data.maturity || {};
  const maturityTone = toneForMaturity(num(maturity.score, 100));
  const [maintaining, setMaintaining] = useState(false);
  const staleCount = num(maturity.signals?.stale_sessions);
  const handleMaintainStale = async () => {
    setMaintaining(true);
    try {
      const res = await maintainStaleSessions(50);
      message.success(`已维护 ${res?.updated || 0} 个陈旧任务`);
      await onReload?.();
    } catch (ex: any) {
      message.error(`维护失败: ${ex?.message || ex}`);
    } finally {
      setMaintaining(false);
    }
  };
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>租户概览 — {data.tenant?.slug}</h3>
      {maturity.score !== undefined && (
        <div style={{
          marginBottom: 16,
          padding: 16,
          borderRadius: 8,
          border: `1px solid ${maturityTone.border}`,
          background: maturityTone.bg,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>产品成熟度</div>
              <div style={{ fontSize: 30, fontWeight: 800 }}>{maturity.score}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <Tag color={maturity.score >= 90 ? 'green' : maturity.score >= 75 ? 'gold' : 'red'}>
                {maturity.level || 'pilot'}
              </Tag>
              <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                Runtime {maturity.signals?.runtime_ok ? '健康' : '需检查'} · 卡住任务 {num(maturity.signals?.stale_sessions)} · 上下文覆盖 {Math.round(num(maturity.signals?.context_coverage) * 100)}% · 交付物覆盖 {Math.round(num(maturity.signals?.artifact_coverage) * 100)}%
              </div>
            </div>
            {staleCount > 0 && (
              <Button size="small" loading={maintaining} onClick={handleMaintainStale} style={{ marginLeft: 'auto' }}>
                维护陈旧任务
              </Button>
            )}
          </div>
          {maturity.risk_items?.length > 0 && (
            <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
              {maturity.risk_items.slice(0, 4).map((risk: any) => (
                <div key={risk.code} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <strong>{risk.severity}</strong> · {risk.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <PriorityActions data={data} onMaintainStale={handleMaintainStale} maintaining={maintaining} />
      <div className="admin-stat-grid">
        <Metric label="用户" value={num(data.users)} />
        <Metric label="员工" value={num(data.employees)} />
        <Metric label="会话" value={num(data.sessions)} sub={`max: ${data.tenant?.max_sessions ?? '∞'}`} />
        <Metric label="Memory" value={num(data.memories)} />
        <Metric label="Skills 可用" value={num(data.skills_available)} />
        <Metric label="Token" value={num(data.token_usage?.total)}
          sub={`in ${num(data.token_usage?.input)} / out ${num(data.token_usage?.output)}`} />
        <Metric label="文件" value={num(data.files?.count)}
          sub={`${formatBytes(num(data.files?.bytes))} · expired ${num(data.files?.expired)}`} />
        <Metric label="失败率" value={`${Math.round(num(data.failure_rate) * 1000) / 10}%`} />
        <Metric label="任务交付物" value={num(data.artifacts?.count)} sub={Object.entries(data.artifacts?.kinds || {}).map(([k, v]) => `${k}:${v}`).join(' · ') || '暂无'} />
        <Metric label="Skill 失败率" value={`${Math.round(num(data.skill_health?.failure_rate) * 1000) / 10}%`}
          sub={`recent ${num(data.skill_health?.runs)}/${num(data.skill_health?.total_runs)} · fail ${num(data.skill_health?.failures)}`} />
        <Metric label="Gateway" value={text(gw.status)}
          sub={gw.port ? `port ${gw.port} · pid ${gw.pid}` : 'no runtime'} />
      </div>
      {data.task_status_counts && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8 }}>任务状态</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(data.task_status_counts).map(([status, count]) => (
              <Tag key={status} color={status === 'failed' ? 'red' : status === 'completed' ? 'green' : 'blue'}>
                {status} · {String(count)}
              </Tag>
            ))}
          </div>
        </div>
      )}
      {data.skill_usage && data.skill_usage.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8 }}>Skill 使用</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {data.skill_usage.slice(0, 20).map((s: any, idx: number) => (
              <Tag key={`${s.id}-${idx}`} color="blue">{s.name} · {s.target_type}</Tag>
            ))}
          </div>
        </div>
      )}
      {data.skill_health?.recent_errors?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8 }}>Skill 最近错误</h4>
          {data.skill_health.recent_errors.slice(0, 6).map((err: any, idx: number) => (
            <div key={`${err.skill_id}-${idx}`} style={{ padding: 8, borderBottom: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: 12 }}>
              <strong>{err.skill_name || err.skill_id}</strong> · {err.created_at} · {err.error}
            </div>
          ))}
        </div>
      )}
      <ArtifactGovernance />
      <TenantDiagnostics />
    </div>
  );
}

function PriorityActions({
  data,
  onMaintainStale,
  maintaining,
}: {
  data: any;
  onMaintainStale?: () => Promise<void> | void;
  maintaining?: boolean;
}) {
  const maturity = data.maturity || {};
  const signals = maturity.signals || {};
  const items = [
    !signals.runtime_ok
      ? { tone: 'danger', title: 'Runtime 需要检查', detail: 'Gateway 或 Hermes Runtime 状态异常，优先确认模型与 Skill 是否可用。' }
      : null,
    num(signals.stale_sessions) > 0
      ? { tone: 'warning', title: `${num(signals.stale_sessions)} 个任务正在后台处理`, detail: 'InsightLab 会继续自动同步结果；必要时可查看回放和检查点。', action: '查看后台任务' }
      : null,
    num(data.failure_rate) > 0.08
      ? { tone: 'danger', title: '会话失败率偏高', detail: `当前失败率 ${Math.round(num(data.failure_rate) * 1000) / 10}%，建议查看审计日志和最近工具错误。` }
      : null,
    num(data.skill_health?.failure_rate) > 0.05
      ? { tone: 'warning', title: 'Skill 调用有波动', detail: `Skill 失败率 ${Math.round(num(data.skill_health?.failure_rate) * 1000) / 10}%，建议核对安装状态和最近错误。` }
      : null,
    num(signals.artifact_coverage) < 0.5 && num(data.sessions) > 0
      ? { tone: 'info', title: '交付物闭环偏弱', detail: '有会话产生回复但没有沉淀交付物，建议检查 HTML/Markdown/文件入库链路。' }
      : null,
  ].filter(Boolean) as Array<{ tone: string; title: string; detail: string; action?: string }>;

  if (items.length === 0) {
    items.push({ tone: 'success', title: '今日主链路健康', detail: 'Runtime、任务恢复、Skill 和交付物覆盖暂未发现高优先级风险。' });
  }

  return (
    <div style={{
      marginBottom: 16,
      padding: 14,
      border: '1px solid var(--border-default)',
      borderRadius: 10,
      background: 'linear-gradient(135deg, color-mix(in srgb, var(--bg-elevated) 92%, transparent), color-mix(in srgb, var(--accent-soft) 42%, transparent))',
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: 14 }}>今日优先处理</strong>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>按风险和闭环影响排序</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {items.slice(0, 4).map((item) => {
          const tone = priorityTone(item.tone);
          return (
            <div key={item.title} style={{
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${tone.border}`,
              background: tone.bg,
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: tone.dot, boxShadow: `0 0 0 4px ${tone.dot}18` }} />
                <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>{item.title}</strong>
              </div>
              <div style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.55 }}>{item.detail}</div>
              {item.action && onMaintainStale && (
                <Button size="small" loading={maintaining} onClick={onMaintainStale} style={{ marginTop: 10 }}>
                  {item.action}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function priorityTone(tone: string) {
  if (tone === 'danger') return { dot: '#ef4444', border: 'rgba(239,68,68,0.28)', bg: 'color-mix(in srgb, #ef4444 8%, var(--bg-secondary))' };
  if (tone === 'warning') return { dot: '#f59e0b', border: 'rgba(245,158,11,0.28)', bg: 'color-mix(in srgb, #f59e0b 8%, var(--bg-secondary))' };
  if (tone === 'success') return { dot: '#10b981', border: 'rgba(16,185,129,0.28)', bg: 'color-mix(in srgb, #10b981 8%, var(--bg-secondary))' };
  return { dot: '#3b82f6', border: 'rgba(59,130,246,0.28)', bg: 'color-mix(in srgb, #3b82f6 8%, var(--bg-secondary))' };
}

function ArtifactGovernance() {
  const [items, setItems] = useState<any[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [managedStatus, setManagedStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchArtifacts({
        includeArchived,
        query: query.trim() || undefined,
        kind: kind || undefined,
        managedStatus: managedStatus || undefined,
        limit: 30,
      });
      setItems(res.items || []);
    } catch (ex: any) {
      message.error(`交付物加载失败: ${ex?.message || ex}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [includeArchived, kind, managedStatus]);

  const archive = async (id: string) => {
    try {
      await archiveArtifact(id);
      message.success('交付物已归档');
      await load();
    } catch (ex: any) {
      message.error(`归档失败: ${ex?.message || ex}`);
    }
  };

  const download = async (row: any) => {
    try {
      await downloadProtectedFile(`/api/artifacts/${row.id}/download`, row.name);
    } catch (ex: any) {
      message.error(`下载失败: ${ex?.message || ex}`);
    }
  };

  const openPreview = async (row: any) => {
    setPreviewLoadingId(row.id);
    try {
      const res = await previewArtifact(row.id);
      setPreview(res);
    } catch (ex: any) {
      message.error(`预览失败: ${ex?.message || ex}`);
    } finally {
      setPreviewLoadingId(null);
    }
  };

  return (
    <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h4 style={{ margin: 0 }}>交付物治理</h4>
        <Tag color="blue">受控存储</Tag>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{items.length} 条</span>
        <label style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          包含归档
        </label>
        <Button size="small" loading={loading} onClick={load}>刷新</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 130px 150px 80px', gap: 8, marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
          placeholder="搜索文件名，例如：浪潮、尽调、HTML"
          style={filterInputStyle}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={filterInputStyle}>
          <option value="">全部类型</option>
          <option value="html">HTML</option>
          <option value="markdown">Markdown</option>
          <option value="report">Report</option>
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
        <select value={managedStatus} onChange={(e) => setManagedStatus(e.target.value)} style={filterInputStyle}>
          <option value="">全部受控状态</option>
          <option value="managed">managed</option>
          <option value="pending">pending</option>
          <option value="missing">missing</option>
          <option value="failed">failed</option>
        </select>
        <Button size="small" loading={loading} onClick={load}>搜索</Button>
      </div>
      {items.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>暂无交付物。真实任务生成的 HTML、Markdown、CSV、报告会被收编到这里。</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((row) => (
            <div key={row.id} style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(180px, 1.5fr) 90px 110px 90px 210px',
              gap: 10,
              alignItems: 'center',
              padding: 10,
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              background: 'var(--bg-primary)',
              fontSize: 12,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.name}
                </div>
                <div style={{ color: 'var(--text-tertiary)', marginTop: 3 }}>
                  v{row.version || 1} · {String(row.session_id || '').slice(0, 8)} · {formatBytes(num(row.storage_size))}
                </div>
              </div>
              <Tag color={kindColor(row.kind)}>{row.kind || 'artifact'}</Tag>
              <Tag color={row.managed_status === 'managed' ? 'green' : row.managed_status === 'failed' ? 'red' : 'gold'}>
                {row.managed_status || 'pending'}
              </Tag>
              <Tag color={row.status === 'final' ? 'green' : row.status === 'archived' ? 'default' : 'blue'}>{row.status || 'active'}</Tag>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <Button size="small" loading={previewLoadingId === row.id} onClick={() => openPreview(row)}>预览</Button>
                <Button size="small" onClick={() => download(row)}>下载</Button>
                {!row.archived && <Button size="small" danger onClick={() => archive(row.id)}>归档</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <Suspense fallback={null}>
        <ArtifactPreviewDrawer
          open={!!preview}
          onClose={() => setPreview(null)}
          title={preview ? `交付物预览 · ${preview.name}` : '交付物预览'}
        >
          {preview && <ManagedArtifactPreview preview={preview} />}
        </ArtifactPreviewDrawer>
      </Suspense>
    </div>
  );
}

function ManagedArtifactPreview({ preview }: { preview: FilePreviewPayload }) {
  const content = preview.content || '';
  const kind = String(preview.preview_kind || '').toLowerCase();
  const mime = String(preview.mime_type || '').toLowerCase();
  const name = String(preview.name || '');
  if (kind === 'html' || mime.includes('html') || /\.html?$/i.test(name)) {
    return (
      <Suspense fallback={<pre>{content}</pre>}>
        <HtmlArtifact code={content} />
      </Suspense>
    );
  }
  if (kind === 'markdown' || mime.includes('markdown') || /\.md$/i.test(name)) {
    return (
      <Suspense fallback={<pre>{content}</pre>}>
        <MarkdownArtifact code={content} />
      </Suspense>
    );
  }
  return (
    <div style={{ padding: 18, background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: 8 }}>
      <div style={{ marginBottom: 10, color: 'var(--text-tertiary)', fontSize: 12 }}>
        {preview.mime_type || 'text/plain'} · {formatBytes(num(preview.size))}
      </div>
      <pre style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--text-primary)',
        fontSize: 13,
        lineHeight: 1.7,
      }}>
        {content || '该交付物没有可在线渲染的文本内容，请下载查看。'}
      </pre>
    </div>
  );
}

function TenantDiagnostics() {
  const [runtime, setRuntime] = useState<any>(null);
  const [isolation, setIsolation] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, i] = await Promise.all([fetchRuntimeStatus(), fetchTenantIsolation()]);
      setRuntime(r);
      setIsolation(i);
    } catch (ex: any) {
      message.error('诊断失败: ' + (ex?.message || ex));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h4 style={{ margin: 0 }}>Runtime / 租户隔离诊断</h4>
        <Button size="small" loading={loading} onClick={load}>刷新诊断</Button>
      </div>
      {!runtime && !isolation && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>点击刷新，检查 Gateway、模型、Skill 列表、Hermes home 与文件根目录。</div>
      )}
      {runtime && (
        <div style={{ marginTop: 8 }}>
          <strong>Hermes Runtime</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            <Tag color={runtime.checks?.health?.ok ? 'green' : 'red'}>gateway {runtime.runtime?.status || 'unknown'}</Tag>
            <Tag color={runtime.checks?.models?.ok ? 'green' : 'orange'}>models {runtime.checks?.models?.count ?? (runtime.checks?.models?.ok ? 'ok' : '-')}</Tag>
            <Tag color={runtime.checks?.skills?.ok ? 'green' : 'orange'}>skills {runtime.checks?.skills?.count ?? (runtime.checks?.skills?.ok ? 'ok' : '-')}</Tag>
            <Tag color={runtime.checks?.capabilities?.ok ? 'green' : 'orange'}>capabilities {runtime.checks?.capabilities?.ok ? 'ok' : '-'}</Tag>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>
            {runtime.runtime?.gateway_base_url || 'no gateway'} · pid {runtime.runtime?.pid || '-'}
          </div>
        </div>
      )}
      {isolation && (
        <div style={{ marginTop: 12 }}>
          <strong>租户隔离</strong>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            <div>Hermes home: <code>{isolation.paths?.hermes_home}</code></div>
            <div>上传根目录: <code>{isolation.paths?.uploads_root}</code></div>
            <div>
              检查:
              {(isolation.checks || []).map((c: any) => (
                <Tag key={c.name} color={c.ok ? 'green' : 'red'} style={{ marginLeft: 6 }}>{c.name}</Tag>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SystemView({ data }: { data: any }) {
  const gw = data.gateways || {};
  const tenantsTotal = data.tenants_total ?? data.tenants;
  const tenantsActive = data.tenants_active ?? data.active_tenants;
  const usersTotal = data.users_total ?? data.users ?? data.active_users;
  const employeesTotal = data.employees_total ?? data.employees;
  const sessionsTotal = data.sessions_total ?? data.sessions;
  const memoriesTotal = data.memories_total ?? data.memories;
  const skillsTotal = data.skills_total ?? data.skills_available ?? data.skills;
  const skillBindingsTotal = data.skill_bindings_total ?? data.skill_bindings;
  const filesTotal = data.files_total ?? data.files;
  const fileBytesTotal = data.file_bytes_total ?? data.file_bytes;
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>系统总览 (system_admin)</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Metric label="租户" value={num(tenantsTotal)} sub={`active: ${num(tenantsActive)}`} />
        <Metric label="用户" value={num(usersTotal)} />
        <Metric label="员工" value={num(employeesTotal)} />
        <Metric label="会话" value={num(sessionsTotal)} />
        <Metric label="Memory" value={num(memoriesTotal)} />
        <Metric label="Skills" value={num(skillsTotal)} sub={`bindings: ${num(skillBindingsTotal)}`} />
        <Metric label="文件" value={num(filesTotal)} sub={formatBytes(num(fileBytesTotal))} />
        <Metric label="Token" value={num(data.token_usage?.total ?? data.total_tokens)}
          sub={`in ${num(data.token_usage?.input ?? data.input_tokens)} / out ${num(data.token_usage?.output ?? data.output_tokens)}`} />
        <Metric label="Gateway 运行" value={num(gw.running)} sub={`total ${num(gw.total)} · err ${num(gw.error)} · crashed ${num(gw.crashed)}`} />
      </div>
      {data.top_skills && data.top_skills.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8 }}>Top Skills (by bindings)</h4>
          {data.top_skills.map((s: any) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderBottom: '1px solid var(--border-default)' }}>
              <strong>{s.name}</strong>
              <Tag color="blue">{s.scope}</Tag>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{s.bindings} bindings</span>
            </div>
          ))}
        </div>
      )}
      <InfoStrip items={[
        ['当前租户', data.tenant?.name || data.tenant?.slug || 'Demo Tenant'],
        ['当前用户', data.user?.email || 'system_admin'],
        ['失败率', `${Math.round(num(data.failure_rate) * 1000) / 10}%`],
      ]} />
      <ArtifactGovernance />
    </div>
  );
}

function toneForMaturity(score: number) {
  const color = score >= 90 ? '#10b981' : score >= 75 ? '#f59e0b' : '#ef4444';
  return {
    bg: `color-mix(in srgb, ${color} 10%, var(--bg-primary))`,
    border: `color-mix(in srgb, ${color} 36%, var(--border-default))`,
  };
}

function InfoStrip({ items }: { items: Array<[string, string]> }) {
  return (
    <div style={{
      marginTop: 16,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      color: 'var(--text-secondary)',
      fontSize: 13,
    }}>
      {items.map(([label, value]) => (
        <span key={label} style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-default)',
          borderRadius: 999,
          padding: '6px 10px',
        }}>
          <strong style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>{label}</strong>
          {value}
        </span>
      ))}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function kindColor(kind: string) {
  const k = String(kind || '').toLowerCase();
  if (k.includes('html')) return 'purple';
  if (k.includes('markdown') || k === 'md') return 'blue';
  if (k.includes('csv') || k.includes('table') || k.includes('json')) return 'cyan';
  if (k.includes('report')) return 'gold';
  return 'default';
}
