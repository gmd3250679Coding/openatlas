export function safeFileTitle(title: string) {
  return (title || 'presentation').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'presentation';
}

export function downloadText(content: string, filename: string, type = 'text/html;charset=utf-8') {
  downloadBlob(new Blob([content], { type }), filename);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 300);
}
