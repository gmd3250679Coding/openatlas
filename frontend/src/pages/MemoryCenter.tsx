import { useEffect, useState } from 'react';
import { Tag, Button, Modal, Input, Select, message } from 'antd';
import {
  fetchMemories, createMemory, patchMemory, archiveMemory, forkMemory, fetchEffectiveMemories,
} from '../services/api';
import { productVisible } from '../utils/productVisibility';

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
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>记忆中心 Memory Center</h2>
        <Button type="primary" onClick={() => setShowCreate(true)}>新建 Memory</Button>
      </div>
      <p style={{ color: 'var(--text-tertiary)' }}>
        四层作用域:global / tenant / user / employee。effective 列表显示当前用户在 chat 中会被注入的 memory。
      </p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <Select allowClear placeholder="按 scope 过滤" value={scope} onChange={setScope} style={{ minWidth: 160 }}
          options={[
            { value: 'global', label: 'global' }, { value: 'tenant', label: 'tenant' },
            { value: 'user', label: 'user' }, { value: 'employee', label: 'employee' },
          ]} />
        <Button onClick={load} loading={loading}>刷新</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>所有 Memory ({mems.length})</h3>
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
          <h3 style={{ marginTop: 0 }}>本次对话生效 ({effective.length})</h3>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
            effective memories — 跟 chat stream 中的 <code>openatlas.memories</code> 事件一致
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
      <CreateModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
      <EditModal editId={editId} onClose={() => setEditId(null)} mems={mems} onSaved={load} />
    </div>
  );
}

function CreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<'global' | 'tenant' | 'user' | 'employee'>('user');
  const [tags, setTags] = useState('');
  const [priority, setPriority] = useState(50);
  const [busy, setBusy] = useState(false);
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
    <Modal open={open} onCancel={onClose} onOk={submit} title="新建 Memory" confirmLoading={busy} okText="创建">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>标题 <Input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>内容 <Input.TextArea rows={5} value={content} onChange={(e) => setContent(e.target.value)} /></label>
        <label>Scope
          <Select value={scope} onChange={setScope} style={{ width: '100%' }}
            options={[
              { value: 'user', label: 'user (个人)' },
              { value: 'tenant', label: 'tenant (本租户)' },
              { value: 'global', label: 'global (全局)' },
              { value: 'employee', label: 'employee (绑定员工)' },
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
