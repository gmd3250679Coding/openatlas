import { useParams, useNavigate } from 'react-router-dom';
import { Input, message, Empty, Spin, Modal } from 'antd';
import { useState, useEffect } from 'react';
import type { EmployeeDetail } from '../services/api';
import { fetchEmployeeDetail, dismissEmployee } from '../services/api';

export default function DismissPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [reason, setReason] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchEmployeeDetail(id)
      .then(setEmployee)
      .catch(() => setEmployee(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>;

  if (!employee) {
    return (
      <div className="workforce-page">
        <section className="dismiss-container">
          <Empty description="未找到该员工信息（可能已被开除）" />
          <button className="nav-back" onClick={() => navigate('/workforce')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            返回数智员工
          </button>
        </section>
      </div>
    );
  }

  const color = employee.department?.color || '#4F46E5';
  const deptName = employee.department?.name || '-';

  const handleConfirmDismiss = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      const res = await dismissEmployee(id);
      if ((res as any).was_active ?? true) {
        message.success((res as any).message || '已开除');
      } else {
        message.warning((res as any).message || '员工已非 active 状态');
      }
      navigate('/workforce');
    } catch (e: any) {
      message.error(`开除失败: ${e?.message || e}`);
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="workforce-page">
      <button className="nav-back" style={{ margin: '32px 0 0 48px' }} onClick={() => navigate('/workforce')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        数智员工
      </button>
      <section className="dismiss-container">
        <div className="dismiss-employee">
          <div className="dismiss-avatar" style={{ background: color }}>{employee.avatar_char}</div>
          <div className="dismiss-employee-info">
            <span className="dismiss-employee-name">{employee.name}</span>
            <span className="dismiss-employee-dept">{deptName}</span>
            <span className="dismiss-employee-id">hermes://atlas/{employee.id}</span>
          </div>
        </div>

        <div className="dismiss-warning-banner">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <p className="dismiss-warning-title">此操作不可撤销</p>
            <p className="dismiss-warning-text">开除后该员工将立即下线，无法再接收新任务。系统将保留其历史对话记录用于审计。</p>
          </div>
        </div>

        <div className="dismiss-stats">
          <div className="dismiss-stat">
            <span className="dismiss-stat-value">{employee.conversation_count}</span>
            <span className="dismiss-stat-label">累计对话</span>
          </div>
          <div className="dismiss-stat">
            <span className="dismiss-stat-value">{employee.total_messages}</span>
            <span className="dismiss-stat-label">总消息数</span>
          </div>
          <div className="dismiss-stat">
            <span className="dismiss-stat-value">{employee.skills?.length || 0}</span>
            <span className="dismiss-stat-label">技能数量</span>
          </div>
        </div>

        <div className="recruit-field recruit-field--full">
          <label className="recruit-label">开除原因（选填）</label>
          <Input.TextArea placeholder="例如：业务调整、技能覆盖、岗位合并…" value={reason} onChange={(e) => setReason(e.target.value)} className="recruit-textarea" rows={3} />
        </div>

        <div className="recruit-field recruit-field--full" style={{ marginTop: 16 }}>
          <label className="recruit-label">任务重新分配至（选填）</label>
          <Input placeholder="输入接手员工的名称，留空则由系统自动分配" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className="recruit-input" />
        </div>

        <div className="dismiss-actions" style={{ marginTop: 32 }}>
          <button className="dismiss-btn-cancel" onClick={() => navigate('/workforce')}>取消</button>
          <button
            className="dismiss-btn-confirm"
            disabled={submitting}
            onClick={() => setConfirmOpen(true)}
          >
            {submitting ? '正在执行下线…' : `确认开除 ${employee.name}`}
          </button>
        </div>

        <Modal
          title="再次确认开除"
          open={confirmOpen}
          onCancel={() => setConfirmOpen(false)}
          onOk={handleConfirmDismiss}
          okText="确认开除"
          cancelText="我再想想"
          okButtonProps={{ danger: true, loading: submitting }}
        >
          <p>将开除 <strong>{employee.name}</strong>（ID={employee.id}）。</p>
          <p style={{ color: '#999', fontSize: 13 }}>
            后果：员工立即下线，{employee.conversation_count} 段对话 / {employee.total_messages} 条消息保留给审计。
          </p>
        </Modal>
      </section>
    </div>
  );
}
