import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiClient } from '../api/client';
import type { LoginResponse } from '../api/types';

interface AuthUser {
  id: number | null;
  username: string;
  role: string;
  full_name: string | null;
  team_id: number | null;
  is_super_admin: boolean;
  permissions: string[];
  // Only meaningful for role === 'client' — see backend models.User.
  can_edit_reports: boolean;
  can_delete_report_images: boolean;
  // Which sidebar menu items this account sees, and at what level — see components/Layout.tsx.
  menu_permissions: Record<string, string>;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (data: LoginResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem('iip_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(readStoredUser());

  useEffect(() => {
    const token = localStorage.getItem('iip_token');
    if (!token) return;
    if (user?.id && user.team_id) return;
    void apiClient
      .get<{
        id: number;
        username: string;
        role: string;
        full_name: string | null;
        team_id: number | null;
        is_super_admin: boolean;
        permissions: string[];
        can_edit_reports: boolean;
        can_delete_report_images: boolean;
        menu_permissions: Record<string, string>;
      }>('/api/auth/me')
      .then(({ data }) => {
        const u: AuthUser = {
          id: data.id,
          username: data.username,
          role: data.role,
          full_name: data.full_name,
          team_id: data.team_id ?? null,
          is_super_admin: data.is_super_admin,
          permissions: data.permissions,
          can_edit_reports: data.can_edit_reports,
          can_delete_report_images: data.can_delete_report_images,
          menu_permissions: data.menu_permissions || {},
        };
        localStorage.setItem('iip_user', JSON.stringify(u));
        setUser(u);
      })
      .catch(() => undefined);
    // Existing sessions stored before user_id existed on login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // localStorage is shared across every tab of this origin, but each tab's own React state is
    // only set once at mount — sign in as someone else in another tab (or this one, in a second
    // window) and this tab keeps rendering UI for the account it started with, while every request
    // it sends now carries the new account's token, since apiClient reads localStorage fresh each
    // time. That mismatch is exactly what an admin hit: a tab still showing "Add team leader"
    // (isAdmin baked in from the old session) submitted with a team_leader token underneath, and
    // got that role's 403 back. The `storage` event fires in every OTHER tab when localStorage
    // changes, so re-reading here keeps this tab's identity in sync instead of silently stale.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'iip_token' || e.key === 'iip_user') setUser(readStoredUser());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      login: (data: LoginResponse) => {
        localStorage.setItem('iip_token', data.access_token);
        const u = {
          id: data.user_id,
          username: data.username,
          role: data.role,
          full_name: data.full_name,
          team_id: data.team_id ?? null,
          is_super_admin: data.is_super_admin,
          permissions: data.permissions,
          can_edit_reports: data.can_edit_reports,
          can_delete_report_images: data.can_delete_report_images,
          menu_permissions: data.menu_permissions || {},
        };
        localStorage.setItem('iip_user', JSON.stringify(u));
        setUser(u);
      },
      logout: () => {
        localStorage.removeItem('iip_token');
        localStorage.removeItem('iip_user');
        // So the next sign-in in this same tab (a shared device, a different admin) sees the
        // welcome splash again instead of it staying dismissed from the previous person's session.
        sessionStorage.removeItem('iip_splash_shown');
        setUser(null);
      },
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
