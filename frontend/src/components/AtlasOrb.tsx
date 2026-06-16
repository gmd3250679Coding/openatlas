import { useMemo, useId } from 'react';

// ============================================================
// AtlasOrb v2 — Liquid Living Presence
//
// Design philosophy:
//   It's not 5 pets, not a logo, not an icon.
//   It IS Atlas. The same entity, in different sizes,
//   in different cognitive states.
//
// Composition (back to front):
//   1. Outer aura (gradient blur, breathes)
//   2. Orbital particle ring (rotates)
//   3. Liquid mercury core (gradient with hot-spot, deforms slightly)
//   4. Inner specular highlight (Apple "glass orb" feel)
//   5. State-specific overlay
//        idle      → calm breathing
//        thinking  → 3 internal cognitive points orbit faster
//        dispatch  → core sheds 5 tracer particles outward in a flower pattern
//        speaking  → expanding sonic ripples from base
// ============================================================

export type OrbState = 'idle' | 'thinking' | 'dispatch' | 'speaking';

interface AtlasOrbProps {
  state: OrbState;
  size?: number;
  showLabel?: boolean;
  className?: string;
  staticMode?: boolean;
}

const STATE_LABELS: Record<OrbState, string> = {
  idle: '在线 · 随时待命',
  thinking: '思考中 · 正在理解',
  dispatch: '调度中 · 派发任务',
  speaking: '回复中 · 汇总结果',
};

