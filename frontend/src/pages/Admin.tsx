import { useState, useEffect } from 'react';
import { Spin } from 'antd';
import type { Tenant, PlatformStats } from '../services/api';
import { fetchAdminStats, fetchTenants } from '../services/api';

const PLAN_TIER: Record<string, 'accent' | 'success' | 'warning'> = {
  enterprise: 'accent', professional: 'success', free: 'warning',
};
const STATUS_TIER: Record<string, 'success' | 'warning' | 'danger'> = {
  active: 'success', trial: 'warning', expired: 'danger',
};
const PLAN_LABEL: Record<string, string> = { enterprise: 'Enterprise', professional: 'Standard', free: 'Trial' };
const STATUS_LABEL: Record<string, string> = { active: '活跃', trial: '试用中', expired: '已过期' };

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

export default function Admin() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchAdminStats(), fetchTenants()])
      .then(([s, t]) => { setStats(s); setTenants(t); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const adminStats = stats ? [
    { label: '租户总数', value: String(stats.total_tenants), delta: `${stats.active_tenants} 活跃`, up: true },
    { label: '活跃员工', value: String(stats.active_employees), delta: `共 ${stats.total_employees}`, up: true },
    { label: 'Token 本月', value: formatTokens(stats.total_tokens), delta: `${stats.total_messages} 条消息`, up: true },
    { label: '平均响应', value: stats.avg_response_time_ms ? `${stats.avg_response_time_ms}ms` : '-', delta: '', up: true },
    { label: '对话总数', value: String(stats.total_conversations), delta: '', up: true },
    { label: '运行时间', value: stats.uptime_hours ? `${stats.uptime_hours.toFixed(1)}h` : '-', delta: '', up: true },
  ] : [];

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>;

  return (
    <div className="atlas-page">
      <h1 className="atlas-page-title">管理后台</h1>
      <p className="atlas-page-desc">平台运行概览与租户管理</p>

      <div className="atlas-stats">
        {adminStats.map((s) => (
          <div className="atlas-stat" key={s.label}>
            <span className="atlas-stat-label">{s.label}</span>
            <span className="atlas-stat-value">{s.value}</span>
            <span className={`atlas-stat-delta ${s.up ? 'up' : 'down'}`}>{s.delta}</span>
          </div>
        ))}
      </div>

      <div className="atlas-page-section">
        <div className="atlas-section-label">租户管理</div>
        {tenants.map((t) => (
          <div className="atlas-row" key={t.id}>
            <div className={`atlas-row-bar atlas-row-bar--${STATUS_TIER[t.status] === 'danger' ? 'danger' : STATUS_TIER[t.status] === 'warning' ? 'warning' : 'success'}`} />
            <div className="atlas-row-body">
              <div className="atlas-row-primary">{t.name}</div>
              <div className="atlas-row-meta">
                <span className="atlas-row-meta-item">员工 {t.employee_count}</span>
                <span className="atlas-row-meta-item">Token {formatTokens(t.monthly_tokens)}</span>
              </div>
            </div>
            <div className="atlas-row-right">
              <span className={`atlas-chip atlas-chip--${PLAN_TIER[t.plan] || 'neutral'}`}>{PLAN_LABEL[t.plan] || t.plan}</span>
              <span className={`atlas-chip atlas-chip--${STATUS_TIER[t.status] || 'neutral'}`}>{STATUS_LABEL[t.status] || t.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
