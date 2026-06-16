import { useEffect, useState } from 'react';
import { Switch, Button, Alert, Spin, Tag, Select, Space, Input, message } from 'antd';
import {
  fetchModels, fetchRuntimeHealth, fetchRuntimeStatus,
  fetchToolsetGovernance, updateEmployeeToolsets,
  fetchRuntimeDiagnostics, fetchRuntimeLogs, runRuntimeOperation,
} from '../services/api';

/* ── Data ── */
const apiKeys = [
  { name: '企业模型网关 Key', prefix: '由 Hermes Gateway 托管', lastUsed: '运行时代理' },
  { name: 'OpenAtlas API Token', prefix: '按租户签发', lastUsed: '当前会话' },
];

const securityItems = [
  { label: '敏感词自动拦截', desc: '对话中检测到敏感词自动拦截并通知管理员', checked: true },
  { label: '对话记录留存', desc: '所有对话记录保留 180 天', checked: true },
  { label: '租户数据隔离', desc: '不同租户数据严格隔离', checked: true },
  { label: 'PII 自动脱敏', desc: '自动识别并脱敏个人身份信息', checked: true },
  { label: 'IP 白名单', desc: '限制只有指定 IP 才能访问管理后台', checked: false },
];

const notifyItems = [
  { label: '异常告警', desc: '员工离线、模型异常等', checked: true },
  { label: 'Token 用量告警', desc: '用量达到预算 80% 时通知', checked: true },
  { label: '安全事件通知', desc: '敏感词拦截、权限变更等', checked: true },
  { label: '日报推送', desc: '每日运行摘要推送至企业微信', checked: false },
];

/* ── SVG Icons (stroke-width 1.5, currentColor) ── */
const IconCloud = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
  </svg>
);
const IconKey = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);
const IconDb = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
  </svg>
);
const IconShield = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
const IconBell = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

const TABS = [
  { key: 'models', label: '模型网关', icon: <IconCloud /> },
  { key: 'ops', label: '运维诊断', icon: <IconShield /> },
  { key: 'toolsets', label: '工具治理', icon: <IconDb /> },
  { key: 'apikeys', label: 'API Keys', icon: <IconKey /> },
  { key: 'knowledge', label: '知识库', icon: <IconDb /> },
  { key: 'security', label: '安全合规', icon: <IconShield /> },
  { key: 'notifications', label: '通知偏好', icon: <IconBell /> },
];

