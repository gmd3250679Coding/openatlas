import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { loginApi, registerApi, fetchCurrentUser } from '../services/api';

/* ── Types ── */

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role?: string;
  is_active: boolean;
  is_admin: boolean;
  capabilities: string[];
  permissions?: { capabilities?: string[] };
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (usernameOrEmail: string, password: string) => Promise<void>;
  logout: () => void;
}

/* ── Context ── */

const AuthContext = createContext<AuthContextValue | null>(null);

/* ── Provider ── */

const TOKEN_KEY = 'openatlas_access_token';

function normalizeAuthUser(payload: any): AuthUser | null {
  const raw = payload?.user || payload;
  if (!raw?.id) return null;
  return {
    id: String(raw.id),
    username: raw.username || raw.email?.split('@')[0] || '用户',
    email: raw.email || '',
    role: raw.role,
    is_active: raw.is_active ?? true,
    is_admin: raw.is_admin ?? ['system_admin', 'tenant_admin', 'admin'].includes(String(raw.role || '')),
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : (raw.permissions?.capabilities || []),
    permissions: raw.permissions,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: validate existing token
  useEffect(() => {
    if (window.location.pathname.startsWith('/aippt-offline-demo')) {
      setIsLoading(false);
      return;
    }
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setIsLoading(false);
      return;
    }

    fetchCurrentUser()
      .then(u => setUser(normalizeAuthUser(u)))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await loginApi(username, password);
    localStorage.setItem(TOKEN_KEY, data.access_token);
    const u = await fetchCurrentUser();
    setUser(normalizeAuthUser(u));
  }, []);

  const register = useCallback(async (usernameOrEmail: string, password: string) => {
    const data = await registerApi(usernameOrEmail, password);
    localStorage.setItem(TOKEN_KEY, data.access_token);
    const u = await fetchCurrentUser();
    setUser(normalizeAuthUser(u));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/* ── Hook ── */

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
