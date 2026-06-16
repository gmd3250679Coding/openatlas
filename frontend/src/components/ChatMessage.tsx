/**
 * ChatMessage — styled message bubble for the chat interface.
 * User messages: right-aligned, accent background.
 * Assistant messages: left-aligned, secondary background, Streamdown rendered.
 */
import { lazy, Suspense, useState } from 'react';
import ToolCallPanel from './ToolCallPanel';
import type { ToolCallItem } from './ToolCallPanel';
import type { Attachment } from '../services/api';
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
}

export default function ChatMessage({
  role, sender, avatar, color, text, timestamp, isStreaming, tools, attachments, reasoning,
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
          fontSize: 14, lineHeight: 1.7, color: '#1D1D1F',
          padding: '12px 16px',
          borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
          background: isUser ? 'rgba(79, 70, 229, 0.08)' : '#F5F5F7',
          border: isUser ? '1px solid rgba(79, 70, 229, 0.18)' : '1px solid #ECECEF',
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
                      background: 'rgba(255,255,255,0.7)',
                      border: '1px solid rgba(79, 70, 229, 0.12)',
                      fontSize: 11,
                      color: '#4B5563',
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
              {tools && tools.length > 0 && <ToolCallPanel tools={tools} />}
              <Suspense fallback={<div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>}>
                <StreamRenderer content={text} isStreaming={isStreaming} />
              </Suspense>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
