import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { FileExcelOutlined, FileImageOutlined, FilePdfOutlined, FileTextOutlined } from '@ant-design/icons';
import HtmlArtifact from './HtmlArtifact';
import MarkdownArtifact from './MarkdownArtifact';
import { fetchProtectedFileBlob } from '../services/api';
import '../styles/chat.css';

export interface ArtifactPreviewLike {
  id?: string;
  name?: string;
  mime_type?: string;
  mime?: string;
  preview_kind?: string;
  kind?: string;
  size?: number;
  renderable?: boolean;
  content?: string;
  download_url?: string;
  source?: string;
  meta?: string;
}

interface Props {
  preview: ArtifactPreviewLike;
}

export default function ArtifactPreviewContent({ preview }: Props) {
  const name = String(preview.name || 'openatlas-artifact');
  const content = String(preview.content || '');
  const mime = String(preview.mime_type || preview.mime || '').toLowerCase();
  const previewKind = String(preview.preview_kind || preview.kind || '').toLowerCase();
  const lowerName = name.toLowerCase();

  if (isDocxHtmlPreview(previewKind, content)) {
    return <DocxHtmlPreview preview={preview} />;
  }

  if (previewKind === 'html' || mime.includes('html') || /\.html?$/.test(lowerName)) {
    return <HtmlArtifact code={content} />;
  }

  if (previewKind === 'markdown' || mime.includes('markdown') || /\.(md|markdown)$/.test(lowerName)) {
    return <MarkdownArtifact code={content} />;
  }

  if (previewKind === 'json' || mime.includes('json') || /\.json$/.test(lowerName)) {
    return <CodeLikePreview preview={preview} language="json" content={formatJson(content)} />;
  }

  if (
    previewKind === 'csv'
    || mime.includes('csv')
    || /\.csv$/.test(lowerName)
    || isSpreadsheetPreview(previewKind, mime, lowerName)
  ) {
    return <SpreadsheetPreview preview={preview} />;
  }

  if (previewKind === 'pdf_text' || mime.includes('pdf') || /\.pdf$/.test(lowerName)) {
    return <PdfPreview preview={preview} />;
  }

  if (previewKind === 'image' || mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(lowerName)) {
    return <ImagePreview preview={preview} />;
  }

  return <PlainPreview preview={preview} />;
}

function DocxHtmlPreview({ preview }: { preview: ArtifactPreviewLike }) {
  const safeHtml = useMemo(() => DOMPurify.sanitize(String(preview.content || ''), {
    ADD_ATTR: ['data-index', 'style', 'class'],
  }), [preview.content]);
  const canRenderOriginal = Boolean(preview.download_url) && /\.docx$/i.test(String(preview.name || ''));

  return (
    <div className="artifact-docx-preview-shell">
      <PreviewMeta
        preview={preview}
        label={canRenderOriginal ? 'DOCX 原版在线预览' : 'DOCX 结构化预览'}
        hint={canRenderOriginal ? '优先按 Word 版式渲染；失败时自动回退到结构化正文。' : undefined}
      />
      {canRenderOriginal ? (
        <DocxOriginalPreview preview={preview} fallbackHtml={safeHtml} />
      ) : (
        <StructuredDocxHtml safeHtml={safeHtml} />
      )}
    </div>
  );
}

function DocxOriginalPreview({
  preview,
  fallbackHtml,
}: {
  preview: ArtifactPreviewLike;
  fallbackHtml: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [error, setError] = useState('');
  const downloadUrl = String(preview.download_url || '');

  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    if (!host || !downloadUrl) {
      setStatus('fallback');
      return undefined;
    }
    host.innerHTML = '';
    setStatus('loading');
    setError('');
    (async () => {
      try {
        const [{ renderAsync }, blob] = await Promise.all([
          import('docx-preview'),
          fetchProtectedFileBlob(downloadUrl),
        ]);
        if (!alive || !hostRef.current) return;
        hostRef.current.innerHTML = '';
        await renderAsync(blob, hostRef.current, undefined, {
          className: 'openatlas-docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderComments: true,
          renderChanges: true,
          renderAltChunks: false,
          useBase64URL: true,
        });
        if (alive) setStatus('ready');
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('fallback');
      }
    })();
    return () => {
      alive = false;
      if (host) host.innerHTML = '';
    };
  }, [downloadUrl]);

  return (
    <>
      {status === 'loading' && (
        <div className="artifact-preview-empty">正在解析 Word 版式...</div>
      )}
      <div
        ref={hostRef}
        className={`artifact-docx-original-stage ${status === 'ready' ? 'is-ready' : ''}`}
        aria-hidden={status !== 'ready'}
      />
      {status === 'fallback' && (
        <>
          {error ? (
            <div className="artifact-preview-fallback-note">
              原版渲染失败，已切换为结构化预览。{error}
            </div>
          ) : null}
          <StructuredDocxHtml safeHtml={fallbackHtml} />
        </>
      )}
    </>
  );
}

function StructuredDocxHtml({ safeHtml }: { safeHtml: string }) {
  return <div className="artifact-docx-preview-page" dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}

