import { createContext, useContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '';
const AUTH_BYPASS = (import.meta as any).env?.VITE_AUTH_BYPASS === 'true';
const LOCAL_BYPASS_USER: User = { githubId: 0, login: 'local-dev', avatarUrl: '' };

export interface User {
  githubId: number;
  login: string;
  avatarUrl: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

function cleanAuthCallbackUrl(): void {
  if (typeof window === 'undefined') return;
  const pathname = window.location.pathname;
  const isAuthCallbackPath = pathname === '/auth/callback';
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token') && !isAuthCallbackPath) return;
  if (isAuthCallbackPath) {
    window.history.replaceState({}, document.title, '/');
    return;
  }
  url.searchParams.delete('token');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, next || '/');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (AUTH_BYPASS) {
      setToken('local-bypass');
      setUser(LOCAL_BYPASS_USER);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const bootstrapAuth = async () => {
      try {
        const url = new URL(window.location.href);
        const tokenFromQuery = url.searchParams.get('token');
        if (tokenFromQuery) {
          localStorage.setItem('auth_token', tokenFromQuery);
        }

        cleanAuthCallbackUrl();

        const storedToken = getStoredToken();
        if (!storedToken) {
          if (!cancelled) {
            setToken(null);
            setUser(null);
            setIsLoading(false);
          }
          return;
        }

        const me = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        });

        if (!me.ok) {
          localStorage.removeItem('auth_token');
          if (!cancelled) {
            setToken(null);
            setUser(null);
            setIsLoading(false);
          }
          return;
        }

        const profile = await me.json() as User;
        if (!cancelled) {
          setToken(storedToken);
          setUser(profile);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[Auth] bootstrap failed:', err);
        localStorage.removeItem('auth_token');
        if (!cancelled) {
          setToken(null);
          setUser(null);
          setIsLoading(false);
        }
      }
    };

    bootstrapAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => {
    if (AUTH_BYPASS) {
      setToken('local-bypass');
      setUser(LOCAL_BYPASS_USER);
      setIsLoading(false);
      return;
    }
    window.location.href = `${API_BASE}/api/auth/github`;
  }, []);

  const logout = useCallback(() => {
    if (AUTH_BYPASS) {
      setToken('local-bypass');
      setUser(LOCAL_BYPASS_USER);
      return;
    }
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    user,
    token,
    isAuthenticated: !!user && !!token,
    isLoading,
    login,
    logout,
  }), [user, token, isLoading, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
