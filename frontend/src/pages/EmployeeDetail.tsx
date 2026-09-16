import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, Descriptions, Table, Empty, Spin, Modal, Input, message, Tag, Button, Popconfirm, Select } from 'antd';
import { SettingOutlined, FileTextOutlined, ApiOutlined, ClockCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import type { EmployeeDetail as EmployeeDetailType, SkillPackage } from '../services/api';
import { fetchEmployeeDetail, executeSkill, fetchSkillBindings, deleteSkillBinding, fetchSkillMarket, bindSkill, type SkillBindingRow } from '../services/api';

const STATS_LABEL: Record<string, string> = {
  conversations: '今日对话',
  responseTime: '平均响应',
  successRate: '成功率',
  tokens: 'Token 用量',
};

// M2.5: 试运行参数模板 — 与 backend/services/skill_runtime.py 4 个 skill 的 input schema 一一对应
const SKILL_INPUT_TEMPLATE: Record<string, string> = {
  text_analysis: '{\n  "text": "请替换为需要分析的文本。返回 JSON:{sentiment, keywords[], summary}"\n}',
  code_generation: '{\n  "prompt": "请写一个判断回文字符串的函数",\n  "language": "python"\n}',
  document_summarize: '{\n  "text": "请粘贴或输入需要总结的文档内容(可到 3000 字)。",\n  "max_length": 200\n}',
  contract_review: '{\n  "text": "请粘贴合同条款文本,系统将识别潜在风险并给出修改建议。"\n}',
};

function skillRiskColor(risk?: string) {
  const r = String(risk || '').toLowerCase();
  if (r === 'high') return 'red';
  if (r === 'medium') return 'orange';
  if (r === 'low') return 'green';
  return 'default';
}

function formatMs(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  const ms = Number(value);
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatPercent(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  return `${Math.round(Number(value) * 100)}%`;
}

function taskStatusText(status?: string) {
  const map: Record<string, string> = {
    draft: '草稿',
    queued: '排队中',
    running: '进行中',
    stalled: '停滞',
    needs_input: '需补充',
    waiting_input: '需补充',
    waiting_approval: '待审批',
    completed: '已完成',
    done: '已完成',
    failed: '失败',
  };
  return map[String(status || '')] || status || '-';
}

function taskStatusChipClass(status?: string) {
  const s = String(status || '');
  if (s === 'completed' || s === 'done') return 'atlas-chip atlas-chip--success';
  if (s === 'failed') return 'atlas-chip atlas-chip--danger';
  if (s === 'running' || s === 'queued') return 'atlas-chip atlas-chip--accent';
  return 'atlas-chip atlas-chip--neutral';
}

function skillSourceLabel(sourceRef?: string) {
  const source = String(sourceRef || '');
  if (source.startsWith('hermes:')) return 'Hermes 运行时';
  if (source.startsWith('zip:') || source.startsWith('openatlas:')) return '本地导入包';
  return 'InsightLab 元数据';
}

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<EmployeeDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  // Phase 3.9: InsightLab SkillBinding 表里绑定的市场技能
  const [skillBindings, setSkillBindings] = useState<SkillBindingRow[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [marketSkills, setMarketSkills] = useState<SkillPackage[]>([]);
  const [bindModalOpen, setBindModalOpen] = useState(false);
  const [bindingSkillId, setBindingSkillId] = useState<string | undefined>();
  const [bindingMode, setBindingMode] = useState<'inherited' | 'copied' | 'custom'>('inherited');
  const [bindingSubmitting, setBindingSubmitting] = useState(false);
  // 真实 Skill 执行仍待 Hermes toolsets 接入；这里保留模态状态但入口禁用，避免假执行。
  const [atomicSkills, setAtomicSkills] = useState<string[]>([]);
  const [trialSkill, setTrialSkill] = useState<string | null>(null);
  const [trialInput, setTrialInput] = useState<string>('{}');
  const [trialResult, setTrialResult] = useState<string>('');
  const [trialRunning, setTrialRunning] = useState(false);

  useEffect(() => {
    setAtomicSkills([]);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchEmployeeDetail(id)
      .then((data) => setEmployee(data))
      .catch(() => setEmployee(null))
      .finally(() => setLoading(false));
  }, [id]);

  // Phase 3.9: load InsightLab SkillBindings for this employee
  const reloadSkillBindings = useCallback(async () => {
    const targetId = (employee as any)?.__id || id;
    if (!targetId) return;
    setBindingsLoading(true);
    try {
      const rows = await fetchSkillBindings({ target_type: 'employee', target_id: targetId });
      setSkillBindings(rows);
    } catch (e) {
      console.error('Failed to load skill bindings:', e);
      setSkillBindings([]);
    } finally {
      setBindingsLoading(false);
    }
  }, [employee, id]);
  useEffect(() => { void reloadSkillBindings(); }, [reloadSkillBindings]);

  const reloadMarketSkills = useCallback(async () => {
    try {
      const rows = await fetchSkillMarket();
      setMarketSkills(rows || []);
    } catch (e) {
      console.error('Failed to load market skills:', e);
      setMarketSkills([]);
    }
  }, []);
  useEffect(() => { void reloadMarketSkills(); }, [reloadMarketSkills]);

  const handleUnbind = useCallback(async (bindingId: string) => {
    try {
      await deleteSkillBinding(bindingId);
      message.success('已解绑');
      await reloadSkillBindings();
    } catch (ex: any) {
      message.error('解绑失败: ' + (ex?.message || ex));
    }
  }, [reloadSkillBindings]);

  const realEmployeeId = (employee as any)?.__id || id || '';
  const boundSkillIds = useMemo(() => new Set(skillBindings.map((b) => b.skill_id)), [skillBindings]);
  const bindableSkills = useMemo(
    () => marketSkills
      .filter((s: any) => s.status === 'enabled' && !boundSkillIds.has((s as any).__id || String(s.id)))
      .sort((a: any, b: any) => {
        const rank = (s: any) => String(s.source_ref || '').startsWith('hermes:') ? 0 : String(s.source_ref || '').startsWith('zip:') || String(s.source_ref || '').startsWith('openatlas:') ? 1 : 2;
        const ah = rank(a);
        const bh = rank(b);
        return ah - bh || a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name);
      }),
    [marketSkills, boundSkillIds],
  );
  const selectedBindingSkill = useMemo(
    () => bindableSkills.find((s: any) => ((s as any).__id || String(s.id)) === bindingSkillId),
    [bindableSkills, bindingSkillId],
  );

  const openBindModal = useCallback(() => {
    setBindingSkillId(bindableSkills[0] ? ((bindableSkills[0] as any).__id || String(bindableSkills[0].id)) : undefined);
    setBindingMode('inherited');
    setBindModalOpen(true);
  }, [bindableSkills]);

  const handleBindSkill = useCallback(async () => {
    if (!bindingSkillId || !realEmployeeId) {
      message.warning('请选择要绑定的 Skill');
      return;
    }
    setBindingSubmitting(true);
    try {
      await bindSkill(bindingSkillId, {
        target_type: 'employee',
        target_id: realEmployeeId,
        binding_mode: bindingMode,
      });
      message.success('已绑定 Skill');
      setBindModalOpen(false);
      await Promise.all([reloadSkillBindings(), reloadMarketSkills()]);
    } catch (ex: any) {
      message.error('绑定失败: ' + (ex?.message || ex));
    } finally {
      setBindingSubmitting(false);
    }
  }, [bindingMode, bindingSkillId, realEmployeeId, reloadMarketSkills, reloadSkillBindings]);

  if (loading) {
    return (
      <div style={{ padding: '40px 48px', textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  // M2.5: 打开试运行模态
  const openTrial = (skillName?: string) => {
    const initial = skillName || atomicSkills[0] || '';
    setTrialSkill(initial);
    setTrialInput(SKILL_INPUT_TEMPLATE[initial] || '{}');
    setTrialResult('');
  };

  // M2.5: 切换 atomic skill 时,重置输入模板
  const switchSkill = (skillName: string) => {
    setTrialSkill(skillName);
    setTrialInput(SKILL_INPUT_TEMPLATE[skillName] || '{}');
  };

  // M2.5: 执行试运行
  const runTrial = async () => {
    if (!trialSkill) return;
    let parsed: Record<string, any> = {};
    try {
      parsed = trialInput.trim() ? JSON.parse(trialInput) : {};
    } catch (e: any) {
      message.error(`输入 JSON 解析失败: ${e?.message || e}`);
      return;
    }
    setTrialRunning(true);
    setTrialResult('');
    try {
      const res = await executeSkill(trialSkill, parsed);
      setTrialResult(JSON.stringify(res, null, 2));
      message.success(`Skill ${trialSkill} 执行成功`);
    } catch (e: any) {
      const err = String(e?.message || e);
      setTrialResult(`// 执行失败\n${err}`);
      message.error(`Skill 执行失败: ${err}`);
    } finally {
      setTrialRunning(false);
    }
  };

  if (!employee) {
    return (
      <div style={{ padding: '40px 48px' }}>
        <Empty description="未找到该员工" />
      </div>
    );
  }

  // Map API fields to display fields
  const avatar = employee.avatar_char;
  const color = employee.department?.color || 'var(--accent)';
  const dept = employee.department?.name || '未分配';
  const name = employee.name;
  const empId = String(employee.id);
  const status = employee.status_text || employee.status;
  const statusTier = employee.status === 'active' ? 'busy' : employee.status === 'idle' ? 'idle' : 'offline';
  const conversations = String(employee.today_conversation_count ?? employee.conversation_count ?? 0);
  const responseTime = formatMs(employee.avg_response_ms);
  const successRate = formatPercent(employee.success_rate);
  const tokens = String(employee.total_tokens || 0);
  const skillNames = (employee.skills || []).map((s: any) => s.skill_name || s.name || String(s)).filter(Boolean);
  // Bug C 修复：system_prompt 存在 employees 表，不在 skills.description
  const systemPrompt = (employee.system_prompt && employee.system_prompt.trim())
    ? employee.system_prompt
    : '暂无系统 Prompt（招聘时填的 system_prompt 不为空时才会显示）';
  const tools = Array.isArray(employee.toolsets) ? employee.toolsets : [];
  const runtimeParams = employee.runtime_params || {};
  const recentActivity = employee.recent_activity || [];

  return (
    <div style={{ padding: '32px 48px 64px', maxWidth: 1200 }}>
      {/* ── Back ── */}
      <button className="nav-back" style={{ marginBottom: 18 }} onClick={() => navigate('/workforce')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        数智员工
      </button>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 32 }}>
        <div className="employee-avatar" style={{ background: color, width: 72, height: 72, fontSize: 28 }}>
          {avatar}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{
            fontSize: 28, fontWeight: 700, color: 'var(--text-primary)',
            letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2,
          }}>{name}</h1>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{dept}</span>
            <span className="atlas-chip atlas-chip--accent" style={{ fontFamily: 'var(--font-mono)' }}>
              hermes://atlas/{empId}
            </span>
            <span className={`atlas-chip ${statusTier === 'busy' ? 'atlas-chip--success' : statusTier === 'idle' ? 'atlas-chip--neutral' : 'atlas-chip--danger'}`}>
              {status}
            </span>
          </div>
        </div>
        <button
          onClick={() => navigate(`/overview?employee=${id}`)}
          style={{
            background: 'var(--accent)', color: 'white', padding: '8px 20px',
            borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600,
            border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          开始对话
        </button>
      </div>

      {/* ── Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 32 }}>
        {[
          { key: 'conversations', value: conversations },
          { key: 'responseTime', value: responseTime },
          { key: 'successRate', value: successRate },
          { key: 'tokens', value: tokens },
        ].map((s) => (
          <div key={s.key} className="stat-card">
            <div className="label">{STATS_LABEL[s.key]}</div>
            <div className="value">{s.value}</div>
          </div>
        ))}
      </div>

      <Tabs
        defaultActiveKey="skill"
        items={[
          {
            key: 'skill',
            label: <span><SettingOutlined /> Skill 配置</span>,
            children: (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>已绑定 Skills</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 28 }}>
                  {skillNames.length > 0 ? skillNames.map((s) => (
                    <span key={s} className="atlas-chip atlas-chip--accent" style={{ fontFamily: 'var(--font-mono)', padding: '4px 10px' }}>
                      {s.trim()}
                    </span>
                  )) : (
                    <span className="atlas-chip atlas-chip--neutral" style={{ padding: '4px 10px' }}>未配置</span>
                  )}
                </div>
                {/* Phase 3.9: InsightLab SkillBinding — 来自技能市场的可绑定技能 */}
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <span>已绑定市场技能</span>
                  {bindingsLoading && <Spin size="small" style={{ marginLeft: 8 }} />}
                  <Button
                    size="small"
                    type="primary"
                    onClick={openBindModal}
                    disabled={bindableSkills.length === 0}
                    style={{ float: 'right', marginTop: -4 }}
                  >
                    绑定 Skill
                  </Button>
                </div>
                {skillBindings.length === 0 && !bindingsLoading ? (
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 28, padding: '12px 14px', background: 'var(--bg-secondary)', border: '1px dashed var(--border-default)', borderRadius: 8 }}>
                    暂未从技能市场绑定技能。前往 <a onClick={() => navigate('/skills')} style={{ color: 'var(--accent)', cursor: 'pointer' }}>技能中心</a> 或 <a onClick={() => navigate('/skill-market')} style={{ color: 'var(--accent)', cursor: 'pointer' }}>技能市场</a> 绑定。
                  </div>
                ) : (
                  <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {skillBindings.map((b) => (
                      <div key={b.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 8,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                          <strong style={{ fontSize: 13 }}>{b.skill_name}</strong>
                          <Tag color={b.skill_scope === 'global' ? 'geekblue' : b.skill_scope === 'tenant' ? 'blue' : 'purple'} style={{ margin: 0 }}>
                            {b.skill_scope}
                          </Tag>
                          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>v{b.skill_version}</span>
                          <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>·</span>
                          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>mode: {b.binding_mode}</span>
                          {b.locked && <Tag color="default" style={{ margin: 0, fontSize: 11 }}>locked</Tag>}
                        </div>
                        {!b.locked && (
                          <Popconfirm
                            title="解绑该市场技能？"
                            description={`将解除「${b.skill_name}」与本员工的绑定关系`}
                            okText="解 绑"
                            okButtonProps={{ danger: true }}
                            cancelText="取 消"
                            onConfirm={() => handleUnbind(b.id)}
                          >
                            <Button size="small" danger>解绑</Button>
                          </Popconfirm>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>运行参数</div>
                <Descriptions
                  column={2}
                  size="small"
                  bordered={false}
                  styles={{
                    label: { color: 'var(--text-tertiary)', background: 'transparent' },
                    content: { color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 13 },
                  }}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: 16,
                  }}
                >
                  <Descriptions.Item label="模型">{runtimeParams.model || employee.model || 'Hermes 默认'}</Descriptions.Item>
                  <Descriptions.Item label="Provider">{runtimeParams.provider || employee.provider || 'hermes'}</Descriptions.Item>
                  <Descriptions.Item label="Run Events 超时">
                    {runtimeParams.run_event_idle_timeout_seconds ? `${runtimeParams.run_event_idle_timeout_seconds}s` : 'Hermes 默认'}
                  </Descriptions.Item>
                  <Descriptions.Item label="温度">{runtimeParams.temperature ?? employee.temperature ?? 'Hermes 默认'}</Descriptions.Item>
                  <Descriptions.Item label="最大 Token">{runtimeParams.max_tokens ?? employee.max_tokens ?? 'Hermes 默认'}</Descriptions.Item>
                  <Descriptions.Item label="Top P">{runtimeParams.top_p ?? 'Hermes 默认'}</Descriptions.Item>
                  <Descriptions.Item label="频率惩罚">{runtimeParams.frequency_penalty ?? 'Hermes 默认'}</Descriptions.Item>
                  <Descriptions.Item label="真实运行次数">{employee.run_count || 0}</Descriptions.Item>
                </Descriptions>
              </div>
            ),
          },
          {
            key: 'prompt',
            label: <span><FileTextOutlined /> 系统 Prompt</span>,
            children: (
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '20px 22px',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text-primary)',
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
              }}>
                {systemPrompt}
              </div>
            ),
          },
          {
            key: 'tools',
            label: <span><ApiOutlined /> 绑定工具</span>,
            children: (
              <div>
                {/* 真实 Skill 执行入口：待 Hermes toolsets 接入后再启用。 */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)', padding: '14px 18px', marginBottom: 18,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      Skill 真实执行
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      当前阶段技能会作为员工能力上下文进入对话；直接执行 Skill 需要下一步接入 Hermes toolsets。
                    </div>
                  </div>
                  <button
                    onClick={() => openTrial()}
                    disabled
                    style={{
                      background: 'var(--accent)', color: 'white',
                      border: 'none', borderRadius: 'var(--radius-md)',
                      padding: '8px 18px', fontSize: 13, fontWeight: 600,
                      cursor: 'not-allowed',
                      opacity: 0.5,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      transition: 'all var(--motion-fast) var(--motion-ease)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <PlayCircleOutlined /> 待接入
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tools.length === 0 && (
                    <div style={{
                      color: 'var(--text-tertiary)',
                      fontSize: 13,
                      padding: '12px 16px',
                      border: '1px dashed var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                    }}>
                      暂无绑定工具集
                    </div>
                  )}
                  {tools.map((tool) => (
                    <div key={tool} style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '12px 16px',
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                      <ApiOutlined style={{ color: 'var(--accent)', fontSize: 14 }} />
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 13 }}>{tool}</span>
                      <span className="atlas-chip atlas-chip--neutral" style={{ marginLeft: 'auto' }}>
                        Hermes Toolset
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ),
          },
          {
            key: 'activity',
            label: <span><ClockCircleOutlined /> 近期活动</span>,
            children: (
              <Table
                dataSource={recentActivity}
                rowKey={(_, i) => String(i)}
                pagination={false}
                size="small"
                locale={{ emptyText: '暂无真实会话活动' }}
                columns={[
                  { title: '对话主题', dataIndex: 'topic' },
                  { title: '用户', dataIndex: 'user', width: 100 },
                  {
                    title: '时间',
                    dataIndex: 'time',
                    width: 150,
                    render: (t: string) => (
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', fontSize: 12 }}>
                        {t ? new Date(t).toLocaleString() : '-'}
                      </span>
                    ),
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 100,
                    render: (t: string) => <span className={taskStatusChipClass(t)}>{taskStatusText(t)}</span>,
                  },
                  {
                    title: '消息',
                    dataIndex: 'message_count',
                    width: 80,
                    render: (n: number) => <span style={{ fontFamily: 'var(--font-mono)' }}>{n || 0}</span>,
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Modal
        title="绑定市场 Skill"
        open={bindModalOpen}
        onCancel={() => setBindModalOpen(false)}
        onOk={handleBindSkill}
        confirmLoading={bindingSubmitting}
        okText="绑定"
        cancelText="取消"
        width={640}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 600 }}>
              选择已启用 Skill
            </div>
            <Select
              aria-label="选择 Skill"
              showSearch
              value={bindingSkillId}
              onChange={setBindingSkillId}
              placeholder="选择 Skill"
              style={{ width: '100%' }}
              optionFilterProp="label"
              options={bindableSkills.map((s: any) => ({
                value: s.__id || String(s.id),
                label: `${s.name} · ${s.scope} · v${s.version} · ${skillSourceLabel(s.source_ref)}`,
              }))}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 600 }}>
              绑定模式
            </div>
            <Select
              aria-label="绑定模式"
              value={bindingMode}
              onChange={setBindingMode}
              style={{ width: '100%' }}
              options={[
                { value: 'inherited', label: '继承引用: 使用市场 Skill 当前版本' },
                { value: 'copied', label: '复制引入: 适合后续个人化定制' },
                { value: 'custom', label: '自定义: 保留给员工私有变体' },
              ]}
            />
          </div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>
            绑定后，该 Skill 会进入员工对话链路的能力上下文；全局不可变 Skill 仍由系统统一维护，员工侧只建立引用关系。
          </div>
          {selectedBindingSkill && (
            <div style={{
              display: 'grid',
              gap: 10,
              padding: 12,
              borderRadius: 10,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14 }}>{selectedBindingSkill.name}</strong>
                <Tag color={selectedBindingSkill.scope === 'global' ? 'geekblue' : selectedBindingSkill.scope === 'tenant' ? 'blue' : 'purple'}>
                  {selectedBindingSkill.scope}
                </Tag>
                <Tag color={String(selectedBindingSkill.source_ref || '').startsWith('hermes:') ? 'cyan' : String(selectedBindingSkill.source_ref || '').startsWith('zip:') || String(selectedBindingSkill.source_ref || '').startsWith('openatlas:') ? 'purple' : 'default'}>
                  {skillSourceLabel(selectedBindingSkill.source_ref)}
                </Tag>
                <Tag color={skillRiskColor(selectedBindingSkill.risk_level)}>风险 {selectedBindingSkill.risk_level || 'low'}</Tag>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {selectedBindingSkill.ability_description || selectedBindingSkill.description || '暂无能力说明'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ padding: 8, borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>输入示例</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    {selectedBindingSkill.input_example || '输入业务目标、文件或上下文说明。'}
                  </div>
                </div>
                <div style={{ padding: 8, borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>输出示例</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    {selectedBindingSkill.output_example || '结构化结论、报告、表格或交付物。'}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                适用员工：{(selectedBindingSkill.suitable_employees || []).join(' / ') || '通用数智员工'} ·
                已绑定员工 {selectedBindingSkill.bound_employee_count || 0} ·
                失败率 {Math.round(Number(selectedBindingSkill.health?.failure_rate || 0) * 100)}%
                {selectedBindingSkill.health?.last_error ? ` · 最近错误：${String(selectedBindingSkill.health.last_error).slice(0, 80)}` : ''}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* M2.5: 试运行 Modal — atomic skill 下拉 + 输入模板 + 实时结果 */}
      <Modal
        title={
          <span>
            <PlayCircleOutlined style={{ color: 'var(--accent)', marginRight: 8 }} />
            试运行原子 Skill
          </span>
        }
        open={!!trialSkill}
        onCancel={() => setTrialSkill(null)}
        width={720}
        footer={[
          <button key="cancel" onClick={() => setTrialSkill(null)} style={{
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
            padding: '6px 16px', fontSize: 13, cursor: 'pointer',
          }}>关闭</button>,
          <button key="run" onClick={runTrial} disabled={trialRunning} style={{
            background: trialRunning ? 'var(--text-tertiary)' : 'var(--accent)',
            color: 'white', border: 'none', borderRadius: 'var(--radius-sm)',
            padding: '6px 20px', fontSize: 13, fontWeight: 600,
            cursor: trialRunning ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            {trialRunning ? <><Spin size="small" /> 执行中...</> : <><PlayCircleOutlined /> 执行</>}
          </button>,
        ]}
      >
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            选择原子 Skill
          </div>
          <select
            value={trialSkill || ''}
            onChange={(e) => switchSkill(e.target.value)}
            disabled={trialRunning}
            style={{
              width: '100%', padding: '8px 12px', fontSize: 13,
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
              cursor: trialRunning ? 'not-allowed' : 'pointer',
            }}
          >
            {atomicSkills.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            输入参数 (JSON)
          </div>
          <Input.TextArea
            value={trialInput}
            onChange={(e) => setTrialInput(e.target.value)}
            rows={5}
            placeholder='{"text": "需要分析的文本"}'
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 13,
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            执行结果
          </div>
          <pre style={{
            background: 'var(--bg-secondary)', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
            padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 12,
            minHeight: 120, maxHeight: 280, overflow: 'auto', margin: 0,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {trialRunning ? '执行中…' : (trialResult || '// 点击「执行」开始试运行')}
          </pre>
        </div>
      </Modal>
    </div>
  );
}
