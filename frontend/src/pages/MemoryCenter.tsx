import { useEffect, useState } from 'react';
import { Tag, Button, Modal, Input, Select, message } from 'antd';
import {
  fetchMemories, createMemory, patchMemory, archiveMemory, forkMemory, fetchEffectiveMemories,
} from '../services/api';
import { productVisible } from '../utils/productVisibility';
import { useAuth } from '../contexts/AuthContext';

const SCOPE_COLORS: Record<string, string> = {
  global: 'geekblue', tenant: 'blue', user: 'purple', employee: 'magenta',
};

function dedupeMemories(items: any[]) {
  const seen = new Set<string>();
  return items.filter((m) => {
    const key = `${m.scope || ''}|${m.title || ''}|${m.content || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function MemoryCenter() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const [mems, setMems] = useState<any[]>([]);
  const [effective, setEffective] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [scope, setScope] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [m, e] = await Promise.all([fetchMemories(scope), fetchEffectiveMemories()]);
      setMems(dedupeMemories(productVisible(m || [])));
      setEffective(dedupeMemories(productVisible(e || [])));
    } catch (ex: any) { message.error('load failed: ' + (ex?.message || ex)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [scope]);

  const onArchive = async (id: string) => {
    try { await archiveMemory(id); message.success('archived'); await load(); }
    catch (ex: any) { message.error('archive failed: ' + (ex?.message || ex)); }
  };
  const onFork = async (id: string) => {
    try { await forkMemory(id, { target_scope: 'user' }); message.success('forked to user scope'); await load(); }
    catch (ex: any) { message.error('fork failed: ' + (ex?.message || ex)); }
  };

  return (
    <div style={{ padding: '42px 48px 80px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{
        borderRadius: 24,
        padding: '34px 36px',
        marginBottom: 22,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.86), rgba(245,246,255,0.72))',
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 24px 72px rgba(79,70,229,0.10)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
          <div>
            <div style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 800, letterSpacing: '0.16em', marginBottom: 8 }}>
              MEMORY GOVERNANCE
            </div>
            <h2 style={{ margin: 0, fontSize: 44, letterSpacing: 0 }}>记忆中心</h2>
            <p style={{ color: 'var(--text-secondary)', maxWidth: 760, margin: '12px 0 0', lineHeight: 1.8 }}>
              Hermes 负责真实运行时记忆能力，OpenAtlas 负责企业侧的作用域、权限、版本和注入可见性。全局/租户记忆只读共享，个人与自建员工记忆可定制，避免跨用户串记忆。
            </p>
          </div>
          <Button type="primary" onClick={() => setShowCreate(true)}>
            {isAdmin ? '新建记忆规则' : '新建个人记忆'}
          </Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 24 }}>
          {[
            ['Hermes 原生记忆', '保留底层 profiles / sessions / memory 注入能力，不在 OpenAtlas 中复制运行时。'],
            ['OpenAtlas 治理层', '按 global / tenant / user / employee 管控可读、可改、可 Fork 和可绑定范围。'],
            ['本轮输入来源', '聊天右侧会展示本轮实际注入的 Skill、文件片段和记忆，便于追溯。'],
          ].map(([title, detail]) => (
            <div key={title} style={{
              padding: 16,
              borderRadius: 16,
              background: 'rgba(255,255,255,0.66)',
              border: '1px solid var(--border-subtle)',
            }}>
              <strong>{title}</strong>
              <p style={{ margin: '8px 0 0', color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1.6 }}>{detail}</p>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <Select allowClear placeholder="按作用域过滤" value={scope} onChange={setScope} style={{ minWidth: 180 }}
          options={[
            { value: 'global', label: '全局共享' }, { value: 'tenant', label: '租户共享' },
            { value: 'user', label: '个人记忆' }, { value: 'employee', label: '员工记忆' },
          ]} />
        <Button onClick={load} loading={loading}>刷新</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>可见记忆 ({mems.length})</h3>
          {!loading && mems.length === 0 && (
            <div style={{ padding: 24, background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-tertiary)' }}>
              暂无
            </div>
          )}
          {mems.map((m) => (
            <div key={m.id} style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
              borderRadius: 8, padding: 12, marginBottom: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <strong>{m.title}</strong>
                <Tag color={SCOPE_COLORS[m.scope] || 'default'}>{m.scope}</Tag>
                {m.mutable ? <Tag>mutable</Tag> : <Tag color="red">locked</Tag>}
                {m.status === 'archived' && <Tag color="default">archived</Tag>}
                <span style={{ color: 'var(--text-tertiary)', fontSize: 12, marginLeft: 'auto' }}>
                  v{m.version || 1} · p{m.priority || 50}
                </span>
              </div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'auto' }}>
                {m.content}
              </div>
              {m.tags && (
                <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {String(m.tags).split(',').filter(Boolean).map((t) => <Tag key={t}>{t}</Tag>)}
                </div>
              )}
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                {m.mutable && m.status !== 'archived' && (
                  <Button size="small" onClick={() => setEditId(m.id)}>编辑</Button>
                )}
                {(m.scope === 'global' || m.scope === 'tenant') && (
                  <Button size="small" onClick={() => onFork(m.id)}>Fork→user</Button>
                )}
                {m.status !== 'archived' && (
                  <Button size="small" danger onClick={() => onArchive(m.id)}>Archive</Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div>
          <h3 style={{ marginTop: 0 }}>当前生效注入 ({effective.length})</h3>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
            与聊天流中的 <code>openatlas.memories</code> 事件一致，用来解释模型本轮看到了哪些记忆。
          </p>
          {effective.length === 0 && (
            <div style={{ padding: 24, background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-tertiary)', fontSize: 13 }}>
              当前无生效 memory
            </div>
          )}
          {effective.map((m) => (
            <div key={m.id} style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
              borderRadius: 6, padding: 8, marginBottom: 6, fontSize: 13,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tag color={SCOPE_COLORS[m.scope] || 'default'} style={{ fontSize: 11 }}>{m.scope}</Tag>
                <strong style={{ fontSize: 13 }}>{m.title}</strong>
              </div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 4, maxHeight: 40, overflow: 'hidden' }}>
                {m.content?.slice(0, 80)}…
              </div>
            </div>
          ))}
        </div>
      </div>
      <CreateModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} isAdmin={isAdmin} />
      <EditModal editId={editId} onClose={() => setEditId(null)} mems={mems} onSaved={load} />
    </div>
  );
}

function CreateModal({ open, onClose, onCreated, isAdmin }: { open: boolean; onClose: () => void; onCreated: () => void; isAdmin: boolean }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<'global' | 'tenant' | 'user' | 'employee'>('user');
  const [tags, setTags] = useState('');
  const [priority, setPriority] = useState(50);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isAdmin) setScope('user');
  }, [isAdmin, open]);
  const submit = async () => {
    if (!title || !content) { message.error('title + content required'); return; }
    setBusy(true);
    try {
      await createMemory({
        title, content, scope, priority,
        tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
        visibility: 'private', mutable: true,
      });
      message.success('created');
      onCreated(); onClose();
    } catch (ex: any) { message.error('create failed: ' + (ex?.message || ex)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={submit} title={isAdmin ? '新建记忆规则' : '新建个人记忆'} confirmLoading={busy} okText="创建">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>标题 <Input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>内容 <Input.TextArea rows={5} value={content} onChange={(e) => setContent(e.target.value)} /></label>
        <label>作用域
          <Select value={scope} onChange={setScope} style={{ width: '100%' }}
            options={[
              { value: 'user', label: '个人记忆' },
              ...(isAdmin ? [
                { value: 'tenant', label: '租户共享记忆' },
                { value: 'global', label: '全局共享记忆' },
                { value: 'employee', label: '员工记忆' },
              ] : []),
            ]} />
        </label>
        <label>Tags (逗号分隔) <Input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        <label>Priority (0-100) <Input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></label>
      </div>
    </Modal>
  );
}

function EditModal({ editId, onClose, mems, onSaved }:
  { editId: string | null; onClose: () => void; mems: any[]; onSaved: () => void }) {
  const m = mems.find((x) => x.id === editId);
  const [title, setTitle] = useState(m?.title || '');
  const [content, setContent] = useState(m?.content || '');
  const [priority, setPriority] = useState(m?.priority || 50);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (m) { setTitle(m.title); setContent(m.content); setPriority(m.priority || 50); } }, [m]);
  if (!m) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await patchMemory(m.id, { title, content, priority });
      message.success('updated');
      onSaved(); onClose();
    } catch (ex: any) { message.error('update failed: ' + (ex?.message || ex)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={!!editId} onCancel={onClose} onOk={submit} title="编辑 Memory" confirmLoading={busy} okText="保存">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>标题 <Input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>内容 <Input.TextArea rows={6} value={content} onChange={(e) => setContent(e.target.value)} /></label>
        <label>Priority <Input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></label>
      </div>
    </Modal>
  );
}