function OrbSVG({ state, size, staticMode = false }: { state: OrbState; size: number; staticMode?: boolean }) {
  const uid = useId().replace(/[:]/g, '');
  const cx = size / 2;
  const cy = size / 2;
  const coreR = size * 0.26;
  const orbitR = size * 0.4;

  const isDispatch = state === 'dispatch';
  const isSpeaking = state === 'speaking';
  const isThinking = state === 'thinking';

  // Core animation tempo
  const coreClass = state === 'idle' ? `orb-${uid}-breath`
    : state === 'thinking' ? `orb-${uid}-pulse`
    : `orb-${uid}-fast`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: 'visible', display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        {/* — Liquid core: hot spot top-left, cools to deep indigo bottom-right — */}
        <radialGradient id={`orb-core-${uid}`} cx="35%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="20%" stopColor="#C4B8FF" stopOpacity="0.95" />
          <stop offset="55%" stopColor={isDispatch ? '#A59BF0' : '#8B7FE8'} stopOpacity="1" />
          <stop offset="85%" stopColor="#4F46E5" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#1E1B4B" stopOpacity="0.85" />
        </radialGradient>

        {/* — Outer aura: deep purple bloom — */}
        <radialGradient id={`orb-aura-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8B7FE8" stopOpacity="0.55" />
          <stop offset="40%" stopColor="#6366F1" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
        </radialGradient>

        {/* — Specular highlight (glass top reflection) — */}
        <radialGradient id={`orb-spec-${uid}`} cx="35%" cy="25%" r="35%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>

        {/* — Subtle noise / iridescence sheen — */}
        <linearGradient id={`orb-sheen-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.0" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.0" />
        </linearGradient>

        {/* — Glow blur filter — */}
        <filter id={`orb-glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={size * 0.08} result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>

        {/* — Soft blur for aura — */}
        <filter id={`orb-aura-blur-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={size * 0.04} />
        </filter>
      </defs>

      {/* ─── L1: Ambient outer aura (breathes) ─── */}
      {!staticMode && (
        <circle
          cx={cx}
          cy={cy}
          r={size * 0.48}
          fill={`url(#orb-aura-${uid})`}
          filter={`url(#orb-aura-blur-${uid})`}
          className={`orb-${uid}-aura-pulse`}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        />
      )}

      {/* ─── L2: Orbital ring (rotates) ─── */}
      <g
        className={`orb-${uid}-orbit`}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={orbitR}
          fill="none"
          stroke="#8B7FE8"
          strokeWidth={size * 0.006}
          strokeOpacity="0.18"
          strokeDasharray={`${size * 0.014} ${size * 0.022}`}
        />
        {/* 6 small particles on the orbit, arc-distributed */}
        {[0, 60, 120, 180, 240, 300].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          const px = cx + Math.cos(rad) * orbitR;
          const py = cy + Math.sin(rad) * orbitR;
          const sz = size * 0.018 * (1 - (i % 3) * 0.2);
          return (
            <circle
              key={i}
              cx={px}
              cy={py}
              r={sz}
              fill="#A59BF0"
              opacity={0.55 - (i % 3) * 0.12}
            />
          );
        })}
      </g>

      {/* ─── L3: Counter-rotating outer ring (only when active) ─── */}
      {(isDispatch || isThinking) && (
        <g
          className={`orb-${uid}-orbit-rev`}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        >
          <circle
            cx={cx}
            cy={cy}
            r={orbitR * 1.18}
            fill="none"
            stroke="#4F46E5"
            strokeWidth={size * 0.005}
            strokeOpacity="0.25"
            strokeDasharray={`${size * 0.04} ${size * 0.32}`}
          />
        </g>
      )}

      {/* ─── L4: Liquid core (the "self") ─── */}
      <g
        className={coreClass}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      >
        {/* Soft outer glow shadow */}
        <circle
          cx={cx}
          cy={cy + size * 0.02}
          r={coreR * 1.1}
          fill="#4F46E5"
          opacity="0.35"
          filter={`url(#orb-glow-${uid})`}
        />
        {/* The orb body */}
        <circle
          cx={cx}
          cy={cy}
          r={coreR}
          fill={`url(#orb-core-${uid})`}
        />
        {/* Iridescent sheen overlay */}
        <ellipse
          cx={cx - coreR * 0.15}
          cy={cy - coreR * 0.1}
          rx={coreR * 0.95}
          ry={coreR * 0.85}
          fill={`url(#orb-sheen-${uid})`}
          opacity="0.6"
        />
        {/* Top specular highlight (glass reflection) */}
        <ellipse
          cx={cx - coreR * 0.28}
          cy={cy - coreR * 0.42}
          rx={coreR * 0.42}
          ry={coreR * 0.22}
          fill={`url(#orb-spec-${uid})`}
        />
        {/* Tiny pin highlight */}
        <circle
          cx={cx - coreR * 0.4}
          cy={cy - coreR * 0.55}
          r={coreR * 0.06}
          fill="#FFFFFF"
          opacity="0.9"
        />
      </g>

      {/* ─── L5: Internal cognitive points (thinking state) ─── */}
      {isThinking && (
        <g
          className={`orb-${uid}-cog`}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        >
          {[0, 120, 240].map((deg, i) => {
            const rad = (deg * Math.PI) / 180;
            const r = coreR * 0.55;
            return (
              <circle
                key={i}
                cx={cx + Math.cos(rad) * r}
                cy={cy + Math.sin(rad) * r}
                r={size * 0.012}
                fill="#FFFFFF"
                opacity="0.85"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            );
          })}
        </g>
      )}

      {/* ─── L6: Dispatch — tracer flowers ─── */}
      {isDispatch && [0, 72, 144, 216, 288].map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const dist = orbitR * 1.45;
        const dx = cx + Math.cos(rad) * dist;
        const dy = cy + Math.sin(rad) * dist;
        return (
          <g
            key={i}
            className={`orb-${uid}-tracer`}
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              animationDelay: `${i * 0.12}s`,
            }}
          >
            <circle cx={dx} cy={dy} r={size * 0.022} fill="#A59BF0" opacity="0.85" />
            <circle cx={dx} cy={dy} r={size * 0.012} fill="#FFFFFF" opacity="0.95" />
          </g>
        );
      })}

      {/* ─── L7: Speaking — sonic ripples ─── */}
      {isSpeaking && [0, 1, 2].map(i => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={coreR}
          fill="none"
          stroke="#8B7FE8"
          strokeWidth={size * 0.008}
          strokeOpacity="0.6"
          className={`orb-${uid}-ripple`}
          style={{
            animationDelay: `${i * 0.5}s`,
            transformOrigin: `${cx}px ${cy}px`,
          }}
        />
      ))}

      {/* — animations defined per-orb to support multiple instances — */}
      <style>{`
        .orb-${uid}-breath { animation: orb-${uid}-breath-anim 4s ease-in-out infinite; }
        .orb-${uid}-pulse { animation: orb-${uid}-pulse-anim 1.6s ease-in-out infinite; }
        .orb-${uid}-fast { animation: orb-${uid}-pulse-anim 1.0s ease-in-out infinite; }
        .orb-${uid}-aura-pulse { animation: orb-${uid}-aura-anim 4.5s ease-in-out infinite; }
        .orb-${uid}-orbit { animation: orb-${uid}-spin ${isDispatch ? '4s' : isThinking ? '8s' : '14s'} linear infinite; }
        .orb-${uid}-orbit-rev { animation: orb-${uid}-spin-rev ${isDispatch ? '3s' : '7s'} linear infinite; }
        .orb-${uid}-cog { animation: orb-${uid}-spin 1.6s linear infinite; }
        .orb-${uid}-tracer { animation: orb-${uid}-tracer-anim 1.6s ease-in-out infinite; opacity: 0; }
        .orb-${uid}-ripple { animation: orb-${uid}-ripple-anim 2s ease-out infinite; opacity: 0; }

        @keyframes orb-${uid}-breath-anim {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        @keyframes orb-${uid}-pulse-anim {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.07); }
        }
        @keyframes orb-${uid}-aura-anim {
          0%, 100% { transform: scale(0.92); opacity: 0.85; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        @keyframes orb-${uid}-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes orb-${uid}-spin-rev {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes orb-${uid}-tracer-anim {
          0% { opacity: 0; transform: scale(0.4); }
          40% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.6); }
        }
        @keyframes orb-${uid}-ripple-anim {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.4); opacity: 0; }
        }
      `}</style>
    </svg>
  );
}

export default function AtlasOrb({ state, size = 160, showLabel = true, className = '', staticMode = false }: AtlasOrbProps) {
  const label = useMemo(() => STATE_LABELS[state], [state]);

  return (
    <div
      className={`atlas-orb ${className}`}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: showLabel ? Math.max(16, size * 0.12) : 0,
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <OrbSVG state={state} size={size} staticMode={staticMode} />
      </div>

      {showLabel && (
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: Math.max(20, size * 0.16),
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: 0,
              marginBottom: 4,
              fontFamily: 'var(--font-family)',
            }}
          >
            Atlas
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              letterSpacing: 'var(--ls-caption)',
              fontFamily: 'var(--font-mono)',
              transition: 'color 0.3s ease',
              textTransform: 'uppercase',
            }}
          >
            {label}
          </div>
        </div>
      )}
    </div>
  );
}
