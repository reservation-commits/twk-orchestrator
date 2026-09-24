'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, AlertTriangle, AlertCircle, Info, RefreshCw,
  CheckCircle2, XCircle, Copy, ArrowRight, Loader2, BarChart3,
  Users, Link2, Phone, Mail, MapPin, Star, Search, Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Types ────────────────────────────────────────────────────────────────────

interface FieldIssue {
  row_id: unknown; column: string; value: unknown;
  severity: 'critical' | 'warning' | 'info';
  rule: string; message: string; suggested?: string;
}

interface ColumnStats {
  column: string; total: number; nulls: number; blanks: number;
  invalid: number; completeness: number; issues: FieldIssue[];
}

interface AuditReport {
  table: string; scanned_at: string; total_rows: number;
  quality_score: number; critical_count: number;
  warning_count: number; info_count: number;
  columns: ColumnStats[];
  duplicate_groups: { ids: unknown[]; names: string[]; similarity: number }[];
  consistency_issues: { severity: string; rule: string; count: number }[];
}

interface ConsistencyResult {
  checks: { check: string; severity: string; count: number; error: string | null }[];
  total_issues: number;
}

interface CompletenessResult {
  total: number; avg_completeness: number;
  worst: { id: unknown; name: string; score: number }[];
  distribution: { critical: number; poor: number; fair: number; good: number; excellent: number };
}

type Tab = 'overview' | 'columns' | 'duplicates' | 'consistency' | 'completeness' | 'reality' | 'autofix' | 'trends';

interface RealityResults {
  emails?:  { total: number; valid: number; invalid: number; validity_rate: number; issues: Array<{ id: unknown; email: string; status: string; message: string }> };
  phones?:  { total: number; valid: number; invalid: number; validity_rate: number; issues: Array<{ id: unknown; raw: string; e164?: string; message: string }> };
  urls?:    { total: number; reachable: number; broken: number; health_rate: number; issues: Array<{ id: unknown; url: string; status_code?: number; message: string }> };
  places?:  { total: number; fresh: number; stale: number; closed: number; closed_temp: number; results: Array<{ restaurant_id: unknown; name: string; health: string; message: string; diffs: Array<{ field: string; db_value: unknown; places_value: unknown }> }> };
}

interface AutoFixResults {
  total: number;
  by_confidence: { high: number; medium: number; low: number };
  suggestions: Array<{ row_id: unknown; column: string; old_value: unknown; new_value: unknown; reason: string; confidence: 'high' | 'medium' | 'low'; rule: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEV_CONFIG = {
  critical: { color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/20',    Icon: AlertCircle   },
  warning:  { color: 'text-amber-400',  bg: 'bg-amber-400/10',  border: 'border-amber-400/20',  Icon: AlertTriangle },
  info:     { color: 'text-blue-400',   bg: 'bg-blue-400/10',   border: 'border-blue-400/20',   Icon: Info          },
  ok:       { color: 'text-emerald-400',bg: 'bg-emerald-400/10',border: 'border-emerald-400/20',Icon: CheckCircle2  },
};

function ScoreRing({ score }: { score: number }) {
  const c = score >= 85 ? '#34d399' : score >= 65 ? '#c9a96e' : score >= 40 ? '#f59e0b' : '#f87171';
  const r = 36, circ = 2 * Math.PI * r;
  return (
    <svg width="96" height="96" className="-rotate-90">
      <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
      <motion.circle cx="48" cy="48" r={r} fill="none" stroke={c} strokeWidth="8"
        strokeLinecap="round" strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - (circ * score) / 100 }}
        transition={{ duration: 1.2, ease: 'easeOut' }} />
      <text x="48" y="48" textAnchor="middle" dominantBaseline="middle"
        className="rotate-90" style={{ transform: 'rotate(90deg)', transformOrigin: '48px 48px' }}
        fill={c} fontSize="18" fontWeight="700">{score}</text>
    </svg>
  );
}

function SevBadge({ severity }: { severity: string }) {
  const cfg = SEV_CONFIG[severity as keyof typeof SEV_CONFIG] ?? SEV_CONFIG.info;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      <cfg.Icon className="w-2.5 h-2.5" />{severity}
    </span>
  );
}

const COLUMN_ICONS: Record<string, React.ElementType> = {
  email: Mail, phone: Phone, website: Link2, address: MapPin,
  rating: Star, name: Search, slug: Link2,
};

