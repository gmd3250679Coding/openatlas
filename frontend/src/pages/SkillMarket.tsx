import { useEffect, useMemo, useState } from 'react';
import { Tag, Button, Modal, Input, Select, message, Upload, Space, Alert, Empty, Popconfirm } from 'antd';
import { InboxOutlined, FileZipOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  fetchSkillMarket, fetchMe, createSkill, publishSkill, disableSkill, forkSkill, importSkillFromZip, fetchEmployees, syncHermesSkills,
  fetchSkillHealth, reconcileHermesSkills,
  browseHermesSkillsHub, searchHermesSkillsHub, installHermesSkill,
  hermesSkillLifecycleAction, exportHermesSkillSnapshot,
  listHermesSkillTaps, addHermesSkillTap, removeHermesSkillTap,
} from '../services/api';
import { productVisible, sanitizedSourceLabel } from '../utils/productVisibility';

const SCOPE_COLORS: Record<string, string> = {
  global: 'geekblue', tenant: 'blue', user: 'purple', employee: 'magenta',
};

const SCOPE_ORDER: Record<string, number> = {
  global: 0,
  tenant: 1,
  user: 2,
  employee: 3,
};

function isHermesSkill(skill: any) {
  return String(skill?.source_ref || '').startsWith('hermes:');
}

function skillSort(a: any, b: any) {
  const enabledDelta = Number(b.status === 'enabled') - Number(a.status === 'enabled');
  if (enabledDelta) return enabledDelta;
  const hermesDelta = Number(isHermesSkill(b)) - Number(isHermesSkill(a));
  if (hermesDelta) return hermesDelta;
  const scopeDelta = (SCOPE_ORDER[a.scope] ?? 9) - (SCOPE_ORDER[b.scope] ?? 9);
  if (scopeDelta) return scopeDelta;
  return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
}

function riskColor(risk?: string) {
  const r = String(risk || '').toLowerCase();
  if (r === 'high') return 'red';
  if (r === 'medium') return 'orange';
  if (r === 'low') return 'green';
  return 'default';
}

function TrustBox({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ padding: 8, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-primary)', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {text}
      </div>
    </div>
  );
}