function RuntimeTile({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: 'success' | 'warn' }) {
  return (
    <div style={{
      minWidth: 0,
      padding: 12,
      borderRadius: 8,
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-secondary)',
    }}>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{
        color: tone === 'success' ? '#047857' : tone === 'warn' ? '#B45309' : 'var(--text-primary)',
        fontWeight: 700,
        fontSize: 18,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{String(value ?? '-')}</div>
      {sub && (
        <div style={{
          marginTop: 5,
          color: 'var(--text-tertiary)',
          fontSize: 11,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>{sub}</div>
      )}
    </div>
  );
}

function PreBox({ value, minHeight = 180 }: { value: any; minHeight?: number }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
  return (
    <pre style={{
      minHeight,
      maxHeight: 360,
      overflow: 'auto',
      margin: 0,
      padding: 12,
      borderRadius: 8,
      border: '1px solid var(--border-subtle)',
      background: '#0F172A',
      color: '#E2E8F0',
      fontSize: 12,
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap',
    }}>{text || '暂无输出'}</pre>
  );
}

function riskColor(risk?: string) {
  if (risk === 'high') return 'red';
  if (risk === 'medium') return 'orange';
  return 'green';
}

/* ── Page ── */
export default function Settings() {
  const [activeTab, setActiveTab] = useState('models');
  const [models, setModels] = useState<any[]>([]);
  const [runtime, setRuntime] = useState<any>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [toolsetGov, setToolsetGov] = useState<any>(null);
  const [toolsetLoading, setToolsetLoading] = useState(false);
  const [opsDiagnostics, setOpsDiagnostics] = useState<any>(null);
  const [opsOutput, setOpsOutput] = useState<any>(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [logKind, setLogKind] = useState('gateway');
  const [logTail, setLogTail] = useState('120');

  useEffect(() => {
    if (activeTab !== 'models') return;
    setModelsLoading(true);
    setModelsError(null);
    Promise.all([
      fetchModels(),
      fetchRuntimeHealth().catch((e: any) => ({ ok: false, error: e?.message || String(e) })),
      fetchRuntimeStatus().catch((e: any) => ({ error: e?.message || String(e), checks: {} })),
    ])
      .then(([modelResp, healthResp, runtimeResp]) => {
        setModels(Array.isArray(modelResp?.data) ? modelResp.data : []);
        setRuntime({ ...runtimeResp, gateway_health: healthResp });
      })
      .catch((e: any) => setModelsError(e?.message || String(e)))
      .finally(() => setModelsLoading(false));
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'toolsets') return;
    setToolsetLoading(true);
    fetchToolsetGovernance()
      .then(setToolsetGov)
      .catch((e: any) => message.error('工具治理读取失败: ' + (e?.message || e)))
      .finally(() => setToolsetLoading(false));
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'ops') return;
    setOpsLoading(true);
    fetchRuntimeDiagnostics()
      .then(setOpsDiagnostics)
      .catch((e: any) => setOpsDiagnostics({ error: e?.message || String(e) }))
      .finally(() => setOpsLoading(false));
  }, [activeTab]);

  const reloadToolsetGov = async () => {
    setToolsetLoading(true);
    try {
      setToolsetGov(await fetchToolsetGovernance());
    } finally {
      setToolsetLoading(false);
    }
  };

  const saveEmployeeToolsets = async (employeeId: string, toolsets: string[]) => {
    try {
      await updateEmployeeToolsets(employeeId, toolsets);
      message.success('员工工具集已更新');
      await reloadToolsetGov();
    } catch (e: any) {
      message.error('更新失败: ' + (e?.message || e));
    }
  };

  const runOp = async (action: string) => {
    setOpsLoading(true);
    try {
      const r = await runRuntimeOperation(action);
      setOpsOutput(r);
      message.success(`${action} 已执行`);
    } catch (e: any) {
      setOpsOutput({ ok: false, error: e?.message || String(e) });
    } finally {
      setOpsLoading(false);
    }
  };

  const loadLogs = async () => {
    setOpsLoading(true);
    try {
      setOpsOutput(await fetchRuntimeLogs(logKind, Number(logTail) || 120));
    } catch (e: any) {
      setOpsOutput({ ok: false, error: e?.message || String(e) });
    } finally {
      setOpsLoading(false);
    }
  };

  return (
    <div className="atlas-page">
      <h1 className="atlas-page-title">设置</h1>
      <p className="atlas-page-desc">平台配置与安全管理</p>

      <div style={{ display: 'flex', marginTop: 32, minHeight: 480 }}>
        {/* ── Vertical tab nav ── */}
        <nav className="atlas-tab-nav">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`atlas-tab-item ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        {/* ── Tab content ── */}
        <div className="atlas-tab-content">
          {activeTab === 'models' && (
            <div>
              <div className="atlas-section-label">Hermes Runtime</div>
              {modelsLoading && <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>}
              {modelsError && <Alert type="error" showIcon message="模型网关读取失败" description={modelsError} style={{ marginBottom: 12 }} />}
              {!modelsLoading && !modelsError && runtime && (
                <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 10,
                  }}>
                    <RuntimeTile label="Gateway" value={runtime.runtime?.status || runtime.gateway_health?.status || 'unknown'} sub={runtime.runtime?.gateway_base_url || 'no gateway'} tone={runtime.checks?.health?.ok || runtime.gateway_health?.status === 'ok' ? 'success' : 'warn'} />
                    <RuntimeTile label="Process" value={runtime.runtime?.pid || '-'} sub={runtime.runtime?.port ? `port ${runtime.runtime.port}` : 'fallback / external'} />
                    <RuntimeTile label="Models" value={runtime.checks?.models?.ok ? String(runtime.checks?.models?.data?.data?.length ?? models.length) : String(models.length)} sub={runtime.checks?.models?.ok ? 'Hermes /v1/models' : runtime.checks?.models?.error || 'local list'} tone={runtime.checks?.models?.ok || models.length > 0 ? 'success' : 'warn'} />
                    <RuntimeTile label="Skills" value={runtime.checks?.skills?.ok ? String((runtime.checks?.skills?.data?.data || runtime.checks?.skills?.data?.items || []).length) : '-'} sub={runtime.checks?.skills?.ok ? 'Hermes installed skills' : runtime.checks?.skills?.error || '未检查'} tone={runtime.checks?.skills?.ok ? 'success' : 'warn'} />
                  </div>
                  <div style={{
                    padding: 12,
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: 'var(--bg-secondary)',
                    display: 'grid',
                    gap: 8,
                    fontSize: 13,
                  }}>
                    <div><strong>Hermes home:</strong> <code>{runtime.runtime?.hermes_home || '-'}</code></div>
                    <div><strong>Tenant:</strong> {runtime.tenant?.name || '-'} <span style={{ color: 'var(--text-tertiary)' }}>({runtime.tenant?.slug || '-'})</span></div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Tag color={runtime.checks?.capabilities?.ok ? 'green' : 'orange'}>capabilities {runtime.checks?.capabilities?.ok ? 'ok' : 'check'}</Tag>
                      <Tag color={runtime.checks?.health?.ok || runtime.gateway_health?.status === 'ok' ? 'green' : 'orange'}>health {runtime.checks?.health?.ok || runtime.gateway_health?.status === 'ok' ? 'ok' : 'check'}</Tag>
                      <Tag color="blue">reasoning effort: per session</Tag>
                      <Tag color="purple">approval: Hermes Run Events</Tag>
                    </div>
                  </div>
                </div>
              )}

              <div className="atlas-section-label">Hermes Gateway 模型</div>
              {!modelsLoading && !modelsError && models.length === 0 && (
                <Alert type="info" showIcon message="当前 Gateway 未返回模型列表" description="请检查 Hermes Gateway 的 /v1/models 能力或运行时配置。" />
              )}
              {!modelsLoading && !modelsError && models.map((m) => (
                <div className="setting-row" key={m.id || m.name}>
                  <div className="setting-row-left">
                    <div className="setting-row-label">{m.id || m.name}</div>
                    <div className="setting-row-desc">{m.owned_by || 'hermes'} · {m.object || 'model'}</div>
                  </div>
                  <div className="setting-row-right">
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                      {runtime?.runtime?.status || runtime?.gateway_health?.status || 'health unknown'}
                    </span>
                    <span className="atlas-chip atlas-chip--success">在线</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'ops' && (
            <div>
              <div className="atlas-section-label">Hermes 运维诊断</div>
              {opsLoading && <div style={{ padding: 16 }}><Spin /></div>}
              {opsDiagnostics?.error && <Alert type="error" showIcon message="诊断读取失败" description={opsDiagnostics.error} style={{ marginBottom: 12 }} />}
              {opsDiagnostics && !opsDiagnostics.error && (
                <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                    <RuntimeTile label="Runtime" value={opsDiagnostics.all_ok ? 'healthy' : 'check'} sub={opsDiagnostics.runtime?.base_url || '-'} tone={opsDiagnostics.all_ok ? 'success' : 'warn'} />
                    <RuntimeTile label="Hermes Home" value={opsDiagnostics.tenant?.slug || '-'} sub={opsDiagnostics.runtime?.hermes_home || '-'} />
                    <RuntimeTile label="Checks" value={`${(opsDiagnostics.checks || []).filter((c: any) => c.ok).length}/${(opsDiagnostics.checks || []).length}`} sub="health / capabilities / models / skills / toolsets" tone={opsDiagnostics.all_ok ? 'success' : 'warn'} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(opsDiagnostics.checks || []).map((c: any) => (
                      <Tag key={c.name} color={c.ok ? 'green' : 'red'}>
                        {c.name} · {c.ok ? `${c.latency_ms}ms` : c.error}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
              <Space wrap style={{ marginBottom: 12 }}>
                <Button onClick={() => runOp('doctor')}>doctor</Button>
                <Button onClick={() => runOp('security-audit')}>security audit</Button>
                <Button onClick={() => runOp('prompt-size')}>prompt-size</Button>
                <Button onClick={() => runOp('logs-list')}>logs list</Button>
                <Button onClick={() => runOp('backup')}>backup</Button>
              </Space>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <Select
                  value={logKind}
                  onChange={setLogKind}
                  style={{ width: 150 }}
                  options={['gateway', 'agent', 'errors', 'gui', 'openatlas'].map((v) => ({ value: v, label: v }))}
                />
                <Input value={logTail} onChange={(e) => setLogTail(e.target.value)} style={{ width: 96 }} suffix="lines" />
                <Button onClick={loadLogs}>读取日志</Button>
              </div>
              <PreBox value={opsOutput?.output || opsOutput || '选择上方操作查看输出'} />
            </div>
          )}

          {activeTab === 'toolsets' && (
            <div>
              <div className="atlas-section-label">工具集治理</div>
              {toolsetLoading && <div style={{ padding: 16 }}><Spin /></div>}
              {!toolsetLoading && toolsetGov && (
                <div style={{ display: 'grid', gap: 16 }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 10,
                  }}>
                    {(toolsetGov.toolsets || []).map((t: any) => (
                      <div key={t.name} style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        background: 'var(--bg-secondary)',
                        padding: 12,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <strong>{t.name}</strong>
                          <Tag color={riskColor(t.risk_level)}>{t.risk_level}</Tag>
                        </div>
                        <div style={{ marginTop: 6, color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.5 }}>
                          {t.description || t.label || 'Hermes Gateway toolset'}
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Tag color={t.enabled ? 'green' : 'default'}>{t.enabled ? 'enabled' : 'disabled'}</Tag>
                          <Tag color={t.configured === false ? 'orange' : 'blue'}>{t.configured === false ? 'not configured' : 'configured'}</Tag>
                          <Tag color="purple">员工 {t.assigned_employee_count || 0}</Tag>
                          {t.requires_approval && <Tag color="red">需审批</Tag>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="atlas-section-label">员工 Toolset 授权</div>
                    {(toolsetGov.employees || []).map((emp: any) => (
                      <div className="setting-row" key={emp.id}>
                        <div className="setting-row-left">
                          <div className="setting-row-label">{emp.display_name}</div>
                          <div className="setting-row-desc">
                            当前 {emp.toolsets?.length || 0} 个工具集
                            {emp.high_risk_toolsets?.length ? ` · 高风险 ${emp.high_risk_toolsets.join(', ')}` : ''}
                          </div>
                        </div>
                        <div className="setting-row-right" style={{ minWidth: 360 }}>
                          <Select
                            mode="multiple"
                            value={emp.toolsets || []}
                            onChange={(vals) => saveEmployeeToolsets(emp.id, vals)}
                            placeholder="选择允许的 toolsets"
                            style={{ width: 360 }}
                            options={(toolsetGov.toolsets || []).map((t: any) => ({
                              value: t.name,
                              label: `${t.name}${t.risk_level === 'high' ? ' · high' : ''}`,
                              disabled: t.enabled === false,
                            }))}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!toolsetLoading && !toolsetGov && (
                <Alert type="info" showIcon message="暂无工具治理数据" description="需要管理员权限和可访问的 Hermes Gateway。" />
              )}
            </div>
          )}

          {activeTab === 'apikeys' && (
            <div>
              <div className="atlas-section-label">密钥管理</div>
              {apiKeys.map((k) => (
                <div className="setting-row" key={k.name}>
                  <div className="setting-row-left">
                    <div className="setting-row-label">{k.name}</div>
                    <div className="setting-row-desc">{k.prefix}</div>
                  </div>
                  <div className="setting-row-right">
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                      最近: {k.lastUsed}
                    </span>
                    <Button size="small" danger>轮换</Button>
                  </div>
                </div>
              ))}
              <Button type="primary" style={{ marginTop: 16 }}>添加 API Key</Button>
            </div>
          )}

          {activeTab === 'knowledge' && (
            <div>
              <div className="atlas-section-label">知识库连接</div>
              {['企业制度文档库', '行业法规知识库', '产品技术手册', '客户案例库', '培训课程资料', '历史对话记录'].map((name) => (
                <div className="setting-row" key={name}>
                  <div className="setting-row-left">
                    <div className="setting-row-label">{name}</div>
                  </div>
                  <div className="setting-row-right">
                    <Switch defaultChecked={name !== '培训课程资料'} size="small" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'security' && (
            <div>
              <div className="atlas-section-label">安全设置</div>
              {securityItems.map((item) => (
                <div className="setting-row" key={item.label}>
                  <div className="setting-row-left">
                    <div className="setting-row-label">{item.label}</div>
                    <div className="setting-row-desc">{item.desc}</div>
                  </div>
                  <div className="setting-row-right">
                    <Switch defaultChecked={item.checked} size="small" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'notifications' && (
            <div>
              <div className="atlas-section-label">通知设置</div>
              {notifyItems.map((item) => (
                <div className="setting-row" key={item.label}>
                  <div className="setting-row-left">
                    <div className="setting-row-label">{item.label}</div>
                    <div className="setting-row-desc">{item.desc}</div>
                  </div>
                  <div className="setting-row-right">
                    <Switch defaultChecked={item.checked} size="small" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
