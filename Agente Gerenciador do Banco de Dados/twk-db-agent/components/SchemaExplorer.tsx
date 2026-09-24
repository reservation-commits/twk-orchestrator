'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Search, KeyRound, Network, Table2, ArrowRight, ArrowLeft, AlertTriangle } from 'lucide-react';

interface SchemaColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_pk: boolean;
}

interface SchemaTable {
  schema: string;
  name: string;
  row_estimate: number;
  columns: SchemaColumn[];
}

interface ForeignKey {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
}

interface SchemaGraph {
  tables: SchemaTable[];
  foreign_keys: ForeignKey[];
}

const nf = new Intl.NumberFormat('pt-BR');

const NODE_W = 150;
const NODE_H = 46;

/** Resolve a FK table reference ("name" or "schema.name") to a table key. */
function resolveRef(ref: string, tables: SchemaTable[]): string | null {
  const exact = tables.find((t) => `${t.schema}.${t.name}` === ref);
  if (exact) return `${exact.schema}.${exact.name}`;
  const byName = tables.find((t) => t.name === ref);
  if (byName) return `${byName.schema}.${byName.name}`;
  return null;
}

export default function SchemaExplorer() {
  const [graph, setGraph] = useState<SchemaGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/db?action=schema_graph');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(String(data.error));
      setGraph({ tables: data.tables ?? [], foreign_keys: data.foreign_keys ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const tables = useMemo(() => graph?.tables ?? [], [graph]);
  const fks = useMemo(() => graph?.foreign_keys ?? [], [graph]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(q));
  }, [tables, search]);

  const selectedTable = useMemo(
    () => tables.find((t) => `${t.schema}.${t.name}` === selected) ?? null,
    [tables, selected]
  );

  // FKs relative to the selected table (resolved to canonical keys)
  const relations = useMemo(() => {
    if (!selected) return { outgoing: [] as { fk: ForeignKey; target: string | null }[], incoming: [] as { fk: ForeignKey; target: string | null }[] };
    const outgoing = fks
      .filter((fk) => resolveRef(fk.from_table, tables) === selected)
      .map((fk) => ({ fk, target: resolveRef(fk.to_table, tables) }));
    const incoming = fks
      .filter((fk) => resolveRef(fk.to_table, tables) === selected)
      .map((fk) => ({ fk, target: resolveRef(fk.from_table, tables) }));
    return { outgoing, incoming };
  }, [selected, fks, tables]);

  // ── Graph layout: nodes on an ellipse, FK edges as quadratic beziers ──
  const layout = useMemo(() => {
    const n = tables.length;
    if (!n) return null;
    const rx = Math.max(300, n * 30);
    const ry = Math.max(170, n * 14);
    const W = 2 * rx + NODE_W + 100;
    const H = 2 * ry + NODE_H + 80;
    const cx = W / 2;
    const cy = H / 2;
    const pos = new Map<string, { x: number; y: number }>();
    tables.forEach((t, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      pos.set(`${t.schema}.${t.name}`, {
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
      });
    });
    const edges = fks
      .map((fk, i) => {
        const from = resolveRef(fk.from_table, tables);
        const to = resolveRef(fk.to_table, tables);
        if (!from || !to) return null;
        const p1 = pos.get(from)!;
        const p2 = pos.get(to)!;
        // Control point pulled toward the canvas center for a soft curve
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const qx = mx + (cx - mx) * 0.35;
        const qy = my + (cy - my) * 0.35;
        return { key: `${from}-${to}-${i}`, fk, from, to, d: `M ${p1.x} ${p1.y} Q ${qx} ${qy} ${p2.x} ${p2.y}` };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    return { W, H, pos, edges };
  }, [tables, fks]);

  // ── States: loading / error ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-10 h-10 border-2 border-gold/20 border-t-gold rounded-full animate-spin" />
        <p className="text-white/40 text-sm">Carregando schema do banco…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <AlertTriangle className="w-10 h-10 text-red-400/60" />
        <p className="text-white/50 text-sm">Erro ao carregar o schema: {error}</p>
        <button
          onClick={load}
          className="flex items-center gap-2 px-5 py-2.5 bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-xl text-gold text-sm font-medium transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="p-6 border-b border-white/5 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Network className="w-5 h-5 text-gold" />
          <h2 className="font-cormorant text-2xl text-white">Schema Explorer</h2>
        </div>
        <span className="text-xs text-white/30">{tables.length} tabelas · {fks.length} relações</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar tabelas…"
              className="w-56 bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-gold/40 placeholder:text-white/20 transition-colors"
            />
          </div>
          <button
            onClick={load}
            aria-label="Recarregar schema"
            className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-gold/30 rounded-xl text-white/50 hover:text-gold transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Two-pane: table list + detail */}
      <div className="flex min-h-[320px] border-b border-white/5">
        {/* Left: table list */}
        <div className="w-80 flex-shrink-0 border-r border-white/5 overflow-y-auto max-h-[420px] p-3 space-y-1">
          {filtered.length === 0 && (
            <p className="text-white/30 text-sm px-3 py-6 text-center">Nenhuma tabela encontrada</p>
          )}
          {filtered.map((t) => {
            const key = `${t.schema}.${t.name}`;
            const isSel = selected === key;
            return (
              <motion.button
                key={key}
                onClick={() => setSelected(key)}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                  isSel ? 'bg-gold/10 border-gold/30' : 'bg-white/[0.02] border-white/5 hover:border-white/15'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Table2 className={`w-3.5 h-3.5 flex-shrink-0 ${isSel ? 'text-gold' : 'text-white/30'}`} />
                  <span className={`text-sm font-medium truncate ${isSel ? 'text-gold' : 'text-white/70'}`}>
                    {t.schema !== 'public' ? `${t.schema}.` : ''}{t.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 pl-5.5 text-[11px] text-white/30">
                  <span>{nf.format(t.row_estimate)} linhas</span>
                  <span>{t.columns.length} colunas</span>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Right: column detail + relations */}
        <div className="flex-1 min-w-0 overflow-y-auto max-h-[420px] p-6">
          <AnimatePresence mode="wait">
            {selectedTable ? (
              <motion.div
                key={selected}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              >
                <div className="flex items-baseline gap-3 mb-4">
                  <h3 className="text-lg text-white font-medium">{selectedTable.schema}.{selectedTable.name}</h3>
                  <span className="text-xs text-white/30">~{nf.format(selectedTable.row_estimate)} linhas</span>
                </div>

                <div className="bg-black/30 backdrop-blur border border-white/10 rounded-xl overflow-hidden mb-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-left">
                        <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest text-white/30 font-medium">Coluna</th>
                        <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest text-white/30 font-medium">Tipo</th>
                        <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest text-white/30 font-medium text-center">Nullable</th>
                        <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest text-white/30 font-medium text-center">PK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTable.columns.map((c) => (
                        <tr key={c.name} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                          <td className="px-4 py-2 text-white/80 font-mono text-xs">{c.name}</td>
                          <td className="px-4 py-2 text-white/40 font-mono text-xs">{c.data_type}</td>
                          <td className="px-4 py-2 text-center">
                            {c.is_nullable
                              ? <span className="text-emerald-400/70 text-xs">✓</span>
                              : <span className="text-red-400/60 text-xs">✗</span>}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {c.is_pk && <KeyRound className="w-3.5 h-3.5 text-gold inline" aria-label="Chave primária" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Relations */}
                <p className="text-xs text-white/30 uppercase tracking-widest mb-3">Relações</p>
                {relations.outgoing.length === 0 && relations.incoming.length === 0 ? (
                  <p className="text-white/25 text-sm">Nenhuma foreign key envolvendo esta tabela.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {relations.outgoing.map(({ fk, target }, i) => (
                      <button
                        key={`out-${i}`}
                        onClick={() => target && setSelected(target)}
                        disabled={!target}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gold/10 hover:bg-gold/20 border border-gold/20 rounded-full text-xs text-gold transition-colors disabled:opacity-50"
                        title={`${fk.from_table}.${fk.from_column} → ${fk.to_table}.${fk.to_column}`}
                      >
                        <ArrowRight className="w-3 h-3" />
                        <span className="font-mono">{fk.from_column}</span>
                        <span className="text-gold/50">→</span>
                        <span>{fk.to_table}.{fk.to_column}</span>
                      </button>
                    ))}
                    {relations.incoming.map(({ fk, target }, i) => (
                      <button
                        key={`in-${i}`}
                        onClick={() => target && setSelected(target)}
                        disabled={!target}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-xs text-white/60 hover:text-white/80 transition-colors disabled:opacity-50"
                        title={`${fk.from_table}.${fk.from_column} → ${fk.to_table}.${fk.to_column}`}
                      >
                        <ArrowLeft className="w-3 h-3" />
                        <span>{fk.from_table}.{fk.from_column}</span>
                        <span className="text-white/30">→</span>
                        <span className="font-mono">{fk.to_column}</span>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full gap-3 text-center"
              >
                <Table2 className="w-10 h-10 text-gold/20" />
                <p className="text-white/30 text-sm max-w-xs">
                  Selecione uma tabela à esquerda — ou clique em um nó no grafo abaixo — para ver colunas e relações.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Relationship graph */}
      <div className="p-6">
        <p className="text-xs text-white/30 uppercase tracking-widest mb-3">Grafo de Relacionamentos</p>
        {layout ? (
          <div className="bg-black/30 backdrop-blur border border-white/10 rounded-xl overflow-auto">
            <svg
              viewBox={`0 0 ${layout.W} ${layout.H}`}
              className="w-full"
              style={{ minHeight: 380, maxHeight: 560 }}
              role="img"
              aria-label="Grafo de relacionamentos entre tabelas"
            >
              {/* Edges */}
              {layout.edges.map((e) => {
                const active = selected !== null && (e.from === selected || e.to === selected);
                return (
                  <path
                    key={e.key}
                    d={e.d}
                    fill="none"
                    stroke={active ? 'rgba(201,169,110,0.75)' : 'rgba(201,169,110,0.22)'}
                    strokeWidth={active ? 2 : 1.2}
                  >
                    <title>{`${e.fk.from_table}.${e.fk.from_column} → ${e.fk.to_table}.${e.fk.to_column}`}</title>
                  </path>
                );
              })}

              {/* Nodes */}
              {tables.map((t) => {
                const key = `${t.schema}.${t.name}`;
                const p = layout.pos.get(key)!;
                const isSel = selected === key;
                return (
                  <g
                    key={key}
                    transform={`translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`}
                    onClick={() => setSelected(key)}
                    className="cursor-pointer"
                  >
                    <title>{`${key} · ~${nf.format(t.row_estimate)} linhas · ${t.columns.length} colunas`}</title>
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx={10}
                      fill={isSel ? 'rgba(201,169,110,0.18)' : 'rgba(255,255,255,0.04)'}
                      stroke={isSel ? '#c9a96e' : 'rgba(255,255,255,0.14)'}
                      strokeWidth={isSel ? 1.5 : 1}
                    />
                    <text
                      x={NODE_W / 2}
                      y={19}
                      textAnchor="middle"
                      fill={isSel ? '#c9a96e' : 'rgba(255,255,255,0.8)'}
                      fontSize={12}
                      fontWeight={500}
                    >
                      {t.name.length > 20 ? `${t.name.slice(0, 19)}…` : t.name}
                    </text>
                    <text
                      x={NODE_W / 2}
                      y={35}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.35)"
                      fontSize={10}
                    >
                      {nf.format(t.row_estimate)} linhas
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        ) : (
          <p className="text-white/25 text-sm">Nenhuma tabela para exibir.</p>
        )}
      </div>
    </div>
  );
}
