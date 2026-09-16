/**
 * Composer — Phase B 拆分 (2026-06-04) + M3.5 玻璃态升级 (2026-06-04) + M4.2 接力 chip
 *
 * M3.5 变更:
 *   - 内联 style → className,统一消费 atlas-design.css 玻璃态 + motion token
 *   - 工具栏按钮 onMouseEnter/Leave 改为 CSS :hover
 *   - focus-within 光晕 ring(.composer-shell:focus-within)
 *   - 删除图标保留 IconPaperclip/IconImage/IconMic/IconSend
 *
 * M4.2 变更:
 *   - 加 `relayChips` prop:已选接力员工显示在 textarea 上方(可移除)
 *   - 加 `onInput` prop:textarea onChange(已存在 setInput),@ 召唤时父组件需要看 input
 *
 * 消费 token:--border-default / --border-subtle / --text-primary / --text-tertiary
 *            / --accent / --accent-soft / --font-family / --motion-*
 */
import { useRef } from 'react';
import type { Attachment, Employee } from '../services/api';
import { IconPaperclip, IconImage, IconMic, IconSend } from './Icons';

interface Props {
  input: string;
  setInput: (v: string) => void;
  disabled: boolean;
  running?: boolean;
  uploading: boolean;
  pendingAttachments: Attachment[];
  onSend: () => void;
  onAbort?: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart?: (e: React.CompositionEvent<HTMLTextAreaElement>) => void;
  onCompositionEnd?: (e: React.CompositionEvent<HTMLTextAreaElement>) => void;
  onPasteUpload?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onFileSelect: (file: File) => void;
  /** Phase B (2026-06-04):可选 — 移除待发附件(Scene 2 用) */
  onRemoveAttachment?: (url: string) => void;
  /** M4.2 (Group Chat): 已选接力员工 chip(显示在附件 chip 旁边) */
  relayChips?: Employee[];
  /** M4.2 (Group Chat): 移除接力 chip */
  onRemoveRelay?: (employeeId: number) => void;
  placeholder?: string;
  reasoningEffort?: string;
  onReasoningEffortChange?: (value: string) => void;
}

const REASONING_EFFORTS = [
  { value: '', label: '自动', title: '使用 Hermes / 员工默认思考强度' },
  { value: 'none', label: '关闭', title: '不请求额外思考摘要' },
  { value: 'minimal', label: '极简', title: '更快，更少推理展开' },
  { value: 'low', label: '低', title: '轻量推理' },
  { value: 'medium', label: '中', title: '平衡速度和推理深度' },
  { value: 'high', label: '高', title: '复杂任务使用更深推理' },
  { value: 'xhigh', label: '极高', title: '复杂分析/规划任务使用' },
];

export default function Composer({
  input, setInput, disabled, running = false, uploading,
  pendingAttachments, onSend, onKeyDown, onCompositionStart, onCompositionEnd, onPasteUpload, onFileSelect,
  onAbort,
  onRemoveAttachment,
  relayChips, onRemoveRelay,
  placeholder = '输入需求，试试 @行政小六 或 @投资研究分析师...',
  reasoningEffort = '',
  onReasoningEffortChange,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const canSend = !!input.trim() && !disabled;
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const key = e.key.toLowerCase();
    const commandLike = e.metaKey || e.ctrlKey;
    if (commandLike && e.shiftKey && key === 'u') {
      e.preventDefault();
      if (!uploading) fileInputRef.current?.click();
      return;
    }
    if (commandLike && e.shiftKey && key === 'p') {
      e.preventDefault();
      if (!uploading) imageInputRef.current?.click();
      return;
    }
    onKeyDown(e);
  };

  return (
    <div className="composer-root">
      {(pendingAttachments.length > 0 || (relayChips && relayChips.length > 0)) && (
        <div className="composer-chips">
          {/* M4.2 (Group Chat): 接力员工 chip — 第 1 个标"主",后续标"接力 N"
              P1 方案 A (2026-06-05):第 1 个 @ 召唤员工 = 主员工,视觉上跟接力区分 */}
          {relayChips?.map((emp, idx) => {
            const isPrimary = idx === 0;
            return (
              <span
                key={`relay-${emp.id}`}
                className={`composer-chip ${isPrimary ? 'composer-chip-primary' : 'composer-chip-relay'}`}
                title={isPrimary
                  ? `主发言员工: ${emp.name} (${emp.department?.name ?? '未分配'}) — 主导本轮回答`
                  : `接力员工 #${idx}: ${emp.name} (${emp.department?.name ?? '未分配'})`}
              >
                <span
                  className="composer-chip-relay-avatar"
                  style={{ background: emp.department?.color || 'var(--accent-soft)' }}
                >
                  {emp.avatar_char || (emp.name ? emp.name[0] : 'A')}
                </span>
                {isPrimary ? '主' : '接'}{idx}
                @{emp.name}
              {onRemoveRelay && (
                <button
                  onClick={() => onRemoveRelay(emp.id)}
                  title="移除接力"
                  className="composer-chip-remove"
                >×</button>
              )}
            </span>
            );
          })}
          {/* 附件 chip 在后 */}
          {pendingAttachments.map(a => (
            <span key={a.url || a.id} className="composer-chip">
              {a.mime.startsWith('image/') ? '图片' : '附件'} {a.name}
              {onRemoveAttachment && (
                <button onClick={() => onRemoveAttachment(a.url || a.id || '')} title="移除"
                  className="composer-chip-remove">×</button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="composer-shell">
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={e => {
          const f = e.target.files?.[0]; if (f) onFileSelect(f);
          e.target.value = '';
        }} />
        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
          const f = e.target.files?.[0]; if (f) onFileSelect(f);
          e.target.value = '';
        }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} title="附件 · ⌘/Ctrl+Shift+U"
          className="composer-tool-btn"
          data-disabled={uploading}
        ><IconPaperclip size={17} /></button>
        <button onClick={() => imageInputRef.current?.click()} disabled={uploading} title="图片 · ⌘/Ctrl+Shift+P"
          className="composer-tool-btn"
          data-disabled={uploading}
        ><IconImage size={17} /></button>
        <button disabled title="语音输入 — 即将支持"
          className="composer-tool-btn"
          data-disabled={true}
        ><IconMic size={17} /></button>
        {onReasoningEffortChange && (
          <select
            value={reasoningEffort}
            onChange={e => onReasoningEffortChange(e.target.value)}
            title={REASONING_EFFORTS.find(x => x.value === reasoningEffort)?.title || '思考强度'}
            className="composer-reasoning-select"
            disabled={disabled}
          >
            {REASONING_EFFORTS.map(opt => (
              <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
        <textarea
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onPaste={onPasteUpload}
          placeholder={placeholder} disabled={disabled} rows={1}
          className="composer-textarea"
        />
        {running && onAbort && (
          <button onClick={onAbort}
            className="composer-stop-btn"
            title="停止当前运行"
          >■</button>
        )}
        <button onClick={onSend} disabled={!canSend}
          className="composer-send-btn"
          data-active={canSend}
        ><IconSend size={17} /></button>
      </div>
    </div>
  );
}
