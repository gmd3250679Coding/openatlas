import { lazy, Suspense, useState } from 'react';
import { Segmented, Tooltip } from 'antd';
import { CheckOutlined, CopyOutlined, DownloadOutlined, EyeOutlined, FileMarkdownOutlined } from '@ant-design/icons';

const CodeHighlighter = lazy(() => import('./CodeHighlighter'));
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

interface Props {
  code: string;
}

type ViewMode = 'preview' | 'source';

export default function MarkdownArtifact({ code }: Props) {
  const [view, setView] = useState<ViewMode>('preview');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'artifact.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="artifact-frame artifact-markdown">
      <div className="artifact-header">
        <span className="artifact-tag">Markdown</span>
        <span className="artifact-meta">rendered preview</span>
        <div className="artifact-actions">
          <Segmented
            size="small"
            value={view}
            onChange={(v) => setView(v as ViewMode)}
            options={[
              { label: '预览', value: 'preview', icon: <EyeOutlined /> },
              { label: '源码', value: 'source', icon: <FileMarkdownOutlined /> },
            ]}
          />
          <Tooltip title={copied ? '已复制' : '复制 Markdown'}>
            <button type="button" onClick={handleCopy} className="artifact-icon-btn" aria-label="复制 Markdown">
              {copied ? <CheckOutlined /> : <CopyOutlined />}
            </button>
          </Tooltip>
          <Tooltip title="下载 artifact.md">
            <button type="button" onClick={handleDownload} className="artifact-icon-btn" aria-label="下载 Markdown">
              <DownloadOutlined />
            </button>
          </Tooltip>
        </div>
      </div>
      {view === 'preview' ? (
        <div className="artifact-markdown-preview">
          <Suspense fallback={<pre className="code-block-skeleton"><code>{code}</code></pre>}>
            <MarkdownRenderer content={code} />
          </Suspense>
        </div>
      ) : (
        <div className="artifact-source-wrap">
          <Suspense fallback={<pre className="code-block-skeleton"><code>{code}</code></pre>}>
            <CodeHighlighter code={code} language="markdown" showLineNumbers={true} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
