import katex from 'katex';
import 'katex/dist/katex.min.css';
import '../styles/katex-override.css';

interface Props {
  expression: string;
  displayMode?: boolean;
}

export default function KatexMath({ expression, displayMode = false }: Props) {
  let html: string;
  try {
    html = katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'html',
    });
  } catch (e) {
    html = `<span class="katex-error">[math: ${String(e).slice(0, 80)}]</span>`;
  }

  const className = displayMode ? 'katex-display-wrap' : 'katex-inline-wrap';
  const Tag = displayMode ? 'div' : 'span';

  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
