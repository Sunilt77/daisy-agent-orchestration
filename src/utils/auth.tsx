import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type User = { id: string; orgId: string; email: string };

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      console.log('Attempting to fetch auth status from /api/auth/me');
      const res = await fetch('/api/auth/me');
      console.log('Auth response status:', res.status);
      
      if (!res.ok) {
        console.warn('Authentication failed with status:', res.status);
        setUser(null);
        return;
      }
      
      const data = await res.json();
      console.log('Auth data received:', data);
      setUser(data.user ?? null);
    } catch (error) {
      console.error('Authentication error:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
    setUser(null);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ user, loading, refresh, logout }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [redirectAttempts, setRedirectAttempts] = useState(0);

  useEffect(() => {
    console.log('RequireAuth state:', { loading, user: !!user, location: location.pathname });
    
    if (!loading && !user) {
      const next = encodeURIComponent(`${location.pathname}${location.search || ''}`);
      console.log(`Redirecting to auth page with next=${next}, attempt #${redirectAttempts + 1}`);
      
      // Prevent infinite redirect loops
      if (redirectAttempts < 3) {
        setRedirectAttempts(prev => prev + 1);
        navigate(`/auth?next=${next}`, { replace: true });
      } else if (redirectAttempts === 3) {
        setRedirectAttempts(prev => prev + 1);
        console.error('Detected potential redirect loop - stopping redirects');
      }
    } else if (user) {
      // Reset counter when we have a user
      setRedirectAttempts(0);
    }
  }, [loading, user, navigate, location.pathname, location.search, redirectAttempts]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="text-slate-500 mb-4">Loading authentication status...</div>
        <div className="h-8 w-8 mx-auto animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
      </div>
    );
  }
  
  if (!user) {
    if (redirectAttempts >= 3) {
      return (
        <div className="p-8 text-center text-red-600">
          <h2 className="text-xl font-bold mb-4">Authentication Error</h2>
          <p className="mb-4">There was a problem with the authentication process.</p>
          <p className="mb-4">Please try refreshing the page or clearing your cookies.</p>
          <button 
            onClick={() => window.location.href = '/auth'} 
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Go to Login
          </button>
        </div>
      );
    }
    return null;
  }
  
  return <>{children}</>;
}
