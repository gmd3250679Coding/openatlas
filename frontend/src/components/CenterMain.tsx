/**
 * CenterMain — Phase B 拆分 (2026-06-04)
 *
 * 中栏容器。包括:
 *   1. 顶栏 chip「正在和 XX 对话」+ 切换按钮(可隐藏)
 *   2. ChatHeader(像素宠物 + 状态 orb)
 *   3. 消息流(ChatMessage 列表 + 处理中占位)
 *   4. Composer(底部输入,被独立抽出,这里只挂载)
 *
 * 滚动行为:每条新消息后自动 scrollIntoView,这是 IM 风格聊天必要,
 * 放在内部 useEffect 完成,不污染父组件。
 *
 * 消费 token:--bg-primary / --bg-secondary / --border-subtle / --text-primary
 *            / --text-tertiary / --accent / --accent-soft
 */
import { useEffect, useRef } from 'react';
import ChatHeader, { type HeaderStyle, type Pet, type ProfileMode } from './ChatHeader';
import ChatMessage from './ChatMessage';
import Composer from './Composer';
import MentionPopover from './MentionPopover';
import type { Attachment, Employee } from '../services/api';

export interface Msg {
  role: 'user' | string;
  sender: string;
  avatar: string;
  color: string;
  text: string;
  tools?: Array<{ name: string; label?: string; status?: string }>;
  attachments?: Attachment[];
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  token_count?: number;
  reasoning?: string[];
}

interface ActiveEmployee {
  id: number;
  name: string;
  avatar: string;
  color: string;
}

interface Props {
  messages: Msg[];
  isProcessing: boolean;
  input: string;
  setInput: (v: string) => void;
  pendingAttachments: Attachment[];
  uploading: boolean;
  onSend: () => void;
  onAbort?: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFileSelect: (file: File) => void;
  reasoningEffort?: string;
  onReasoningEffortChange?: (value: string) => void;
  onRemoveAttachment?: (url: string) => void;
  // M4.2 (Group Chat): 接力员工 chip 透传
  relayChips?: Employee[];
  onRemoveRelay?: (employeeId: number) => void;
  // M4.2 (Group Chat): @ 召唤下拉数据
  mentionEmployees?: Employee[];
  mentionSelectedIds?: number[];
  onMentionPick?: (emp: Employee) => void;
  onMentionClose?: () => void;
  // Header
  orbState: 'idle' | 'thinking' | 'dispatch' | 'speaking';
  headerStyle: HeaderStyle;
  onStyleChange: (s: HeaderStyle) => void;
  pet: Pet;
  onPetChange: (p: Pet) => void;
  petAwakeSignal?: string;
  profile?: ProfileMode;
  // Active employee chip
  activeEmployee: ActiveEmployee | null;
  onSwitchEmployee: () => void;
  // Refs forwarded for parent use (chatEndRef for scroll)
  // 不需要 — 内部自己管
}

export default function CenterMain({
  messages, isProcessing,
  input, setInput, pendingAttachments, uploading,
  onSend, onAbort, onKeyDown, onFileSelect, onRemoveAttachment,
  reasoningEffort, onReasoningEffortChange,
  relayChips, onRemoveRelay,
  mentionEmployees, mentionSelectedIds, onMentionPick, onMentionClose,
  orbState, headerStyle, onStyleChange, pet, onPetChange, petAwakeSignal, profile = 'normal',
  activeEmployee, onSwitchEmployee,
}: Props) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isProcessing]);

  return (
    <main style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-primary)', overflow: 'hidden',
    }}>
      {activeEmployee && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '8px 16px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 13,
        }}>
          <span style={{ color: 'var(--text-tertiary)' }}>正在和</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 10px',
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            borderRadius: 12,
            fontWeight: 600,
          }}>
            <span style={{
              width: 16, height: 16, borderRadius: '50%',
              background: activeEmployee.color, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700,
            }}>{activeEmployee.avatar}</span>
            {activeEmployee.name}
          </span>
          <span style={{ color: 'var(--text-tertiary)' }}>对话</span>
          <button onClick={onSwitchEmployee}
            style={{
              marginLeft: 8, padding: '2px 10px',
              background: 'transparent', border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)', borderRadius: 4,
              fontSize: 12, cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >切换</button>
        </div>
      )}
      <ChatHeader
        orbState={orbState} style={headerStyle}
        onStyleChange={onStyleChange} pet={pet} onPetChange={onPetChange}
        petAwakeSignal={petAwakeSignal}
        profile={profile}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {messages.map((msg, i) => {
          // M3.1 (2026-06-04): 最后一条 assistant 消息在 isProcessing 期间走流式渲染
          const isLast = i === messages.length - 1;
          const isAssistant = msg.role !== 'user';
          const streaming = isProcessing && isLast && isAssistant;
          return (
            <ChatMessage
              key={i}
              role={isAssistant ? 'assistant' : 'user'}
              sender={msg.sender}
              avatar={msg.avatar}
              color={msg.color}
              text={msg.text}
              tools={msg.tools}
              attachments={msg.attachments}
              reasoning={msg.reasoning}
              isStreaming={streaming}
            />
          );
        })}
        {isProcessing && !messages.some(m => m.role !== 'user') && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 13, fontWeight: 700,
            }}>A</div>
            <div style={{
              padding: '12px 16px', borderRadius: '4px 16px 16px 16px',
              background: 'var(--bg-secondary)',
              fontSize: 14, color: 'var(--text-tertiary)',
            }}>
              正在调度同事处理…
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div style={{ position: 'relative' }}>
        {/* M4.2 (Group Chat): @ 召唤下拉浮层 */}
        {mentionEmployees && onMentionPick && onMentionClose && (
          <MentionPopover
            input={input}
            employees={mentionEmployees}
            selectedIds={mentionSelectedIds ?? []}
            onPick={onMentionPick}
            onClose={onMentionClose}
          />
        )}
        <Composer
          input={input} setInput={setInput}
          disabled={isProcessing} uploading={uploading}
          pendingAttachments={pendingAttachments}
          onSend={onSend} onKeyDown={onKeyDown} onFileSelect={onFileSelect}
          onAbort={onAbort}
          onRemoveAttachment={onRemoveAttachment}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={onReasoningEffortChange}
          relayChips={relayChips}
          onRemoveRelay={onRemoveRelay}
        />
      </div>
    </main>
  );
}
