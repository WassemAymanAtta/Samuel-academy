import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setAuthToken, setUnauthorizedHandler, storedAuthToken } from '../lib/api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'STUDENT' | 'ADMIN';
  status: 'PENDING' | 'ACTIVE' | 'REJECTED';
  phone: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (input: { name: string; email: string; password: string; phone?: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  // Never let one account's cached data appear in another account's session.
  useEffect(() => {
    setUnauthorizedHandler((message) => {
      setAuthToken(null);
      setUser(null);
      queryClient.clear();
      if (message) sessionStorage.setItem('sa_session_notice', message);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  useEffect(() => {
    const token = storedAuthToken();
    api
      .get<{ user: AuthUser }>('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(async () => {
        if (!token) {
          setUser(null);
          return;
        }
        // Stale per-tab token: fall back to the shared cookie once, then clear it.
        setAuthToken(null);
        try {
          const data = await api.get<{ user: AuthUser }>('/api/auth/me');
          setUser(data.user);
        } catch {
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: async (email, password) => {
        const data = await api.post<{ user: AuthUser; token: string }>('/api/auth/login', { email, password });
        queryClient.clear();
        if (data.token) setAuthToken(data.token);
        setUser(data.user);
        return data.user;
      },
      register: async (input) => {
        // New accounts start as PENDING and do not receive a session until an admin approves them.
        await api.post('/api/auth/register', input);
      },
      logout: async () => {
        await api.post('/api/auth/logout').catch(() => undefined);
        queryClient.clear();
        setAuthToken(null);
        setUser(null);
      },
    }),
    [user, loading, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'حدث خطأ غير متوقع';
}
