export function filesFromClipboardData(data: DataTransfer | null): File[] {
  if (!data) return [];

  const files: File[] = [];
  const seen = new Set<string>();
  const addFile = (file: File | null) => {
    if (!file) return;
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  Array.from(data.files || []).forEach(addFile);
  Array.from(data.items || []).forEach((item) => {
    if (item.kind === 'file') addFile(item.getAsFile());
  });

  return files;
}
