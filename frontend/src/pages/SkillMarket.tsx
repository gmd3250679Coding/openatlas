import { useEffect, useMemo, useState } from 'react';
import { Tag, Button, Modal, Input, Select, message, Upload, Space, Alert, Empty, Popconfirm, Drawer, Descriptions } from 'antd';
import { InboxOutlined, FileZipOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  fetchSkillMarket, fetchMe, createSkill, publishSkill, disableSkill, forkSkill, importSkillFromZip, fetchEmployees, syncHermesSkills, patchSkill,
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

function isLocalPackageSkill(skill: any) {
  return String(skill?.source_ref || '').startsWith('zip:') || String(skill?.source_ref || '').startsWith('openatlas:');
}

function skillSourceKind(skill: any): 'hermes' | 'local' | 'openatlas' {
  if (isHermesSkill(skill)) return 'hermes';
  if (isLocalPackageSkill(skill)) return 'local';
  return 'openatlas';
}

function skillSourceTag(skill: any) {
  const kind = skillSourceKind(skill);
  if (kind === 'hermes') return { label: 'Hermes 运行时', color: 'cyan' };
  if (kind === 'local') return { label: '本地导入包', color: 'purple' };
  return { label: 'OpenAtlas 元数据', color: 'default' };
}

function skillSort(a: any, b: any) {
  const enabledDelta = Number(b.status === 'enabled') - Number(a.status === 'enabled');
  if (enabledDelta) return enabledDelta;
  const sourceRank: Record<string, number> = { hermes: 0, local: 1, openatlas: 2 };
  const sourceDelta = sourceRank[skillSourceKind(a)] - sourceRank[skillSourceKind(b)];
  if (sourceDelta) return sourceDelta;
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

const CAPABILITY_TAG_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: '联网检索', pattern: /web|search|browse|browser|联网|检索|搜索/i },
  { label: '浏览器操作', pattern: /browser|page|crawl|爬取|网页/i },
  { label: '数据源调用', pattern: /stock|finance|market|data|api|股票|行情|数据/i },
  { label: '文档解析', pattern: /docx|pdf|paper|document|文档|论文|合同/i },
  { label: '表格处理', pattern: /xlsx|excel|sheet|csv|表格/i },
  { label: '代码执行', pattern: /code|python|script|代码|脚本/i },
  { label: '终端命令', pattern: /terminal|shell|command|终端|命令/i },
  { label: '报告生成', pattern: /report|ppt|html|markdown|报告|交付物/i },
  { label: '多员工协作', pattern: /workflow|relay|agent|collaboration|协作|接力/i },
];

function skillSearchText(skill: any) {
  return [
    skill?.name,
    skill?.slug,
    skill?.description,
    skill?.category,
    skill?.source_ref,
    skill?.ability_description,
    skill?.input_example,
    skill?.output_example,
    ...(skill?.suitable_employees || []),
  ].filter(Boolean).join(' ');
}

function skillCategoryText(skill: any) {
  return [
    skill?.name,
    skill?.slug,
    skill?.description,
    skill?.category,
    skill?.ability_description,
  ].filter(Boolean).join(' ');
}

function abilityTagsForSkill(skill: any) {
  const text = skillSearchText(skill);
  const tags = CAPABILITY_TAG_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
  return [...new Set(tags)].slice(0, 4);
}

function categoryForSkill(skill: any) {
  const text = skillCategoryText(skill);
  if (/stock|finance|a.?股|投资|行情|财务|经营/i.test(text)) return '投资财务';
  if (/market|sales|crm|客户|销售|市场|推广/i.test(text)) return '市场销售';
  if (/data|analysis|excel|csv|表格|指标/i.test(text)) return '数据分析';
  if (/law|legal|contract|合规|法务|合同/i.test(text)) return '法务合规';
  if (/doc|paper|knowledge|pdf|文档|论文|知识/i.test(text)) return '文档知识';
  if (/hr|recruit|resume|candidate|简历|招聘|候选人|面试/i.test(text)) return 'HR 招聘';
  if (/project|workflow|delivery|项目|运营|交付/i.test(text)) return '项目运营';
  if (/terminal|shell|browser|code|system|工具|命令/i.test(text)) return '系统工具';
  return skill?.category || '通用能力';
}

