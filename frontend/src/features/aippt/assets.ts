import { safeFileTitle } from './browser';

export const AIPPT_SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

export function isSupportedImageFile(file: File) {
  const name = file.name.toLowerCase();
  return AIPPT_SUPPORTED_IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp|gif|svg)$/u.test(name);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取素材失败'));
    reader.readAsDataURL(file);
  });
}

export function svgTextToDataUrl(svg: string) {
  const clean = svg.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
}

export function isImageLikeUrl(value: string) {
  const text = value.trim();
  return /^data:image\//iu.test(text) || /^https?:\/\/.+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/iu.test(text);
}

export function filenameForImage(file: File, fallback: string) {
  const raw = file.name || fallback || 'aippt-image';
  return safeFileTitle(raw.replace(/\.[^.]+$/u, ''));
}