function DiagnosticTable({ loading, rows, columns, emptyText }: {
  loading: boolean;
  rows: any[];
  columns: string[];
  emptyText: string;
}) {
  if (loading) return <div style={{ padding: 20 }}>loading…</div>;
  if (!rows.length) return <Empty description={emptyText} />;
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 8, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border-default)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || row.slug || row.name || i}>
              {columns.map((col) => (
                <td key={col} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', maxWidth: 240, wordBreak: 'break-word' }}>
                  {col.includes('rate') ? `${Math.round(Number(row[col] || 0) * 100)}%` : String(row[col] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SkillMarket() {
  const [skills, setSkills] = useState<any[]>([]);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('enabled');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'hermes' | 'openatlas'>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'tenant' | 'user' | 'employee'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showHub, setShowHub] = useState(false);
  const [forkTargetSkill, setForkTargetSkill] = useState<any | null>(null);
  const [forkEmployees, setForkEmployees] = useState<any[]>([]);
  const [forkEmployeeId, setForkEmployeeId] = useState<string>('');
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthRows, setHealthRows] = useState<any[]>([]);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileRows, setReconcileRows] = useState<any[]>([]);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [lifecycleName, setLifecycleName] = useState('');
  const [tapRepo, setTapRepo] = useState('');
  const [lifecycleOutput, setLifecycleOutput] = useState<any>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([fetchSkillMarket(), fetchMe()]);
      setSkills(productVisible(s || []));
      setMe(m);
    } catch (ex: any) {
      message.error('load failed: ' + (ex?.message || ex));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const isSysadmin = me?.user?.role === 'system_admin' || me?.role === 'system_admin';
  const isTenantAdmin = me?.user?.role === 'tenant_admin' || me?.role === 'tenant_admin';

  const canPublishGlobal = isSysadmin;
  const canPublishTenant = isSysadmin || isTenantAdmin;
  const canPublishUser = true;

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills
      .filter((s) => {
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        if (scopeFilter !== 'all' && s.scope !== scopeFilter) return false;
        if (sourceFilter === 'hermes' && !isHermesSkill(s)) return false;
        if (sourceFilter === 'openatlas' && isHermesSkill(s)) return false;
        if (!q) return true;
        return [s.name, s.slug, s.description, s.category, s.source_ref]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort(skillSort);
  }, [query, skills, scopeFilter, sourceFilter, statusFilter]);

  const onPublish = async (s: any) => {
    try { await publishSkill(s.__id || s.id); message.success(`published v${s.version} → next`); await load(); }
    catch (ex: any) { message.error('publish failed: ' + (ex?.message || ex)); }
  };
  const onDisable = async (s: any) => {
    try { await disableSkill(s.__id || s.id); message.success('disabled'); await load(); }
    catch (ex: any) { message.error('disable failed: ' + (ex?.message || ex)); }
  };
  const onFork = async (s: any, target: 'user' | 'employee') => {
    try {
      if (target === 'employee') {
        const emps = await fetchEmployees();
        if (!emps || emps.length === 0) {
          message.error('no employees in this tenant to bind to');
          return;
        }
        setForkTargetSkill(s);
        setForkEmployees(emps);
        setForkEmployeeId(String((emps[0] as any).__id || emps[0].id));
      } else {
        const r = await forkSkill(s.__id || s.id, target);
        message.success(`forked to ${r.scope}`);
        await load();
      }
    } catch (ex: any) {
      message.error('fork failed: ' + (ex?.message || ex));
    }
  };

  const confirmForkToEmployee = async () => {
    if (!forkTargetSkill || !forkEmployeeId) {
      message.warning('请选择一个员工');
      return;
    }
    try {
      const emp = forkEmployees.find((e: any) => String((e as any).__id || e.id) === forkEmployeeId);
      const r = await forkSkill(forkTargetSkill.__id || forkTargetSkill.id, 'employee', forkEmployeeId);
      message.success(`forked to ${r.scope} + bound to ${emp?.display_name || emp?.name || forkEmployeeId.slice(0, 6)}`);
      setForkTargetSkill(null);
      setForkEmployeeId('');
      setForkEmployees([]);
      await load();
    } catch (ex: any) {
      message.error('fork failed: ' + (ex?.message || ex));
    }
  };

  const onSyncHermes = async () => {
    setLoading(true);
    try {
      const r = await syncHermesSkills();
      message.success(`已同步 Hermes Skills: ${r.installed || 0} installed, ${r.created || 0} created`);
      await load();
    } catch (ex: any) {
      message.error('sync failed: ' + (ex?.message || ex));
    } finally {
      setLoading(false);
    }
  };

  const openHealth = async () => {
    setDiagnosticLoading(true);
    setHealthOpen(true);
    try {
      const r = await fetchSkillHealth();
      setHealthRows(r.items || []);
    } catch (ex: any) {
      message.error('health failed: ' + (ex?.message || ex));
    } finally {
      setDiagnosticLoading(false);
    }
  };

  const openReconcile = async () => {
    setDiagnosticLoading(true);
    setReconcileOpen(true);
    try {
      const r = await reconcileHermesSkills();
      setReconcileRows(r.items || []);
    } catch (ex: any) {
      message.error('reconcile failed: ' + (ex?.message || ex));
    } finally {
      setDiagnosticLoading(false);
    }
  };

  const runLifecycle = async (action: Parameters<typeof hermesSkillLifecycleAction>[0], body: any = {}) => {
    setLifecycleBusy(true);
    try {
      const r = await hermesSkillLifecycleAction(action, { name: lifecycleName.trim(), ...body });
      setLifecycleOutput({ action, ...r });
      if (action === 'update' || action === 'uninstall' || action === 'opt-in') await load();
    } catch (ex: any) {
      setLifecycleOutput({ action, ok: false, error: ex?.message || String(ex) });
    } finally {
      setLifecycleBusy(false);
    }
  };

  const runSnapshotExport = async () => {
    setLifecycleBusy(true);
    try {
      setLifecycleOutput({ action: 'snapshot.export', ...(await exportHermesSkillSnapshot()) });
    } catch (ex: any) {
      setLifecycleOutput({ action: 'snapshot.export', ok: false, error: ex?.message || String(ex) });
    } finally {
      setLifecycleBusy(false);
    }
  };

  const runTapList = async () => {
    setLifecycleBusy(true);
    try {
      setLifecycleOutput({ action: 'tap.list', ...(await listHermesSkillTaps()) });
    } catch (ex: any) {
      setLifecycleOutput({ action: 'tap.list', ok: false, error: ex?.message || String(ex) });
    } finally {
      setLifecycleBusy(false);
    }
  };

  const runTapAdd = async () => {
    if (!tapRepo.trim()) {
      message.warning('请输入 tap repo，例如 owner/repo');
      return;
    }
    setLifecycleBusy(true);
    try {
      setLifecycleOutput({ action: 'tap.add', ...(await addHermesSkillTap(tapRepo.trim())) });
      setTapRepo('');
    } catch (ex: any) {
      setLifecycleOutput({ action: 'tap.add', ok: false, error: ex?.message || String(ex) });
    } finally {
      setLifecycleBusy(false);
    }
  };

  const runTapRemove = async () => {
    if (!tapRepo.trim()) {
      message.warning('请输入要移除的 tap 名称');
      return;
    }
    setLifecycleBusy(true);
    try {
      setLifecycleOutput({ action: 'tap.remove', ...(await removeHermesSkillTap(tapRepo.trim())) });
      setTapRepo('');
    } catch (ex: any) {
      setLifecycleOutput({ action: 'tap.remove', ok: false, error: ex?.message || String(ex) });
    } finally {
      setLifecycleBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>技能市场 Skill Market</h2>
        <Space>
          {(isSysadmin || isTenantAdmin) && (
            <>
              <Button onClick={() => setShowHub(true)}>浏览 Skills Hub</Button>
              <Button onClick={onSyncHermes}>同步已安装</Button>
              <Button onClick={openHealth}>健康检查</Button>
              <Button onClick={openReconcile}>Hermes 对账</Button>
              <Button onClick={() => setLifecycleOpen(true)}>生命周期</Button>
            </>
          )}
          <Button icon={<FileZipOutlined />} onClick={() => setShowImport(true)}>导入私有 Skill ZIP</Button>
          <Button type="primary" onClick={() => setShowCreate(true)}>登记 OpenAtlas 技能</Button>
        </Space>
      </div>
      <p style={{ color: 'var(--text-tertiary)' }}>
        主路径对齐 Hermes Skills: 管理员先同步/安装 Hermes 已安装技能,员工创建或绑定时选择启用项。
        ZIP/登记入口保留给企业私有 Skill 包治理。
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 1fr) 150px 150px 150px',
        gap: 8,
        marginBottom: 12,
      }}>
        <Input.Search
          allowClear
          placeholder="搜索名称、分类、描述、source"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'enabled', label: '仅启用' },
            { value: 'all', label: '全部状态' },
            { value: 'disabled', label: '已禁用' },
          ]}
        />
        <Select
          value={sourceFilter}
          onChange={setSourceFilter}
          options={[
            { value: 'all', label: '全部来源' },
            { value: 'hermes', label: 'Hermes' },
            { value: 'openatlas', label: 'OpenAtlas' },
          ]}
        />
        <Select
          value={scopeFilter}
          onChange={setScopeFilter}
          options={[
            { value: 'all', label: '全部范围' },
            { value: 'global', label: 'global' },
            { value: 'tenant', label: 'tenant' },
            { value: 'user', label: 'user' },
            { value: 'employee', label: 'employee' },
          ]}
        />
      </div>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 8 }}>
        显示 {filteredSkills.length} / {skills.length} 个技能，排序优先级：启用 → Hermes 已安装 → scope → 名称。
      </div>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 8 }}>
        {loading && <div style={{ padding: 24 }}>loading…</div>}
        {!loading && skills.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            暂无技能,点右上角发布
          </div>
        )}
        {!loading && skills.length > 0 && filteredSkills.length === 0 && (
          <div style={{ padding: 32 }}>
            <Empty description="没有匹配的技能，请调整筛选条件" />
          </div>
        )}
        {!loading && filteredSkills.map((s) => (
          <div key={s.id} style={{
            padding: '12px 16px', borderTop: '1px solid var(--border-default)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                <strong>{s.name}</strong>
                <Tag color={SCOPE_COLORS[s.scope] || 'default'}>{s.scope}</Tag>
                <Tag color={s.status === 'enabled' ? 'green' : s.status === 'disabled' ? 'red' : 'default'}>{s.status}</Tag>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                  v{s.version} · {s.category}
                </span>
                <Tag color={(s.bound_employee_count || 0) > 0 ? 'gold' : 'default'} style={{ fontSize: 11 }}>
                  已绑员工 {s.bound_employee_count || 0}
                </Tag>
                <Tag color={riskColor(s.risk_level)} style={{ fontSize: 11 }}>
                  风险 {s.risk_level || 'low'}
                </Tag>
                <Tag color={(s.health?.failure_rate || 0) > 0 ? 'red' : 'green'} style={{ fontSize: 11 }}>
                  失败率 {Math.round((s.health?.failure_rate || 0) * 100)}%
                </Tag>
                {(s.binding_count || 0) > 0 && (
                  <Tag color="orange" style={{ fontSize: 11 }}>
                    禁用影响 {s.binding_count} 个绑定
                  </Tag>
                )}
                {s.source_ref && (
                  <Tag color={String(s.source_ref).startsWith('hermes:') ? 'cyan' : 'default'} style={{ fontSize: 11 }}>
                    {sanitizedSourceLabel(String(s.source_ref))}
                  </Tag>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {s.mutable && (s.scope === 'global' && canPublishGlobal || s.scope === 'tenant' && canPublishTenant || s.scope === 'user' && canPublishUser) && (
                  <>
                    <Button size="small" onClick={() => onPublish(s)}>Publish</Button>
                  </>
                )}
                {(canPublishGlobal || canPublishTenant || s.mutable) && (
                  <Popconfirm
                    title="确认禁用该 Skill？"
                    description={`会影响 ${s.disable_impact?.binding_count || s.binding_count || 0} 个绑定、${s.disable_impact?.employee_count || s.bound_employee_count || 0} 个员工。`}
                    okText="禁用"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => onDisable(s)}
                  >
                    <Button size="small" danger>Disable</Button>
                  </Popconfirm>
                )}
                {(s.scope === 'global' || s.scope === 'tenant') && !String(s.source_ref || '').startsWith('hermes:') && (
                  <>
                    <Button size="small" onClick={() => onFork(s, 'user')}>Fork→user</Button>
                    <Button size="small" onClick={() => onFork(s, 'employee')}>Fork→employee</Button>
                  </>
                )}
                {String(s.source_ref || '').startsWith('hermes:') && (
                  <span style={{ alignSelf: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
                    在创建员工或员工技能页绑定
                  </span>
                )}
              </div>
            </div>
            {s.description && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginTop: 4 }}>{s.description}</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 8, marginTop: 8 }}>
              <TrustBox title="能力说明" text={s.ability_description || s.description || '暂未登记能力说明'} />
              <TrustBox title="输入示例" text={s.input_example || '由对话任务和文件上下文触发'} />
              <TrustBox title="输出示例" text={s.output_example || '结构化建议、报告或可下载交付物'} />
            </div>
            <div style={{ marginTop: 6, color: 'var(--text-tertiary)', fontSize: 12 }}>
              适用员工: {(s.suitable_employees || []).join(' / ') || '通用数智员工'} ·
              调用 {s.health?.run_count || 0} 次 · 失败 {s.health?.failure_count || 0} 次
              {s.health?.last_error ? ` · 最近错误: ${String(s.health.last_error).slice(0, 80)}` : ''}
            </div>
          </div>
        ))}
      </div>
      <CreateModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} canGlobal={canPublishGlobal} canTenant={canPublishTenant} />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} onImported={load}
        canGlobal={canPublishGlobal} canTenant={canPublishTenant} />
      <HubModal open={showHub} onClose={() => setShowHub(false)} onInstalled={load} />
      <Modal open={healthOpen} onCancel={() => setHealthOpen(false)} footer={null} width={840} title="Skill 健康检查">
        <DiagnosticTable
          loading={diagnosticLoading}
          rows={healthRows}
          columns={['name', 'slug', 'status', 'run_count', 'failure_count', 'failure_rate', 'last_error']}
          emptyText="暂无运行记录。完成几轮真实对话后，这里会出现 Skill 调用健康数据。"
        />
      </Modal>
      <Modal open={reconcileOpen} onCancel={() => setReconcileOpen(false)} footer={null} width={900} title="OpenAtlas / Hermes Skills 对账">
        <DiagnosticTable
          loading={diagnosticLoading}
          rows={reconcileRows}
          columns={['name', 'slug', 'openatlas_status', 'hermes_status', 'reconcile_status', 'source_ref']}
          emptyText="暂无对账结果。"
        />
      </Modal>
      <Modal open={lifecycleOpen} onCancel={() => setLifecycleOpen(false)} footer={null} width={900} title="Hermes Skill 生命周期">
        <div style={{ display: 'grid', gap: 12 }}>
          <Alert
            type="info"
            showIcon
            message="这些操作直接作用于当前租户隔离的 Hermes home"
            description="check/update/audit 可以不填名称表示全部；uninstall/reset/repair-official 需要填写 Skill 名称。"
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 8 }}>
            <Input
              placeholder="Skill 名称，可留空表示全部"
              value={lifecycleName}
              onChange={(e) => setLifecycleName(e.target.value)}
            />
            <Space wrap>
              <Button loading={lifecycleBusy} onClick={() => runLifecycle('check')}>Check</Button>
              <Button loading={lifecycleBusy} onClick={() => runLifecycle('update')}>Update</Button>
              <Button loading={lifecycleBusy} onClick={() => runLifecycle('audit')}>Audit</Button>
              <Button loading={lifecycleBusy} onClick={() => runLifecycle('audit', { deep: true })}>Deep Audit</Button>
            </Space>
          </div>
          <Space wrap>
            <Popconfirm
              title="确认卸载 Hermes Skill？"
              description="会从当前租户 Hermes home 中移除该 hub skill。"
              okText="卸载"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => runLifecycle('uninstall')}
            >
              <Button danger loading={lifecycleBusy}>Uninstall</Button>
            </Popconfirm>
            <Button loading={lifecycleBusy} onClick={() => runLifecycle('reset')}>Reset</Button>
            <Button loading={lifecycleBusy} onClick={() => runLifecycle('repair-official')}>Repair Official</Button>
            <Button loading={lifecycleBusy} onClick={() => runLifecycle('opt-in', { sync: true })}>Opt-in + Sync</Button>
            <Button loading={lifecycleBusy} onClick={() => runLifecycle('opt-out')}>Opt-out</Button>
            <Button loading={lifecycleBusy} onClick={runSnapshotExport}>Snapshot Export</Button>
          </Space>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 8 }}>
            <Input
              placeholder="Tap repo 或 tap 名称，例如 owner/repo"
              value={tapRepo}
              onChange={(e) => setTapRepo(e.target.value)}
            />
            <Space>
              <Button loading={lifecycleBusy} onClick={runTapList}>Tap List</Button>
              <Button loading={lifecycleBusy} onClick={runTapAdd}>Tap Add</Button>
              <Button loading={lifecycleBusy} danger onClick={runTapRemove}>Tap Remove</Button>
            </Space>
          </div>
          <pre style={{
            minHeight: 220,
            maxHeight: 380,
            overflow: 'auto',
            margin: 0,
            padding: 12,
            borderRadius: 8,
            background: '#0F172A',
            color: '#E2E8F0',
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}>
            {lifecycleOutput
              ? (lifecycleOutput.output || JSON.stringify(lifecycleOutput, null, 2))
              : '选择一个生命周期操作查看 Hermes CLI 输出。'}
          </pre>
        </div>
      </Modal>
      <Modal
        open={!!forkTargetSkill}
        title={`Fork "${forkTargetSkill?.name || ''}" 到员工`}
        okText="Fork 并绑定"
        cancelText="取消"
        onOk={confirmForkToEmployee}
        onCancel={() => {
          setForkTargetSkill(null);
          setForkEmployeeId('');
          setForkEmployees([]);
        }}
      >
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>选择一个已启用员工，系统会复制 Skill 并建立员工绑定。</div>
          <Select
            value={forkEmployeeId || undefined}
            onChange={setForkEmployeeId}
            placeholder="选择员工"
            style={{ width: '100%' }}
            options={forkEmployees.map((e: any) => ({
              value: String((e as any).__id || e.id),
              label: e.display_name || e.name || String(e.id).slice(0, 8),
            }))}
          />
        </div>
      </Modal>
    </div>
  );
}

