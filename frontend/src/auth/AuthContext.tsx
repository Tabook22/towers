import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { LoginResponse } from '../api/types';

interface AuthUser {
  username: string;
  role: string;
  full_name: string | null;
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

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      login: (data: LoginResponse) => {
        localStorage.setItem('iip_token', data.access_token);
        const u = { username: data.username, role: data.role, full_name: data.full_name };
        localStorage.setItem('iip_user', JSON.stringify(u));
        setUser(u);
      },
      logout: () => {
        localStorage.removeItem('iip_token');
        localStorage.removeItem('iip_user');
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
