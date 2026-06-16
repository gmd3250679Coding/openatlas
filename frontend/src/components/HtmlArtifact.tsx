/**
 * HtmlArtifact — M3.4 (2026-06-04) + Bug 1 fix (2026-06-06)
 *
 * Sandboxed live HTML preview. Renders raw HTML inside a same-origin
 * `<iframe sandbox="allow-scripts">` so that the artifact code cannot
 * reach Atlas's React tree, cookies, or localStorage.
 *
 * Bug 1 (2026-06-06, 王六原话: "既支持看代码, 也支持前端渲染预览, 也提供
 * 下载/复制按钮"):
 *   之前只有 preview iframe, 用户看不到代码 / 没法复制 / 没法下载.
 *   现在顶部加 <Segmented> 切 "预览" / "代码" / "下载" 三视图:
 *     - 预览: 原本的 iframe sandbox (M3.4 行为, 不变)
 *     - 代码: 走 CodeHighlighter, 跟普通 code block 一样有 copy/download
 *     - 下载: 一键下载 code.html, blob URL 触发
 *
 * Security model (保留 M3.4 不变):
 *   - `sandbox="allow-scripts"` — no allow-same-origin
 *   - `srcdoc` — inline string injection
 *   - ErrorBoundary 包裹
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { Segmented, Tooltip } from 'antd';
import { EyeOutlined, CodeOutlined, DownloadOutlined, CopyOutlined, CheckOutlined } from '@ant-design/icons';

const CodeHighlighter = lazy(() => import('./CodeHighlighter'));

interface Props {
  code: string;
}

type ViewMode = 'preview' | 'code';

export default function HtmlArtifact({ code }: Props) {
  const [view, setView] = useState<ViewMode>('preview');
  const [copied, setCopied] = useState(false);

  // 注入 HTML 前先做最简包装,确保 <html>/<body> 存在(用户常只写片段)
  const srcdoc = useMemo(() => {
    const trimmed = code.trim();
    if (/^\s*<!doctype/i.test(trimmed) || /^\s*<html/i.test(trimmed)) {
      return trimmed;
    }
    // 片段:用最小 HTML 包装
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{min-height:100%;background:#fff}
  body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2328}
  img,svg,canvas,video{max-width:100%;height:auto}
  table{border-collapse:collapse;max-width:100%}
</style>
</head>
<body>
${trimmed}
</body>
</html>`;
  }, [code]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silent */
    }
  };

  const handleDownload = () => {
    const blob = new Blob([srcdoc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'artifact.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="artifact-frame artifact-html">
      <div className="artifact-header">
        <span className="artifact-tag">HTML 预览</span>
        <span className="artifact-meta">sandbox · responsive frame</span>
        <div className="artifact-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Bug 1: 顶部加 Segmented 切预览/代码 */}
          <Segmented
            size="small"
            value={view}
            onChange={(v) => setView(v as ViewMode)}
            options={[
              { label: '预览', value: 'preview', icon: <EyeOutlined /> },
              { label: '代码', value: 'code', icon: <CodeOutlined /> },
            ]}
          />
          <Tooltip title={copied ? '已复制' : '复制 HTML 源码'}>
            <button
              type="button"
              onClick={handleCopy}
              className="artifact-icon-btn"
              aria-label={copied ? '已复制' : '复制 HTML'}
            >
              {copied ? <CheckOutlined /> : <CopyOutlined />}
            </button>
          </Tooltip>
          <Tooltip title="下载 artifact.html">
            <button
              type="button"
              onClick={handleDownload}
              className="artifact-icon-btn"
              aria-label="下载 HTML"
            >
              <DownloadOutlined />
            </button>
          </Tooltip>
        </div>
      </div>
      {view === 'preview' ? (
        <div className="artifact-html-stage">
          <iframe
            className="artifact-iframe"
            sandbox="allow-scripts"
            title="html-artifact"
            // srcDoc 同时设了 dangerouslySetInnerHTML fallback 路径不行,所以直接用 srcDoc prop
            srcDoc={srcdoc}
          />
        </div>
      ) : (
        // Bug 1: 切到代码视图走 CodeHighlighter, 自动拿到 copy/download/行号
        <div style={{ padding: 12 }}>
          <Suspense fallback={<pre className="code-block-skeleton"><code>{code}</code></pre>}>
            <CodeHighlighter code={code} language="html" showLineNumbers={true} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