function skillStatusText(skill: any) {
  const failureRate = Math.round(Number(skill?.health?.failure_rate || 0) * 100);
  if (skill?.status !== 'enabled') return '未启用';
  if (skill?.health?.last_error) return '需关注';
  if (failureRate > 0) return `失败率 ${failureRate}%`;
  return '可用';
}

function readableSkillExample(example: any) {
  if (!example) return '由任务、文件和员工上下文自动触发';
  const text = typeof example === 'string' ? example : JSON.stringify(example);
  if (!text || text === '{}' || text === '[]' || text === 'null') {
    return '由任务、文件和员工上下文自动触发';
  }
  return text.length > 88 ? `${text.slice(0, 88)}…` : text;
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
  const [sourceFilter, setSourceFilter] = useState<'all' | 'hermes' | 'local' | 'openatlas'>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'tenant' | 'user' | 'employee'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
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
  const [detailSkill, setDetailSkill] = useState<any | null>(null);

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
  const isSkillAdmin = isSysadmin || isTenantAdmin;

  const canPublishGlobal = isSysadmin;
  const canPublishTenant = isSysadmin || isTenantAdmin;
  const canPublishUser = isSkillAdmin;

  const categoryOptions = useMemo(() => {
    const categories = [...new Set(skills.map(categoryForSkill).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return [{ value: 'all', label: '全部分类' }, ...categories.map((c) => ({ value: c, label: c }))];
  }, [skills]);

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills
      .filter((s) => {
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        if (scopeFilter !== 'all' && s.scope !== scopeFilter) return false;
        if (sourceFilter === 'hermes' && !isHermesSkill(s)) return false;
        if (sourceFilter === 'local' && !isLocalPackageSkill(s)) return false;
        if (sourceFilter === 'openatlas' && skillSourceKind(s) !== 'openatlas') return false;
        if (categoryFilter !== 'all' && categoryForSkill(s) !== categoryFilter) return false;
        if (!q) return true;
        return skillSearchText(s).toLowerCase().includes(q);
      })
      .sort(skillSort);
  }, [categoryFilter, query, skills, scopeFilter, sourceFilter, statusFilter]);

  const marketStats = useMemo(() => {
    const enabled = skills.filter((s) => s.status === 'enabled').length;
    const hermes = skills.filter(isHermesSkill).length;
    const local = skills.filter(isLocalPackageSkill).length;
    const boundEmployees = skills.reduce((sum, s) => sum + Number(s.bound_employee_count || 0), 0);
    const unhealthy = skills.filter((s) => Number(s.health?.failure_rate || 0) > 0 || s.health?.last_error).length;
    const highRisk = skills.filter((s) => s.risk_level === 'high').length;
    return { enabled, hermes, local, boundEmployees, unhealthy, highRisk };
  }, [skills]);

  const onPublish = async (s: any) => {
    try { await publishSkill(s.__id || s.id); message.success(`published v${s.version} → next`); await load(); }
    catch (ex: any) { message.error('publish failed: ' + (ex?.message || ex)); }
  };
  const onDisable = async (s: any) => {
    try { await disableSkill(s.__id || s.id); message.success('disabled'); await load(); }
    catch (ex: any) { message.error('disable failed: ' + (ex?.message || ex)); }
  };
  const onSaveSkillDefinition = async (s: any, patch: any) => {
    try {
      const updated = await patchSkill(s.__id || s.id, patch);
      message.success('Skill 定义已保存');
      setDetailSkill(updated);
      await load();
    } catch (ex: any) {
      message.error('保存失败: ' + (ex?.message || ex));
    }
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
    <div className="admin-console">
      <section className="admin-hero">
        <div>
          <div className="admin-kicker">Skill Governance</div>
          <h1 className="admin-title">技能市场 Skill Market</h1>
          <p className="admin-subtitle">
            对齐 Hermes Skills 的安装、同步、健康检查和企业私有 Skill 治理；员工创建或绑定时只选择已启用能力。
          </p>
        </div>
        <div className="admin-actions">
          <Button onClick={() => setShowHub(true)}>浏览 Skills Hub</Button>
          {isSkillAdmin && (
            <>
              <Button onClick={onSyncHermes}>同步已安装</Button>
              <Button onClick={openHealth}>健康检查</Button>
              <Button onClick={openReconcile}>Hermes 对账</Button>
              <Button onClick={() => setLifecycleOpen(true)}>生命周期</Button>
              <Button icon={<FileZipOutlined />} onClick={() => setShowImport(true)}>导入私有 Skill ZIP</Button>
              <Button type="primary" onClick={() => setShowCreate(true)}>登记 OpenAtlas 技能</Button>
            </>
          )}
        </div>
      </section>
      {!isSkillAdmin && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message="当前为普通用户只读视图"
          description="你可以查看 Skill 能力说明、风险等级、适用员工和安装来源；安装、导入、同步、禁用等治理操作由管理员执行。"
        />
      )}
      <div className="admin-stat-grid">
        {[
          ['启用 Skill', marketStats.enabled, '可被员工绑定'],
          ['Hermes 来源', marketStats.hermes, '已与运行时对齐'],
          ['本地导入', marketStats.local, '企业私有 SKILL.md 包'],
          ['员工绑定', marketStats.boundEmployees, '影响真实员工能力'],
          ['健康关注', marketStats.unhealthy, '需检查最近错误'],
          ['高风险', marketStats.highRisk, '禁用/审批需谨慎'],
        ].map(([label, value, hint]) => (
          <div key={label} className="admin-stat-card">
            <div className="admin-stat-label">{label}</div>
            <div className="admin-stat-value">{value}</div>
            <div className="admin-stat-hint">{hint}</div>
          </div>
        ))}
      </div>
      <div className="admin-toolbar" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 1fr) 150px 150px 150px 150px',
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
            { value: 'hermes', label: 'Hermes 运行时' },
            { value: 'local', label: '本地导入包' },
            { value: 'openatlas', label: 'OpenAtlas 元数据' },
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
        <Select
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={categoryOptions}
        />
      </div>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 8 }}>
        显示 {filteredSkills.length} / {skills.length} 个技能。优先看能力标签、适用员工和运行状态；版本/风险/对账信息在详情里治理。
      </div>
      <div className="admin-panel">
        {loading && <div style={{ padding: 24 }}>loading…</div>}
        {!loading && skills.length === 0 && (
          <div className="admin-empty">
            暂无技能,点右上角发布
          </div>
        )}
        {!loading && skills.length > 0 && filteredSkills.length === 0 && (
          <div style={{ padding: 32 }}>
            <Empty description="没有匹配的技能，请调整筛选条件" />
          </div>
        )}
        {!loading && filteredSkills.map((s) => {
          const tags = abilityTagsForSkill(s);
          const category = categoryForSkill(s);
          const statusText = skillStatusText(s);
          return (
            <div key={s.id} className="admin-list-row" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 14, alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15, color: 'var(--text-primary)', marginRight: 2 }}>{s.name}</strong>
                    <Tag color="blue">{category}</Tag>
                    <Tag color={s.status === 'enabled' ? 'green' : s.status === 'disabled' ? 'red' : 'default'}>{statusText}</Tag>
                    <Tag color={skillSourceTag(s).color}>{skillSourceTag(s).label}</Tag>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>v{s.version}</span>
                  </div>
                  <div style={{
                    marginTop: 6,
                    color: 'var(--text-secondary)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}>
                    {s.ability_description || s.description || '暂未登记能力说明。'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {(tags.length ? tags : ['通用能力']).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                    <Tag color={(s.bound_employee_count || 0) > 0 ? 'gold' : 'default'}>已绑员工 {s.bound_employee_count || 0}</Tag>
                    <Tag color={riskColor(s.risk_level)}>风险 {s.risk_level || 'low'}</Tag>
                    {s.health?.last_error && <Tag color="red">最近错误</Tag>}
                  </div>
                  <div style={{ marginTop: 8, color: 'var(--text-tertiary)', fontSize: 12 }}>
                    适合员工: {(s.suitable_employees || []).join(' / ') || '通用数智员工'} ·
                    示例输入: {readableSkillExample(s.input_example)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 360 }}>
                  <Button size="small" type="primary" onClick={() => setDetailSkill(s)}>查看能力</Button>
                  {isSkillAdmin && s.mutable && (s.scope === 'global' && canPublishGlobal || s.scope === 'tenant' && canPublishTenant || s.scope === 'user' && canPublishUser) && (
                    <Button size="small" onClick={() => onPublish(s)}>Publish</Button>
                  )}
                  {isSkillAdmin && (s.scope === 'global' || s.scope === 'tenant') && !String(s.source_ref || '').startsWith('hermes:') && (
                    <>
                      <Button size="small" onClick={() => onFork(s, 'user')}>Fork→user</Button>
                      <Button size="small" onClick={() => onFork(s, 'employee')}>Fork→employee</Button>
                    </>
                  )}
                  {isSkillAdmin && (canPublishGlobal || canPublishTenant || s.mutable) && (
                    <Popconfirm
                      title="确认禁用该 Skill？"
                      description={`会影响 ${s.disable_impact?.binding_count || s.binding_count || 0} 个绑定、${s.disable_impact?.employee_count || s.bound_employee_count || 0} 个员工。`}
                      okText="禁用"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => onDisable(s)}
                    >
                      <Button size="small" danger>禁用</Button>
                    </Popconfirm>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <CreateModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} canGlobal={canPublishGlobal} canTenant={canPublishTenant} />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} onImported={load}
        canGlobal={canPublishGlobal} canTenant={canPublishTenant} />
      <HubModal open={showHub} onClose={() => setShowHub(false)} onInstalled={load} canInstall={isSkillAdmin} />
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
      <SkillGovernanceDrawer
        skill={detailSkill}
        onClose={() => setDetailSkill(null)}
        onDisable={onDisable}
        onSave={onSaveSkillDefinition}
        onFork={onFork}
        canDisable={isSkillAdmin && (canPublishGlobal || canPublishTenant || Boolean(detailSkill?.mutable))}
        canEdit={isSkillAdmin && Boolean(detailSkill?.mutable) && !isHermesSkill(detailSkill)}
        canFork={isSkillAdmin}
      />
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

function SkillGovernanceDrawer({
  skill,
  onClose,
  onDisable,
  onSave,
  onFork,
  canDisable,
  canEdit,
  canFork,
}: {
  skill: any | null;
  onClose: () => void;
  onDisable: (skill: any) => Promise<void>;
  onSave: (skill: any, patch: any) => Promise<void>;
  onFork: (skill: any, target: 'user' | 'employee') => Promise<void>;
  canDisable: boolean;
  canEdit: boolean;
  canFork: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    description: '',
    system_prompt: '',
    input_schema: '{}',
    output_schema: '{}',
    few_shot_examples: '[]',
  });
  useEffect(() => {
    if (!skill) return;
    setEditing(false);
    setForm({
      description: skill.description || '',
      system_prompt: skill.system_prompt || '',
      input_schema: skill.input_schema || '{}',
      output_schema: skill.output_schema || '{}',
      few_shot_examples: skill.few_shot_examples || '[]',
    });
  }, [skill?.id, skill?.updated_at]);
  if (!skill) return null;
  const sourceTag = skillSourceTag(skill);
  const failureRate = Math.round(Number(skill.health?.failure_rate || 0) * 100);
  const boundEmployees = Number(skill.bound_employee_count || 0);
  const bindingCount = Number(skill.binding_count || 0);
  const highRisk = skill.risk_level === 'high';
  const governanceTips = [
    highRisk ? '高风险 Skill 建议仅绑定给明确角色员工，并配合审批/审计查看。' : '当前风险较低，可作为普通员工能力扩展。',
    boundEmployees > 0 ? `已影响 ${boundEmployees} 个员工，禁用前建议通知负责人并查看最近会话。` : '暂无员工绑定，适合先做灰度验证。',
    failureRate > 0 ? `最近失败率 ${failureRate}%，建议先运行健康检查或 Hermes 对账。` : '最近暂无失败记录。',
    isHermesSkill(skill)
      ? '该 Skill 来源于 Hermes，OpenAtlas 负责绑定、可见性、健康和审计。'
      : isLocalPackageSkill(skill)
        ? '该 Skill 是企业本地导入的 Hermes 兼容 SKILL.md 包，会作为员工能力上下文注入。'
        : '该 Skill 来源于 OpenAtlas，可按 scope 做企业内部治理。',
  ];

  return (
    <Drawer
      open={Boolean(skill)}
      onClose={onClose}
      title="Skill 详情与治理"
      width={560}
      destroyOnClose
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 20 }}>{skill.name}</h3>
            <Tag color={SCOPE_COLORS[skill.scope] || 'default'}>{skill.scope}</Tag>
            <Tag color={skill.status === 'enabled' ? 'green' : 'red'}>{skill.status}</Tag>
            <Tag color={riskColor(skill.risk_level)}>风险 {skill.risk_level || 'low'}</Tag>
            <Tag color={sourceTag.color}>{sourceTag.label}</Tag>
          </div>
          <div style={{ marginTop: 6, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>{skill.description || '暂无描述'}</div>
        </div>

        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="版本">v{skill.version || '-'}</Descriptions.Item>
          <Descriptions.Item label="来源">{sourceTag.label} · {sanitizedSourceLabel(String(skill.source_ref || 'openatlas'))}</Descriptions.Item>
          <Descriptions.Item label="分类">{skill.category || '-'}</Descriptions.Item>
          <Descriptions.Item label="绑定影响">{bindingCount} 个绑定 / {boundEmployees} 个员工</Descriptions.Item>
          <Descriptions.Item label="健康">{skill.health?.run_count || 0} 次调用 · {skill.health?.failure_count || 0} 次失败 · 失败率 {failureRate}%</Descriptions.Item>
          <Descriptions.Item label="最近错误">{skill.health?.last_error || '暂无'}</Descriptions.Item>
        </Descriptions>

        <div style={{ display: 'grid', gap: 8 }}>
          {editing ? (
            <>
              <label>
                描述
                <Input.TextArea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>
              <label>
                System Prompt
                <Input.TextArea rows={7} value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} />
              </label>
              <label>
                Input Schema
                <Input.TextArea rows={8} value={form.input_schema} onChange={(e) => setForm({ ...form, input_schema: e.target.value })} />
              </label>
              <label>
                Output Schema
                <Input.TextArea rows={8} value={form.output_schema} onChange={(e) => setForm({ ...form, output_schema: e.target.value })} />
              </label>
              <label>
                Few-shot Examples
                <Input.TextArea rows={8} value={form.few_shot_examples} onChange={(e) => setForm({ ...form, few_shot_examples: e.target.value })} />
              </label>
              <Space>
                <Button type="primary" onClick={() => onSave(skill, form)}>保存定义</Button>
                <Button onClick={() => setEditing(false)}>取消</Button>
              </Space>
            </>
          ) : (
            <>
              <TrustBox title="能力说明" text={skill.ability_description || skill.description || '暂未登记能力说明'} />
              <TrustBox title="System Prompt" text={skill.system_prompt || '暂未配置 system prompt'} />
              <TrustBox title="Input Schema" text={skill.input_schema || '{}'} />
              <TrustBox title="Output Schema" text={skill.output_schema || '{}'} />
              <TrustBox title="Few-shot Examples" text={skill.few_shot_examples || '[]'} />
            </>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8 }}>适用员工</div>
          <Space wrap>
            {(skill.suitable_employees || ['通用数智员工']).map((item: string) => (
              <Tag key={item} color="blue">{item}</Tag>
            ))}
          </Space>
        </div>

        <div style={{
          padding: 12,
          borderRadius: 10,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8 }}>治理建议</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {governanceTips.map((tip) => (
              <div key={tip} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                · {tip}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && !editing && (
            <Button type="primary" onClick={() => setEditing(true)}>编辑定义</Button>
          )}
          {canFork && (skill.scope === 'global' || skill.scope === 'tenant') && !isHermesSkill(skill) && (
            <>
              <Button onClick={() => onFork(skill, 'user')}>Fork 到个人</Button>
              <Button onClick={() => onFork(skill, 'employee')}>Fork 到员工</Button>
            </>
          )}
          {canDisable && (
            <Popconfirm
              title="确认禁用该 Skill？"
              description={`会影响 ${bindingCount} 个绑定、${boundEmployees} 个员工。`}
              okText="禁用"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => onDisable(skill)}
            >
              <Button danger>禁用 Skill</Button>
            </Popconfirm>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function HubModal({ open, onClose, onInstalled, canInstall }: { open: boolean; onClose: () => void; onInstalled: () => void; canInstall: boolean }) {
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
    if (!canInstall) {
      message.info('当前账号仅可浏览 Skills Hub，安装请联系管理员。');
      return;
    }
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
      {!canInstall && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="普通用户可浏览 Hub，安装由管理员执行"
          description="这样可以保证 Hermes 运行时、租户 Skill 市场和员工绑定关系可审计、可回滚。"
        />
      )}
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
                disabled={!canInstall}
                title={!canInstall ? '仅管理员可安装' : undefined}
                onClick={() => install(item)}
              >
                {canInstall ? '安装' : '仅管理员'}
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
