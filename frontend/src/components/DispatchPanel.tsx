/**
 * DispatchPanel v3 — Phase B 拆分 (2026-06-04)
 *
 * 替换说明:从原 v2(只接 TunnelSpec[] 渲染 tunnel cards)升级为 v3(统一
 * 消费 types/dispatch.ts 的 DispatchTunnel,把字段名 outputLines / isComplete
 * 收敛为单一真相)。
 *
 * 同时修复与 CommandCenter 的真实数据模型脱节问题——原来 CommandCenter
 * 手搓 <aside> 渲染隧道进展,v3 让 RightAside 直接调 <DispatchPanel />,
 * 两条路径合二为一。
 */
import { useEffect, useState } from 'react';
import type { DispatchTunnel } from '../types/dispatch';
import DispatchTunnelCard from './DispatchTunnel';
import { IconPulse } from './Icons';

interface DispatchPanelProps {
  tunnels: DispatchTunnel[];
  visible: boolean;
}

export default function DispatchPanel({ tunnels, visible }: DispatchPanelProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => setShow(true), 150);
      return () => clearTimeout(t);
    } else {
      setShow(false);
    }
  }, [visible]);

  if (tunnels.length === 0 && !visible) return null;

  return (
    <div style={{
      opacity: show ? 1 : 0,
      transition: 'opacity 0.3s ease',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 16,
      }}>
        <IconPulse size={14} />
        <span style={{
          fontSize: 'var(--fs-caption)',
          fontWeight: 'var(--fw-semibold)',
          color: 'var(--text-secondary)',
          letterSpacing: 'var(--ls-caption)',
          textTransform: 'uppercase',
        }}>
          Atlas 正在调度同事为你工作
        </span>
        <span style={{
          fontSize: 'var(--fs-caption)', color: 'var(--text-tertiary)',
          marginLeft: 'auto',
        }}>
          {tunnels.length} 路并行
        </span>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {tunnels.map((t, i) => (
          <DispatchTunnelCard key={t.id} {...t} delay={i * 100} />
        ))}
      </div>
    </div>
  );
}
