/**
 * CodeHighlighter — client-side syntax highlighting via shiki 4.x (M3.2, 2026-06-04).
 *
 * Why this exists:
 *   Streamdown 2.5.0's internal shiki integration is broken in this build —
 *   its `f()` factory returns undefined, so `<pre><code>` falls back to raw
 *   text with `--sdm-c: inherit` (no hex colors). We bypass it by overriding
 *   the `code` component in Streamdown's `components` slot and rendering the
 *   highlighted HTML ourselves via `shiki.codeToHtml()`.
 *
 * Features wired here:
 *   - Dual-theme: github-light (default) + github-dark (via CSS var
 *     `--shiki-dark`); auto-switches when the page sets `data-theme="dark"`
 *     because shiki writes the dark color as a CSS variable, not a media
 *     query.
 *   - Copy + Download buttons (Bug 2 fix, 2026-06-06):
 *     Streamdown 2.5 自己的内置 copy/download 按钮要求 controls.code: true,
 *     但我们用 controls.code: false 让自定义 CodeHighlighter 接管高亮, 代价是
 *     内置按钮被禁.  现在 CodeHighlighter 自己做 Copy (navigator.clipboard) +
 *     Download (Blob + a.download) 双按钮, 跟 streamdown 风格一致.
 *   - Language label: shown top-left, lowercase monospace chip.
 *   - Line numbers: enabled by default via CSS counter — streamdown's
 *     `lineNumbers` Tailwind utility is broken in our no-Tailwind build,
 *     so we apply our own counter to shiki's standard `<span class="line">`
 *     wrappers.
 *
 * Performance:
 *   - createHighlighterCore caches one highlighter across renders.
 *   - Themes load once; grammar modules load only when a code block actually
 *     uses that language.
 */
import { useState, useCallback, useEffect } from 'react';
import { CopyOutlined, CheckOutlined, DownloadOutlined } from '@ant-design/icons';
import type { HighlighterCore } from '@shikijs/core';

const SUPPORTED_LANGS = [
  'python', 'javascript', 'typescript', 'tsx', 'jsx',
  'bash', 'shell', 'json', 'css', 'html',
  'sql', 'yaml', 'markdown',
] as const;

type SupportedLanguage = typeof SUPPORTED_LANGS[number];

const LANG_LOADERS: Record<SupportedLanguage, () => Promise<{ default: unknown }>> = {
  python: () => import('@shikijs/langs/python'),
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  jsx: () => import('@shikijs/langs/jsx'),
  bash: () => import('@shikijs/langs/bash'),
  shell: () => import('@shikijs/langs/shell'),
  json: () => import('@shikijs/langs/json'),
  css: () => import('@shikijs/langs/css'),
  html: () => import('@shikijs/langs/html'),
  sql: () => import('@shikijs/langs/sql'),
  yaml: () => import('@shikijs/langs/yaml'),
  markdown: () => import('@shikijs/langs/markdown'),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();

function getHl() {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import('@shikijs/core'),
      import('@shikijs/engine-javascript'),
      import('@shikijs/themes/github-light'),
      import('@shikijs/themes/github-dark'),
    ]).then(([core, engine, lightTheme, darkTheme]) => {
      return core.createHighlighterCore({
        themes: [lightTheme.default, darkTheme.default] as any[],
        langs: [],
        engine: engine.createJavaScriptRegexEngine(),
      });
    });
  }
  return highlighterPromise;
}

async function ensureLanguage(hl: HighlighterCore, lang: string) {
  if (!LANG_LOADERS[lang as SupportedLanguage] || loadedLangs.has(lang)) return;
  const grammar = await LANG_LOADERS[lang as SupportedLanguage]();
  await hl.loadLanguage(grammar.default as any);
  loadedLangs.add(lang);
}

interface CodeHighlighterProps {
  code: string;
  language: string;
  showLineNumbers?: boolean;
}

export default function CodeHighlighter({ code, language, showLineNumbers = true }: CodeHighlighterProps) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState<string | null>(null);

  // shiki requires async init; once the singleton resolves we get the
  // highlighter and run codeToHtml. The first frame shows raw code (no
  // flicker since the parent <Streamdown> parses and places us in a
  // stable layout).
  useEffect(() => {
    let cancelled = false;
    const resolvedLang = (SUPPORTED_LANGS as readonly string[]).includes(language)
      ? (language as SupportedLanguage)
      : 'text';
    getHl().then(async (hl) => {
      if (cancelled) return;
      try {
        await ensureLanguage(hl, resolvedLang);
        if (cancelled) return;
        const out = hl.codeToHtml(code, {
          lang: resolvedLang,
          themes: { light: 'github-light', dark: 'github-dark' },
        });
        setHtml(out);
      } catch {
        setHtml(null);
      }
    });
    return () => { cancelled = true; };
  }, [code, language]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API might be unavailable in some embeds; fail silently.
    }
  }, [code]);

  // Bug 2 (2026-06-06): Download 按钮 — 把 code 写到 Blob, 触发 a.download.
  // 文件名后缀按 language 推断 (py / ts / json / html / css ...), 默认 .txt.
  const handleDownload = useCallback(() => {
    const extMap: Record<string, string> = {
      python: 'py', javascript: 'js', typescript: 'ts', tsx: 'tsx', jsx: 'jsx',
      bash: 'sh', shell: 'sh', json: 'json', css: 'css', html: 'html',
      sql: 'sql', yaml: 'yml', markdown: 'md',
    };
    const ext = extMap[language] || 'txt';
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [code, language]);

  const resolvedLang = (SUPPORTED_LANGS as readonly string[]).includes(language)
    ? language
    : 'text';

  return (
    <div className="code-block" data-streamdown="code-block">
      <div className="code-block-header" data-streamdown="code-block-header">
        <span className="code-block-lang">{resolvedLang}</span>
        {/* Bug 2 (2026-06-06): Copy + Download 双按钮, 走 antd icon 精确定位右上角 */}
        <div className="code-block-actions" data-streamdown="code-block-actions">
          <button
            type="button"
            className="code-block-copy"
            data-streamdown="code-block-copy-button"
            onClick={handleCopy}
            title={copied ? '已复制' : '复制代码'}
            aria-label={copied ? '已复制' : '复制代码'}
          >
            {copied ? <CheckOutlined /> : <CopyOutlined />}
          </button>
          <button
            type="button"
            className="code-block-download"
            data-streamdown="code-block-download-button"
            onClick={handleDownload}
            title="下载代码"
            aria-label="下载代码"
          >
            <DownloadOutlined />
          </button>
        </div>
      </div>
      {html ? (
        <div
          className={showLineNumbers ? 'code-block-body line-numbers' : 'code-block-body'}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="code-block-skeleton"><code>{code}</code></pre>
      )}
    </div>
  );
}
