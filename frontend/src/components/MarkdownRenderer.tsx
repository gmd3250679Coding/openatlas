/**
 * MarkdownRenderer — renders markdown using marked.
 * Compatible with React 19.
 */
import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import '../styles/hljs-theme.css';
import '../styles/chat.css';

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface Props {
  content: string;
}

export default function MarkdownRenderer({ content }: Props) {
  const html = useMemo(() => {
    if (!content || content.trim() === '') return '';
    try {
      const raw = marked.parse(content) as string;
      return DOMPurify.sanitize(raw, {
        ADD_ATTR: ['target', 'rel'],
      });
    } catch {
      return content;
    }
  }, [content]);

  if (!content || content.trim() === '') {
    return null;
  }

  return (
    <div
      className="markdown-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
