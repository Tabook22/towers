const imageTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp' };
export function teamArchiveImageType(file: { name: string; type: string; size: number }): string | null {
  if (!file.size) return null;
  const type = file.type.split(';')[0].trim().toLowerCase();
  if (Object.values(imageTypes).includes(type) || type === 'image/x-tiff') return type;
  if (!type || type === 'application/octet-stream') return imageTypes[file.name.split('.').pop()?.toLowerCase() || ''] || null;
  return null;
}
export function teamArchiveFileKey(file: { name: string; webkitRelativePath?: string; size: number; lastModified: number }): string {
  return `${file.webkitRelativePath || file.name}|${file.size}|${file.lastModified}`;
}

/** The path selected by the browser, including the folder and subfolders. */
export function teamArchiveRelativePath(file: { name: string; webkitRelativePath?: string }): string {
  return file.webkitRelativePath || file.name;
}
