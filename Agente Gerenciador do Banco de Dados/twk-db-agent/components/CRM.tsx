'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutGrid, Store, CalendarClock, Search, Globe2, Mail, MapPin,
  X, ChevronLeft, ChevronRight, ArrowUpDown, ExternalLink, Phone,
  Star, Clock, Tag, RefreshCw, CheckCircle2, XCircle, Filter, Crown,
  Users, ShieldCheck, Calendar,
} from 'lucide-react';
import LiveMetricCard from './command-center/LiveMetricCard';
import toast from 'react-hot-toast';

// ── types ──────────────────────────────────────────────────────────────────
type KV = { k: string; v: number };
interface Overview {
  kpis: Record<string, number>;
  status: KV[]; price: KV[];
  topCountries: { k: string; v: number; pub: number }[];
  reservations: { total: number; by_status: KV[] };
  recentActivity: number;
}
interface ReportsData {
  customerKpis: { total: number; verified: number; with_phone: number; new_30d: number; deactivated: number; from_wp: number };
  growth: { month: string; customers: number; reservations: number }[];
  topRestaurants: { name: string; city: string; n: number }[];
  stages: { stage: string; n: number }[];
}
interface Customer {
  id: string; name: string | null; email: string; phone: string | null;
  verified: boolean; createdAt: string; deactivated: boolean; from_wp: boolean;
  reservations: number; last_booking: string | null;
}
interface Row {
  restaurant_id: string; name: string; city: string; country: string;
  email_for_reservations: string | null; telephone_of_the_establishment: string | null;
  site_url: string | null; price_range_id: number | null; published: boolean;
  operational_status: string | null; confidence_level: string | null; partner: boolean;
  restaurant_category: string | null; establishment_type: string | null;
  latitude: number | null; longitude: number | null;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20',
  closed_permanently: 'text-red-300 bg-red-400/10 border-red-400/20',
  temporarily_closed: 'text-amber-300 bg-amber-400/10 border-amber-400/20',
  unknown: 'text-white/40 bg-white/5 border-white/10',
};
const priceSymbol = (id: number | null) => (id ? '$'.repeat(id) : '—');
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// ── small visual primitives ─────────────────────────────────────────────────
function Panel({ title, icon: Icon, children, className = '' }: { title: string; icon: typeof Globe2; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-gold/10 bg-black/30 backdrop-blur p-5 ${className}`}>
      <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40 mb-4">
        <Icon className="w-3.5 h-3.5 text-gold/70" /> {title}
      </p>
      {children}
    </div>
  );
}

function BarList({ data, max, accent = '#c9a96e' }: { data: { label: string; value: number; sub?: number }[]; max?: number; accent?: string }) {
  const top = max ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label} className="group">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-white/60 truncate max-w-[70%]">{d.label}</span>
            <span className="text-white/40 tabular-nums">{d.value.toLocaleString('pt-BR')}{d.sub != null ? ` · ${d.sub} pub` : ''}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${(d.value / top) * 100}%` }} transition={{ duration: 0.6, ease: 'easeOut' }}
              className="h-full rounded-full" style={{ background: accent }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Donut({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let acc = 0;
  const R = 54, C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-5">
      <svg width="130" height="130" viewBox="0 0 130 130" className="-rotate-90">
        {data.map((d) => {
          const frac = d.value / total;
          const dash = frac * C;
          const seg = <circle key={d.label} cx="65" cy="65" r={R} fill="none" stroke={d.color} strokeWidth="14"
            strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} />;
          acc += dash;
          return seg;
        })}
        <circle cx="65" cy="65" r={R - 12} fill="#0a0a0f" />
      </svg>
      <div className="space-y-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
            <span className="text-white/60 capitalize">{d.label.replace(/_/g, ' ')}</span>
            <span className="text-white/40 tabular-nums ml-auto">{d.value.toLocaleString('pt-BR')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ s }: { s: string | null }) {
  const key = s ?? 'unknown';
  return <span className={`text-[10px] px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLE[key] ?? STATUS_STYLE.unknown}`}>{key.replace(/_/g, ' ')}</span>;
}

// ── detail drawer (360°) ─────────────────────────────────────────────────────
function Drawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ record: Record<string, unknown>; related: Record<string, unknown> } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/crm?action=restaurant&id=${encodeURIComponent(id)}`).then((r) => r.json()).then(setData);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const r = data?.record as Record<string, unknown> | undefined;
  const rel = data?.related as Record<string, unknown> | undefined;

  const save = async (column: string, value: unknown) => {
    setSaving(column);
    try {
      const res = await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_field', id, column, value }) });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(`${column} atualizado`); onChanged(); load();
    } catch (e) { toast.error(String(e)); } finally { setSaving(null); }
  };

  const Field = ({ label, column, value, type = 'text' }: { label: string; column: string; value: unknown; type?: string }) => {
    const [v, setV] = useState(value == null ? '' : String(value));
    useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
    return (
      <div>
        <label className="text-[10px] uppercase tracking-wider text-white/30">{label}</label>
        <div className="flex items-center gap-2 mt-1">
          <input value={v} onChange={(e) => setV(e.target.value)} type={type}
            onBlur={() => { if (v !== (value == null ? '' : String(value))) save(column, v === '' ? null : v); }}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/80 focus:border-gold/40 focus:outline-none transition-colors" />
          {saving === column && <RefreshCw className="w-3.5 h-3.5 text-gold animate-spin" />}
        </div>
      </div>
    );
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }} transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="relative w-[460px] max-w-[92vw] h-full bg-[#0c0c12] border-l border-gold/15 overflow-y-auto no-scrollbar">
        {!r ? (
          <div className="flex items-center justify-center h-full"><div className="w-7 h-7 border-2 border-gold/20 border-t-gold rounded-full animate-spin" /></div>
        ) : (
          <div className="p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-cormorant text-2xl text-white leading-tight">{String(r.name ?? '')}</p>
                <p className="text-sm text-white/40 flex items-center gap-1.5 mt-1"><MapPin className="w-3.5 h-3.5" />{String(r.city ?? '')}, {String(r.country ?? '')}</p>
              </div>
              <button onClick={onClose} className="text-white/40 hover:text-white p-1"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge s={r.operational_status as string} />
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-gold/20 bg-gold/5 text-gold">{priceSymbol(r.price_range_id as number)}</span>
              {r.partner ? <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 text-emerald-300 flex items-center gap-1"><Crown className="w-3 h-3" />Parceiro</span> : null}
              <button onClick={() => save('published', !(r.published))}
                className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${r.published ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-white/15 bg-white/5 text-white/50'}`}>
                {r.published ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}{r.published ? 'Publicado' : 'Não publicado'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <Field label="Email de reserva" column="email_for_reservations" value={r.email_for_reservations} type="email" />
              <Field label="Telefone" column="telephone_of_the_establishment" value={r.telephone_of_the_establishment} />
              <Field label="Site" column="site_url" value={r.site_url} />
              <Field label="Endereço" column="address_of_establishment" value={r.address_of_establishment} />
              <Field label="Comissão / pessoa" column="commission_per_person" value={r.commission_per_person} />
            </div>

            {Boolean(r.about_text) && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Descrição</p>
                <p className="text-sm text-white/60 leading-relaxed">{String(r.about_text)}</p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              {[['Categorias', rel?.categories], ['Tipos', rel?.types], ['Prêmios', rel?.awards]].map(([lbl, arr]) => (
                <div key={lbl as string} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
                  <p className="text-xl font-cormorant text-gold">{Array.isArray(arr) ? arr.length : 0}</p>
                  <p className="text-[10px] text-white/40">{lbl as string}</p>
                </div>
              ))}
            </div>

            {Array.isArray(rel?.categories) && (rel!.categories as { name: string }[]).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(rel!.categories as { name: string }[]).map((c, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 text-white/60 border border-white/10 flex items-center gap-1"><Tag className="w-2.5 h-2.5" />{c.name}</span>
                ))}
              </div>
            )}

            {Array.isArray(rel?.hours) && (rel!.hours as { weekday: number; open_time: string; close_time: string }[]).length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-2 flex items-center gap-1"><Clock className="w-3 h-3" />Horários</p>
                <div className="space-y-1">
                  {(rel!.hours as { weekday: number; open_time: string; close_time: string }[]).slice(0, 14).map((h, i) => (
                    <div key={i} className="flex justify-between text-xs text-white/50">
                      <span>{WEEKDAYS[h.weekday] ?? h.weekday}</span>
                      <span className="tabular-nums">{String(h.open_time).slice(0, 5)}–{String(h.close_time).slice(0, 5)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-white/30 pt-3 border-t border-white/5">
              <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" />{Number(rel?.reservations_count ?? 0)} reservas</span>
              <span className="font-mono">{String(r.restaurant_id)}</span>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── main CRM ─────────────────────────────────────────────────────────────────
export default function CRM() {
  const [tab, setTab] = useState<'overview' | 'map' | 'restaurants' | 'customers' | 'reservations'>('overview');
  return (
    <div className="h-full overflow-y-auto no-scrollbar">
      <div className="px-7 py-5 border-b border-white/5 bg-gradient-to-b from-black/40 to-black/10 backdrop-blur sticky top-0 z-20 flex items-center gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-gold/50 mb-1">The World Keys</p>
          <h1 className="font-cormorant text-3xl text-white leading-none flex items-center gap-2.5"><LayoutGrid className="w-6 h-6 text-gold" />Customer Relationship</h1>
        </div>
        <div className="ml-auto flex items-center gap-1 bg-white/5 rounded-xl p-1 border border-white/5">
          {([['overview', 'Visão Geral', LayoutGrid], ['map', 'Mapa', Globe2], ['restaurants', 'Restaurantes', Store], ['customers', 'Clientes', Users], ['reservations', 'Reservas', CalendarClock]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs transition-all ${tab === id ? 'bg-gold/15 text-gold shadow-[0_0_0_1px_rgba(201,169,110,0.2)]' : 'text-white/40 hover:text-white/70'}`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 max-w-[1400px] mx-auto">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'map' && <MapTab />}
        {tab === 'restaurants' && <RestaurantsTab />}
        {tab === 'customers' && <CustomersTab />}
        {tab === 'reservations' && <ReservationsTab />}
      </div>
    </div>
  );
}

// ── professional area chart (SVG, smooth, gradient) ──────────────────────────
function AreaChart({ data, color = '#c9a96e', label }: { data: { x: string; y: number }[]; color?: string; label?: string }) {
  const w = 520, h = 150, pad = 8;
  const max = Math.max(...data.map((d) => d.y), 1);
  const stepX = (w - pad * 2) / Math.max(data.length - 1, 1);
  const px = (i: number) => pad + i * stepX;
  const py = (v: number) => h - pad - (v / max) * (h - pad * 2 - 14);
  const pts = data.map((d, i) => [px(i), py(d.y)] as const);
  const line = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const area = `${line} L${px(data.length - 1)},${h - pad} L${px(0)},${h - pad} Z`;
  const gid = `ag-${color.replace('#', '')}`;
  const last = data[data.length - 1];
  return (
    <div>
      {label && <p className="text-xs text-white/50 mb-2">{label} · <span className="text-white font-medium tabular-nums">{last?.y.toLocaleString('pt-BR')}</span> <span className="text-white/30">no mês</span></p>}
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 150 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={pad} x2={w - pad} y1={h - pad - g * (h - pad * 2 - 14)} y2={h - pad - g * (h - pad * 2 - 14)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />)}
        <path d={area} fill={`url(#${gid})`} />
        <motion.path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: 'easeOut' }} />
        {last && <circle cx={px(data.length - 1)} cy={py(last.y)} r="3.5" fill={color} />}
      </svg>
      <div className="flex justify-between text-[9px] text-white/25 mt-1 px-1">
        {data.filter((_, i) => i % 2 === 0).map((d) => <span key={d.x}>{d.x.slice(5)}</span>)}
      </div>
    </div>
  );
}

// ── cockpit instruments ──────────────────────────────────────────────────────
function gPolar(cx: number, cy: number, r: number, angle: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}
function gArc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p0 = gPolar(cx, cy, r, a0), p1 = gPolar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

function Gauge({ value, label, sub, color = '#c9a96e', unit = '%' }: { value: number; label: string; sub?: string; color?: string; unit?: string }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const SWEEP = 270, START = -135, cx = 60, cy = 58, r = 44;
  const valEnd = START + (SWEEP * v) / 100;
  const ticks = Array.from({ length: 9 }, (_, i) => START + (SWEEP / 8) * i);
  const needle = gPolar(cx, cy, r - 10, valEnd);
  return (
    <div className="relative rounded-2xl border border-gold/10 bg-black/40 pt-2 pb-3 flex flex-col items-center" style={{ boxShadow: 'inset 0 0 26px rgba(0,0,0,0.55)' }}>
      <svg viewBox="0 0 120 96" className="w-full" style={{ maxHeight: 116 }}>
        {ticks.map((a, i) => { const o = gPolar(cx, cy, r + 3, a), inr = gPolar(cx, cy, r - 3, a); return <line key={i} x1={o.x} y1={o.y} x2={inr.x} y2={inr.y} stroke="rgba(255,255,255,0.18)" strokeWidth={i % 2 === 0 ? 1.4 : 0.7} />; })}
        <path d={gArc(cx, cy, r, START, START + SWEEP)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" strokeLinecap="round" />
        <motion.path d={gArc(cx, cy, r, START, valEnd)} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: 'easeOut' }} style={{ filter: `drop-shadow(0 0 4px ${color}66)` }} />
        <motion.line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={color} strokeWidth="1.6" strokeLinecap="round" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.85 }} />
        <circle cx={cx} cy={cy} r="3" fill={color} />
        <text x={cx} y={cy + 1} textAnchor="middle" className="font-cormorant" fill="#fff" fontSize="23" fontWeight="500">{Math.round(v)}<tspan fontSize="11" fill="rgba(255,255,255,0.4)">{unit}</tspan></text>
      </svg>
      <p className="text-[10px] uppercase tracking-[0.15em] text-white/45 -mt-0.5 text-center px-1">{label}</p>
      {sub && <p className="text-[9px] text-white/25 tabular-nums font-mono">{sub}</p>}
    </div>
  );
}

function Mfd({ title, code, children, className = '' }: { title: string; code?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative rounded-2xl border border-gold/15 bg-black/50 overflow-hidden ${className}`} style={{ boxShadow: 'inset 0 0 40px rgba(0,0,0,0.6)' }}>
      {['top-1.5 left-1.5 border-t border-l', 'top-1.5 right-1.5 border-t border-r', 'bottom-1.5 left-1.5 border-b border-l', 'bottom-1.5 right-1.5 border-b border-r'].map((c, i) => <span key={i} className={`absolute w-2.5 h-2.5 border-gold/30 ${c} pointer-events-none`} />)}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02]">
        <span className="text-[10px] uppercase tracking-[0.2em] text-gold/60">{title}</span>
        <span className="text-[9px] font-mono text-white/25">{code ?? '◇'}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function DataBar({ items }: { items: { label: string; value: string | number; color?: string }[] }) {
  return (
    <div className="flex items-stretch gap-px rounded-xl overflow-hidden border border-white/10 bg-black/50">
      {items.map((it, i) => (
        <div key={i} className="flex-1 px-3.5 py-2.5 bg-white/[0.02]">
          <p className="text-[9px] uppercase tracking-[0.15em] text-white/30">{it.label}</p>
          <p className="text-base tabular-nums font-mono mt-0.5" style={{ color: it.color ?? '#fff' }}>{typeof it.value === 'number' ? it.value.toLocaleString('pt-BR') : it.value}</p>
        </div>
      ))}
    </div>
  );
}

function Annunciator({ items }: { items: { label: string; value: number; color: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: it.color, boxShadow: `0 0 7px ${it.color}` }} />
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-wide text-white/40 truncate capitalize">{it.label.replace(/_/g, ' ')}</p>
            <p className="text-sm tabular-nums text-white/80 font-mono">{it.value.toLocaleString('pt-BR')}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── overview ─────────────────────────────────────────────────────────────────
function OverviewTab() {
  const [d, setD] = useState<Overview | null>(null);
  const [rep, setRep] = useState<ReportsData | null>(null);
  useEffect(() => {
    fetch('/api/crm?action=overview').then((r) => r.json()).then(setD);
    fetch('/api/crm?action=reports').then((r) => r.json()).then(setRep);
  }, []);
  if (!d) return <Skeleton />;
  const k = d.kpis;
  const pubRate = k.total ? Math.round((k.published / k.total) * 100) : 0;
  const emailRate = k.total ? Math.round((k.with_email / k.total) * 100) : 0;
  const compAvg = k.total ? Math.round(((k.with_phone + k.with_site + k.with_geo + k.with_about) / (4 * k.total)) * 100) : 0;
  const activeCount = d.status.find((s) => s.k === 'active')?.v ?? 0;
  const activeRate = k.total ? Math.round((activeCount / k.total) * 100) : 0;
  const verifiedRate = rep && rep.customerKpis.total ? Math.round((rep.customerKpis.verified / rep.customerKpis.total) * 100) : 0;
  const resvTotal = d.reservations.total || 1;
  const won = d.reservations.by_status.filter((s) => s.k === 'Accept' || s.k === 'Paid').reduce((a, s) => a + s.v, 0);
  const conversion = Math.round((won / resvTotal) * 100);
  const stageColors = ['#c9a96e', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#f87171', '#6b7280'];
  const statusColors: Record<string, string> = { active: '#34d399', closed_permanently: '#f87171', temporarily_closed: '#fbbf24', unknown: '#9ca3af' };
  const annun = d.status.map((s) => ({ label: s.k, value: s.v, color: statusColors[s.k] ?? '#9ca3af' }));

  return (
    <div className="space-y-5">
      <DataBar items={[
        { label: 'Restaurantes', value: k.total, color: '#c9a96e' },
        { label: 'Publicados', value: k.published, color: '#34d399' },
        { label: 'Clientes', value: rep?.customerKpis.total ?? 0, color: '#60a5fa' },
        { label: 'Reservas', value: d.reservations.total, color: '#fbbf24' },
        { label: 'Países', value: k.countries, color: '#ffffff' },
        { label: 'Parceiros', value: k.partners, color: '#c9a96e' },
      ]} />

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Gauge value={pubRate} label="Publicação" sub={`${k.published.toLocaleString('pt-BR')}/${k.total.toLocaleString('pt-BR')}`} color="#34d399" />
        <Gauge value={emailRate} label="Cobertura email" sub={`${k.with_email.toLocaleString('pt-BR')} ok`} color="#60a5fa" />
        <Gauge value={compAvg} label="Completude" sub="contato+geo+desc" color="#c9a96e" />
        <Gauge value={activeRate} label="Operacional" sub={`${activeCount.toLocaleString('pt-BR')} ativos`} color="#c9a96e" />
        <Gauge value={verifiedRate} label="Clientes verif." sub={rep ? `${rep.customerKpis.verified.toLocaleString('pt-BR')} verif.` : '—'} color="#34d399" />
        <Gauge value={conversion} label="Conversão" sub={`${won.toLocaleString('pt-BR')} aceitas`} color="#fbbf24" />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <span className="text-[10px] uppercase tracking-[0.25em] text-gold/50">Telemetria · 12 meses</span>
        <div className="flex-1 h-px bg-gradient-to-r from-gold/20 to-transparent" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Mfd title="Aquisição de clientes" code="ACQ/MO">{rep ? <AreaChart data={rep.growth.map((g) => ({ x: g.month, y: g.customers }))} color="#c9a96e" /> : <ChartSkeleton />}</Mfd>
        <Mfd title="Volume de reservas" code="RSV/MO">{rep ? <AreaChart data={rep.growth.map((g) => ({ x: g.month, y: g.reservations }))} color="#60a5fa" /> : <ChartSkeleton />}</Mfd>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <span className="text-[10px] uppercase tracking-[0.25em] text-gold/50">Instrumentos secundários</span>
        <div className="flex-1 h-px bg-gradient-to-r from-gold/20 to-transparent" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Mfd title="Status operacional" code="STAT"><Annunciator items={annun} /></Mfd>
        <Mfd title="Top países" code="GEO" className="lg:col-span-2"><BarList data={d.topCountries.map((c) => ({ label: c.k, value: c.v, sub: c.pub }))} /></Mfd>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Mfd title="Top restaurantes" code="RANK" className="lg:col-span-2">{rep ? <BarList data={rep.topRestaurants.map((t) => ({ label: `${t.name} · ${t.city}`, value: t.n }))} accent="#c9a96e" /> : <ChartSkeleton />}</Mfd>
        <Mfd title="Estágio do cliente" code="STAGE">{rep ? <Donut data={rep.stages.slice(0, 6).map((s, i) => ({ label: s.stage, value: s.n, color: stageColors[i % stageColors.length] }))} /> : <ChartSkeleton />}</Mfd>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Mfd title="Reservas por status" code="BKG"><BarList data={d.reservations.by_status.map((s) => ({ label: s.k, value: s.v }))} accent="#60a5fa" /></Mfd>
        <Mfd title="Faixa de preço" code="TIER"><BarList data={d.price.map((p) => ({ label: p.k, value: p.v }))} accent="#fbbf24" /></Mfd>
      </div>
    </div>
  );
}

// ── restaurants table ────────────────────────────────────────────────────────
function RestaurantsTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [facets, setFacets] = useState<{ countries: { v: string; n: number }[]; statuses: { v: string }[]; prices: { v: number; label: string }[] }>({ countries: [], statuses: [], prices: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const limit = 25;
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { fetch('/api/crm?action=facets').then((r) => r.json()).then(setFacets); }, []);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ action: 'restaurants', page: String(page), limit: String(limit), sort, dir });
    if (search) p.set('search', search);
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    fetch(`/api/crm?${p}`).then((r) => r.json()).then((d) => { setRows(d.rows ?? []); setTotal(d.total ?? 0); }).finally(() => setLoading(false));
  }, [page, sort, dir, search, filters]);
  useEffect(() => { load(); }, [load]);

  const onSearch = (v: string) => {
    setSearch(v); setPage(1);
  };
  useEffect(() => { if (debounce.current) clearTimeout(debounce.current); debounce.current = setTimeout(load, 280); return () => { if (debounce.current) clearTimeout(debounce.current); }; }, [search]); // eslint-disable-line

  const setF = (k: string, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const toggleSort = (col: string) => { if (sort === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(col); setDir('asc'); } };
  const pages = Math.max(Math.ceil(total / limit), 1);

  const togglePublish = async (row: Row, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch('/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle_publish', id: row.restaurant_id, published: !row.published }) });
    toast.success(row.published ? 'Despublicado' : 'Publicado'); load();
  };

  const Th = ({ col, children }: { col?: string; children: React.ReactNode }) => (
    <th className="text-left px-3 py-2 font-medium text-white/40 select-none">
      {col ? <button onClick={() => toggleSort(col)} className="flex items-center gap-1 hover:text-white/70">{children}<ArrowUpDown className={`w-3 h-3 ${sort === col ? 'text-gold' : 'opacity-30'}`} /></button> : children}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Buscar nome, cidade, país, email…"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white/80 focus:border-gold/40 focus:outline-none" />
        </div>
        <Select value={filters.country ?? ''} onChange={(v) => setF('country', v)} options={[{ v: '', label: 'Todos países' }, ...facets.countries.map((c) => ({ v: c.v, label: `${c.v} (${c.n})` }))]} />
        <Select value={filters.published ?? ''} onChange={(v) => setF('published', v)} options={[{ v: '', label: 'Publicação' }, { v: 'true', label: 'Publicados' }, { v: 'false', label: 'Não publicados' }]} />
        <Select value={filters.status ?? ''} onChange={(v) => setF('status', v)} options={[{ v: '', label: 'Status' }, ...facets.statuses.map((s) => ({ v: s.v, label: s.v.replace(/_/g, ' ') }))]} />
        <Select value={filters.has_email ?? ''} onChange={(v) => setF('has_email', v)} options={[{ v: '', label: 'Email' }, { v: 'true', label: 'Com email' }, { v: 'false', label: 'Sem email' }]} />
        <span className="text-xs text-white/40 ml-auto tabular-nums">{total.toLocaleString('pt-BR')} resultados</span>
      </div>

      <div className="rounded-2xl border border-gold/10 bg-black/30 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-xs border-b border-white/5">
            <tr><Th col="name">Restaurante</Th><Th col="city">Cidade</Th><Th col="country">País</Th><Th col="price_range_id">Preço</Th><Th col="operational_status">Status</Th><Th>Contato</Th><Th col="published">Publicado</Th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-16"><div className="w-6 h-6 border-2 border-gold/20 border-t-gold rounded-full animate-spin mx-auto" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-16 text-white/30 text-sm">Nenhum restaurante encontrado</td></tr>
            ) : rows.map((row) => (
              <tr key={row.restaurant_id} onClick={() => setSelected(row.restaurant_id)}
                className="border-b border-white/[0.03] hover:bg-gold/[0.04] cursor-pointer transition-colors">
                <td className="px-3 py-2.5">
                  <p className="text-white/85 font-medium truncate max-w-[220px]">{row.name}</p>
                  {row.restaurant_category && <p className="text-[10px] text-white/30 truncate max-w-[220px]">{row.restaurant_category.split(',')[0]}</p>}
                </td>
                <td className="px-3 py-2.5 text-white/50">{row.city}</td>
                <td className="px-3 py-2.5 text-white/50">{row.country}</td>
                <td className="px-3 py-2.5 text-gold/80">{priceSymbol(row.price_range_id)}</td>
                <td className="px-3 py-2.5"><StatusBadge s={row.operational_status} /></td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-white/30">
                    <Mail className={`w-3.5 h-3.5 ${row.email_for_reservations ? 'text-emerald-400/70' : 'text-white/15'}`} />
                    <Phone className={`w-3.5 h-3.5 ${row.telephone_of_the_establishment ? 'text-emerald-400/70' : 'text-white/15'}`} />
                    {row.site_url ? <a href={row.site_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-gold/60 hover:text-gold"><ExternalLink className="w-3.5 h-3.5" /></a> : <ExternalLink className="w-3.5 h-3.5 text-white/15" />}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <button onClick={(e) => togglePublish(row, e)} className={`w-9 h-5 rounded-full relative transition-colors ${row.published ? 'bg-emerald-400/30' : 'bg-white/10'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${row.published ? 'left-[18px] bg-emerald-400' : 'left-0.5 bg-white/40'}`} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-white/30">Página {page} de {pages}</p>
        <div className="flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg border border-white/10 disabled:opacity-30 hover:border-gold/30 text-white/60"><ChevronLeft className="w-4 h-4" /></button>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg border border-white/10 disabled:opacity-30 hover:border-gold/30 text-white/60"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      <AnimatePresence>{selected && <Drawer id={selected} onClose={() => setSelected(null)} onChanged={load} />}</AnimatePresence>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white/70 focus:border-gold/40 focus:outline-none cursor-pointer max-w-[170px]">
      {options.map((o) => <option key={o.v} value={o.v} className="bg-[#0c0c12]">{o.label}</option>)}
    </select>
  );
}

// ── customers ────────────────────────────────────────────────────────────────
const BOOKING_COLOR: Record<string, string> = { Pending: '#fbbf24', Accept: '#34d399', Paid: '#34d399', Decline: '#f87171', 'Declined (client)': '#f87171', 'In Treatment': '#60a5fa', 'No-Show': '#9ca3af' };
const initials = (name: string | null, email: string) => {
  const s = (name && name.trim()) || email || '?';
  const parts = s.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || s[0].toUpperCase();
};
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function CustomersTab() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState('createdAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<string | null>(null);
  const limit = 25;
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ action: 'customers', page: String(page), limit: String(limit), sort, dir });
    if (search) p.set('search', search);
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    fetch(`/api/crm?${p}`).then((r) => r.json()).then((d) => { setRows(d.rows ?? []); setTotal(d.total ?? 0); }).finally(() => setLoading(false));
  }, [page, sort, dir, search, filters]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (debounce.current) clearTimeout(debounce.current); debounce.current = setTimeout(() => { setPage(1); load(); }, 280); return () => { if (debounce.current) clearTimeout(debounce.current); }; }, [search]); // eslint-disable-line

  const setF = (k: string, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const toggleSort = (col: string) => { if (sort === col) setDir((x) => (x === 'asc' ? 'desc' : 'asc')); else { setSort(col); setDir('desc'); } };
  const pages = Math.max(Math.ceil(total / limit), 1);

  const Th = ({ col, children, right }: { col?: string; children: React.ReactNode; right?: boolean }) => (
    <th className={`px-3 py-2 font-medium text-white/40 select-none ${right ? 'text-right' : 'text-left'}`}>
      {col ? <button onClick={() => toggleSort(col)} className={`flex items-center gap-1 hover:text-white/70 ${right ? 'ml-auto' : ''}`}>{children}<ArrowUpDown className={`w-3 h-3 ${sort === col ? 'text-gold' : 'opacity-30'}`} /></button> : children}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome, email ou telefone…"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white/80 focus:border-gold/40 focus:outline-none" />
        </div>
        <Select value={filters.verified ?? ''} onChange={(v) => setF('verified', v)} options={[{ v: '', label: 'Verificação' }, { v: 'true', label: 'Verificados' }, { v: 'false', label: 'Não verificados' }]} />
        <Select value={filters.has_phone ?? ''} onChange={(v) => setF('has_phone', v)} options={[{ v: '', label: 'Telefone' }, { v: 'true', label: 'Com telefone' }]} />
        <Select value={filters.source ?? ''} onChange={(v) => setF('source', v)} options={[{ v: '', label: 'Origem' }, { v: 'wp', label: 'WordPress' }, { v: 'native', label: 'Nativo' }]} />
        <Select value={filters.status ?? ''} onChange={(v) => setF('status', v)} options={[{ v: '', label: 'Situação' }, { v: 'active', label: 'Ativos' }, { v: 'deactivated', label: 'Desativados' }]} />
        <span className="text-xs text-white/40 ml-auto tabular-nums">{total.toLocaleString('pt-BR')} clientes</span>
      </div>

      <div className="rounded-2xl border border-gold/10 bg-black/30 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-xs border-b border-white/5">
            <tr><Th col="name">Cliente</Th><Th>Telefone</Th><Th col="reservations" right>Reservas</Th><Th col="last_booking" right>Última reserva</Th><Th col="createdAt" right>Cadastro</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-16"><div className="w-6 h-6 border-2 border-gold/20 border-t-gold rounded-full animate-spin mx-auto" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-16 text-white/30 text-sm">Nenhum cliente encontrado</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id} onClick={() => setSelected(c.id)} className="border-b border-white/[0.03] hover:bg-gold/[0.04] cursor-pointer transition-colors">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-full bg-gradient-to-br from-gold/25 to-amber-700/20 border border-gold/15 flex items-center justify-center text-[11px] font-medium text-gold flex-shrink-0">{initials(c.name, c.email)}</span>
                    <div className="min-w-0">
                      <p className="text-white/85 font-medium truncate max-w-[200px] flex items-center gap-1.5">{c.name || '—'}{c.verified && <ShieldCheck className="w-3 h-3 text-emerald-400/70 flex-shrink-0" />}</p>
                      <p className="text-[10px] text-white/30 truncate max-w-[200px]">{c.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-white/50 tabular-nums">{c.phone || <span className="text-white/15">—</span>}</td>
                <td className="px-3 py-2.5 text-right"><span className={`tabular-nums ${c.reservations > 0 ? 'text-gold' : 'text-white/30'}`}>{c.reservations}</span></td>
                <td className="px-3 py-2.5 text-right text-white/50 text-xs">{fmtDate(c.last_booking)}</td>
                <td className="px-3 py-2.5 text-right text-white/40 text-xs">{fmtDate(c.createdAt)}</td>
                <td className="px-3 py-2.5">
                  {c.deactivated
                    ? <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-400/20 bg-red-400/10 text-red-300">Desativado</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/50">{c.from_wp ? 'WordPress' : 'Nativo'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-white/30">Página {page} de {pages}</p>
        <div className="flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg border border-white/10 disabled:opacity-30 hover:border-gold/30 text-white/60"><ChevronLeft className="w-4 h-4" /></button>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg border border-white/10 disabled:opacity-30 hover:border-gold/30 text-white/60"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      <AnimatePresence>{selected && <CustomerDrawer id={selected} onClose={() => setSelected(null)} />}</AnimatePresence>
    </div>
  );
}

function CustomerDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<{ record: Record<string, unknown>; reservations: Record<string, unknown>[]; stats: { total: number; by_status: { status: string; n: number }[] } } | null>(null);
  useEffect(() => { fetch(`/api/crm?action=customer&id=${encodeURIComponent(id)}`).then((r) => r.json()).then(setData); }, [id]);
  const r = data?.record;

  return (
    <motion.div className="fixed inset-0 z-50 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }} transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="relative w-[460px] max-w-[92vw] h-full bg-[#0c0c12] border-l border-gold/15 overflow-y-auto no-scrollbar">
        {!r ? (
          <div className="flex items-center justify-center h-full"><div className="w-7 h-7 border-2 border-gold/20 border-t-gold rounded-full animate-spin" /></div>
        ) : (
          <div className="p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="w-14 h-14 rounded-full bg-gradient-to-br from-gold/25 to-amber-700/20 border border-gold/15 flex items-center justify-center text-lg font-medium text-gold">{initials(r.name as string, r.email as string)}</span>
                <div>
                  <p className="font-cormorant text-2xl text-white leading-tight flex items-center gap-2">{(r.name as string) || '—'}{Boolean(r.emailVerified) && <ShieldCheck className="w-4 h-4 text-emerald-400" />}</p>
                  <p className="text-sm text-white/40">{r.email as string}</p>
                </div>
              </div>
              <button onClick={onClose} className="text-white/40 hover:text-white p-1"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center"><p className="text-xl font-cormorant text-gold">{data?.stats.total ?? 0}</p><p className="text-[10px] text-white/40">Reservas</p></div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center"><p className="text-xl font-cormorant text-gold">{Boolean(r.emailVerified) ? 'Sim' : 'Não'}</p><p className="text-[10px] text-white/40">Verificado</p></div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center"><p className="text-xl font-cormorant text-gold">{r.wp_id ? 'WP' : 'Nativo'}</p><p className="text-[10px] text-white/40">Origem</p></div>
            </div>

            <div className="grid grid-cols-1 gap-2 text-sm">
              {[[Phone, 'Telefone', r.phone], [Calendar, 'Cadastro', fmtDate(r.createdAt as string)], [Users, 'Função', r.role], [Clock, 'Atualizado', fmtDate(r.updatedAt as string)]].map(([Icon, label, val], i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/[0.03]">
                  <span className="text-white/40 flex items-center gap-2 text-xs">{Icon ? (() => { const C = Icon as typeof Phone; return <C className="w-3.5 h-3.5" />; })() : null}{label as string}</span>
                  <span className="text-white/70 text-xs">{(val as string) || '—'}</span>
                </div>
              ))}
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-2 flex items-center gap-1"><CalendarClock className="w-3 h-3" />Reservas ({data?.stats.total ?? 0})</p>
              <div className="space-y-1 max-h-[320px] overflow-y-auto no-scrollbar">
                {(data?.reservations ?? []).length === 0 ? <p className="text-xs text-white/25 py-4 text-center">Sem reservas</p> : (data?.reservations ?? []).map((rv, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-white/[0.03]">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: BOOKING_COLOR[rv.booking_status as string] ?? '#888' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white/70 truncate">{(rv.restaurant_name as string) ?? rv.restaurant_id as string}</p>
                      <p className="text-[10px] text-white/30">{(rv.city as string) || ''} · {rv.people as number} pax</p>
                    </div>
                    <span className="text-[10px] text-white/40 capitalize">{rv.booking_status as string}</span>
                    <span className="text-[10px] text-white/30 tabular-nums">{fmtDate(rv.booking_date as string)}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-white/20 font-mono pt-2 border-t border-white/5">{r.id as string}</p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── reservations ─────────────────────────────────────────────────────────────
function ReservationsTab() {
  const [d, setD] = useState<{ total: number; byStatus: { status: string; count: number }[]; recent: { restaurant_id: string; booking_status: string; booking_date: string; restaurant_name: string; city: string }[] } | null>(null);
  useEffect(() => { fetch('/api/crm?action=reservations').then((r) => r.json()).then(setD); }, []);
  if (!d) return <Skeleton />;
  const STAT: Record<string, string> = { Pending: '#fbbf24', Accept: '#34d399', Paid: '#34d399', Decline: '#f87171', 'Declined (client)': '#f87171', 'In Treatment': '#60a5fa', 'No-Show': '#888' };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <LiveMetricCard label="Total de reservas" value={d.total} icon={CalendarClock} accent="gold" />
        {d.byStatus.slice(0, 3).map((s) => <LiveMetricCard key={s.status} label={s.status} value={s.count} icon={Star} accent={s.status === 'Pending' ? 'amber' : s.status.startsWith('Decl') ? 'red' : 'emerald'} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Por status" icon={Filter}>
          <BarList data={d.byStatus.map((s) => ({ label: s.status, value: s.count }))} accent="#c9a96e" />
        </Panel>
        <Panel title="Reservas recentes" icon={CalendarClock} className="lg:col-span-2">
          <div className="space-y-1 max-h-[380px] overflow-y-auto no-scrollbar">
            {d.recent.map((r, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-white/[0.03]">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STAT[r.booking_status] ?? '#888' }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white/70 truncate">{r.restaurant_name ?? r.restaurant_id}</p>
                  <p className="text-[10px] text-white/30">{r.city}</p>
                </div>
                <span className="text-[10px] text-white/40 capitalize">{r.booking_status}</span>
                <span className="text-[10px] text-white/30 tabular-nums">{r.booking_date ? new Date(r.booking_date).toLocaleDateString('pt-BR') : '—'}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ── global constellation map ────────────────────────────────────────────────
interface MapPoint { name: string; city: string; country: string; lat: number; lng: number; st: string | null; pr: number | null }
const MAP_STATUS_COLOR: Record<string, string> = { active: '#c9a96e', closed_permanently: '#f87171', temporarily_closed: '#fbbf24', unknown: '#6b7280' };

function MapTab() {
  const [data, setData] = useState<{ points: MapPoint[]; total: number; byCountry: { c: string; n: number }[] } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; p: MapPoint } | null>(null);
  useEffect(() => { fetch('/api/crm?action=map').then((r) => r.json()).then(setData); }, []);

  const projected = useMemo(() => {
    if (!data) return [];
    return data.points.map((p) => ({ p, x: ((p.lng + 180) / 360) * 1000, y: ((90 - p.lat) / 180) * 500 }));
  }, [data]);

  if (!data) return <Skeleton />;
  const meridians = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
  const parallels = [-60, -30, 0, 30, 60];
  const regions = [
    { n: 'América do Norte', lng: -100, lat: 45 }, { n: 'América do Sul', lng: -60, lat: -15 },
    { n: 'Europa', lng: 12, lat: 52 }, { n: 'África', lng: 20, lat: 2 },
    { n: 'Ásia', lng: 100, lat: 40 }, { n: 'Oceania', lng: 140, lat: -25 },
  ];
  const proj = (lng: number, lat: number) => [((lng + 180) / 360) * 1000, ((90 - lat) / 180) * 500];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-gold/50">Constelação Global</p>
          <p className="font-cormorant text-2xl text-white">{data.total.toLocaleString('pt-BR')} mesas mapeadas</p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          {Object.entries(MAP_STATUS_COLOR).slice(0, 3).map(([k, c]) => (
            <span key={k} className="flex items-center gap-1.5 text-white/50"><span className="w-2 h-2 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />{k.replace(/_/g, ' ')}</span>
          ))}
        </div>
      </div>

      <div className="relative rounded-2xl border border-gold/15 bg-black/60 overflow-hidden" style={{ aspectRatio: '2 / 1', boxShadow: 'inset 0 0 80px rgba(0,0,0,0.7)' }}>
        <span className="absolute top-2.5 left-3 z-10 text-[9px] font-mono text-gold/40 tracking-widest">TWK · WORLD RADAR · EQUIRECTANGULAR</span>
        <motion.div className="absolute inset-y-0 w-24 pointer-events-none z-0"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(201,169,110,0.07), transparent)' }}
          animate={{ left: ['-10%', '100%'] }} transition={{ repeat: Infinity, duration: 7, ease: 'linear' }} />
        <svg viewBox="0 0 1000 500" preserveAspectRatio="none" className="w-full h-full relative z-[1]">
          <defs>
            <filter id="glowpt" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {meridians.map((m) => { const [x] = proj(m, 0); return <line key={`m${m}`} x1={x} y1="0" x2={x} y2="500" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />; })}
          {parallels.map((pl) => { const [, y] = proj(0, pl); return <line key={`p${pl}`} x1="0" y1={y} x2="1000" y2={y} stroke={pl === 0 ? 'rgba(201,169,110,0.12)' : 'rgba(255,255,255,0.035)'} strokeWidth="1" />; })}
          {regions.map((r) => { const [x, y] = proj(r.lng, r.lat); return <text key={r.n} x={x} y={y} textAnchor="middle" fill="rgba(255,255,255,0.13)" fontSize="13" className="font-cormorant" style={{ letterSpacing: '0.15em' }}>{r.n.toUpperCase()}</text>; })}
          <g filter="url(#glowpt)">
            {projected.map((pt, i) => (
              <circle key={i} cx={pt.x} cy={pt.y} r={pt.p.pr === 4 ? 2.4 : 1.7}
                fill={MAP_STATUS_COLOR[pt.p.st ?? 'unknown'] ?? '#6b7280'} fillOpacity={0.85}
                onMouseEnter={() => setHover({ x: pt.x, y: pt.y, p: pt.p })} onMouseLeave={() => setHover(null)}
                style={{ cursor: 'pointer' }} />
            ))}
          </g>
        </svg>
        {hover && (
          <div className="absolute z-20 pointer-events-none" style={{ left: `${(hover.x / 1000) * 100}%`, top: `${(hover.y / 500) * 100}%`, transform: 'translate(-50%, -130%)' }}>
            <div className="bg-black/90 border border-gold/30 rounded-lg px-2.5 py-1.5 whitespace-nowrap" style={{ boxShadow: '0 0 20px rgba(0,0,0,0.6)' }}>
              <p className="text-xs text-white font-medium">{hover.p.name}</p>
              <p className="text-[10px] text-white/50">{hover.p.city}, {hover.p.country}{hover.p.pr ? ` · ${'$'.repeat(hover.p.pr)}` : ''}</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-gold/10 bg-black/30 p-5">
          <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40 mb-4"><Globe2 className="w-3.5 h-3.5 text-gold/70" /> Distribuição por país</p>
          <BarList data={data.byCountry.map((c) => ({ label: c.c, value: c.n }))} />
        </div>
        <div className="rounded-2xl border border-gold/10 bg-black/30 p-5 flex flex-col justify-center">
          <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Densidade</p>
          <p className="font-cormorant text-4xl text-gold">{data.byCountry[0]?.c ?? '—'}</p>
          <p className="text-sm text-white/50 mt-1">lidera com {data.byCountry[0]?.n.toLocaleString('pt-BR')} mesas publicadas</p>
          <p className="text-[11px] text-white/25 mt-3">{data.total.toLocaleString('pt-BR')} pontos · {data.byCountry.length}+ países ativos</p>
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return <div className="flex items-center justify-center h-64"><div className="w-7 h-7 border-2 border-gold/20 border-t-gold rounded-full animate-spin" /></div>;
}

function ChartSkeleton() {
  return <div className="flex items-center justify-center h-[150px]"><div className="w-5 h-5 border-2 border-gold/20 border-t-gold rounded-full animate-spin" /></div>;
}
