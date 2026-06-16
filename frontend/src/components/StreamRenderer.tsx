/**
 * StreamRenderer — incremental markdown renderer based on streamdown.
 * Replaces the previous `marked` + `rehype-highlight` pipeline (M3.1, 2026-06-04).
 *
 * M3.2 (2026-06-04) override:
 *   Streamdown 2.5.0's bundled shiki integration is broken (the highlighter
 *   factory returns undefined in this build), so we override the `code`
 *   component slot to render syntax highlighting ourselves via
 *   `CodeHighlighter` (which uses shiki 4.2's getSingletonHighlighter).
 *
 *   We disable `controls.code` so streamdown doesn't wrap our output in its
 *   own CodeBlock container (which has its own copy button that operates on
 *   raw code, not on the highlighted HTML).
 *
 * Behavior:
 * - `isStreaming` true  -> `mode="streaming"`, `parseIncompleteMarkdown=true`
 *   so the user sees characters appear one by one with no flicker / no jump.
 *   The code highlighter effect skips until isStreaming flips to false, so
 *   we don't burn cycles re-highlighting partial code on every token.
 * - `isStreaming` false -> `mode="static"`, full parse + CodeHighlighter
 *   kicks in.
 */
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Streamdown } from 'streamdown';
import 'streamdown/styles.css';
import '../styles/hljs-theme.css';
import '../styles/chat.css';
import '../styles/streamdown.css';
import ArtifactCard from './ArtifactCard';

const CodeHighlighter = lazy(() => import('./CodeHighlighter'));
const MermaidBlock = lazy(() => import('./MermaidBlock'));
const HtmlArtifact = lazy(() => import('./HtmlArtifact'));
const MarkdownArtifact = lazy(() => import('./MarkdownArtifact'));
const ReactArtifact = lazy(() => import('./ReactArtifact'));
const ArtifactPreviewDrawer = lazy(() => import('./ArtifactPreviewDrawer'));
const KatexMath = lazy(() => import('./KatexMath'));

interface Props {
  content: string;
  isStreaming?: boolean;
}

