/** Keep incomplete input on screen; never convert it to a cleared/NaN observation. */
export function parseInspectionReading(raw: string): { valid: boolean; value: number | null } {
  const normalized = raw.trim().replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - (digit.charCodeAt(0) <= 0x669 ? 0x660 : 0x6f0))).replace(/\u066b/g, '.');
  if (!normalized) return { valid: true, value: null };
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return { valid: false, value: null };
  const value = Number(normalized);
  return { valid: Number.isFinite(value), value: Number.isFinite(value) ? value : null };
}
