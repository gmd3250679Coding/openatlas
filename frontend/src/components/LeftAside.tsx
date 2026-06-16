/**
 * LeftAside — Phase B 拆分 (2026-06-04) + M4.2 群聊入口
 *
 * 从 CommandCenter 抽出的左侧会话列表 aside。功能:
 *   - 顶部「会话」标题 + 「+ 新建」按钮 + 「+ 群聊」按钮(M4.2)
 *   - 加载中态 / 空态 / 列表态
 *   - 每条会话:hover 显示删除按钮
 *   - 选中态用 --accent-soft 背景
 *   - 群聊会话显示 👥 群聊徽章(王六硬规则零 emoji → 改用文字「群聊」badge)
 *
 * 消费 token:--bg-secondary / --border-subtle / --text-primary / --text-tertiary
 *            / --accent / --accent-soft / --font-mono
 *
 * props 只接"自己渲染需要的"——所有副作用(handler / state)由 CommandCenter
 * 通过 callback 传入,LeftAside 是纯函数组件。
 */
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { Conversation } from '../services/api';
import { IconPlus, IconTrash, IconUsers } from './Icons';

interface Props {
  conversations: Conversation[];
  loading: boolean;
  activeId: number | string | null | undefined;
  onNew: () => void;
  /** M4.2 (Group Chat): 新建群聊回调 */
  onNewGroup?: () => void;
  onSelect: (conv: Conversation) => void;
  onDelete: (id: number, e: ReactMouseEvent) => void;
  onPatch?: (conv: Conversation, patch: Partial<Pick<Conversation, 'title' | 'pinned' | 'workspace' | 'model_override'>>) => Promise<void> | void;
}

