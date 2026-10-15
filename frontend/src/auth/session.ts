/** Stable ownership for device-local work; tokens can rotate without changing its owner. */
export function currentAccountKey(): string | null {
  try {
    if (!localStorage.getItem('iip_token')) return null;
    const user = JSON.parse(localStorage.getItem('iip_user') || 'null');
    if (Number.isSafeInteger(user?.id) && user.id > 0) return `user:${user.id}`;
    if (typeof user?.username === 'string' && user.username) return `username:${user.username}`;
  } catch { /* Missing or corrupt identity must never claim saved work. */ }
  return null;
}

export function requireSameSession(token: string | null): void {
  if (!token || localStorage.getItem('iip_token') !== token) {
    throw new Error('Sign-in changed. Saved work remains on this device.');
  }
}
