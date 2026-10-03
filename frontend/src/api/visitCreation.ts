// Keep a creation attempt across dropped responses, component remounts and refreshes.
// The server scopes every token to the authenticated account.
type Attempt = { token: string; body: Record<string, unknown> };
const pending = new Map<string, Attempt>();

export async function createVisitWithToken<T>(
  path: string,
  payload: Record<string, unknown>,
  send: (body: Record<string, unknown>) => Promise<T>,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
): Promise<T> {
  let account = '';
  try {
    const user = JSON.parse(storage.getItem('iip_user') || '{}');
    account = String(user.id || user.username || '');
  } catch { /* use session memory */ }
  // A fresh GPS sample on retry is the same intent. Send the original coordinates
  // with the original token so its immutable server receipt still matches.
  const signature = JSON.stringify(Object.fromEntries(Object.entries(payload)
    .filter(([name]) => name !== 'latitude' && name !== 'longitude')
    .sort(([a], [b]) => a.localeCompare(b))));
  const key = `iip-visit-create:${account}:${path}:${signature}`;
  let attempt = pending.get(key);
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (!attempt && saved?.body && typeof saved.token === 'string') attempt = saved as Attempt;
  } catch { /* memory still protects retries */ }
  attempt ||= { token: crypto.randomUUID(), body: { ...payload } };
  pending.set(key, attempt);
  try { storage.setItem(key, JSON.stringify(attempt)); } catch { /* browser storage can be unavailable */ }
  let result: T;
  try {
    result = await send({ ...attempt.body, request_token: attempt.token });
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 410) {
      // The server confirmed deliberate deletion. A subsequent user action may
      // start a new request; this failed call never silently recreates the visit.
      pending.delete(key);
      try { storage.removeItem(key); } catch { /* optional browser storage */ }
    }
    throw error;
  }
  // Clear only on a confirmed response. A lost response keeps exactly the same token.
  pending.delete(key);
  try { storage.removeItem(key); } catch { /* optional browser storage */ }
  return result;
}
