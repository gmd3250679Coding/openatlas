import { useEffect, useState, useCallback } from 'react';
import { Tag, message, Input, Select, Button, Empty, Spin } from 'antd';
import {
  fetchSkillMarket, bindSkill, fetchEmployees, fetchSkillBindings, deleteSkillBinding,
  type SkillBindingRow,
} from '../services/api';
import { productVisible, showTestFixtures } from '../utils/productVisibility';

const SCOPE_COLORS: Record<string, string> = {
  global: 'geekblue', tenant: 'blue', user: 'purple', employee: 'magenta',
};

export default function Skills() {
  const [skills, setSkills] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [bindings, setBindings] = useState<SkillBindingRow[]>([]);
  const [scope, setScope] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [bindingTo, setBindingTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, e, b] = await Promise.all([
        fetchSkillMarket(),
        fetchEmployees(),
        fetchSkillBindings(),
      ]);
      setSkills(productVisible(s || []));
      setEmps(e || []);
      setBindings(b || []);
    } catch (ex: any) {
      message.error('load failed: ' + (ex?.message || ex));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Group bindings by skill_id for fast lookup.
  // NOTE: skills are wrapped with withIdShim (id = hashInt, __id = real uuid),
  // while binding.skill_id is the real backend uuid. Compare on __id.
  const bindingsBySkill = (skillId: string) => bindings.filter(b => {
    return b.skill_id === skillId || (b as any).__skill_id === skillId;
  });

  const filtered = skills.filter((s) => {
    if (scope && s.scope !== scope) return false;
    if (search && !`${s.name} ${s.description} ${s.slug}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const onBind = async (skill: any, targetId: string) => {
    try {
      // skill.id is shimmed (hashInt), pass __id to backend so it can locate the skill row
      await bindSkill(skill.__id || skill.id, { target_type: 'employee', target_id: targetId, binding_mode: skill.scope === 'global' ? 'inherited' : 'copied' });
      message.success(`bound ${skill.name} to ${targetId.slice(0, 8)}`);
      await load();
    } catch (ex: any) {
      message.error('bind failed: ' + (ex?.message || ex));
    } finally { setBindingTo(null); }
  };

  const onUnbind = async (bindingId: string, skillName: string) => {
    try {
      await deleteSkillBinding(bindingId);
      message.success(`unbound ${skillName}`);
      await load();
    } catch (ex: any) {
      message.error('unbind failed: ' + (ex?.message || ex));
    }
  };

  const empNameById = (id: string) => {
    const e = emps.find(x => String(x.id) === String(id) || String((x as any).__id) === String(id));
    return e ? (e.display_name || e.name || id.slice(0, 6)) : null;
  };

  const employeeLabel = (e: any) => {
    const rawId = e.__id || String(e.id);
    return e.display_name || e.name || rawId.slice(0, 6);
  };
  const enabledCount = skills.filter((s) => s.status === 'enabled').length;
  const hermesCount = skills.filter((s) => String((s as any).source_ref || '').startsWith('hermes:')).length;

  return (
    <div className="admin-console">
      <section className="admin-hero">
        <div>
          <div className="admin-kicker">Capability Control</div>
          <h1 className="admin-title">技能中心 Skills</h1>
          <p className="admin-subtitle">
            浏览当前租户可用技能，并把 Hermes / InsightLab 技能绑定到具体数智员工。
          </p>
        </div>
        <div className="admin-actions">
          <Button onClick={load} loading={loading}>刷新</Button>
        </div>
      </section>
      <div className="admin-stat-grid">
        <div className="admin-stat-card"><div className="admin-stat-label">全部 Skill</div><div className="admin-stat-value">{skills.length}</div><div className="admin-stat-hint">当前可见能力包</div></div>
        <div className="admin-stat-card"><div className="admin-stat-label">启用中</div><div className="admin-stat-value">{enabledCount}</div><div className="admin-stat-hint">可绑定到员工</div></div>
        <div className="admin-stat-card"><div className="admin-stat-label">Hermes 来源</div><div className="admin-stat-value">{hermesCount}</div><div className="admin-stat-hint">运行时已同步</div></div>
        <div className="admin-stat-card"><div className="admin-stat-label">绑定记录</div><div className="admin-stat-value">{bindings.length}</div><div className="admin-stat-hint">员工能力覆盖</div></div>
      </div>
      <div className="admin-toolbar">
        <Input.Search placeholder="按名称搜索" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }} />
        <Select
          allowClear placeholder="按 scope 过滤"
          value={scope} onChange={setScope} style={{ minWidth: 160 }}
          options={[
            { value: 'global', label: 'global' }, { value: 'tenant', label: 'tenant' },
            { value: 'user', label: 'user' }, { value: 'employee', label: 'employee' },
          ]}
        />
      </div>
      <div className="admin-card-grid">
        {filtered.length === 0 && !loading && (
          <div className="admin-empty">无匹配技能</div>
        )}
        {filtered.map((s) => (
          <div key={s.__id || s.id} className="admin-skill-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong>{s.name}</strong>
              <Tag color={SCOPE_COLORS[s.scope] || 'default'}>{s.scope}</Tag>
            </div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 4 }}>
              {s.category} · v{s.version} · {s.status}
            </div>
            {s.description && <div style={{ marginTop: 6, fontSize: 13 }}>{s.description}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <Button size="small" disabled={s.status !== 'enabled'} onClick={() => setBindingTo(bindingTo === (s.__id || String(s.id)) ? null : (s.__id || String(s.id)))}>
                {bindingTo === (s.__id || String(s.id)) ? '取消' : 'Bind…'}
              </Button>
              {!s.mutable && <Tag color="default" style={{ marginLeft: 'auto' }}>只读</Tag>}
            </div>
            {bindingTo === (s.__id || String(s.id)) && (
              <div style={{ marginTop: 8, borderTop: '1px dashed var(--border-default)', paddingTop: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>选择员工:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {emps.slice(0, 12).map((e) => (
                    <Button key={e.__id || e.id} size="small" onClick={() => onBind(s, e.__id || String(e.id))}>
                      {employeeLabel(e)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {/* Phase 3.9: show bound employees + unbind per binding.
                skills are shimmed (s.id is hashInt, s.__id is real uuid). Use __id. */}
            {(() => {
              const realSkillId = (s as any).__id || s.id;
              const sb = bindingsBySkill(realSkillId).filter((b) => showTestFixtures() || !!empNameById(b.target_id));
              if (sb.length === 0) return null;
              return (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-default)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                    已绑定 {sb.length} 个员工:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {sb.map(b => (
                      <Tag
                        key={b.id}
                        color={b.target_type === 'employee' ? 'cyan' : 'orange'}
                        closable={!b.locked}
                        onClose={(e) => { e.preventDefault(); e.stopPropagation(); onUnbind(b.id, s.name); }}
                        style={{ fontSize: 11, margin: 0 }}
                      >
                        {empNameById(b.target_id) || '未知员工'} · {b.binding_mode}
                      </Tag>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
