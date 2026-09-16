/**
 * ChatMessage — styled message bubble for the chat interface.
 * User messages: right-aligned, accent background.
 * Assistant messages: left-aligned, secondary background, Streamdown rendered.
 */
import { lazy, Suspense, useState } from 'react';
import ToolCallPanel from './ToolCallPanel';
import type { ToolCallItem } from './ToolCallPanel';
import ChatArtifactCards from './ChatArtifactCards';
import type { Attachment } from '../services/api';
import type { ProgressStage } from '../types/progress';
import '../styles/chat.css';

const StreamRenderer = lazy(() => import('./StreamRenderer'));

interface Props {
  role: 'user' | 'assistant';
  sender: string;
  avatar: string;
  color: string;
  text: string;
  timestamp?: string;
  isStreaming?: boolean;
  tools?: ToolCallItem[];
  attachments?: Attachment[];
  reasoning?: string[];
  progressStages?: ProgressStage[];
  artifacts?: any[];
}

export default function ChatMessage({
  role, sender, avatar, color, text, timestamp, isStreaming, tools, attachments, reasoning, progressStages, artifacts,
}: Props) {
  const isUser = role === 'user';
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const reasoningText = (reasoning || []).filter(Boolean).join('\n\n').trim();
  const reasoningPreview = reasoningText.length > 160 ? `${reasoningText.slice(0, 160)}...` : reasoningText;

  return (
    <div className="chat-message" style={{
      display: 'flex',
      gap: 10,
      flexDirection: isUser ? 'row-reverse' : 'row',
      marginBottom: 20,
      animation: 'fade-up 0.25s ease-out both',
    }}>
      {/* Avatar */}
      <div style={{
        width: 34, height: 34, borderRadius: '50%',
        background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0,
      }}>{avatar}</div>

      {/* Bubble */}
      <div style={{ maxWidth: '75%', minWidth: 0 }}>
        {/* Sender name */}
        <div style={{
          fontSize: 11, fontWeight: 600,
          color: isUser ? '#8B8FA3' : '#4F46E5',
          marginBottom: 4,
          textAlign: isUser ? 'right' : 'left',
        }}>
          {sender}
          {timestamp && (
            <span style={{
              fontSize: 10, fontWeight: 400,
              color: '#6B7280',
              marginLeft: 8,
            }}>{timestamp}</span>
          )}
        </div>

	        {/* Content — 配 light main 背景：机器人用浅灰气泡 + 深字；用户用淡紫透明 */}
	        <div className="message-bubble" style={{
	          fontSize: 14, lineHeight: 1.7, color: 'var(--message-text)',
	          padding: '12px 16px',
	          borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
	          background: isUser ? 'var(--message-user-bg)' : 'var(--message-assistant-bg)',
	          border: isUser ? '1px solid var(--message-user-border)' : '1px solid var(--message-assistant-border)',
	          overflow: 'hidden',
	          wordBreak: 'break-word',
	        }}>
          {isUser ? (
            <>
              <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
              {attachments && attachments.length > 0 && (
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  {attachments.map((file, idx) => (
                    <div key={`${file.id || file.name}-${idx}`} style={{
                      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', gap: 8,
	                      padding: '6px 8px',
	                      borderRadius: 6,
	                      background: 'var(--message-attachment-bg)',
	                      border: '1px solid var(--message-user-border)',
	                      fontSize: 11,
	                      color: 'var(--text-secondary)',
                    }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {file.name}
                      </span>
                      <span style={{ flexShrink: 0, color: (file.extracted_chars || 0) > 0 ? '#047857' : '#6B7280' }}>
                        {(file.extracted_chars || 0) > 0 ? `已注入 ${file.extracted_chars} 字` : file.status || '已上传'}
                      </span>
                      {file.is_expired && (
                        <span style={{ flexShrink: 0, color: '#B45309' }}>已过期</span>
                      )}
                      {(file.summary || (file.snippets && file.snippets.length > 0)) && (
                        <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#6B7280', lineHeight: 1.5, whiteSpace: 'normal' }}>
                          {file.summary || file.snippets?.[0]?.text}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {reasoningText && (
                <div style={{
                  marginBottom: 8,
                  borderLeft: '2px solid rgba(79,70,229,0.28)',
                  padding: '6px 10px',
                  background: 'rgba(79,70,229,0.05)',
                  borderRadius: 6,
                }}>
                  <button
                    onClick={() => setReasoningOpen(v => !v)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      cursor: 'pointer',
                      color: '#6B7280',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    思考摘要 · {reasoningOpen ? '收起' : '展开'}
                  </button>
                  {!reasoningOpen && reasoningPreview && (
                    <div style={{
                      marginTop: 4,
                      color: '#6B7280',
                      fontSize: 12,
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                    }}>
                      {reasoningPreview}
                    </div>
                  )}
                  {reasoningOpen && (
                    <div style={{
                      marginTop: 6,
                      color: '#6B7280',
                      fontSize: 12,
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
                    }}>
                      {reasoningText}
                    </div>
                  )}
                </div>
              )}
              {!isUser && progressStages && progressStages.length > 0 && (
                <InlineProgress stages={progressStages} />
              )}
              {tools && tools.length > 0 && <ToolCallPanel tools={tools} hasDeliverables={Boolean(artifacts?.length)} />}
              {text.trim() && (
                <Suspense fallback={<div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>}>
                  <StreamRenderer content={text} isStreaming={isStreaming} />
                </Suspense>
              )}
              {artifacts && artifacts.length > 0 && <ChatArtifactCards artifacts={artifacts} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InlineProgress({ stages }: { stages: ProgressStage[] }) {
  const compactStages = stages.slice(-4);
  const current = [...stages].reverse().find((stage) => stage.status === 'running' || stage.status === 'waiting') || stages[stages.length - 1];
  const running = stages.some((stage) => stage.status === 'running' || stage.status === 'waiting');
  const completed = stages.length > 0 && stages.every((stage) => stage.status === 'completed' || stage.status === 'failed');
  return (
    <div className={`chat-progress-rail ${running ? 'is-running' : ''} ${completed ? 'is-complete' : ''}`}>
      <div className="chat-progress-rail__head">
        <span className="chat-progress-rail__pulse" aria-hidden="true" />
        <span className="chat-progress-rail__title">
          {running ? '正在推进' : completed ? '阶段完成' : '任务进展'}
          {current?.title ? ` · ${current.title}` : ''}
        </span>
        {current?.meta && <span className="chat-progress-rail__meta">{current.meta}</span>}
      </div>
      <div className="chat-progress-rail__bar" aria-hidden="true">
        <span />
      </div>
      <div className="chat-progress-rail__steps">
        {compactStages.map((stage) => (
          <div key={`${stage.id}-${stage.updatedAt || ''}`} className={`chat-progress-step chat-progress-step--${stage.status || 'running'}`}>
            <span className="chat-progress-step__dot" />
            <span className="chat-progress-step__copy">
              <strong>{stage.title || '任务进展'}</strong>
              {stage.detail && <span>{stage.detail}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
