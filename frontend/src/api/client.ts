import axios from 'axios';
import { requireSameSession } from '../auth/session';

declare module 'axios' {
  interface AxiosRequestConfig {
    iipSessionToken?: string;
  }
}

function resolveApiBase(): string {
  const env = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, '');
  // Production (no env): talk to whatever host the user opened — IP or domain —
  // so we stay same-origin and do not trip the browser's CORS rules.
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://127.0.0.1:8001';
}

export const API_BASE_URL = resolveApiBase();

/**
 * Builds a signed media URL (image/thumbnail/report) for use directly in `<img src>` / `<a href>`.
 * Those tags can't send an Authorization header, so the backend also accepts the same JWT as a
 * `?token=` query param on those specific endpoints — this appends it.
 *
 * `version`, when given, is appended as `&v=` so the URL changes whenever the underlying file does
 * (pass the image's `uploaded_at`) — otherwise the browser's HTTP cache keeps serving the old bytes
 * from the identical URL after a "Replace image", since the image id/token alone never change.
 */
export function mediaUrl(path: string, version?: string | number | null): string {
  const token = localStorage.getItem('iip_token');
  const url = new URL(path, API_BASE_URL);
  if (token) url.searchParams.set('token', token);
  if (version) url.searchParams.set('v', String(version));
  return url.toString();
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

apiClient.interceptors.request.use((config) => {
  if (config.iipSessionToken !== undefined) requireSameSession(config.iipSessionToken);
  const token = localStorage.getItem('iip_token');
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // An old request must not sign out a new account that logged in while it was pending.
    const sentAuthorization = error?.config?.headers?.Authorization;
    const currentToken = localStorage.getItem('iip_token');
    if (error?.response?.status === 401 && currentToken && sentAuthorization === `Bearer ${currentToken}`) {
      localStorage.removeItem('iip_token');
      localStorage.removeItem('iip_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);
