import { useEffect, useState } from 'react';
import { Button, Tag, message } from 'antd';
import {
  fetchDashboardMe, fetchDashboardTenant, fetchDashboardSystem, fetchMe,
  fetchRuntimeStatus, fetchTenantIsolation, maintainStaleSessions,
} from '../services/api';

type Variant = 'me' | 'tenant' | 'system';

export default function Dashboard() {
  const [variant, setVariant] = useState<Variant>('me');
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

  useEffect(() => { load(variant); }, [variant]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['me', 'tenant', 'system'] as Variant[]).map((v) => (
          <button
            key={v}
            onClick={() => setVariant(v)}
            style={{
              padding: '6px 14px',
              background: variant === v ? 'var(--accent)' : 'var(--bg-secondary)',
              color: variant === v ? 'white' : 'inherit',
              border: '1px solid var(--border-default)',
              borderRadius: 6, cursor: 'pointer',
            }}
          >
            {v}
          </button>
        ))}
      </div>
      {loading && <div>loading…</div>}
      {err && <div style={{ color: 'var(--color-danger)' }}>error: {err}</div>}
      {!loading && !err && data && (
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
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
      borderRadius: 8, padding: 16, minWidth: 140,
    }}>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function MeView({ data }: { data: any }) {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>个人概览</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
      <TenantDiagnostics />
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
