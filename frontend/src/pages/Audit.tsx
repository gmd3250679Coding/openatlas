import { useState, useEffect, useMemo } from 'react';
import { Tag, Button, Input, Select, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import {
  fetchAuditLogs, exportAuditCsv,
} from '../services/api';

interface BackendAudit {
  id: string;
  tenant_id?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  user_id: string;
  request_id?: string;
  ip?: string;
  user_agent?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

const ACTION_TAGS: Record<string, string> = {
  'auth.login': 'green',
  'auth.logout': 'default',
  'employee.create': 'blue',
  'employee.update': 'cyan',
  'employee.archive': 'red',
  'session.create': 'blue',
  'session.chat': 'purple',
  'job.create': 'blue',
  'job.update': 'cyan',
  'job.delete': 'red',
  'job.pause': 'orange',
  'job.resume': 'green',
  'job.run': 'geekblue',
  'skill.create': 'blue',
  'skill.update': 'cyan',
  'skill.bind': 'purple',
  'skill.unbind': 'orange',
  'skill.publish': 'geekblue',
  'skill.disable': 'red',
  'skill.fork': 'magenta',
  'memory.create': 'blue',
  'memory.update': 'cyan',
  'memory.archive': 'default',
  'memory.fork': 'magenta',
  'memory.bind': 'purple',
  'memory.unbind': 'orange',
  'tenant.create': 'blue',
  'tenant.update': 'cyan',
  'tenant.delete': 'red',
  'runtime.start': 'green',
  'runtime.stop': 'orange',
  'runtime.healthcheck': 'default',
};

function summarizeMetadata(metadata?: Record<string, any>) {
  if (!metadata || Object.keys(metadata).length === 0) return '';
  const parts: string[] = [];
  if (metadata.nodes !== undefined) parts.push(`nodes ${metadata.nodes}`);
  if (metadata.edges !== undefined) parts.push(`edges ${metadata.edges}`);
  if (Array.isArray(metadata.memories_injected)) parts.push(`记忆 ${metadata.memories_injected.length}`);
  if (Array.isArray(metadata.attachments_injected)) parts.push(`附件 ${metadata.attachments_injected.length}`);
  if (metadata.attachment_chars) parts.push(`附件 ${metadata.attachment_chars} 字`);
  if (Array.isArray(metadata.speaker_employee_ids)) parts.push(`员工 ${metadata.speaker_employee_ids.length}`);
  if (Array.isArray(metadata.participant_ids)) parts.push(`参与者 ${metadata.participant_ids.length}`);
  if (metadata.status) parts.push(`status ${metadata.status}`);
  if (metadata.scope) parts.push(`scope ${metadata.scope}`);
  if (metadata.target_type) parts.push(`target ${metadata.target_type}`);
  return parts.length > 0 ? parts.join(' · ') : `${Object.keys(metadata).length} 个字段`;
}

export default function Audit() {
  const [logs, setLogs] = useState<BackendAudit[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | undefined>();
  const [resourceType, setResourceType] = useState<string | undefined>();
  const [resourceId, setResourceId] = useState<string>('');
  const [userId, setUserId] = useState<string | undefined>();
  const [employeeId, setEmployeeId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [fileId, setFileId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [timeRange, setTimeRange] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const rangeToSince = (v: string): string | undefined => {
    if (v === 'all') return undefined;
    const days = v === '1d' ? 1 : v === '7d' ? 7 : v === '30d' ? 30 : 0;
    if (!days) return undefined;
    return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetchAuditLogs({
        action, resource_type: resourceType, resource_id: resourceId || undefined, user_id: userId,
        employee_id: employeeId || undefined,
        skill_id: skillId || undefined,
        file_id: fileId || undefined,
        session_id: sessionId || undefined,
        since: rangeToSince(timeRange), q: search || undefined,
        limit: 200,
      });
      setLogs(r as unknown as BackendAudit[]);
    } catch (ex: any) {
      message.error('load failed: ' + (ex?.message || ex));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [action, resourceType, userId, timeRange]);

  const distinctActions = useMemo(() => {
    const s = new Set<string>();
    logs.forEach((l) => s.add(l.action));
    return Array.from(s).sort();
  }, [logs]);
  const distinctResourceTypes = useMemo(() => {
    const s = new Set<string>();
    logs.forEach((l) => s.add(l.resource_type));
    return Array.from(s).sort();
  }, [logs]);
  const distinctUserIds = useMemo(() => {
    const s = new Set<string>();
    logs.forEach((l) => { if (l.user_id) s.add(l.user_id); });
    return Array.from(s).sort();
  }, [logs]);

  const onExport = async () => {
    setExporting(true);
    try {
      await exportAuditCsv({
        action, resource_type: resourceType, resource_id: resourceId || undefined, user_id: userId,
        employee_id: employeeId || undefined,
        skill_id: skillId || undefined,
        file_id: fileId || undefined,
        session_id: sessionId || undefined,
        since: rangeToSince(timeRange), q: search || undefined,
      });
      message.success('CSV downloaded');
    } catch (ex: any) { message.error('export failed: ' + (ex?.message || ex)); }
    finally { setExporting(false); }
  };

  const hasFilter = action || resourceType || resourceId || userId || employeeId || skillId || fileId || sessionId || timeRange !== 'all' || search;
  const reset = () => {
    setAction(undefined); setResourceType(undefined); setResourceId(''); setUserId(undefined);
    setEmployeeId(''); setSkillId(''); setFileId(''); setSessionId('');
    setTimeRange('all'); setSearch('');
  };

  return (
    <div className="atlas-page" style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 className="atlas-page-title" style={{ margin: 0 }}>审计日志</h1>
        <Button type="primary" icon={<DownloadOutlined />} onClick={onExport} loading={exporting}>
          导出 CSV
        </Button>
      </div>
      <p style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>
        共 {logs.length} 条 · spec §3.5 要求: 记录创建员工、删除员工、创建会话、聊天、任务、Skill 引入/绑定、Memory 修改/注入
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16, marginBottom: 12 }}>
        <Input.Search
          placeholder="搜索 action / resource_id / metadata"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={load}
          style={{ width: 280 }}
          allowClear
        />
        <Select allowClear placeholder="action" value={action} onChange={setAction} style={{ minWidth: 200 }}
          options={distinctActions.map((a) => ({ value: a, label: a }))} showSearch />
        <Select allowClear placeholder="resource_type" value={resourceType} onChange={setResourceType} style={{ minWidth: 180 }}
          options={distinctResourceTypes.map((a) => ({ value: a, label: a }))} />
        <Input.Search
          placeholder="resource_id 精确追踪"
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          onSearch={load}
          style={{ width: 240 }}
          allowClear
        />
        <Input.Search
          placeholder="员工 ID 追踪"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          onSearch={load}
          style={{ width: 220 }}
          allowClear
        />
        <Input.Search
          placeholder="Skill ID 追踪"
          value={skillId}
          onChange={(e) => setSkillId(e.target.value)}
          onSearch={load}
          style={{ width: 220 }}
          allowClear
        />
        <Input.Search
          placeholder="文件 ID 追踪"
          value={fileId}
          onChange={(e) => setFileId(e.target.value)}
          onSearch={load}
          style={{ width: 220 }}
          allowClear
        />
        <Input.Search
          placeholder="会话 ID 追踪"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          onSearch={load}
          style={{ width: 220 }}
          allowClear
        />
        <Select allowClear placeholder="user_id" value={userId} onChange={setUserId} style={{ minWidth: 240 }}
          options={distinctUserIds.map((a) => ({ value: a, label: a.slice(0, 8) }))} showSearch />
        <Select value={timeRange} onChange={setTimeRange} style={{ minWidth: 140 }}
          options={[
            { value: 'all', label: '全部时间' },
            { value: '1d', label: '最近 1 天' },
            { value: '7d', label: '最近 7 天' },
            { value: '30d', label: '最近 30 天' },
          ]} />
        {hasFilter && <Button onClick={reset}>清空</Button>}
        <Button onClick={load} loading={loading}>刷新</Button>
      </div>

      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 8 }}>
        {loading && <div style={{ padding: 24 }}>loading…</div>}
        {!loading && logs.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            没有审计记录
          </div>
        )}
        {!loading && logs.map((l) => (
          <div key={l.id} style={{
            display: 'grid', gridTemplateColumns: '180px 1fr auto',
            gap: 12, padding: '10px 16px',
            borderTop: '1px solid var(--border-default)', fontSize: 13,
            alignItems: 'center',
          }}>
            <div>
              <Tag color={ACTION_TAGS[l.action] || 'default'} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {l.action}
              </Tag>
            </div>
            <div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                  {l.resource_type}{l.resource_id ? ` · ${l.resource_id.slice(0, 12)}` : ''}
                </span>
                {l.user_id && (
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                    user: {l.user_id.slice(0, 8)}
                  </span>
                )}
                {l.ip && (
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>ip: {l.ip}</span>
                )}
              </div>
              {l.metadata && Object.keys(l.metadata).length > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{
                    color: 'var(--text-tertiary)',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}>
                    {summarizeMetadata(l.metadata)}
                  </summary>
                  <pre style={{
                    margin: '6px 0 0',
                    padding: 8,
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 180,
                    overflow: 'auto',
                  }}>
                    {JSON.stringify(l.metadata, null, 2)}
                  </pre>
                </details>
              )}
            </div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11, textAlign: 'right', whiteSpace: 'nowrap' }}>
              {l.created_at?.slice(0, 19).replace('T', ' ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
