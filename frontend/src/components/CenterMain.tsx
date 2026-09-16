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
import type { ProgressStage } from '../types/progress';

const SHOW_AGENT_COMMAND_BAR = false;

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
  progressStages?: ProgressStage[];
}

interface ActiveEmployee {
  id: number;
  name: string;
  avatar: string;
  color: string;
}

interface TaskActivity {
  status: string;
  label: string;
  detail: string;
  headline: string;
  nodeName?: string;
  stepTitle?: string;
  stepCount?: number;
  checkpointCount?: number;
  artifactCount?: number;
  updatedText?: string;
  capabilitySummary?: string;
  capabilityLabels?: string[];
  gapLabels?: string[];
  routedTo?: string;
  collaborationMode?: string;
}

interface Props {
  messages: Msg[];
  artifacts?: any[];
  isProcessing: boolean;
  input: string;
  setInput: (v: string) => void;
  pendingAttachments: Attachment[];
  uploading: boolean;
  onSend: () => void;
  onAbort?: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart?: (e: React.CompositionEvent<HTMLTextAreaElement>) => void;
  onCompositionEnd?: (e: React.CompositionEvent<HTMLTextAreaElement>) => void;
  onPasteUpload?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
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
  composerPlaceholder?: string;
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
  taskActivity?: TaskActivity | null;
  // Refs forwarded for parent use (chatEndRef for scroll)
  // 不需要 — 内部自己管
}

function collaborationModeLabel(mode?: string) {
  if (!mode) return '';
  if (mode.includes('synthesis')) return '协作合稿';
  if (mode.includes('serial')) return '串行接力';
  if (mode.includes('single')) return '单员工执行';
  return mode;
}

function AgentCommandBar({ taskActivity }: { taskActivity: TaskActivity }) {
  const modeLabel = collaborationModeLabel(taskActivity.collaborationMode);
  return (
    <section className={`atlas-agent-command-bar atlas-agent-command-bar--${taskActivity.status}`} aria-label="当前任务状态">
      <div className="atlas-agent-command-bar__pulse" aria-hidden="true"><span /></div>
      <div className="atlas-agent-command-bar__main">
        <div className="atlas-agent-command-bar__eyebrow">
          <strong>{taskActivity.label}</strong>
          {taskActivity.updatedText && <span>{taskActivity.updatedText}</span>}
        </div>
        <div className="atlas-agent-command-bar__headline">{taskActivity.headline}</div>
        <div className="atlas-agent-command-bar__detail">
          {taskActivity.capabilitySummary || taskActivity.detail}
        </div>
        <div className="atlas-agent-command-bar__chips">
          {taskActivity.nodeName && <span>当前员工 {taskActivity.nodeName}</span>}
          {taskActivity.routedTo && <span>已路由 {taskActivity.routedTo}</span>}
          {modeLabel && <span>{modeLabel}</span>}
          {(taskActivity.capabilityLabels || []).map((label) => <span key={`cap-${label}`}>能力 {label}</span>)}
          {(taskActivity.gapLabels || []).map((label) => <span key={`gap-${label}`} className="is-warning">缺口 {label}</span>)}
          <span>步骤 {taskActivity.stepCount || 0}</span>
          <span>交付物 {taskActivity.artifactCount || 0}</span>
        </div>
      </div>
      <div className="atlas-agent-command-bar__meter" aria-hidden="true"><span /></div>
    </section>
  );
}

export default function CenterMain({
  messages, artifacts = [], isProcessing,
  input, setInput, pendingAttachments, uploading,
  onSend, onAbort, onKeyDown, onCompositionStart, onCompositionEnd, onPasteUpload, onFileSelect, onRemoveAttachment,
  reasoningEffort, onReasoningEffortChange,
  relayChips, onRemoveRelay,
  mentionEmployees, mentionSelectedIds, onMentionPick, onMentionClose, composerPlaceholder,
  orbState, headerStyle, onStyleChange, pet, onPetChange, petAwakeSignal, profile = 'normal',
  activeEmployee, onSwitchEmployee, taskActivity,
}: Props) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];
  const artifactSignature = (artifacts || [])
    .map((item: any) => `${item?.__id || item?.id || ''}:${item?.name || item?.title || ''}:${item?.status || ''}:${item?.managed_status || ''}`)
    .join('|');
  const latestMessageSignature = [
    messages.length,
    lastMessage?.role || '',
    lastMessage?.text?.length || 0,
    lastMessage?.tools?.length || 0,
    lastMessage?.tools?.map((t) => `${t.name}:${t.status || ''}`).join('|') || '',
    lastMessage?.reasoning?.join('\n').length || 0,
    lastMessage?.progressStages?.length || 0,
    artifactSignature,
  ].join(':');
  const latestAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role !== 'user') return i;
    }
    return -1;
  })();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [latestMessageSignature, isProcessing, taskActivity?.status, taskActivity?.stepCount]);

  return (
    <main style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-primary)', overflow: 'hidden',
      flex: 1,
      minHeight: 0,
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
      {SHOW_AGENT_COMMAND_BAR && taskActivity && <AgentCommandBar taskActivity={taskActivity} />}

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
              progressStages={msg.progressStages}
              artifacts={i === latestAssistantIndex ? artifacts : undefined}
              isStreaming={streaming}
            />
          );
        })}
        {latestAssistantIndex < 0 && artifacts.length > 0 && (
          <ChatMessage
            role="assistant"
            sender="InsightLab"
            avatar="I"
            color="var(--accent)"
            text=""
            artifacts={artifacts}
          />
        )}
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
          disabled={false} running={isProcessing} uploading={uploading}
          pendingAttachments={pendingAttachments}
          onSend={onSend} onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onPasteUpload={onPasteUpload} onFileSelect={onFileSelect}
          onAbort={onAbort}
          onRemoveAttachment={onRemoveAttachment}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={onReasoningEffortChange}
          relayChips={relayChips}
          onRemoveRelay={onRemoveRelay}
          placeholder={composerPlaceholder}
        />
      </div>
    </main>
  );
}
