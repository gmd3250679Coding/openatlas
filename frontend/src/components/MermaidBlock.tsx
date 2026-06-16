/**
 * MermaidBlock — Renders ```mermaid``` fenced code blocks as SVG diagrams.
 *
 * M3.3 (2026-06-04). Bypasses Streamdown 2.5.0's bundled mermaid integration
 * (we don't trust a freshly-installed dep the way the bundled shiki turned out
 * to be broken). Calls `mermaid.render` directly, themed by current data-theme.
 *
 * Streaming behavior:
 *   - While `isStreaming=true`, show a skeleton (mermaid can't render
 *     half-finished graphs anyway — it needs a complete graph string).
 *   - On completion (`isStreaming=false`), kick off mermaid.render.
 *   - On render error, keep the original code visible with a red border +
 *     the error message; never throw.
 *
 * P3.12 3.4.4 — MermaidBlock 自管三件套 (Copy SVG / Download / View 全屏).
 * 之前依赖 streamdown `controls.mermaid: true` 渲染的浮控件按钮在左侧 +
 * 浏览器 fullscreen API 限制 → 改用 ArtifactCard 容器 + 自家按钮 (右侧).
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Tooltip, message } from 'antd';
import { CopyOutlined, DownloadOutlined, FullscreenOutlined } from '@ant-design/icons';

type MermaidModule = typeof import('mermaid').default;

let mermaidImportPromise: Promise<MermaidModule> | null = null;
let mermaidInitPromise: Promise<MermaidModule> | null = null;
let mermaidInitTheme: string | null = null;

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidImportPromise) {
    mermaidImportPromise = import('mermaid').then((mod) => mod.default);
  }
  return mermaidImportPromise;
}

function ensureMermaid(theme: 'light' | 'dark'): Promise<MermaidModule> {
  if (mermaidInitPromise && mermaidInitTheme === theme) return mermaidInitPromise;
  mermaidInitTheme = theme;
  mermaidInitPromise = loadMermaid().then((mermaid) => {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose', // allow inline html in diagrams
      fontFamily: 'inherit',
    });
    return mermaid;
  });
  return mermaidInitPromise;
}

export function MermaidBlock({
  code,
  isStreaming,
  onView,
}: {
  code: string;
  isStreaming: boolean;
  /** P3.12 3.4.4 — ArtifactPreviewDrawer 打开回调, 容器右上角 View 按钮触发 */
  onView?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (isStreaming) {
      setSvg(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const theme = (document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light') as 'light' | 'dark';
    (async () => {
      try {
        const mermaid = await ensureMermaid(theme);
        const { svg: rendered } = await mermaid.render(idRef.current, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setSvg(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, isStreaming]);

  const handleCopySvg = async () => {
    if (!svg) return;
    try {
      await navigator.clipboard.writeText(svg);
      message.success('SVG 已复制');
    } catch {
      message.error('复制失败');
    }
  };
  const handleDownload = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mermaid-${Date.now()}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (isStreaming) {
    return (
      <div className="mermaid-block mermaid-skeleton" aria-busy="true">
        <span>正在准备图表…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mermaid-block mermaid-error" role="alert">
        <div className="mermaid-error-title">图表渲染失败</div>
        <pre className="mermaid-error-msg">{error}</pre>
        <pre className="mermaid-source">{code}</pre>
      </div>
    );
  }

  return (
    <div className="mermaid-block-wrap">
      <div className="mermaid-block-toolbar">
        <Tooltip title="复制 SVG" mouseEnterDelay={0.4}>
          <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopySvg} disabled={!svg} />
        </Tooltip>
        <Tooltip title="下载 SVG" mouseEnterDelay={0.4}>
          <Button type="text" size="small" icon={<DownloadOutlined />} onClick={handleDownload} disabled={!svg} />
        </Tooltip>
        {onView && (
          <Tooltip title="右侧全屏预览" mouseEnterDelay={0.4}>
            <Button type="text" size="small" icon={<FullscreenOutlined />} onClick={onView} disabled={!svg} />
          </Tooltip>
        )}
      </div>
      <div
        ref={containerRef}
        className="mermaid-block"
        // mermaid.render already sanitizes, and we trust the source because it
        // came from the assistant's own text response.
        dangerouslySetInnerHTML={{ __html: svg ?? '' }}
      />
    </div>
  );
}

export default MermaidBlock;
