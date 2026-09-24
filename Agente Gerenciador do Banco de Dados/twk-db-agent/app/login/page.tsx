'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Falha no login');
        return;
      }
      window.location.href = '/';
    } catch {
      setError('Erro de rede. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-twk-bg relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 30%, rgba(201,169,110,0.08), transparent)',
        }}
      />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm mx-4 p-8 rounded-2xl border border-gold/20 bg-black/40 backdrop-blur-xl"
      >
        <h1 className="text-2xl text-gold font-serif mb-1">TWK DB Architect</h1>
        <p className="text-sm text-white/50 mb-6">Central de comando protegida</p>
        <label htmlFor="password" className="block text-xs uppercase tracking-wider text-white/60 mb-2">
          Senha de acesso
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 rounded-lg bg-white/[0.04] border border-white/10 text-white focus:border-gold/60 focus:ring-2 focus:ring-gold/30 outline-none transition"
          placeholder="••••••••"
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading || !password}
          className="mt-6 w-full py-3 rounded-lg bg-gold/90 hover:bg-gold text-black font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
