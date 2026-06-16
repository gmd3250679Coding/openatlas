import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Select } from 'antd';
import type { Employee } from '../services/api';
import { fetchEmployees } from '../services/api';
import { IconSearch, IconPlus } from '../components/Icons';

const TIER_INFO: Record<string, { dot: string; label: string; cls: string }> = {
  busy: { dot: 'var(--color-success)', label: '在岗', cls: 'busy' },
  idle: { dot: '#FFFFFF', label: '空闲', cls: 'idle' },
  offline: { dot: '#FCA5A5', label: '离线', cls: 'offline' },
};

// Tiny inline icons for skill rows (kept minimal, ~10px)
const SkillIcon = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/** UI-ready shape derived from API Employee */
interface UIEmployee {
  id: string;
  name: string;
  avatar: string;
  color: string;
  dept: string;
  status: string;
  statusTier: 'busy' | 'idle' | 'offline';
  mood: string;
  skill: string;
  photo?: string;
  conversations: string;
  responseTime: string;
  successRate: string;
}

function mapStatusToTier(status: string): UIEmployee['statusTier'] {
  if (status === 'online') return 'busy';
  if (status === 'offline') return 'offline';
  return 'idle';
}

function mapEmployee(e: Employee): UIEmployee {
  const skillList = [
    ...((e.skills || []) as string[]),
    ...((e.allowed_toolsets || e.toolsets || []) as string[]),
  ].filter(Boolean);
  return {
    id: String(e.id),
    name: e.name,
    avatar: e.avatar_char,
    color: e.department?.color || '#4F46E5',
    dept: e.department?.name || e.role || '未分配部门',
    status: e.status_text || e.status,
    statusTier: mapStatusToTier(e.status),
    mood: e.mood || '',
    skill: skillList.length > 0 ? skillList.slice(0, 4).join(' / ') : '默认 Hermes 能力',
    conversations: String(e.conversation_count || e.total_messages || 0),
    responseTime: e.model || 'hermes-agent',
    successRate: e.total_tokens ? `${e.total_tokens} Token` : '待积累',
  };
}

export default function Workforce() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState<string>('all');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEmployees()
      .then((data) => {
        if (!cancelled) {
          setEmployees(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const mapped = useMemo(() => employees.map(mapEmployee), [employees]);

  const depts = useMemo(
    () => Array.from(new Set(mapped.map((e) => e.dept))),
    [mapped]
  );

  const filtered = useMemo(
    () =>
      mapped.filter(
        (e) =>
          (!search ||
            e.name.includes(search) ||
            e.dept.includes(search) ||
            e.skill.toLowerCase().includes(search.toLowerCase())) &&
          (dept === 'all' || e.dept === dept)
      ),
    [mapped, search, dept]
  );

  const onlineCount = mapped.filter((e) => e.statusTier !== 'offline').length;

  if (loading) {
    return (
      <div className="workforce-page" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh' }}>
        <p style={{ color: '#888', fontSize: 16 }}>加载中…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workforce-page" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh' }}>
        <p style={{ color: '#FCA5A5', fontSize: 16 }}>加载失败: {error}</p>
      </div>
    );
  }

  return (
    <div className="workforce-page">
      {/* ── Header ── */}
      <header className="wf-header">
        <div className="wf-header-top">
          <div>
            <h1 className="wf-title">数智员工</h1>
            <p className="wf-sub">
              <span className="wf-dot-live" />
              {onlineCount}/{mapped.length} 在线 · {depts.length} 个部门 · 平均响应 0.6s
            </p>
          </div>
          <button
            className="wf-btn-recruit"
            onClick={() => navigate('/workforce/recruit')}
          >
            <IconPlus size={15} />
            招聘新员工
          </button>
        </div>
      </header>

      <div className="wf-toolbar">
        <Input
          prefix={<IconSearch size={15} />}
          placeholder="搜索姓名、部门或技能…"
          className="wf-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          value={dept}
          onChange={setDept}
          className="wf-filter"
          classNames={{ popup: { root: 'wf-filter-dropdown' } }}
          options={[
            { value: 'all', label: '全部部门' },
            ...depts.map((d) => ({ value: d, label: d })),
          ]}
        />
      </div>

      {/* ── Vertical ID Badge Grid ── */}
      <section className="wf-badge-grid">
        {filtered.map((e) => {
          const skills = e.skill.split(' / ').slice(0, 4);
          const tier = TIER_INFO[e.statusTier] || TIER_INFO.idle;

          return (
            <article
              key={e.id}
              className="id-badge"
              onClick={() => navigate(`/employee/${e.id}`)}
            >
              {/* Top accent strip — instant visual status read */}
              <div className={`id-badge-strip ${tier.cls}`} />

              {/* Photo */}
              <div className="id-badge-photo">
                {e.photo ? (
                  <img
                    src={e.photo}
                    alt={e.name}
                    className="id-badge-img"
                  />
                ) : (
                  <span style={{ background: e.color }} className="id-badge-initial">
                    {e.avatar}
                  </span>
                )}

                {/* Floating ID pill */}
                <div className="id-badge-eid-pill">ATLS-{e.id.toUpperCase()}</div>

                {/* Status pill */}
                <div className="id-badge-status-pill">
                  <span className="id-status-dot" style={{ background: tier.dot }} />
                  {e.status}
                </div>

                {/* Dismiss action */}
                <button
                  className="id-badge-dismiss"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    navigate(`/workforce/dismiss/${e.id}`);
                  }}
                  title="开除"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Info */}
              <div className="id-badge-info">
                <div>
                  <h3 className="id-badge-name">{e.name}</h3>
                  <p className="id-badge-dept">{e.dept}</p>
                </div>

                <div className="id-badge-skills">
                  {skills.map((s) => (
                    <span key={s} className="id-skill-row" title={s.trim()}>
                      <SkillIcon />
                      {s.trim()}
                    </span>
                  ))}
                </div>

                <div className="id-badge-meta">
                  <span className="id-badge-meta-item">
                    <strong>{e.conversations}</strong>次
                  </span>
                  <span className="id-badge-meta-item">
                    <strong>{e.responseTime}</strong>
                  </span>
                  <span className="id-badge-meta-item">
                    <strong>{e.successRate}</strong>
                  </span>
                </div>
              </div>
            </article>
          );
        })}

        {filtered.length === 0 && (
          <div className="wf-empty">
            <p>没有找到匹配的同事</p>
            <span>试试换个关键词或部门筛选</span>
          </div>
        )}
      </section>
    </div>
  );
}
