/**
 * ReactArtifact — M3.4 (2026-06-04)
 *
 * Sandpack-powered live React preview. Receives a raw React/JSX/TSX
 * component as a single file (the model's primary output) and renders it
 * inside Sandpack's iframe sandbox, so the user sees a hot-reloaded
 * preview without leaving the chat.
 *
 * Why a single file?
 *   M3.4 is the first preview MVP. We accept one component file plus
 *   pre-supplied boilerplate (index.tsx, styles.css, package.json) so
 *   the model only has to emit ~30 lines of code. Multi-file artifacts
 *   are an M3.4+ extension.
 *
 * Why no extra sandbox attribute?
 *   Sandpack's <Preview> already uses `sandbox="allow-scripts
 *   allow-same-origin allow-popups allow-forms"` on its inner iframe.
 *   We trust Sandpack's hardening; we only wrap the result in our
 *   Atlas-themed chrome.
 *
 * Theme sync:
 *   We read the current `data-theme` attribute on the document root and
 *   switch Sandpack's `theme` prop accordingly, so the editor matches
 *   Atlas's light/dark mode.
 */
import { useEffect, useState } from 'react';
import { Sandpack } from '@codesandbox/sandpack-react';
import { aquaBlue } from '@codesandbox/sandpack-themes';

interface Props {
  code: string;
  language: 'tsx' | 'jsx' | 'ts' | 'js';
}

export default function ReactArtifact({ code, language }: Props) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const update = () => {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    };
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // 推断入口文件名
  const entryFile = language === 'tsx' || language === 'ts' ? '/App.tsx' : '/App.jsx';

  return (
    <div className="artifact-frame artifact-react">
      <div className="artifact-header">
        <span className="artifact-tag">React 预览</span>
        <span className="artifact-meta">Sandpack · {entryFile}</span>
      </div>
      <div className="artifact-sandpack">
        <Sandpack
          template="react-ts"
          theme={theme === 'dark' ? 'dark' : aquaBlue}
          options={{
            showNavigator: false,
            showLineNumbers: true,
            showInlineErrors: true,
            editorHeight: 320,
            showTabs: false,
            showConsole: false,
            activeFile: entryFile,
          }}
          files={{
            [entryFile]: code,
          }}
        />
      </div>
    </div>
  );
}