// Extract the raw text from a React children tree (streamdown passes the
// raw code string as a child of the `code` component for code blocks).
function childrenToString(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToString).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return childrenToString((children as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'math-display'; raw: string }
  | { kind: 'math-inline'; raw: string }
  | { kind: 'code-block'; lang: string; code: string; isStreaming: boolean };

/**
 * Tokenize the content into alternating text / math-display / math-inline /
 * code-block segments. Math and code-block tokens are rendered outside of
 * Streamdown:
 *  - Math: Streamdown 2.5.0 declares `remarkPluginsBefore` in its .d.ts but
 *    the runtime doesn't wire it (verified: 0 occurrences in index.js).
 *  - Code-block: Streamdown 2.5.0 on a children string that consists entirely
 *    of a single ```lang ... ``` fence (no surrounding prose) renders an
 *    empty `<div>` — Streamdown treats the input as "incomplete markdown" and
 *    refuses to parse the fence. We slice the fence out ourselves and let
 *    our own components render the artifact / highlighter directly.
 */
function tokenize(input: string, isStreaming: boolean): Segment[] {
  const segs: Segment[] = [];
  // 先切围栏 ```lang\n...``` (M3.4 2026-06-04)
  // P3.12 late: lang 后允许 0+ 空白 + 可选换行, 容错 "```mermaid graph..." 单行
  const fenceRe = /```([a-zA-Z0-9_+\-]*)[ \t]*\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(input))) {
    if (m.index > last) segs.push({ kind: 'text', text: input.slice(last, m.index) });
    const lang = (m[1] || 'text').toLowerCase();
    const code = String(m[2]);
    segs.push({ kind: 'code-block', lang, code, isStreaming });
    last = m.index + m[0].length;
  }
  if (last < input.length) segs.push({ kind: 'text', text: input.slice(last) });

  // 再切块级 $$...$$
  const blockRe = /\$\$([\s\S]+?)\$\$/g;
  const out: Segment[] = [];
  for (const s of segs) {
    if (s.kind !== 'text') { out.push(s); continue; }
    let last2 = 0;
    let mm: RegExpExecArray | null;
    blockRe.lastIndex = 0;
    while ((mm = blockRe.exec(s.text))) {
      if (mm.index > last2) out.push({ kind: 'text', text: s.text.slice(last2, mm.index) });
      const expr = String(mm[1]).trim();
      out.push({ kind: 'math-display', raw: expr });
      last2 = mm.index + mm[0].length;
    }
    if (last2 < s.text.length) out.push({ kind: 'text', text: s.text.slice(last2) });
  }

  // 再切行内 $...$ (只看 text 段)
  const finalSegs: Segment[] = [];
  const inlineRe = /(^|[^$])\$([^\$\n]+?)\$(?!\$)/g;
  for (const s of out) {
    if (s.kind !== 'text') { finalSegs.push(s); continue; }
    let last2 = 0;
    let mm: RegExpExecArray | null;
    inlineRe.lastIndex = 0;
    while ((mm = inlineRe.exec(s.text))) {
      const lead = mm[1] || '';
      const expr = String(mm[2]).trim();
      const matchStart = mm.index + lead.length;
      if (matchStart > last2) finalSegs.push({ kind: 'text', text: s.text.slice(last2, matchStart) });
      finalSegs.push({ kind: 'math-inline', raw: expr });
      last2 = matchStart + mm[0].slice(lead.length).length;
    }
    if (last2 < s.text.length) finalSegs.push({ kind: 'text', text: s.text.slice(last2) });
  }
  return finalSegs;
}

export default function StreamRenderer({ content, isStreaming = false }: Props) {
  // Custom `code` component: handled at the tokenize() layer now (M3.4),
  // so we pass an empty object to Streamdown — `<Streamdown>` is only
  // called on the text-only segments (prose without any code/math).
  const components = useMemo(() => ({}), []);

  // M3.3+M3.4 (2026-06-04):tokenize content into text / math-display /
  // math-inline / code-block segments. Streamdown 2.5.0 has multiple
  // declared-but-unwired features (remarkPluginsBefore for math; refuses
  // to parse a children string that consists entirely of a single ```lang
  // fence for code). We slice them out ourselves and render KaTeX HTML
  // (math) or React components (code) directly.
  const segments = useMemo(() => tokenize(content, isStreaming), [content, isStreaming]);

  // P3.12 3.4.4 — ArtifactPreviewDrawer 状态, View 按钮触发.
  const [preview, setPreview] = useState<{
    open: boolean;
    title: string;
    body: ReactNode;
  }>({ open: false, title: '', body: null });
  const lazyFallback = (text?: string) => (
    <pre className="code-block-skeleton"><code>{text || '正在加载预览…'}</code></pre>
  );
  const lazyWrap = (body: ReactNode, fallbackText?: string) => (
    <Suspense fallback={lazyFallback(fallbackText)}>{body}</Suspense>
  );
  const openPreview = (title: string, body: ReactNode) => {
    setPreview({ open: true, title, body: lazyWrap(body) });
  };
  const closePreview = () => setPreview((p) => ({ ...p, open: false }));

  if (!content || content.trim() === '') {
    return null;
  }

  return (
    <div className="markdown-body streamdown-host">
      {segments.map((seg, i) => {
        if (seg.kind === 'math-display') {
          return (
            <Suspense key={i} fallback={<span className="katex-inline-wrap">{`$$${seg.raw}$$`}</span>}>
              <KatexMath expression={seg.raw} displayMode={true} />
            </Suspense>
          );
        }
        if (seg.kind === 'math-inline') {
          return (
            <Suspense key={i} fallback={<span className="katex-inline-wrap">{`$${seg.raw}$`}</span>}>
              <KatexMath expression={seg.raw} />
            </Suspense>
          );
        }
        if (seg.kind === 'code-block') {
          if (seg.lang === 'mermaid') {
            const mb = lazyWrap(
              <MermaidBlock key={`mb-${i}`} code={seg.code} isStreaming={seg.isStreaming} onView={() => openPreview('Mermaid 流程图预览', <MermaidBlock code={seg.code} isStreaming={false} />)} />,
              seg.code,
            );
            return (
              <ArtifactCard key={i} kind="mermaid" title="Mermaid 流程图" onView={() => openPreview('Mermaid 流程图预览', <MermaidBlock code={seg.code} isStreaming={false} />)}>
                {mb}
              </ArtifactCard>
            );
          }
          // M3.4 (2026-06-04):HTML / HTM 围栏路由到 HtmlArtifact(sandbox iframe)
          if (seg.lang === 'html' || seg.lang === 'htm') {
            return (
              <ArtifactCard key={i} kind="html" title="HTML 预览" onView={() => openPreview('HTML 全屏预览', <HtmlArtifact code={seg.code} />)}>
                {lazyWrap(<HtmlArtifact code={seg.code} />, seg.code)}
              </ArtifactCard>
            );
          }
          if (seg.lang === 'markdown' || seg.lang === 'md') {
            return (
              <ArtifactCard key={i} kind="markdown" title="Markdown 预览" onView={() => openPreview('Markdown 全屏预览', <MarkdownArtifact code={seg.code} />)}>
                {lazyWrap(<MarkdownArtifact code={seg.code} />, seg.code)}
              </ArtifactCard>
            );
          }
          // M3.4 (2026-06-04):TSX / JSX / TS / JS 围栏路由到 ReactArtifact(Sandpack)
          if (seg.lang === 'tsx' || seg.lang === 'jsx' || seg.lang === 'ts' || seg.lang === 'js') {
            return (
              <ArtifactCard key={i} kind="react" title={`React (${seg.lang})`} onView={() => openPreview(`React (${seg.lang}) 全屏预览`, <ReactArtifact code={seg.code} language={seg.lang as 'tsx' | 'jsx' | 'ts' | 'js'} />)}>
                {lazyWrap(<ReactArtifact code={seg.code} language={seg.lang as 'tsx' | 'jsx' | 'ts' | 'js'} />, seg.code)}
              </ArtifactCard>
            );
          }
          return (
            <ArtifactCard key={i} kind="code" title={seg.lang.toUpperCase()} onView={() => openPreview(`${seg.lang.toUpperCase()} 代码预览`, <CodeHighlighter code={seg.code} language={seg.lang} showLineNumbers={true} />)}>
              {lazyWrap(
                <CodeHighlighter
                  code={seg.code}
                  language={seg.lang}
                  showLineNumbers={true}
                />,
                seg.code,
              )}
            </ArtifactCard>
          );
        }
        // text — 走 Streamdown
        return (
          <Streamdown
            key={i}
            mode={isStreaming ? 'streaming' : 'static'}
            parseIncompleteMarkdown={isStreaming}
            shikiTheme={['github-light', 'github-dark']}
            // P3.12 3.4.4: 改 mermaid: false (之前 M3.3 状态 mermaid: true,
            // 让 streamdown 2.5 浮控件渲染左侧破坏布局). 现在 Mermaid 围栏在
            // tokenize() 层就切走, 走 MermaidBlock 自家三件套 (右侧 toolbar).
            // code: false 保持 — CodeHighlighter 接管高亮 + 自带 Copy/Download.
            // table: true 保持 — table 一直 OK.
            controls={{ table: false, code: false, mermaid: false }}
            lineNumbers={false}
            components={components}
          >
            {seg.text}
          </Streamdown>
        );
      })}
      <Suspense fallback={null}>
        <ArtifactPreviewDrawer
          open={preview.open}
          onClose={closePreview}
          title={preview.title}
        >
          {preview.body}
        </ArtifactPreviewDrawer>
      </Suspense>
    </div>
  );
}