function HubModal({ open, onClose, onInstalled }: { open: boolean; onClose: () => void; onInstalled: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState('');

  const load = async (nextPage = page) => {
    setBusy(true);
    try {
      const trimmed = query.trim();
      const r = trimmed
        ? await searchHermesSkillsHub({ q: trimmed, source, limit: 30 })
        : await browseHermesSkillsHub({ page: nextPage, size: 20, source });
      setItems(r.items || []);
      setPage(r.page || nextPage);
      setTotalPages(r.total_pages || 1);
    } catch (ex: any) {
      message.error('hub load failed: ' + (ex?.message || ex));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source]);

  const install = async (item: any) => {
    const identifier = item.identifier;
    if (!identifier) return;
    setInstalling(identifier);
    try {
      const result = await installHermesSkill({
        identifier,
        source: item.source || '',
        name: item.name || '',
        category: item.category || item.meta?.category || '',
      });
      if (result?.visible === false || result?.ok === false) {
        message.warning(result?.warning || `安装命令已执行，但 ${item.name || identifier} 尚未出现在当前租户技能市场`);
      } else {
        message.success(`已安装 ${item.name || identifier}`);
      }
      await onInstalled();
      await load(page);
    } catch (ex: any) {
      message.error('install failed: ' + (ex?.message || ex));
    } finally {
      setInstalling('');
    }
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={920} title="Hermes Skills Hub">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="搜索 skill, 为空则浏览 Hub"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onSearch={() => load(1)}
          loading={busy}
        />
          <Select
            value={source}
            onChange={(v) => { setSource(v); setPage(1); }}
            style={{ width: 150 }}
            options={[
              { value: 'all', label: 'all' },
              { value: 'official', label: 'official' },
              { value: 'skills-sh', label: 'skills-sh' },
              { value: 'well-known', label: 'well-known' },
              { value: 'github', label: 'github' },
              { value: 'clawhub', label: 'clawhub' },
              { value: 'lobehub', label: 'lobehub' },
              { value: 'browse-sh', label: 'browse-sh' },
            ]}
          />
      </div>
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 8, overflow: 'hidden' }}>
        {busy && <div style={{ padding: 20 }}>loading…</div>}
        {!busy && items.length === 0 && <div style={{ padding: 24, color: 'var(--text-tertiary)', textAlign: 'center' }}>暂无结果</div>}
        {!busy && items.map((item) => (
          <div key={item.identifier} style={{ padding: '12px 14px', borderTop: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{item.name}</strong>
                  <Tag>{item.source}</Tag>
                  <Tag color={item.trust === 'builtin' || item.trust === 'trusted' ? 'green' : 'gold'}>{item.trust}</Tag>
                </div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginTop: 4 }}>{item.description}</div>
                <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{item.identifier}</code>
              </div>
              <Button
                type="primary"
                size="small"
                loading={installing === item.identifier}
                onClick={() => install(item)}
              >
                安装
              </Button>
            </div>
          </div>
        ))}
      </div>
      {!query.trim() && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <Button disabled={page <= 1 || busy} onClick={() => load(page - 1)}>上一页</Button>
          <span style={{ alignSelf: 'center', color: 'var(--text-tertiary)' }}>{page} / {totalPages}</span>
          <Button disabled={page >= totalPages || busy} onClick={() => load(page + 1)}>下一页</Button>
        </div>
      )}
    </Modal>
  );
}

