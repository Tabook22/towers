export type BoardPoint = [number, number];
export interface BoardMark { id: string; color: string; width: number; order?: number; points: BoardPoint[]; text?: string }
export const BOARD_LIMIT = 600;
export function validMark(value: unknown): value is BoardMark {
  const m = value as BoardMark | null;
  return !!m && typeof m.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(m.id)
    && /^#[0-9a-f]{6}$/i.test(m.color) && [2, 4, 8].includes(m.width)
    && (m.order === undefined || Number.isSafeInteger(m.order) && m.order >= 0 && m.order < 1000000000)
    && Array.isArray(m.points) && m.points.length > 0 && m.points.length <= 512
    && m.points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 1))
    && (m.text === undefined || typeof m.text === 'string' && m.text.length > 0 && m.text.length <= 160);
}
export function paintBoard(ctx: CanvasRenderingContext2D, marks: BoardMark[], w: number, h: number) {
  ctx.save(); ctx.fillStyle = '#fffcf5'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#dedbd2';
  for (let x = 16; x < w; x += 24) for (let y = 16; y < h; y += 24) ctx.fillRect(x, y, 1, 1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const mark of marks) {
    ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color; ctx.lineWidth = mark.width * w / 1000;
    if (mark.text) {
      ctx.font = `${22 * w / 1000}px Arial, sans-serif`;
      const rtl = /[\u0590-\u08ff]/.test(mark.text); ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
      ctx.fillText(mark.text, mark.points[0][0] * w, mark.points[0][1] * h, w * .9);
    } else {
      ctx.beginPath(); mark.points.forEach(([x, y], i) => i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h));
      if (mark.points.length === 1) { const [x, y] = mark.points[0]; ctx.lineTo(x * w + .1, y * h); }
      ctx.stroke();
    }
  }
  ctx.restore();
}
export function safeFilename(name: string) { return name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').slice(0, 160) || 'document'; }
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = safeFilename(name); a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
