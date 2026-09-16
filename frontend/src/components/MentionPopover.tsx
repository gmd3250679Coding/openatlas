/**
 * MentionPopover — M4.2 (Group Chat) @ 召唤下拉
 *
 * 渲染在 Composer 上方,根据用户在 textarea 输入的 @xxx 触发:
 *   - 检测 input 文本中最后一个未配对的 @xxx
 *   - 过滤 employees 列表(name 或 department 命中关键词)
 *   - 点选 → 调 onPick(emp) → 上层在 input 末尾追加 @员工名 文本
 *   - 同时通知上层把 employee_id 加入 relayEmployeeIds
 *
 * 王六硬规则:零 emoji / 跟 Atlas token 体系一致
 */
import type { Employee } from '../services/api';
import { IconUsers } from './Icons';

interface Props {
  // 当前 input 文本(实时同步,用于检测 @xxx 关键词)
  input: string;
  // 员工列表(下拉数据源)
  employees: Employee[];
  // 已经选中的接力员工(下拉要屏蔽避免重复)
  selectedIds: number[];
  // 点选回调
  onPick: (emp: Employee) => void;
  // 关闭下拉(用户按 Esc / 选了员工)
  onClose: () => void;
}

// 解析 input 文本里最后一个 @ 关键词
// 规则:从末尾向前找 @,到空格/句首/标点停止
function extractMentionQuery(input: string): { query: string; start: number } | null {
  // 找最后一个 @
  const atIdx = input.lastIndexOf('@');
  if (atIdx === -1) return null;
  // @ 后面到末尾/空格的部分
  const after = input.slice(atIdx + 1);
  // 如果中间有空格/换行 → @xxx 段结束
  const spaceIdx = after.search(/[\s\n,，。.;；]/);
  if (spaceIdx !== -1) return null;
  // query 太长(超过 12 字符)说明不是 @召唤
  if (after.length > 12) return null;
  return { query: after, start: atIdx };
}

export default function MentionPopover({
  input, employees, selectedIds, onPick, onClose,
}: Props) {
  const mention = extractMentionQuery(input);
  if (!mention) return null;

  // 过滤:员工名/部门 命中 query
  const q = mention.query.toLowerCase();
  const filtered = employees
    .filter(e => e.is_active && !selectedIds.includes(e.id))
    .filter(e => {
      if (!q) return true;  // 刚打 @ 还没输入,显示全部
      const deptName = e.department?.name ?? '';
      const haystack = `${e.name} ${deptName}`.toLowerCase();
      return haystack.includes(q);
    });

  if (filtered.length === 0) return null;

  return (
    <div className="mention-popover" role="listbox" onMouseDown={e => e.preventDefault()}>
      <div className="mention-popover-header">
        <span>选择员工加入对话 · {filtered.length} 位可用</span>
        <button className="mention-popover-close" onClick={onClose} title="关闭">×</button>
      </div>
      {filtered.map(emp => {
        const deptName = emp.department?.name ?? '未分配';
        const avatarChar = emp.avatar_char || (emp.name ? emp.name[0] : 'A');
        const avatarBg = emp.department?.color || 'var(--accent-soft)';
        return (
          <button
            key={emp.id}
            role="option"
            className="mention-popover-item"
            onClick={() => onPick(emp)}
            title={`${emp.name} · ${deptName}`}
          >
            <span className="mention-popover-avatar" style={{ background: avatarBg }}>
              {avatarChar}
            </span>
            <span className="mention-popover-info">
              <span className="mention-popover-name">{emp.name}</span>
              <span className="mention-popover-meta">
                {deptName}
              </span>
            </span>
            <IconUsers size={14} />
          </button>
        );
      })}
    </div>
  );
}
