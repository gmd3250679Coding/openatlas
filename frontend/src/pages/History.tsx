import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Spin, Input, Button, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { Conversation, Employee } from '../services/api';
import { fetchConversations, fetchEmployees, forkSession } from '../services/api';
import { productVisible, showTestFixtures } from '../utils/productVisibility';

export default function History() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [employees, setEmployees] = useState<Record<string, Employee>>({});
  const [forkingId, setForkingId] = useState<string | number | null>(null);

  useEffect(() => {
    Promise.all([fetchConversations(), fetchEmployees()])
      .then(([convos, emps]) => {
        const map: Record<string, Employee> = {};
        emps.forEach((e) => {
          map[String(e.id)] = e;
          if ((e as any).__id) map[String((e as any).__id)] = e;
        });
        const visibleConversations = productVisible(convos).filter((c) => {
          if (showTestFixtures()) return true;
          if (c.is_group) return true;
          if (c.employee_id == null) return false;
          return Boolean(map[String(c.employee_id)]);
        });
        setConversations(visibleConversations);
        setEmployees(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = conversations.filter((c) => {
    if (!search) return true;
    const empName = c.employee_id != null ? (employees[String(c.employee_id)]?.name || '') : '';
    return (
      c.title?.toLowerCase().includes(search.toLowerCase()) ||
      empName.toLowerCase().includes(search.toLowerCase())
    );
  });

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const handleFork = async (item: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    const sourceId = (item as any).__id || item.id;
    setForkingId(sourceId);
    try {
      const forked = await forkSession(sourceId, `${item.title || '新会话'} · 分支`);
      message.success('已创建分支会话');
      navigate(`/overview?conversation=${(forked as any).__id || forked.id}`);
    } catch (ex: any) {
      message.error('分支创建失败: ' + (ex?.message || ex));
    } finally {
      setForkingId(null);
    }
  };

  return (
    <div style={{ padding: '32px 48px 64px', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{
            fontSize: 28, fontWeight: 700, color: 'var(--text-primary)',
            letterSpacing: '-0.02em', margin: 0,
          }}>对话历史</h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
            {conversations.length} 条对话记录
          </p>
        </div>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索对话..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
      ) : filtered.length === 0 ? (
        <Empty description="暂无对话记录" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((item) => {
            const emp = item.employee_id != null ? employees[String(item.employee_id)] : null;
            const avatar = emp?.avatar_char || '?';
            const color = emp?.department?.color || 'var(--accent)';
            const empName = emp?.name || (item.is_group ? '群聊协作' : '未分配员工');

            return (
              <article
                key={item.id}
                onClick={() => navigate(`/overview?conversation=${item.id}`)}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 18px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.background = 'var(--bg-secondary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.background = 'var(--bg-elevated)';
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 700, flexShrink: 0,
                }}>
                  {avatar}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {item.title || `对话 #${item.id}`}
                    </span>
                    <span className="atlas-chip atlas-chip--neutral" style={{ fontSize: 11 }}>
                      {empName}
                    </span>
                  </div>
                  {item.last_message && (
                    <p style={{
                      fontSize: 12, color: 'var(--text-secondary)',
                      margin: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.last_message}
                    </p>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {formatTime(item.updated_at || item.created_at)}
                  </div>
                  {item.message_count != null && (
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {item.message_count} 条消息
                    </div>
                  )}
                  <Button
                    size="small"
                    type="text"
                    loading={String(forkingId || '') === String((item as any).__id || item.id)}
                    onClick={(e) => handleFork(item, e)}
                    style={{ marginTop: 6, paddingInline: 6 }}
                  >
                    分支
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