function PdfPreview({ preview }: { preview: ArtifactPreviewLike }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [error, setError] = useState('');
  const downloadUrl = String(preview.download_url || '');

  useEffect(() => {
    let url = '';
    let alive = true;
    if (!downloadUrl) return undefined;
    setError('');
    fetchProtectedFileBlob(downloadUrl)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [downloadUrl]);

  const text = String(preview.content || '').trim();
  return (
    <div className="artifact-file-preview">
      <PreviewMeta preview={preview} label="PDF 在线预览" icon={<FilePdfOutlined />} />
      {objectUrl ? (
        <iframe className="artifact-pdf-frame" title={`${preview.name || 'PDF'} preview`} src={objectUrl} />
      ) : (
        <div className="artifact-preview-empty">
          {error ? `PDF 原文件预览失败：${error}` : '正在加载 PDF 原文件预览...'}
        </div>
      )}
      {text ? (
        <details className="artifact-extracted-text">
          <summary>查看抽取文本</summary>
          <pre>{text}</pre>
        </details>
      ) : null}
    </div>
  );
}

function ImagePreview({ preview }: { preview: ArtifactPreviewLike }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [error, setError] = useState('');
  const downloadUrl = String(preview.download_url || '');

  useEffect(() => {
    let url = '';
    let alive = true;
    if (!downloadUrl) return undefined;
    setError('');
    fetchProtectedFileBlob(downloadUrl)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [downloadUrl]);

  return (
    <div className="artifact-file-preview">
      <PreviewMeta preview={preview} label="图片在线预览" icon={<FileImageOutlined />} />
      {objectUrl ? (
        <div className="artifact-image-stage">
          <img src={objectUrl} alt={preview.name || 'artifact image'} />
        </div>
      ) : (
        <div className="artifact-preview-empty">
          {error ? `图片预览失败：${error}` : '正在加载图片...'}
        </div>
      )}
    </div>
  );
}

function SpreadsheetPreview({ preview }: { preview: ArtifactPreviewLike }) {
  const sheets = useMemo(() => parseSpreadsheetPreview(String(preview.content || '')), [preview.content]);
  if (!sheets.length) return <PlainPreview preview={preview} icon={<FileExcelOutlined />} label="表格文本预览" />;

  return (
    <div className="artifact-file-preview artifact-sheet-preview">
      <PreviewMeta preview={preview} label="表格在线预览" icon={<FileExcelOutlined />} />
      {sheets.map((sheet, index) => (
        <section key={`${sheet.name}-${index}`} className="artifact-sheet-section">
          <div className="artifact-sheet-title">{sheet.name || `Sheet ${index + 1}`}</div>
          <div className="artifact-sheet-table-wrap">
            <table>
              <tbody>
                {sheet.rows.slice(0, 120).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function CodeLikePreview({
  preview,
  language,
  content,
}: {
  preview: ArtifactPreviewLike;
  language: string;
  content: string;
}) {
  return (
    <div className="artifact-file-preview">
      <PreviewMeta preview={preview} label={`${language.toUpperCase()} 预览`} />
      <pre className="artifact-code-preview">{content || '暂无可预览内容。'}</pre>
    </div>
  );
}

function PlainPreview({
  preview,
  icon,
  label = '文本预览',
}: {
  preview: ArtifactPreviewLike;
  icon?: ReactNode;
  label?: string;
}) {
  const text = String(preview.content || '').trim();
  return (
    <div className="artifact-file-preview">
      <PreviewMeta preview={preview} label={label} icon={icon || <FileTextOutlined />} />
      {text ? (
        <pre className="artifact-text-preview">{text}</pre>
      ) : (
        <div className="artifact-preview-empty">该交付物暂不支持在线渲染，可以下载到本地打开。</div>
      )}
    </div>
  );
}

function PreviewMeta({
  preview,
  label,
  icon,
  hint,
}: {
  preview: ArtifactPreviewLike;
  label: string;
  icon?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="artifact-preview-meta-bar">
      <span className="artifact-preview-meta-icon">{icon || <FileTextOutlined />}</span>
      <div>
        <div className="artifact-preview-meta-title">{label}</div>
        <div className="artifact-preview-meta-subtitle">
          {preview.mime_type || preview.mime || preview.kind || 'artifact'} · {formatBytes(Number(preview.size || 0))}
        </div>
        {hint ? <div className="artifact-preview-meta-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

function isDocxHtmlPreview(kind: string, content: string) {
  return kind === 'docx_html' || /class=["']docx-preview-document["']/.test(content);
}

function isSpreadsheetPreview(kind: string, mime: string, lowerName: string) {
  return kind === 'document_text' && (
    mime.includes('spreadsheet')
    || mime.includes('excel')
    || /\.(xlsx?|xlsm)$/.test(lowerName)
  );
}

function formatJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function parseSpreadsheetPreview(text: string): Array<{ name: string; rows: string[][] }> {
  const clean = text.trim();
  if (!clean) return [];
  const lines = clean.split(/\r?\n/);
  const sheets: Array<{ name: string; rows: string[][] }> = [];
  let current: { name: string; rows: string[][] } = { name: 'Sheet 1', rows: [] };

  const flush = () => {
    if (current.rows.some((row) => row.length > 1 || row.some(Boolean))) sheets.push(current);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const sheetMatch = line.match(/^#\s*Sheet:\s*(.+)$/i);
    if (sheetMatch) {
      flush();
      current = { name: sheetMatch[1].trim() || `Sheet ${sheets.length + 1}`, rows: [] };
      continue;
    }
    const row = line.includes('|')
      ? line.split('|').map((cell) => cell.trim())
      : parseCsvLine(line);
    if (row.length > 1) current.rows.push(row);
  }
  flush();
  return sheets.filter((sheet) => sheet.rows.length > 0);
}

function parseCsvLine(line: string) {
  const row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  return row;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