export default function LeftAside({
  conversations, loading, activeId, onNew, onNewGroup, onSelect, onDelete, onPatch,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; conv: Conversation } | null>(null);
  const activeKey = activeId == null ? '' : String(activeId);
  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [conversations]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const patchMenuConversation = async (
    patch: Partial<Pick<Conversation, 'title' | 'pinned' | 'workspace' | 'model_override'>>,
  ) => {
    if (!menu?.conv || !onPatch) return;
    await onPatch(menu.conv, patch);
    setMenu(null);
  };

  const openContextMenu = (conv: Conversation, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const width = 214;
    const height = 342;
    const x = Math.min(e.clientX, window.innerWidth - width - 12);
    const y = Math.min(e.clientY, window.innerHeight - height - 12);
    setMenu({ x: Math.max(12, x), y: Math.max(12, y), conv });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setMenu(null);
  };

  const exportConversationMeta = (conv: Conversation, format: 'json' | 'markdown') => {
    const displayTitle = conversationDisplayTitle(conv);
    const baseName = displayTitle.replace(/[\\/:*?"<>|]+/g, '-');
    const body = format === 'json'
      ? JSON.stringify(conv, null, 2)
      : [
        `# ${displayTitle}`,
        '',
        `- 会话 ID: ${conv.__id}`,
        `- 工作区: ${conv.workspace || '-'}`,
        `- 模型: ${conv.model_override || '-'}`,
        `- 消息数: ${conv.message_count ?? 0}`,
        `- 最近消息: ${conv.last_message || '-'}`,
        `- 更新时间: ${conv.updated_at}`,
      ].join('\n');
    const blob = new Blob([body], { type: format === 'json' ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.${format === 'json' ? 'json' : 'md'}`;
    a.click();
    URL.revokeObjectURL(url);
    setMenu(null);
  };

  const menuButtonStyle: CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '9px 14px',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: 13,
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: 8,
  };

  return (
    <aside style={{
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border-subtle)',
      overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '14px 12px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 'var(--ls-uppercase)',
        }}>会话</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onNew} title="新建单聊会话"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px',
              background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: 4,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          ><IconPlus size={12} /> 新建</button>
          {onNewGroup && (
            <button onClick={onNewGroup} title="新建群聊(选 1 个主员工 + 最多 3 个接力)"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px',
                background: 'transparent', color: 'var(--accent)',
                border: '1px solid var(--accent)', borderRadius: 4,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-soft)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            ><IconUsers size={12} /> 群聊</button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{
          padding: '24px 12px', fontSize: 12,
          color: 'var(--text-tertiary)', textAlign: 'center',
        }}>加载中…</div>
      ) : conversations.length === 0 ? (
        <div style={{
          padding: '24px 12px', fontSize: 12,
          color: 'var(--text-tertiary)', textAlign: 'center',
        }}>
          暂无会话<br />
          <span style={{ fontSize: 11 }}>点上方"新建"开始</span>
        </div>
      ) : (
        sortedConversations.map(conv => {
          const isActive = String(conv.id) === activeKey || String(conv.__id) === activeKey;
          const groupParticipantCount = conv.is_group ? 1 + (conv.participant_ids?.length ?? 0) : 1;
          const displayTitle = conversationDisplayTitle(conv);
          return (
            <div
              key={conv.id}
              className="atlas-session-row"
              onClick={() => onSelect(conv)}
              onContextMenu={(e) => openContextMenu(conv, e)}
              style={{
                padding: '12px',
                borderBottom: '1px solid var(--border-subtle)',
                cursor: 'pointer', transition: 'background 0.15s ease',
                background: isActive ? 'var(--accent-soft)' : 'transparent',
                position: 'relative',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--border-subtle)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{
                  fontSize: 13, fontWeight: isActive ? 700 : 500,
                  color: 'var(--text-primary)',
                  flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {conv.pinned ? '置顶 · ' : ''}
                  {displayTitle}
                </div>
                {/* M4.2 (Group Chat): 群聊徽章 */}
                {conv.is_group && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 2,
                    fontSize: 10, fontWeight: 600,
                    color: 'var(--accent)',
                    background: 'var(--accent-soft)',
                    padding: '1px 6px', borderRadius: 3,
                    flexShrink: 0,
                  }} title={`群聊 · ${groupParticipantCount} 人`}>
                    <IconUsers size={10} /> 群聊 · {groupParticipantCount}
                  </span>
                )}
                <button onClick={(e) => openContextMenu(conv, e)} title="更多操作"
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--text-tertiary)', cursor: 'pointer',
                    padding: '0 2px', display: 'flex', alignItems: 'center',
                    fontSize: 16, lineHeight: 1,
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
                >⋯</button>
                <button onClick={(e) => onDelete(conv.id, e)} title="删除"
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--text-tertiary)', cursor: 'pointer',
                    padding: 2, display: 'flex', alignItems: 'center',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--color-danger, #EF4444)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
                ><IconTrash size={12} /></button>
              </div>
              <div style={{
                fontSize: 11, color: 'var(--text-tertiary)',
                lineHeight: 1.4, marginBottom: 4,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {conv.last_message || `${conv.message_count ?? 0} 条消息`}
              </div>
              {(conv.workspace || conv.model_override) && (
                <div style={{
                  display: 'flex', gap: 4, flexWrap: 'wrap',
                  marginBottom: 5,
                }}>
                  {conv.workspace && <span style={{
                    fontSize: 10, color: 'var(--text-secondary)', background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)', padding: '1px 6px', borderRadius: 999,
                  }}>{conv.workspace}</span>}
                  {conv.model_override && <span style={{
                    fontSize: 10, color: 'var(--text-secondary)', background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)', padding: '1px 6px', borderRadius: 999,
                  }}>{conv.model_override}</span>}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  fontSize: 10, color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {new Date(conv.updated_at).toLocaleString('zh-CN', {
                    month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                {conv.message_count !== undefined && conv.message_count > 0 && (
                  <span style={{
                    fontSize: 10, color: 'var(--accent)',
                    background: 'var(--accent-soft)',
                    padding: '1px 6px', borderRadius: 3,
                  }}>
                    {conv.message_count}
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
      {menu && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            width: 214,
            padding: 6,
            borderRadius: 12,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-popover)',
            backdropFilter: 'var(--glass-blur)',
            zIndex: 1100,
          }}
        >
          <button
            style={menuButtonStyle}
            onClick={() => patchMenuConversation({ pinned: !menu.conv.pinned })}
          >
            <span>{menu.conv.pinned ? '取消置顶' : '置顶'}</span>
          </button>
          <button
            style={menuButtonStyle}
            onClick={() => {
              const title = window.prompt('重命名会话', menu.conv.title || '新会话');
              if (title && title.trim()) void patchMenuConversation({ title: title.trim() });
            }}
          >
            <span>重命名</span>
          </button>
          <button
            style={menuButtonStyle}
            onClick={() => {
              const workspace = window.prompt('设置工作区', menu.conv.workspace || '默认工作区');
              if (workspace != null) void patchMenuConversation({ workspace: workspace.trim() });
            }}
          >
            <span>设置工作区</span>
          </button>
          <button
            style={menuButtonStyle}
            onClick={() => {
              const model = window.prompt('设置会话模型偏好', menu.conv.model_override || 'mimo-v2.5-pro');
              if (model != null) void patchMenuConversation({ model_override: model.trim() });
            }}
          >
            <span>设置模型</span>
          </button>
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '5px 4px' }} />
          <button
            style={menuButtonStyle}
            onClick={() => exportConversationMeta(menu.conv, 'markdown')}
          >
            <span>导出 Markdown</span>
          </button>
          <button
            style={menuButtonStyle}
            onClick={() => exportConversationMeta(menu.conv, 'json')}
          >
            <span>导出 JSON</span>
          </button>
          <button
            style={menuButtonStyle}
            onClick={() => {
              window.open(`/overview?conversation=${encodeURIComponent(menu.conv.__id)}`, '_blank', 'noopener,noreferrer');
              setMenu(null);
            }}
          >
            <span>在新标签页打开</span>
          </button>
          <button
            style={menuButtonStyle}
            onClick={() => copyText(`${window.location.origin}/overview?conversation=${encodeURIComponent(menu.conv.__id)}`)}
          >
            <span>复制会话链接</span>
          </button>
          <button
            style={menuButtonStyle}
            onClick={() => copyText(menu.conv.__id)}
          >
            <span>复制会话 ID</span>
          </button>
        </div>
      )}
    </aside>
  );
}

function conversationDisplayTitle(conv: Conversation) {
  const raw = String(conv.title || '').trim();
  if (raw && raw !== '新会话' && raw !== '新对话') return raw;
  const last = String(conv.last_message || '').replace(/\s+/g, ' ').trim();
  if (last) return last.length > 28 ? `${last.slice(0, 28)}...` : last;
  return '未命名任务';
}
