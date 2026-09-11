import type { AxiosError } from 'axios';

export function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Network drop, timeout, 5xx, or rate-limit — safe to retry later. 4xx is the crew's data, not the link. */
export function isRetryableError(err: unknown): boolean {
  const ax = err as AxiosError | undefined;
  if (!ax) return true;
  if (ax.code === 'ERR_NETWORK' || ax.code === 'ECONNABORTED' || ax.code === 'ERR_CANCELED') return true;
  if (!ax.response) return true;
  const status = ax.response.status;
  return status >= 500 || status === 408 || status === 429;
}

export function errorMessage(err: unknown): string {
  const ax = err as AxiosError<{ detail?: string }> | undefined;
  if (ax?.response?.data?.detail) return String(ax.response.data.detail);
  if (ax?.message) return ax.message;
  if (err instanceof Error) return err.message;
  return 'Upload failed';
}
