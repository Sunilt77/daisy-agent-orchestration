import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../utils/auth';

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [orgName, setOrgName] = useState('My Org');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      const email = String(form.get('email') || '').trim();
      const password = String(form.get('password') || '');
      const org = String(form.get('org_name') || orgName).trim();
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const body = mode === 'login'
        ? { email, password }
        : { org_name: org || 'My Org', email, password };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      await refresh();
      const search = new URLSearchParams(location.search);
      const next = search.get('next');
      const safeNext = next && next.startsWith('/') ? next : '/';
      navigate(safeNext, { replace: true });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">AgentOrch Platform</h1>
          <p className="text-slate-500 mt-1">Sign in to manage projects and traces.</p>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border ${mode === 'login' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200'}`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border ${mode === 'signup' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200'}`}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">Org Name</label>
              <input
                name="org_name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="Acme, Inc."
                autoComplete="organization"
              />
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              name="email"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              name="password"
              type="password"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="At least 8 characters"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {busy ? 'Working…' : mode === 'login' ? 'Login' : 'Create Account'}
          </button>
        </form>

        <p className="mt-4 text-xs text-slate-500">
          Dev note: set `DATABASE_URL` + run `docker compose up -d` + `npm run prisma:migrate`.
        </p>
      </div>
    </div>
  );
}
