/** Merge independent device edits, but never choose a winner for conflicting proposals. */
export function reconcileDraft<T>(local: T, remote: T, base: T): T {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const object = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);
  function merge(a: unknown, b: unknown, original: unknown, path: string): unknown {
    if (same(a, b) || same(b, original)) return a;
    if (same(a, original)) return b;
    if (object(a) && object(b) && (object(original) || original === undefined)) {
      const baseline = object(original) ? original : {};
      return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(baseline)])].map(key =>
        [key, merge(a[key], b[key], baseline[key], path ? `${path}.${key}` : key)]).filter(([, value]) => value !== undefined));
    }
    throw new Error(`Conflicting draft proposals: ${path}. Your local entries are retained. Copy the conflicting values before reloading the server draft.`);
  }
  return merge(local, remote, base, '') as T;
}
