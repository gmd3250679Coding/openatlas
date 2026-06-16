import { useEffect, useState } from 'react';
import { Button, Tag, Modal, Input, Select, message } from 'antd';
import {
  fetchJobs, createJob, deleteJob, pauseJob, resumeJob, runJob, patchJob,
} from '../services/api';

const STATUS_COLORS: Record<string, string> = {
  active: 'green', paused: 'orange', disabled: 'default',
};

export default function Jobs() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetchJobs();
      setJobs(r.items || []);
    } catch (e: any) {
      message.error('failed to load jobs: ' + (e?.message || e));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onPause = async (id: string) => { setBusy(id); try { await pauseJob(id); await load(); } finally { setBusy(null); } };
  const onResume = async (id: string) => { setBusy(id); try { await resumeJob(id); await load(); } finally { setBusy(null); } };
  const onRun = async (id: string) => { setBusy(id); try { await runJob(id); message.success('job run triggered'); await load(); } catch (e: any) { message.error('run failed: ' + (e?.message || e)); } finally { setBusy(null); } };
  const onDelete = async (id: string) => { Modal.confirm({ title: 'Delete job?', onOk: async () => { await deleteJob(id); await load(); } }); };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>自动任务 Jobs</h2>
        <Button type="primary" onClick={() => setShowCreate(true)}>新建任务</Button>
      </div>
      <p style={{ color: 'var(--text-tertiary)', marginTop: 0 }}>
        Cron / interval / once 任务。点 Run 立即触发;点 Pause 暂停调度。
      </p>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 8 }}>
        {loading && <div style={{ padding: 24 }}>loading…</div>}
        {!loading && jobs.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            暂无任务,点右上角新建
          </div>
        )}
        {!loading && jobs.map((j) => (
          <div key={j.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderTop: '1px solid var(--border-default)',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong>{j.name}</strong>
                <Tag color={STATUS_COLORS[j.status] || 'default'}>{j.status}</Tag>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                  {j.schedule_kind}: {j.schedule_expr}
                </span>
              </div>
              {j.description && <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginTop: 4 }}>{j.description}</div>}
              <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 4 }}>
                last: {j.last_status || 'never_run'} · {j.last_run_at || '—'}
                {j.last_error && <span style={{ color: 'var(--color-danger)' }}> · {j.last_error.slice(0, 60)}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
              {j.status === 'active'
                ? <Button size="small" onClick={() => onPause(j.id)} loading={busy === j.id}>暂停</Button>
                : <Button size="small" onClick={() => onResume(j.id)} loading={busy === j.id}>恢复</Button>}
              <Button size="small" type="primary" ghost onClick={() => onRun(j.id)} loading={busy === j.id}>Run</Button>
              <Button size="small" danger onClick={() => onDelete(j.id)}>删除</Button>
            </div>
          </div>
        ))}
      </div>
      <CreateJobModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </div>
  );
}

function CreateJobModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [kind, setKind] = useState('cron');
  const [expr, setExpr] = useState('0 9 * * *');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) { message.error('name required'); return; }
    setBusy(true);
    try {
      await createJob({ name, description: desc, schedule_kind: kind, schedule_expr: expr, prompt });
      message.success('job created');
      onCreated(); onClose();
    } catch (e: any) {
      message.error('create failed: ' + (e?.message || e));
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onCancel={onClose} onOk={submit} title="新建任务" confirmLoading={busy} okText="创建">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>名称 <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="daily-report" /></label>
        <label>描述 <Input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label>调度类型
          <Select value={kind} onChange={setKind} style={{ width: '100%' }}
                  options={[{ value: 'cron', label: 'cron' }, { value: 'interval', label: 'interval' }, { value: 'once', label: 'once' }]} />
        </label>
        <label>调度表达式 <Input value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="0 9 * * *" /></label>
        <label>Prompt (LLM 输入)
          <Input.TextArea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What's in the news today?" />
        </label>
      </div>
    </Modal>
  );
}