/* ── ImportModal: ZIP upload + import ───────────────────────────────────── */
function ImportModal({ open, onClose, onImported, canGlobal, canTenant }:
  { open: boolean; onClose: () => void; onImported: () => void; canGlobal: boolean; canTenant: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState<'global' | 'tenant' | 'user'>('user');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const reset = () => { setFile(null); setScope('user'); setResult(null); setBusy(false); };
  const onCancel = () => { onClose(); reset(); };

  const submit = async () => {
    if (!file) { message.error('请先选择 ZIP 文件'); return; }
    if (!file.name.toLowerCase().endsWith('.zip')) { message.error('文件必须是 .zip'); return; }
    if (scope === 'global' && !canGlobal) { message.error('只有 system_admin 能导入 global'); return; }
    if (scope === 'tenant' && !canTenant) { message.error('只有 tenant_admin 能导入 tenant'); return; }
    setBusy(true);
    try {
      const r = await importSkillFromZip(file, scope as any);
      setResult(r);
      message.success(`imported ${r.name} v${r.version} (${r.extracted_files} files)`);
      onImported();
    } catch (ex: any) {
      message.error('import failed: ' + (ex?.message || ex));
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onCancel={onCancel} onOk={submit} title="从 ZIP 导入技能" confirmLoading={busy} okText="导入"
      okButtonProps={{ disabled: !file }} width={640}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="ZIP 必须包含 SKILL.md,frontmatter 至少要有 name + version" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Upload.Dragger
          accept=".zip"
          multiple={false}
          beforeUpload={(f) => { setFile(f); setResult(null); return false; /* prevent auto-upload */ }}
          onRemove={() => { setFile(null); return true; }}
          fileList={file ? [{ uid: '-1', name: file.name, status: 'done' }] : []}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽 .zip 文件到这里</p>
          <p className="ant-upload-hint" style={{ color: 'var(--text-tertiary)' }}>
            支持单个 .zip(最大 10MB)。ZIP 中应包含 SKILL.md 与可选的 references/、scripts/ 目录。
          </p>
        </Upload.Dragger>
        <label>Scope
          <Select value={scope} onChange={setScope} style={{ width: '100%' }}
            options={[
              { value: 'user', label: 'user (个人)' },
              { value: 'tenant', label: 'tenant (本租户)', disabled: !canTenant },
              { value: 'global', label: 'global (全局)', disabled: !canGlobal },
            ]} />
        </label>
        {result && (
          <Alert type="success" showIcon
            message={`已导入 ${result.name} v${result.version}`}
            description={
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <div>scope: <Tag>{result.scope}</Tag> visibility: {result.visibility} mutable: {String(result.mutable)}</div>
                <div>extracted to: <code style={{ fontSize: 11 }}>{result.extracted_path}</code></div>
                <div>files: {result.extracted_files} · size: {result.source_ref ? '✓' : '?'}</div>
              </div>
            } />
        )}
      </div>
    </Modal>
  );
}

function CreateModal({ open, onClose, onCreated, canGlobal, canTenant }:
  { open: boolean; onClose: () => void; onCreated: () => void; canGlobal: boolean; canTenant: boolean }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('general');
  const [scope, setScope] = useState<'global' | 'tenant' | 'user'>('user');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name || !slug) { message.error('name + slug required'); return; }
    if (scope === 'global' && !canGlobal) { message.error('只有 system_admin 能发 global'); return; }
    if (scope === 'tenant' && !canTenant) { message.error('只有 tenant_admin 能发 tenant'); return; }
    setBusy(true);
    try {
      await createSkill({ name, slug, description: desc, category: cat, scope });
      message.success('created');
      onCreated(); onClose();
    } catch (ex: any) { message.error('create failed: ' + (ex?.message || ex)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} title="发布技能" confirmLoading={busy} okText="发布">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>名称 <Input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Slug (URL-safe) <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-skill" /></label>
        <label>描述 <Input.TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label>分类 <Input value={cat} onChange={(e) => setCat(e.target.value)} /></label>
        <label>Scope
          <Select value={scope} onChange={setScope} style={{ width: '100%' }}
            options={[
              { value: 'user', label: 'user (个人)' },
              { value: 'tenant', label: 'tenant (本租户)', disabled: !canTenant },
              { value: 'global', label: 'global (全局)', disabled: !canGlobal },
            ]} />
        </label>
      </div>
    </Modal>
  );
}
