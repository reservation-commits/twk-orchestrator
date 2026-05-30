'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Play, RefreshCw, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface EnrichJob {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  before?: string;
  after?: string;
  error?: string;
}

export default function DataEnricher() {
  const [tables, setTables] = useState<{ table_schema: string; table_name: string }[]>([]);
  const [selectedTable, setSelectedTable] = useState('public.db_restaurants');
  const [selectedColumn, setSelectedColumn] = useState('description');
  const [schema, setSchema] = useState<{ column_name: string; data_type: string }[]>([]);
  const [source, setSource] = useState<'claude' | 'places' | 'web'>('claude');
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [jobs, setJobs] = useState<EnrichJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [enriched, setEnriched] = useState(0);

  useEffect(() => {
    fetch('/api/db?action=tables').then((r) => r.json()).then((d) => setTables(d.tables ?? []));
  }, []);

  useEffect(() => {
    if (!selectedTable) return;
    fetch(`/api/db?action=schema&table=${selectedTable}`)
      .then((r) => r.json())
      .then((d) => setSchema(d.schema ?? []));
  }, [selectedTable]);

  const loadPreview = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query',
          sql: `SELECT * FROM ${selectedTable} WHERE ${selectedColumn} IS NULL OR ${selectedColumn} = '' LIMIT 5`,
        }),
      });
      const data = await res.json();
      setPreview(data.rows ?? []);

      const countRes = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query',
          sql: `SELECT COUNT(*) as n FROM ${selectedTable} WHERE ${selectedColumn} IS NULL OR ${selectedColumn} = ''`,
        }),
      });
      const countData = await countRes.json();
      setTotal(parseInt(countData.rows?.[0]?.n ?? '0', 10));
    } finally {
      setLoading(false);
    }
  };

  const runEnrichment = async () => {
    if (!preview.length) { toast.error('Carregue uma prévia primeiro'); return; }
    setLoading(true);
    setJobs([]);
    setEnriched(0);

    // Get all rows to enrich
    const res = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'query',
        sql: `SELECT * FROM ${selectedTable} WHERE ${selectedColumn} IS NULL OR ${selectedColumn} = '' LIMIT 50`,
      }),
    });
    const data = await res.json();
    const rows: Record<string, unknown>[] = data.rows ?? [];

    const initialJobs: EnrichJob[] = rows.map((r) => ({
      id: String(r.id ?? r.place_id ?? Math.random()),
      name: String(r.name ?? r.id ?? 'Unknown'),
      status: 'pending',
    }));
    setJobs(initialJobs);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setJobs((prev) => prev.map((j, idx) => idx === i ? { ...j, status: 'running' } : j));

      try {
        let newValue: string | null = null;

        if (source === 'claude') {
          const agentRes = await fetch('/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{
                role: 'user',
                content: `Generate a value for the column "${selectedColumn}" for this restaurant: ${JSON.stringify(row)}. Return ONLY the value, no explanation.`,
              }],
            }),
          });
          const reader = agentRes.body!.getReader();
          const decoder = new TextDecoder();
          let text = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const lines = decoder.decode(value).split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                const payload = JSON.parse(line.slice(6));
                if (payload.text) text += payload.text;
              }
            }
          }
          newValue = text.trim();
        } else if (source === 'web') {
          const searchRes = await fetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'search', query: `${row.name} ${row.city} ${selectedColumn}` }),
          });
          const searchData = await searchRes.json();
          newValue = searchData.results?.[0]?.snippet ?? null;
        }

        if (newValue) {
          const idCol = schema[0]?.column_name ?? 'id';
          await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update_cell', table: selectedTable, id_column: idCol, id_value: row[idCol], column: selectedColumn, value: newValue }),
          });
          setJobs((prev) => prev.map((j, idx) => idx === i ? { ...j, status: 'done', after: newValue!.slice(0, 60) } : j));
          setEnriched((e) => e + 1);
        } else {
          setJobs((prev) => prev.map((j, idx) => idx === i ? { ...j, status: 'error', error: 'No value generated' } : j));
        }
      } catch (err) {
        setJobs((prev) => prev.map((j, idx) => idx === i ? { ...j, status: 'error', error: String(err) } : j));
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    setLoading(false);
    toast.success(`Enriquecimento concluído: ${enriched} registros atualizados`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-white/5">
        <h2 className="font-cormorant text-2xl text-white mb-4">Data Enricher</h2>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-white/40 uppercase tracking-widest mb-2 block">Tabela</label>
            <select value={selectedTable} onChange={(e) => setSelectedTable(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-gold/40">
              {tables.map((t) => (
                <option key={`${t.table_schema}.${t.table_name}`} value={`${t.table_schema}.${t.table_name}`}>
                  {t.table_schema !== 'public' ? `${t.table_schema}.` : ''}{t.table_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-white/40 uppercase tracking-widest mb-2 block">Coluna</label>
            <select value={selectedColumn} onChange={(e) => setSelectedColumn(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-gold/40">
              {schema.map((col) => (
                <option key={col.column_name} value={col.column_name}>{col.column_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-white/40 uppercase tracking-widest mb-2 block">Fonte</label>
            <select value={source} onChange={(e) => setSource(e.target.value as 'claude' | 'places' | 'web')}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-gold/40">
              <option value="claude">Claude AI</option>
              <option value="places">Google Places</option>
              <option value="web">Web Search</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button onClick={loadPreview} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/60 text-sm transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Prévia
          </button>

          {total > 0 && (
            <span className="text-sm text-white/40">{total.toLocaleString()} registros incompletos</span>
          )}

          <button onClick={runEnrichment} disabled={loading || !total}
            className="ml-auto flex items-center gap-2 px-5 py-2 bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-xl text-gold text-sm font-medium transition-colors disabled:opacity-40">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Enriquecer {total > 0 ? `${Math.min(total, 50)} registros` : ''}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Preview */}
        {preview.length > 0 && jobs.length === 0 && (
          <div className="mb-6">
            <p className="text-xs text-white/30 uppercase tracking-widest mb-3">Prévia (primeiros 5 registros sem {selectedColumn})</p>
            <div className="space-y-2">
              {preview.map((row, i) => (
                <div key={i} className="bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3">
                  <p className="text-sm text-white/70">{String(row.name ?? row.id ?? `Row ${i}`)}</p>
                  <p className="text-xs text-white/30 mt-1">{selectedColumn}: <span className="italic">null</span></p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Jobs */}
        {jobs.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-white/30 uppercase tracking-widest">Progresso</p>
              <span className="text-sm text-gold">{enriched}/{jobs.length}</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full mb-4 overflow-hidden">
              <motion.div className="h-full bg-gradient-to-r from-gold to-amber-500 rounded-full"
                animate={{ width: `${(enriched / jobs.length) * 100}%` }} />
            </div>
            <div className="space-y-2">
              {jobs.map((job) => (
                <motion.div key={job.id} layout className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3">
                  {job.status === 'pending' && <div className="w-4 h-4 rounded-full border border-white/20" />}
                  {job.status === 'running' && <Loader2 className="w-4 h-4 text-gold animate-spin" />}
                  {job.status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {job.status === 'error' && <XCircle className="w-4 h-4 text-red-400" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/70 truncate">{job.name}</p>
                    {job.after && <p className="text-xs text-emerald-400/70 truncate mt-0.5">→ {job.after}</p>}
                    {job.error && <p className="text-xs text-red-400/70 mt-0.5">{job.error}</p>}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {!preview.length && !jobs.length && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <Sparkles className="w-12 h-12 text-gold/20" />
            <p className="text-white/30 text-sm max-w-sm">
              Selecione uma tabela e coluna, clique em Prévia para ver os registros incompletos, depois execute o enriquecimento.
            </p>
            <button onClick={loadPreview} className="flex items-center gap-2 px-4 py-2 bg-gold/10 hover:bg-gold/20 border border-gold/15 rounded-xl text-gold/70 text-sm transition-colors">
              <Play className="w-4 h-4" /> Carregar Prévia
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
