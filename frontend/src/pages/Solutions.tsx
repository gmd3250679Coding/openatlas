import { useEffect, useState } from 'react';
import { fetchSolutions, type Solution } from '../services/api';

const SOLUTION_COLORS = ['#0071e3', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];

function getColor(id: number) {
  return SOLUTION_COLORS[(id - 1) % SOLUTION_COLORS.length];
}

function getIndustry(name: string) {
  const parts = name.split('行业');
  return parts[0] || name;
}

export default function Solutions() {
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSolutions()
      .then(setSolutions)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 64, textAlign: 'center', color: 'var(--text-secondary)' }}>加载中…</div>;

  return (
    <div style={{ padding: '32px 48px 64px' }}>
      <h1 style={{
        fontSize: 28, fontWeight: 700, color: 'var(--text-primary)',
        letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2,
      }}>行业方案</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '6px 0 28px' }}>
        面向不同行业的数智员工解决方案 · 一键部署 Atlas 子集
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {solutions.map((s) => {
          const color = getColor(s.id);
          const industry = getIndustry(s.name);
          return (
            <article
              key={s.id}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                cursor: 'pointer',
                transition: 'border-color 0.2s ease, box-shadow 0.25s ease, transform 0.2s ease',
                boxShadow: 'var(--elev-1)',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'var(--accent)';
                el.style.boxShadow = 'var(--elev-3)';
                el.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'var(--border-subtle)';
                el.style.boxShadow = 'var(--elev-1)';
                el.style.transform = 'translateY(0)';
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: `${color}1A`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 700, color,
                letterSpacing: '-0.02em',
              }}>
                {industry.charAt(0)}
              </div>

              <span className="atlas-chip" style={{ background: `${color}1A`, color, alignSelf: 'flex-start' }}>
                {industry}
              </span>

              <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
                {s.name}
              </h3>

              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.65 }}>
                {s.description}
              </p>

              <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{
                  fontSize: 11, color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  fontWeight: 500, marginBottom: 8,
                }}>
                  包含数智员工 · {s.employee_count}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  <span className="atlas-chip atlas-chip--neutral">{s.employee_count} 位员工</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