// ── Main component ────────────────────────────────────────────────────────────

export default function DataAuditor() {
  const [tables, setTables] = useState<{ table_schema: string; table_name: string }[]>([]);
  const [selectedTable, setSelectedTable] = useState('public.db_restaurants');
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);

  const [auditReport, setAuditReport]       = useState<AuditReport | null>(null);
  const [consistency, setConsistency]       = useState<ConsistencyResult | null>(null);
  const [completeness, setCompleteness]     = useState<CompletenessResult | null>(null);
  const [fixingId, setFixingId]             = useState<unknown>(null);
  const [reality, setReality]               = useState<RealityResults>({});
  const [autoFix, setAutoFix]               = useState<AutoFixResults | null>(null);
  const [realityLoading, setRealityLoading] = useState<string | null>(null);
  const [trend, setTrend]                   = useState<{ delta_score: number; trend: string; alert?: string; current?: { quality_score: number; captured_at?: string } } | null>(null);

  const [pkColumn, setPkColumn] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/db?action=tables').then((r) => r.json()).then((d) => setTables(d.tables ?? []));
  }, []);

  // Fetch the real primary key of the selected table once per table change.
  useEffect(() => {
    let cancelled = false;
    setPkColumn(null);
    fetch(`/api/db?action=pk&table=${encodeURIComponent(selectedTable)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setPkColumn(d.pk ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedTable]);

  // Fallback: db_restaurants uses restaurant_id, everything else defaults to id.
  const idColumn = pkColumn ?? (selectedTable.includes('restaurants') ? 'restaurant_id' : 'id');

  const post = useCallback(async (action: string, extra: object = {}) => {
    const r = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, table: selectedTable, ...extra }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    return data;
  }, [selectedTable]);

  const runAudit = async () => {
    setLoading(true);
    try {
      const [rep, cons, comp] = await Promise.all([
        post('audit_table'),
        post('consistency_check'),
        post('completeness_report', { limit: 500 }),
      ]);
      setAuditReport(rep);
      setConsistency(cons);
      setCompleteness(comp);
      setTab('overview');
      toast.success(`Auditoria completa — Score ${rep.quality_score}/100`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  const applyFix = async (issue: FieldIssue) => {
    if (!issue.suggested) return;
    setFixingId(issue.row_id);
    try {
      await post('apply_fix', {
        id_column: idColumn, id_value: issue.row_id,
        column: issue.column, new_value: issue.suggested,
        reason: `Auto-fix: ${issue.rule} — ${issue.message}`,
      });
      toast.success(`Corrigido: ${issue.column} → ${issue.suggested}`);
      setAuditReport((r) => r ? {
        ...r,
        columns: r.columns.map((c) => c.column === issue.column
          ? { ...c, issues: c.issues.filter((i) => i.row_id !== issue.row_id), invalid: c.invalid - 1 }
          : c),
      } : r);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setFixingId(null);
    }
  };

  const runRealityCheck = async (kind: 'emails' | 'phones' | 'urls' | 'places') => {
    setRealityLoading(kind);
    try {
      const actionMap = { emails: 'check_emails_reality', phones: 'check_phones_reality', urls: 'check_urls_reality', places: 'check_places_freshness' };
      const limitMap = { emails: 100, phones: 500, urls: 30, places: 15 };
      const data = await post(actionMap[kind], { limit: limitMap[kind] });
      setReality((r) => ({ ...r, [kind]: data }));
      toast.success(`${kind}: ${kind === 'urls' ? data.health_rate : kind === 'places' ? '✓' : data.validity_rate}% válidos`);
    } catch (err) {
      toast.error(String(err));
    } finally { setRealityLoading(null); }
  };

  const runAutoFix = async () => {
    setRealityLoading('autofix');
    try {
      const data = await post('auto_fix_suggestions', { limit: 500 });
      setAutoFix(data);
      toast.success(`${data.total} correções sugeridas (${data.by_confidence.high} de alta confiança)`);
    } catch (err) { toast.error(String(err)); }
    finally { setRealityLoading(null); }
  };

  const doApplyHighConfidence = async (highOnly: AutoFixResults['suggestions']) => {
    setRealityLoading('applying');
    try {
      const data = await post('apply_auto_fixes', {
        suggestions: highOnly.map((s) => ({ ...s, table: selectedTable, id_column: idColumn })),
        min_confidence: 'high',
      });
      toast.success(`${data.applied} correções aplicadas`);
      setAutoFix(null);
    } catch (err) { toast.error(String(err)); }
    finally { setRealityLoading(null); }
  };

  const applyHighConfidence = () => {
    if (!autoFix?.suggestions.length) return;
    const highOnly = autoFix.suggestions.filter((s) => s.confidence === 'high');
    toast((t) => (
      <div>
        <p className="text-sm mb-2">Aplicar {highOnly.length} correções de alta confiança?</p>
        <div className="flex gap-2">
          <button onClick={() => { toast.dismiss(t.id); doApplyHighConfidence(highOnly); }}
            className="px-3 py-1 bg-emerald-600 rounded text-xs text-white">Aplicar</button>
          <button onClick={() => toast.dismiss(t.id)}
            className="px-3 py-1 bg-gray-600 rounded text-xs text-white">Cancelar</button>
        </div>
      </div>
    ), { duration: 10000 });
  };

  const loadTrend = async () => {
    try {
      const data = await post('trend_analysis');
      setTrend(data);
    } catch {}
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview',    label: 'Visão Geral' },
    { id: 'columns',     label: 'Por Coluna' },
    { id: 'reality',     label: 'Reality Check' },
    { id: 'autofix',     label: 'Auto-Fix' },
    { id: 'duplicates',  label: `Duplicatas${auditReport?.duplicate_groups.length ? ` (${auditReport.duplicate_groups.length})` : ''}` },
    { id: 'consistency', label: 'Consistência' },
    { id: 'completeness',label: 'Completude' },
    { id: 'trends',      label: 'Tendências' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 flex items-center gap-4">
        <ShieldCheck className="w-5 h-5 text-gold flex-shrink-0" />
        <div className="flex-1">
          <h2 className="font-cormorant text-xl text-white">Data Quality Auditor</h2>
          <p className="text-xs text-white/30 mt-0.5">Verificação inteligente de integridade, formatos e consistência</p>
        </div>
        <select value={selectedTable} onChange={(e) => { setSelectedTable(e.target.value); setAuditReport(null); }}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-gold/40">
          {tables.map((t) => {
            const full = `${t.table_schema}.${t.table_name}`;
            return <option key={full} value={full}>{t.table_schema !== 'public' ? full : t.table_name}</option>;
          })}
        </select>
        <button onClick={runAudit} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-xl text-gold text-sm font-medium transition-all disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Auditar Agora
        </button>
      </div>

      {/* Tabs */}
      {auditReport && (
        <div className="flex gap-1 px-6 pt-3 border-b border-white/5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${tab === t.id ? 'text-gold border-b-2 border-gold bg-gold/5' : 'text-white/40 hover:text-white/70'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">

          {/* ── EMPTY STATE ──────────────────────────────────────────────── */}
          {!auditReport && !loading && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="w-20 h-20 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center">
                <ShieldCheck className="w-10 h-10 text-gold/50" />
              </div>
              <div>
                <h3 className="text-xl font-cormorant text-white">Nenhuma auditoria realizada</h3>
                <p className="text-sm text-white/40 mt-2 max-w-sm">
                  Selecione uma tabela e clique em <strong className="text-gold/70">Auditar Agora</strong> para analisar emails, telefones, URLs, coordenadas, duplicatas e consistência cruzada.
                </p>
              </div>
              <button onClick={runAudit}
                className="flex items-center gap-2 px-6 py-3 bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-xl text-gold font-medium transition-all">
                <ShieldCheck className="w-5 h-5" /> Iniciar Auditoria
              </button>
            </motion.div>
          )}

          {loading && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-full gap-4">
              <div className="w-12 h-12 border-2 border-gold/20 border-t-gold rounded-full animate-spin" />
              <p className="text-white/50">Auditando {selectedTable}…</p>
              <p className="text-white/20 text-xs">Verificando formatos, duplicatas e consistência cruzada</p>
            </motion.div>
          )}

          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
          {auditReport && tab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              {/* Score cards */}
              <div className="grid grid-cols-5 gap-4">
                <div className="col-span-1 bg-white/[0.02] border border-white/5 rounded-2xl p-5 flex flex-col items-center gap-2">
                  <ScoreRing score={auditReport.quality_score} />
                  <p className="text-xs text-white/40 uppercase tracking-widest">Quality Score</p>
                </div>
                {[
                  { label: 'Total', val: auditReport.total_rows.toLocaleString(), sub: 'registros', sev: 'ok' },
                  { label: 'Críticos', val: auditReport.critical_count, sub: 'problemas graves', sev: 'critical' },
                  { label: 'Avisos', val: auditReport.warning_count, sub: 'campos incompletos', sev: 'warning' },
                  { label: 'Duplicatas', val: auditReport.duplicate_groups.length, sub: 'grupos similares', sev: auditReport.duplicate_groups.length > 0 ? 'warning' : 'ok' },
                ].map((c) => {
                  const cfg = SEV_CONFIG[c.sev as keyof typeof SEV_CONFIG] ?? SEV_CONFIG.ok;
                  return (
                    <div key={c.label} className={`bg-white/[0.02] border rounded-2xl p-5 flex flex-col justify-between ${cfg.border}`}>
                      <cfg.Icon className={`w-5 h-5 ${cfg.color}`} />
                      <div>
                        <p className={`text-3xl font-semibold ${cfg.color}`}>{c.val}</p>
                        <p className="text-xs text-white/40 mt-1">{c.label}</p>
                        <p className="text-[10px] text-white/20">{c.sub}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Top issues */}
              <div>
                <h3 className="text-sm font-medium text-white/60 uppercase tracking-widest mb-3">Principais Problemas</h3>
                <div className="space-y-2">
                  {auditReport.columns
                    .filter((c) => c.issues.length > 0)
                    .sort((a, b) => b.issues.filter((i) => i.severity === 'critical').length - a.issues.filter((i) => i.severity === 'critical').length)
                    .slice(0, 8)
                    .map((col) => {
                      const crits = col.issues.filter((i) => i.severity === 'critical').length;
                      const warns = col.issues.filter((i) => i.severity === 'warning').length;
                      const Icon = COLUMN_ICONS[col.column] ?? BarChart3;
                      return (
                        <div key={col.column}
                          className="flex items-center gap-4 bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3 hover:border-white/10 transition-colors cursor-pointer"
                          onClick={() => setTab('columns')}>
                          <Icon className="w-4 h-4 text-white/30 flex-shrink-0" />
                          <span className="text-sm text-white/70 w-32 flex-shrink-0 font-mono">{col.column}</span>
                          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-red-400 to-amber-400 rounded-full" style={{ width: `${100 - col.completeness}%` }} />
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            {crits > 0 && <span className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-full px-2 py-0.5">{crits} críticos</span>}
                            {warns > 0 && <span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">{warns} avisos</span>}
                          </div>
                          <span className="text-xs text-white/30 flex-shrink-0">{col.completeness}% ok</span>
                          <ArrowRight className="w-3.5 h-3.5 text-white/20" />
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Consistency quick view */}
              {consistency && consistency.checks.filter((c) => c.count > 0).length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-white/60 uppercase tracking-widest mb-3">Problemas de Consistência</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {consistency.checks.filter((c) => c.count > 0).map((c) => (
                      <div key={c.check} className="flex items-center gap-3 bg-white/[0.02] border border-red-400/10 rounded-xl px-4 py-3">
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white/70 truncate">{c.check}</p>
                        </div>
                        <span className="text-lg font-semibold text-amber-400 flex-shrink-0">{c.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ── COLUMNS ──────────────────────────────────────────────────── */}
          {auditReport && tab === 'columns' && (
            <motion.div key="columns" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              {auditReport.columns
                .filter((c) => c.issues.length > 0)
                .sort((a, b) => b.issues.length - a.issues.length)
                .map((col) => (
                  <details key={col.column} className="group bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden">
                    <summary className="flex items-center gap-4 px-4 py-3 cursor-pointer list-none hover:bg-white/[0.02]">
                      <span className="font-mono text-sm text-white/80 w-40 flex-shrink-0">{col.column}</span>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-gold/50 rounded-full" style={{ width: `${col.completeness}%` }} />
                        </div>
                        <span className="text-xs text-white/40 w-10 text-right">{col.completeness}%</span>
                      </div>
                      <div className="flex gap-2">
                        {['critical','warning','info'].map((s) => {
                          const n = col.issues.filter((i) => i.severity === s).length;
                          return n > 0 ? <SevBadge key={s} severity={s} /> : null;
                        })}
                        <span className="text-xs text-white/30">{col.issues.length} issues</span>
                      </div>
                    </summary>

                    <div className="border-t border-white/5 divide-y divide-white/[0.03] max-h-80 overflow-y-auto">
                      {col.issues.slice(0, 100).map((issue, i) => (
                        <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.01]">
                          <SevBadge severity={issue.severity} />
                          <span className="text-xs text-white/30 font-mono w-16 flex-shrink-0">id:{String(issue.row_id).slice(0,6)}</span>
                          <span className="text-xs text-red-300/70 flex-1 truncate" title={String(issue.value ?? 'null')}>
                            {issue.value === null || issue.value === undefined ? <em className="opacity-50">null</em> : String(issue.value).slice(0, 60)}
                          </span>
                          <span className="text-xs text-white/40 flex-shrink-0">{issue.message}</span>
                          {issue.suggested && (
                            <button
                              onClick={() => applyFix(issue)}
                              disabled={fixingId === issue.row_id}
                              className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-2 py-0.5 hover:bg-emerald-400/20 transition-colors flex-shrink-0">
                              {fixingId === issue.row_id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <><CheckCircle2 className="w-3 h-3" /> Fix</>}
                            </button>
                          )}
                        </div>
                      ))}
                      {col.issues.length > 100 && (
                        <p className="px-4 py-2 text-xs text-white/20 text-center">
                          +{col.issues.length - 100} issues adicionais — use o Agent Chat para correção em lote
                        </p>
                      )}
                    </div>
                  </details>
                ))}
              {auditReport.columns.filter((c) => c.issues.length > 0).length === 0 && (
                <div className="text-center py-16 text-emerald-400/60">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Nenhum problema de coluna encontrado!</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ── DUPLICATES ───────────────────────────────────────────────── */}
          {auditReport && tab === 'duplicates' && (
            <motion.div key="duplicates" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              {auditReport.duplicate_groups.length === 0 ? (
                <div className="text-center py-16 text-emerald-400/60">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Nenhuma duplicata detectada!</p>
                </div>
              ) : auditReport.duplicate_groups.map((g, i) => (
                <div key={i} className="bg-white/[0.02] border border-amber-400/15 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Users className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-medium text-amber-400">{Math.round(g.similarity * 100)}% similares</span>
                    <span className="text-xs text-white/30">{g.ids.length} registros</span>
                  </div>
                  <div className="space-y-1.5">
                    {g.names.map((name, j) => (
                      <div key={j} className="flex items-center gap-2">
                        <span className="text-xs text-white/20 font-mono w-20 flex-shrink-0">id:{String(g.ids[j]).slice(0,8)}</span>
                        <span className="text-sm text-white/70">{name}</span>
                        {j > 0 && <Copy className="w-3 h-3 text-amber-400/40 ml-auto" />}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* ── CONSISTENCY ──────────────────────────────────────────────── */}
          {auditReport && tab === 'consistency' && consistency && (
            <motion.div key="consistency" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              {consistency.checks.map((c, i) => {
                const ok = c.count === 0 && !c.error;
                const cfg = c.error ? SEV_CONFIG.critical : ok ? SEV_CONFIG.ok : SEV_CONFIG[c.severity as 'critical' | 'warning'] ?? SEV_CONFIG.warning;
                return (
                  <div key={i} className={`flex items-center gap-4 bg-white/[0.02] border rounded-xl px-5 py-4 ${cfg.border}`}>
                    <cfg.Icon className={`w-5 h-5 ${cfg.color} flex-shrink-0`} />
                    <div className="flex-1">
                      <p className="text-sm text-white/80">{c.check}</p>
                      {c.error && <p className="text-xs text-red-400/60 mt-0.5">{c.error}</p>}
                    </div>
                    <span className={`text-2xl font-semibold ${cfg.color}`}>{c.error ? '?' : c.count}</span>
                  </div>
                );
              })}
            </motion.div>
          )}

          {/* ── REALITY CHECK ────────────────────────────────────────────── */}
          {auditReport && tab === 'reality' && (
            <motion.div key="reality" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="bg-gold/5 border border-gold/15 rounded-2xl p-5">
                <h3 className="font-cormorant text-xl text-gold mb-2">Validação contra a realidade</h3>
                <p className="text-sm text-white/50">
                  Esses checks vão além da validação de formato. Eles verificam se os dados são <strong className="text-white/70">reais</strong>:
                  e-mails que aceitam mensagens (DNS MX), telefones válidos (libphonenumber), URLs que respondem (HEAD request)
                  e restaurantes ainda operando no Google Places.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Emails */}
                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <Mail className="w-5 h-5 text-blue-400" />
                    <h4 className="text-sm font-medium text-white/80">E-mails (DNS MX)</h4>
                    <button onClick={() => runRealityCheck('emails')} disabled={!!realityLoading}
                      className="ml-auto text-xs bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded px-3 py-1 text-gold transition-colors disabled:opacity-50">
                      {realityLoading === 'emails' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Verificar'}
                    </button>
                  </div>
                  {reality.emails ? (
                    <div>
                      <div className="flex items-baseline gap-2 mb-2">
                        <span className="text-3xl font-semibold text-emerald-400">{reality.emails.validity_rate}%</span>
                        <span className="text-xs text-white/40">válidos ({reality.emails.valid}/{reality.emails.total})</span>
                      </div>
                      {reality.emails.invalid > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-red-400">{reality.emails.invalid} inválidos</summary>
                          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                            {reality.emails.issues.slice(0, 30).map((e, i) => (
                              <div key={i} className="text-xs text-white/50 flex items-center gap-2">
                                <XCircle className="w-3 h-3 text-red-400/70 flex-shrink-0" />
                                <span className="font-mono truncate">{e.email}</span>
                                <span className="text-white/30 ml-auto flex-shrink-0">{e.message.slice(0, 40)}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ) : <p className="text-xs text-white/30">Clique em Verificar para validar e-mails</p>}
                </div>

                {/* Phones */}
                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <Phone className="w-5 h-5 text-emerald-400" />
                    <h4 className="text-sm font-medium text-white/80">Telefones (E.164)</h4>
                    <button onClick={() => runRealityCheck('phones')} disabled={!!realityLoading}
                      className="ml-auto text-xs bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded px-3 py-1 text-gold transition-colors disabled:opacity-50">
                      {realityLoading === 'phones' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Verificar'}
                    </button>
                  </div>
                  {reality.phones ? (
                    <div>
                      <div className="flex items-baseline gap-2 mb-2">
                        <span className="text-3xl font-semibold text-emerald-400">{reality.phones.validity_rate}%</span>
                        <span className="text-xs text-white/40">válidos ({reality.phones.valid}/{reality.phones.total})</span>
                      </div>
                    </div>
                  ) : <p className="text-xs text-white/30">Validação por país + tipo (móvel/fixo)</p>}
                </div>

                {/* URLs */}
                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <Link2 className="w-5 h-5 text-cyan-400" />
                    <h4 className="text-sm font-medium text-white/80">Sites (HTTP HEAD)</h4>
                    <button onClick={() => runRealityCheck('urls')} disabled={!!realityLoading}
                      className="ml-auto text-xs bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded px-3 py-1 text-gold transition-colors disabled:opacity-50">
                      {realityLoading === 'urls' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Verificar'}
                    </button>
                  </div>
                  {reality.urls ? (
                    <div>
                      <div className="flex items-baseline gap-2 mb-2">
                        <span className="text-3xl font-semibold text-emerald-400">{reality.urls.health_rate}%</span>
                        <span className="text-xs text-white/40">acessíveis ({reality.urls.reachable}/{reality.urls.total})</span>
                      </div>
                      {reality.urls.broken > 0 && (
                        <details>
                          <summary className="text-xs text-red-400 cursor-pointer">{reality.urls.broken} quebrados</summary>
                          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                            {reality.urls.issues.slice(0, 20).map((u, i) => (
                              <div key={i} className="text-xs text-white/50 flex items-center gap-2">
                                <XCircle className="w-3 h-3 text-red-400/70 flex-shrink-0" />
                                <span className="font-mono truncate text-[10px]">{u.url}</span>
                                <span className="text-white/30 ml-auto flex-shrink-0">{u.message}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ) : <p className="text-xs text-white/30">Detecta 404, timeout, domínios parqueados</p>}
                </div>

                {/* Places freshness */}
                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <MapPin className="w-5 h-5 text-amber-400" />
                    <h4 className="text-sm font-medium text-white/80">Frescor (Google Places)</h4>
                    <button onClick={() => runRealityCheck('places')} disabled={!!realityLoading}
                      className="ml-auto text-xs bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded px-3 py-1 text-gold transition-colors disabled:opacity-50">
                      {realityLoading === 'places' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Verificar'}
                    </button>
                  </div>
                  {reality.places ? (
                    <div className="space-y-1.5">
                      <div className="flex gap-3 text-xs">
                        <span className="text-emerald-400">{reality.places.fresh} OK</span>
                        <span className="text-amber-400">{reality.places.stale} desatualizados</span>
                        <span className="text-red-400">{reality.places.closed} fechados</span>
                      </div>
                      {reality.places.closed > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-red-400">⚠️ {reality.places.closed} FECHADOS PERMANENTEMENTE</summary>
                          <div className="mt-2 space-y-1">
                            {reality.places.results.filter((r) => r.health === 'closed').map((r, i) => (
                              <div key={i} className="text-xs text-red-300/80 truncate">{r.name}</div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ) : <p className="text-xs text-white/30">Compara banco vs Places (amostra de 15)</p>}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── AUTO-FIX ─────────────────────────────────────────────────── */}
          {auditReport && tab === 'autofix' && (
            <motion.div key="autofix" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
              <div className="flex items-center justify-between bg-gold/5 border border-gold/15 rounded-2xl p-5">
                <div>
                  <h3 className="font-cormorant text-xl text-gold">Sugestões de correção automática</h3>
                  <p className="text-sm text-white/50 mt-1">Normalização de URL, telefone E.164, slug regenerado, typos de e-mail</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={runAutoFix} disabled={!!realityLoading}
                    className="px-4 py-2 bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-xl text-gold text-sm transition-colors disabled:opacity-50 flex items-center gap-2">
                    {realityLoading === 'autofix' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Gerar sugestões
                  </button>
                  {autoFix && autoFix.by_confidence.high > 0 && (
                    <button onClick={applyHighConfidence} disabled={!!realityLoading}
                      className="px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm transition-colors disabled:opacity-50 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Aplicar {autoFix.by_confidence.high} de alta confiança
                    </button>
                  )}
                </div>
              </div>

              {autoFix && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    {(['high','medium','low'] as const).map((conf) => {
                      const colors = { high: 'text-emerald-400 border-emerald-400/20', medium: 'text-amber-400 border-amber-400/20', low: 'text-red-400 border-red-400/20' };
                      return (
                        <div key={conf} className={`bg-white/[0.02] border rounded-xl p-4 ${colors[conf]}`}>
                          <p className="text-xs uppercase tracking-widest opacity-60">{conf}</p>
                          <p className="text-2xl font-semibold mt-1">{autoFix.by_confidence[conf]}</p>
                          <p className="text-xs opacity-50">correções</p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-1.5 max-h-96 overflow-y-auto">
                    {autoFix.suggestions.slice(0, 100).map((s, i) => {
                      const cfg = SEV_CONFIG[s.confidence === 'high' ? 'ok' : s.confidence === 'medium' ? 'warning' : 'critical'];
                      return (
                        <div key={i} className="bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2 flex items-center gap-3 text-xs">
                          <SevBadge severity={s.confidence === 'high' ? 'ok' : s.confidence} />
                          <span className="text-white/30 font-mono w-16 flex-shrink-0 truncate">id:{String(s.row_id).slice(0, 10)}</span>
                          <span className="text-white/60 font-mono w-32 flex-shrink-0 truncate">{s.column}</span>
                          <span className="text-red-300/70 truncate flex-1">{String(s.old_value ?? 'null').slice(0, 40)}</span>
                          <ArrowRight className="w-3 h-3 text-white/20 flex-shrink-0" />
                          <span className="text-emerald-400/80 truncate flex-1">{String(s.new_value).slice(0, 40)}</span>
                          <span className="text-white/30 text-[10px] flex-shrink-0">{s.rule}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {!autoFix && (
                <div className="text-center py-16 text-white/30">
                  <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Clique em Gerar sugestões para começar</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ── TRENDS ───────────────────────────────────────────────────── */}
          {auditReport && tab === 'trends' && (
            <motion.div key="trends" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
              <div className="flex items-center justify-between bg-gold/5 border border-gold/15 rounded-2xl p-5">
                <div>
                  <h3 className="font-cormorant text-xl text-gold">Evolução da qualidade no tempo</h3>
                  <p className="text-sm text-white/50 mt-1">Snapshots históricos do quality score por tabela</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    await post('save_snapshot');
                    toast.success('Snapshot salvo');
                    loadTrend();
                  }} className="px-4 py-2 bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-xl text-gold text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" /> Salvar snapshot agora
                  </button>
                  <button onClick={loadTrend} aria-label="Recarregar tendências"
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/70 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {trend && trend.alert && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <p className="text-sm text-red-300">{trend.alert}</p>
                </div>
              )}

              {trend ? (
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                    <p className="text-xs text-white/30 uppercase">Tendência</p>
                    <p className="text-2xl font-cormorant text-white mt-2 capitalize">
                      {trend.trend === 'improving' ? '📈 Melhorando' : trend.trend === 'degrading' ? '📉 Piorando' : trend.trend === 'stable' ? '➡️ Estável' : 'Sem dados'}
                    </p>
                  </div>
                  <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                    <p className="text-xs text-white/30 uppercase">Δ Score</p>
                    <p className={`text-2xl font-semibold mt-2 ${trend.delta_score > 0 ? 'text-emerald-400' : trend.delta_score < 0 ? 'text-red-400' : 'text-white/60'}`}>
                      {trend.delta_score > 0 ? '+' : ''}{trend.delta_score}
                    </p>
                  </div>
                  <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                    <p className="text-xs text-white/30 uppercase">Quality atual</p>
                    <p className="text-2xl font-semibold mt-2 text-gold">{trend.current?.quality_score ?? '—'}</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-white/30">
                  <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Salve o primeiro snapshot para começar a track de evolução</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ── COMPLETENESS ─────────────────────────────────────────────── */}
          {auditReport && tab === 'completeness' && completeness && (
            <motion.div key="completeness" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              {/* Distribution bars */}
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
                <p className="text-xs text-white/30 uppercase tracking-widest mb-4">Distribuição de completude</p>
                <div className="space-y-3">
                  {(Object.entries(completeness.distribution) as [string, number][]).map(([label, count]) => {
                    const pct = completeness.total ? Math.round((count / completeness.total) * 100) : 0;
                    const colors: Record<string, string> = {
                      critical: 'bg-red-400', poor: 'bg-orange-400', fair: 'bg-amber-400',
                      good: 'bg-gold', excellent: 'bg-emerald-400',
                    };
                    const ranges: Record<string, string> = {
                      critical: '< 40%', poor: '40–60%', fair: '60–80%', good: '80–95%', excellent: '95–100%',
                    };
                    return (
                      <div key={label} className="flex items-center gap-3">
                        <span className="text-xs text-white/40 w-20 flex-shrink-0 capitalize">{label}</span>
                        <span className="text-xs text-white/20 w-14 flex-shrink-0">{ranges[label]}</span>
                        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                          <motion.div className={`h-full rounded-full ${colors[label]}`}
                            initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, delay: 0.1 }} />
                        </div>
                        <span className="text-sm text-white/60 w-16 text-right">{count.toLocaleString()}</span>
                        <span className="text-xs text-white/30 w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Worst records */}
              <div>
                <p className="text-xs text-white/30 uppercase tracking-widest mb-3">50 registros mais incompletos</p>
                <div className="space-y-1.5">
                  {completeness.worst.map((r) => (
                    <div key={String(r.id)} className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2 hover:border-white/10">
                      <span className="text-xs text-white/20 font-mono w-24 flex-shrink-0 truncate">{String(r.id).slice(0, 10)}</span>
                      <span className="text-sm text-white/70 flex-1 truncate">{r.name}</span>
                      <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden flex-shrink-0">
                        <div className={`h-full rounded-full ${r.score < 40 ? 'bg-red-400' : r.score < 60 ? 'bg-amber-400' : 'bg-gold'}`}
                          style={{ width: `${r.score}%` }} />
                      </div>
                      <span className={`text-xs font-medium w-10 text-right flex-shrink-0 ${r.score < 40 ? 'text-red-400' : r.score < 60 ? 'text-amber-400' : 'text-gold'}`}>
                        {r.score}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
