import { Progress, Button } from 'antd';
import { AlertOutlined, FileSearchOutlined, NodeIndexOutlined } from '@ant-design/icons';

// 围标串标证据分析 — 内联数据（场景特定，非 API 数据）
const EVIDENCE_FINDINGS = [
  { id: 1, severity: 'critical', title: '三家供应商存在共同自然人股东', desc: '王某某同时持有恒联建设 (35%)、瑞辉工程 (28%)、滨业集团 (22%) 股份。', confidence: 98 },
  { id: 2, severity: 'critical', title: '投标报价呈现高度一致的阶梯模式', desc: '三家报价差异率仅 1.2%-2.8%，远低于行业正常波动范围。', confidence: 95 },
  { id: 3, severity: 'high', title: '投标文件存在雷同段落', desc: '技术方案中文本相似度达 87%，疑似共用模板。', confidence: 92 },
  { id: 4, severity: 'high', title: '历史中标记录异常集中', desc: '过去 24 个月内 12 次由同一组供应商同时入围。', confidence: 88 },
  { id: 5, severity: 'medium', title: '电子标书元数据雷同', desc: '三份 PDF 标书 Creator/Producer 字段一致，创建时间间隔不足 2 小时。', confidence: 85 },
];

const SEVERITY_LABEL: Record<string, string> = { critical: '严重', high: '高', medium: '中' };
const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--color-danger)',
  high: 'var(--color-warning)',
  medium: '#FBBF24',
};
const SEVERITY_TIER: Record<string, 'danger' | 'warning'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'warning',
};

const timelineSteps = [
  { label: '任务分发 — 检测到采购类附件，启动围标分析流水线', status: 'done', time: '10:30:05' },
  { label: '文档解析 — 提取 3 份招标文件元数据 + 文本指纹', status: 'done', time: '10:30:12' },
  { label: '企业图谱 — 构建 17 家供应商股权关系网络', status: 'done', time: '10:30:45' },
  { label: '报价分析 — 检测 3 家核心供应商报价异常模式', status: 'done', time: '10:31:02' },
  { label: '文档比对 — 技术方案文本相似度分析', status: 'done', time: '10:31:30' },
  { label: '关联分析 — 综合判定串标风险等级', status: 'active', time: '10:31:58' },
  { label: '证据归档 — 生成结构化证据报告', status: 'pending', time: '-' },
  { label: '报告分发 — 推送至纪检部门和采购中心', status: 'pending', time: '-' },
];

const metadata = [
  { supplier: '恒联建设', ip: '183.136.XX.XX', mac: 'A4:83:E7:XX', creator: '张某某', createTime: '10:08', editor: 'User_0833', editTime: '10:15' },
  { supplier: '瑞辉工程', ip: '183.136.XX.XX', mac: 'A4:83:E7:XX', creator: '张某某', createTime: '10:12', editor: 'User_0833', editTime: '10:20' },
  { supplier: '滨业集团', ip: '183.136.XX.XX', mac: 'A4:83:E7:XX', creator: '李某某', createTime: '10:22', editor: 'User_0833', editTime: '10:30' },
];

const overviewStats = [
  { label: '关联企业', value: '3 家', tier: 'danger' as const },
  { label: '共同股东', value: '1 人', tier: 'danger' as const },
  { label: '报价异常', value: '3 项', tier: 'warning' as const },
  { label: '文档相似度', value: '87%', tier: 'warning' as const },
  { label: '历史异常', value: '12 次', tier: 'warning' as const },
];

export default function Evidence() {
  return (
    <div style={{ padding: '32px 48px 64px' }}>
      <h1 style={{
        fontSize: 28, fontWeight: 700, color: 'var(--text-primary)',
        letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <AlertOutlined style={{ color: 'var(--color-danger)', fontSize: 22 }} />
        围标串标证据分析
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '6px 0 28px' }}>
        XX 采购项目 · 恒联建设 / 瑞辉工程 / 滨业集团 · 多 Agent 协作分析
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 24 }}>
        {/* Left: findings + metadata */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileSearchOutlined />关键发现
          </div>
          {EVIDENCE_FINDINGS.map((f) => (
            <div key={f.id} style={{
              padding: '14px 18px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderLeft: `3px solid ${SEVERITY_COLOR[f.severity]}`,
              borderRadius: 'var(--radius-md)',
              marginBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className={`atlas-chip atlas-chip--${SEVERITY_TIER[f.severity]}`}>{SEVERITY_LABEL[f.severity]}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 14 }}>{f.title}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  置信度 {f.confidence}%
                </span>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>{f.desc}</div>
              <Progress
                percent={f.confidence}
                size="small"
                strokeColor={SEVERITY_COLOR[f.severity]}
                trailColor="var(--border-subtle)"
                style={{ marginTop: 8, marginBottom: 0 }}
                showInfo={false}
              />
            </div>
          ))}

          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 24, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <NodeIndexOutlined />文档元数据对比
          </div>
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    {['供应商', 'IP 地址', 'MAC', '创建者', '创建时间', '修改者', '修改时间'].map((h) => (
                      <th key={h} style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        color: 'var(--text-tertiary)',
                        fontWeight: 600,
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metadata.map((m, i) => (
                    <tr key={m.supplier} style={{ borderBottom: i < metadata.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontWeight: 500 }}>{m.supplier}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--color-danger)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{m.ip}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--color-danger)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{m.mac}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--color-danger)', fontWeight: 500 }}>{m.creator}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{m.createTime}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--color-danger)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{m.editor}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{m.editTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: timeline + overview + cta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: 18,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              多 Agent 协作时间轴
            </div>
            {timelineSteps.map((step, i) => (
              <div key={i} className="timeline-step">
                <div className={`timeline-dot ${step.status}`} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    color: step.status === 'pending' ? 'var(--text-tertiary)' : 'var(--text-primary)',
                    fontSize: 13, lineHeight: 1.5,
                  }}>{step.label}</div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                    {step.time}
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: 18,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              分析概览
            </div>
            {overviewStats.map((item) => (
              <div key={item.label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px dashed var(--border-subtle)',
              }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{item.label}</span>
                <span className={`atlas-chip atlas-chip--${item.tier}`}>{item.value}</span>
              </div>
            ))}
          </section>

          <Button type="primary" size="large" block>生成正式报告</Button>
        </div>
      </div>
    </div>
  );
}
