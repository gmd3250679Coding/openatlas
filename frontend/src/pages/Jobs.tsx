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
    <div className="admin-console">
      <section className="admin-hero">
        <div>
          <div className="admin-kicker">Automation Scheduler</div>
          <h1 className="admin-title">自动任务 Jobs</h1>
          <p className="admin-subtitle">
            管理 Cron / interval / once 任务，支持立即触发、暂停恢复和调度结果回看。
          </p>
        </div>
        <div className="admin-actions">
          <Button onClick={load} loading={loading}>刷新</Button>
          <Button type="primary" onClick={() => setShowCreate(true)}>新建任务</Button>
        </div>
      </section>
      <div className="admin-stat-grid">
        <div className="admin-stat-card"><div className="admin-stat-label">全部任务</div><div className="admin-stat-value">{jobs.length}</div><div className="admin-stat-hint">当前租户任务</div></div>
        <div className="admin-stat-card"><div className="admin-stat-label">运行中</div><div className="admin-stat-value">{jobs.filter((j) => j.status === 'active').length}</div><div className="admin-stat-hint">调度可触发</div></div>
        <div className="admin-stat-card"><div className="admin-stat-label">已暂停</div><div className="admin-stat-value">{jobs.filter((j) => j.status === 'paused').length}</div><div className="admin-stat-hint">等待恢复</div></div>
      </div>
      <div className="admin-panel">
        {loading && <div style={{ padding: 24 }}>loading…</div>}
        {!loading && jobs.length === 0 && (
          <div className="admin-empty">
            暂无任务,点右上角新建
          </div>
        )}
        {!loading && jobs.map((j) => (
          <div key={j.id} className="admin-list-row" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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
