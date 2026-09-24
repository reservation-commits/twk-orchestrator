'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Loader2, Camera, CheckCircle2, AlertTriangle, Languages, Globe2, RefreshCw, TrendingUp } from 'lucide-react';

interface Check { check: string; value: number; of: number; weight: number; ideal: 'high' | 'low'; }
interface Audit { published: number; score: number; checks: Check[]; expansion: Check[]; notes: string[]; }
interface Covers { published: number; missing: number; coverage: number; byCountry: { country: string; missing: number; partners: number }[]; }
interface TrendPoint { captured_at: string; seo_score: number; covers_coverage: number; }

const pct = (v: number, of: number) => (of ? Math.round((v / of) * 100) : 0);
const barColor = (p: number) => (p >= 95 ? 'bg-emerald-400' : p >= 80 ? 'bg-gold' : p >= 50 ? 'bg-amber-400' : 'bg-red-400');

export default function SeoDashboard({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [data, setData] = useState<{ audit: Audit; covers: Covers; trend?: TrendPoint[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setErr(null);
    fetch('/api/seo').then((r) => r.json()).then((d) => { if (d.error) setErr(d.error); else setData(d); }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const score = data?.audit.score ?? 0;
  const R = 52, C = 2 * Math.PI * R;

  return (
    <div className="h-full overflow-y-auto no-scrollbar">
      <div className="max-w-[1100px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-10 h-10 rounded-lg bg-gold/15 flex items-center justify-center flex-shrink-0">
            <Search className="w-5 h-5 text-gold" />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.22em] text-white/30">Inteligência</p>
            <h2 className="font-cormorant text-3xl text-white leading-tight">SEO &amp; Busca Orgânica</h2>
          </div>
          <button onClick={load} className="ml-auto flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 text-white/50 hover:text-white/80 hover:border-gold/30 text-xs transition">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>

        {loading && !data && <div className="flex items-center justify-center h-64 text-gold/60"><Loader2 className="w-6 h-6 animate-spin" /></div>}
        {err && <div className="p-4 rounded-lg bg-red-400/10 border border-red-400/25 text-red-200 text-sm">{err}</div>}

        {data && (
          <div className="space-y-5">
            {/* Score + core checks */}
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
              {/* Score ring */}
              <div className="rounded-2xl bg-white/[0.03] border border-gold/10 p-6 flex flex-col items-center justify-center">
                <svg width="140" height="140" viewBox="0 0 140 140">
                  <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
                  <motion.circle cx="70" cy="70" r={R} fill="none" stroke="#c9a96e" strokeWidth="10" strokeLinecap="round"
                    transform="rotate(-90 70 70)" strokeDasharray={C}
                    initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - score / 100) }} transition={{ duration: 1, ease: 'easeOut' }} />
                  <text x="70" y="66" textAnchor="middle" className="fill-white" style={{ fontFamily: 'var(--font-cormorant, serif)', fontSize: 34 }}>{score}</text>
                  <text x="70" y="88" textAnchor="middle" className="fill-white/40" style={{ fontSize: 11 }}>/ 100 core</text>
                </svg>
                <p className="text-xs text-white/40 mt-2 text-center">Saúde de SEO das páginas (inglês = idioma padrão)</p>
              </div>

              {/* Core checks */}
              <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-3">Fatores core ({data.audit.published.toLocaleString()} publicados)</p>
                <div className="space-y-2.5">
                  {data.audit.checks.map((c) => {
                    const p = pct(c.value, c.of);
                    return (
                      <div key={c.check} className="flex items-center gap-3">
                        <span className="text-xs text-white/70 w-52 flex-shrink-0 truncate">{c.check}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <motion.div className={`h-full rounded-full ${barColor(p)}`} initial={{ width: 0 }} animate={{ width: `${p}%` }} transition={{ duration: 0.7 }} />
                        </div>
                        <span className={`text-xs font-mono w-10 text-right ${p >= 95 ? 'text-emerald-300' : p >= 50 ? 'text-white/60' : 'text-amber-300'}`}>{p}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Trend over time (persisted daily snapshots) */}
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-gold" />
                <p className="text-sm font-semibold text-white/80">Evolução da nota</p>
                <span className="ml-auto text-xs text-white/30">{data.trend?.length ? `${data.trend.length} snapshot(s)` : 'sem histórico ainda'}</span>
              </div>
              {data.trend && data.trend.length >= 2 ? (() => {
                const pts = data.trend;
                const W = 640, H = 90, pad = 8;
                const xs = (i: number) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
                const ys = (v: number) => H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - 2 * pad);
                const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.seo_score).toFixed(1)}`).join(' ');
                return (
                  <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ height: 90 }} role="img" aria-label="Linha da nota de SEO ao longo do tempo">
                    <path d={line} fill="none" stroke="#c9a96e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    {pts.map((p, i) => <circle key={i} cx={xs(i)} cy={ys(p.seo_score)} r="2.5" fill="#c9a96e" />)}
                  </svg>
                );
              })() : (
                <p className="text-xs text-white/40 py-4 text-center">O snapshot diário (cron <code className="font-mono text-white/60">/api/cron/snapshot</code>) começa a preencher a evolução. Nota atual: <span className="text-gold">{data.audit.score}/100</span>.</p>
              )}
            </div>

            {/* Wins + translations */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="rounded-2xl bg-emerald-400/[0.06] border border-emerald-400/20 p-5">
                <div className="flex items-center gap-2 text-emerald-300 mb-1"><CheckCircle2 className="w-4 h-4" /><span className="text-sm font-semibold">Structured data aplicado</span></div>
                <p className="text-xs text-white/50 leading-relaxed">JSON-LD schema.org rico (11 campos) gerado para os publicados. Falta só o frontend renderizar <code className="font-mono text-white/70">structured_data_json</code> para habilitar rich results no Google.</p>
              </div>
              <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
                <div className="flex items-center gap-2 text-white/60 mb-2"><Languages className="w-4 h-4" /><span className="text-sm font-semibold">Conteúdo multilíngue (expansão · fase 2)</span></div>
                <div className="space-y-1.5">
                  {data.audit.expansion.map((c) => (
                    <div key={c.check} className="flex items-center justify-between text-xs">
                      <span className="text-white/50">{c.check.replace(' (expansão)', '')}</span>
                      <span className="text-white/40 font-mono">{pct(c.value, c.of)}%</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-white/30 mt-2">Adiado: inglês é o padrão e já captura a busca global. Reativar após hreflang no frontend.</p>
              </div>
            </div>

            {/* Missing covers */}
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
              <div className="flex items-center gap-3 mb-3">
                <Globe2 className="w-4 h-4 text-amber-300" />
                <div>
                  <p className="text-sm font-semibold text-white/80">Lacuna de capa (hero / og:image)</p>
                  <p className="text-xs text-white/40">{data.covers.missing.toLocaleString()} publicados sem capa · cobertura {data.covers.coverage}%</p>
                </div>
                <button onClick={() => onNavigate?.('photos')} className="ml-auto flex items-center gap-2 px-3 py-2 rounded-lg bg-gold text-black text-xs font-semibold hover:bg-gold/90 transition">
                  <Camera className="w-3.5 h-3.5" /> Abrir Photo Studio
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {data.covers.byCountry.map((c) => (
                  <div key={c.country} className="rounded-lg bg-black/20 border border-white/5 p-2.5">
                    <p className="text-xs text-white/70 truncate">{c.country}</p>
                    <p className="text-lg font-cormorant text-amber-300 leading-none mt-1">{c.missing}</p>
                    <p className="text-[10px] text-white/30 mt-0.5">{c.partners} parceiro(s)</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            {data.audit.notes.length > 0 && (
              <div className="rounded-2xl bg-amber-400/[0.05] border border-amber-400/15 p-4 space-y-1.5">
                {data.audit.notes.map((n, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-100/70"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{n}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
