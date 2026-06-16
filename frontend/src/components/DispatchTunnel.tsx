import { useEffect, useState } from 'react';
import { IconCheck } from './Icons';

// ============================================================
// DispatchTunnel v2 — Zero-card design
// Left 3px color bar instead of bordered container
// ============================================================

interface DispatchTunnelProps {
  id: string;
  name: string;
  avatar: string;
  color: string;
  department: string;
  status: string;
  task: string;
  outputLines: string[];
  isComplete: boolean;
  delay: number;
}

export default function DispatchTunnel({
  name, avatar, color, department, status, task,
  outputLines, isComplete, delay,
}: DispatchTunnelProps) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (isComplete) setProgress(100);
    else {
      const iv = setInterval(() => setProgress(p => Math.min(p + Math.random() * 4 + 1, 85)), 400);
      return () => clearInterval(iv);
    }
  }, [isComplete]);

  return (
    <div style={{
      display: 'flex',
      flex: 1,
      minWidth: 240,
      maxWidth: 360,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(0)' : 'translateX(8px)',
      transition: `opacity 0.3s ease ${delay}ms, transform 0.3s ease ${delay}ms`,
    }}>
      {/* Left color bar — the ONLY decorative element */}
      <div style={{
        width: 3,
        flexShrink: 0,
        background: isComplete ? 'var(--color-success)' : color,
        borderRadius: '2px 0 0 2px',
        transition: 'background 0.3s ease',
      }} />

      {/* Content */}
      <div style={{
        flex: 1,
        padding: '12px 0 12px 14px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {/* Avatar + Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}>
            {avatar}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
              {department}
            </div>
          </div>
          <div style={{
            marginLeft: 'auto', flexShrink: 0,
            fontSize: 11, fontWeight: 500,
            color: isComplete ? 'var(--color-success)' : 'var(--accent)',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            {isComplete ? (
              <><IconCheck size={12} /> 完成</>
            ) : (
              <span style={{
                display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'breath 1.4s ease-in-out infinite',
              }} />
            )}
            {!isComplete && status}
          </div>
        </div>

        {/* Task */}
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', paddingLeft: 36 }}>
          {task}
        </div>

        {/* Progress */}
        <div style={{ height: 2, borderRadius: 1, background: 'var(--border-subtle)', overflow: 'hidden', marginLeft: 36 }}>
          <div style={{
            height: '100%', width: `${progress}%`,
            background: isComplete ? 'var(--color-success)' : color,
            borderRadius: 1,
            transition: 'width 0.5s ease-out',
          }} />
        </div>

        {/* Streaming output */}
        {outputLines.length > 0 && (
          <div style={{
            marginLeft: 36, fontSize: 11, color: 'var(--text-secondary)',
            lineHeight: 1.8, fontFamily: 'var(--font-mono)',
            maxHeight: 72, overflowY: 'auto',
          }}>
            {outputLines.slice(-4).map((line, i) => (
              <div key={`${line.slice(0,8)}-${i}`} style={{ animation: 'fade-up 0.2s ease-out both' }}>
                <span style={{ color: 'var(--text-tertiary)', marginRight: 4 }}>·</span>{line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
