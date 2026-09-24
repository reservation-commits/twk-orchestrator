'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { OnMount } from '@monaco-editor/react';
import { motion } from 'framer-motion';
import { Play, History, Download, Lightbulb, Zap, Shield, ShieldOff, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const HISTORY_KEY = 'twk_sql_history';

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
  sql: string;
  timestamp: string;
}

const EXAMPLE_QUERIES = [
  'SELECT COUNT(*) FROM public.db_restaurants',
  'SELECT name, city, rating FROM public.db_restaurants ORDER BY rating DESC LIMIT 10',
  'SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\'',
];

export default function QueryConsole() {
  const [sql, setSql] = useState('SELECT * FROM public.db_restaurants LIMIT 10;');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [safeMode, setSafeMode] = useState(true);
  const [history, setHistory] = useState<QueryResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [naturalLanguage, setNaturalLanguage] = useState('');
  const startTime = useRef<number>(0);
  const runRef = useRef<() => void>(() => {});
  const completionDisposeRef = useRef<{ dispose: () => void } | null>(null);
  const historyLoaded = useRef(false);

  // Load persisted history once on mount; save on every change afterwards.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHistory(parsed.slice(0, 20));
      }
    } catch {}
    historyLoaded.current = true;
  }, []);

  useEffect(() => {
    if (!historyLoaded.current) return;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20))); } catch {}
  }, [history]);

  // Dispose the Monaco completion provider on unmount.
  useEffect(() => () => { completionDisposeRef.current?.dispose(); completionDisposeRef.current = null; }, []);

  const isMutation = (s: string) => /^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)/i.test(s);
  const isDestructiveWithoutWhere = (s: string) =>
    /^\s*(DELETE|UPDATE)/i.test(s) && !/WHERE/i.test(s);
  const hasDropOrTruncate = (s: string) =>
    s.split(';').some((stmt) => /^\s*(DROP|TRUNCATE)\b/i.test(stmt));

  const runQuery = async () => {
    // DROP/TRUNCATE are always blocked, independent of Safe Mode (server also blocks them).
    if (hasDropOrTruncate(sql)) {
      toast.error('DROP e TRUNCATE são bloqueados neste console, mesmo fora do Safe Mode.');
      return;
    }
    if (safeMode && isDestructiveWithoutWhere(sql)) {
      toast.error('Safe Mode: DELETE/UPDATE sem WHERE bloqueado. Desative Safe Mode para continuar.');
      return;
    }
    setLoading(true);
    startTime.current = Date.now();
    try {
      const action = isMutation(sql) ? 'mutate' : 'query';
      // Nunca envia `confirmed` de cara: o servidor devolve um confirm_token no
      // preview de operações destrutivas e só executa com o token correspondente.
      const body: Record<string, unknown> = { action, sql };
      if (action === 'mutate') {
        body.table = 'unknown';
        body.operation = sql.trim().toUpperCase().split(' ')[0] as string;
      }
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.requiresConfirmation) {
        toast((t) => (
          <div>
            <p className="text-sm mb-2">{data.message}</p>
            <div className="flex gap-2">
              <button onClick={() => { toast.dismiss(t.id); runConfirmed(data.confirm_token); }}
                className="px-3 py-1 bg-red-500 rounded text-xs text-white">Confirmar</button>
              <button onClick={() => toast.dismiss(t.id)}
                className="px-3 py-1 bg-gray-600 rounded text-xs text-white">Cancelar</button>
            </div>
          </div>
        ), { duration: 10000 });
        return;
      }
      const qr: QueryResult = {
        rows: data.rows ?? [],
        rowCount: data.rowCount ?? 0,
        duration: Date.now() - startTime.current,
        sql,
        timestamp: new Date().toISOString(),
      };
      setResult(qr);
      setHistory((h) => [qr, ...h].slice(0, 20));
      toast.success(`Query executada — ${qr.rowCount ?? qr.rows.length} row(s) em ${qr.duration}ms`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  const runConfirmed = async (confirmToken?: string) => {
    setLoading(true);
    startTime.current = Date.now();
    try {
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mutate', sql, confirmed: true, confirm_token: confirmToken, table: 'unknown', operation: sql.trim().toUpperCase().split(' ')[0] }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult({ rows: [], rowCount: data.rowCount ?? 0, duration: Date.now() - startTime.current, sql, timestamp: new Date().toISOString() });
      toast.success(`${data.rowCount} row(s) afetadas`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Keep the Ctrl+Enter command pointing at the latest runQuery (avoids stale closure).
  useEffect(() => { runRef.current = runQuery; });

  const handleEditorMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());

    // Schema-aware autocomplete: table names + column names (simple word-based provider).
    (async () => {
      try {
        const [tablesRes, schemaRes] = await Promise.all([
          fetch('/api/db?action=tables').then((r) => r.json()),
          fetch('/api/db?action=schema&table=public.db_restaurants').then((r) => r.json()),
        ]);
        const tableNames: string[] = (tablesRes.tables ?? []).map(
          (t: { table_schema: string; table_name: string }) =>
            t.table_schema !== 'public' ? `${t.table_schema}.${t.table_name}` : t.table_name,
        );
        const columnNames: string[] = (schemaRes.schema ?? []).map(
          (c: { column_name: string }) => c.column_name,
        );
        completionDisposeRef.current?.dispose();
        completionDisposeRef.current = monaco.languages.registerCompletionItemProvider('sql', {
          provideCompletionItems: (model: import('monaco-editor').editor.ITextModel, position: import('monaco-editor').Position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };
            return {
              suggestions: [
                ...tableNames.map((t) => ({
                  label: t, insertText: t, range, detail: 'tabela',
                  kind: monaco.languages.CompletionItemKind.Class,
                })),
                ...columnNames.map((c) => ({
                  label: c, insertText: c, range, detail: 'coluna · db_restaurants',
                  kind: monaco.languages.CompletionItemKind.Field,
                })),
              ],
            };
          },
        });
      } catch {}
    })();
  };

  const translateNL = async () => {
    if (!naturalLanguage.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Traduza para SQL (apenas o SQL, sem explicação): "${naturalLanguage}"` }],
        }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let sqlText = '';
      const handleEvent = (payload: string) => {
        if (payload === '[DONE]') return;
        try {
          const parsed = JSON.parse(payload);
          if (typeof parsed.text === 'string') sqlText += parsed.text;
        } catch {}
      };
      // SSE frames are delimited by a blank line; buffer across chunk boundaries.
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? ''; // keep the trailing partial frame
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (line) handleEvent(line.slice(6));
        }
      }
      if (buffer.startsWith('data: ')) handleEvent(buffer.slice(6).trim());
      const match = sqlText.match(/```sql\n?([\s\S]+?)```/) ?? sqlText.match(/```\n?([\s\S]+?)```/);
      setSql((match?.[1] ?? sqlText).trim());
      setNaturalLanguage('');
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!result?.rows.length) return;
    const keys = Object.keys(result.rows[0]);
    const csv = [keys.join(','), ...result.rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'query-result.csv';
    a.click();
  };

  return (
    <div className="flex flex-col h-full">
      {/* NL Translator */}
      <div className="p-4 border-b border-white/5">
        <div className="flex gap-2">
          <input
            value={naturalLanguage}
            onChange={(e) => setNaturalLanguage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && translateNL()}
            placeholder="Descreva em português o que quer consultar…"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-gold/30 placeholder:text-white/20"
          />
          <button onClick={translateNL} className="px-3 py-2 bg-gold/15 hover:bg-gold/25 border border-gold/20 rounded-lg text-gold text-sm transition-colors flex items-center gap-1.5">
            <Lightbulb className="w-4 h-4" /> Traduzir
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          {EXAMPLE_QUERIES.map((q) => (
            <button key={q} onClick={() => setSql(q)}
              className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded px-2 py-1 text-white/40 hover:text-white/70 transition-colors truncate max-w-[200px]">
              {q.slice(0, 35)}…
            </button>
          ))}
        </div>
      </div>

      {/* Editor + Controls */}
      <div className="flex" style={{ height: '280px' }}>
        <div className="flex-1 relative">
          <MonacoEditor
            height="100%"
            language="sql"
            theme="vs-dark"
            value={sql}
            onChange={(v: string | undefined) => setSql(v ?? '')}
            onMount={handleEditorMount}
            options={{
              fontSize: 13,
              fontFamily: 'JetBrains Mono, Fira Code, monospace',
              minimap: { enabled: false },
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 12, bottom: 12 },
            }}
          />
        </div>

        <div className="w-12 flex flex-col items-center gap-3 py-4 border-l border-white/5 bg-black/20">
          <button onClick={runQuery} disabled={loading}
            className="p-2.5 bg-gold/20 hover:bg-gold/30 border border-gold/30 rounded-xl text-gold transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gold/40"
            title="Executar (Ctrl+Enter)" aria-label="Executar query (Ctrl+Enter)">
            {loading ? <div className="w-4 h-4 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
              : <Play className="w-4 h-4" />}
          </button>
          <button onClick={() => setSafeMode(!safeMode)}
            className={`p-2.5 rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40 ${safeMode ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' : 'bg-red-500/20 border-red-500/30 text-red-400'}`}
            title={safeMode ? 'Safe Mode ON' : 'Admin Mode'} aria-label={safeMode ? 'Desativar Safe Mode' : 'Ativar Safe Mode'}>
            {safeMode ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
          </button>
          <button onClick={() => setShowHistory(!showHistory)}
            className="p-2.5 hover:bg-white/10 rounded-xl border border-white/10 text-white/40 hover:text-white/70 transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40"
            title="Histórico" aria-label="Mostrar histórico de queries">
            <History className="w-4 h-4" />
          </button>
          {result && (
            <button onClick={exportCSV}
              className="p-2.5 hover:bg-white/10 rounded-xl border border-white/10 text-white/40 hover:text-white/70 transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40"
              title="Exportar CSV" aria-label="Exportar resultado em CSV">
              <Download className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="border-t border-white/5 p-4 bg-black/30 max-h-40 overflow-y-auto">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-2">Histórico</p>
          {history.map((h, i) => (
            <button key={i} onClick={() => { setSql(h.sql); setShowHistory(false); }}
              className="w-full text-left flex items-center gap-2 py-1 px-2 rounded hover:bg-white/5 group">
              <Clock className="w-3 h-3 text-white/20 flex-shrink-0" />
              <span className="text-xs text-white/40 group-hover:text-white/70 truncate">{h.sql}</span>
              <span className="text-xs text-white/20 ml-auto flex-shrink-0">{h.duration}ms</span>
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto border-t border-white/5">
        {result && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="h-full">
            <div className="sticky top-0 bg-black/60 backdrop-blur px-4 py-2 flex items-center gap-3 border-b border-white/5">
              <span className="text-xs text-white/40">{result.rows.length} rows</span>
              <span className="text-xs text-white/30">·</span>
              <span className="text-xs text-white/30 flex items-center gap-1"><Zap className="w-3 h-3" />{result.duration}ms</span>
            </div>
            {result.rows.length > 0 ? (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-black/40">
                    {Object.keys(result.rows[0]).map((k) => (
                      <th key={k} className="text-left px-3 py-2 text-white/40 font-medium uppercase tracking-wide whitespace-nowrap border-b border-white/5">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-3 py-2 text-white/60 max-w-[200px] truncate">
                          {val === null ? <span className="text-white/20 italic">null</span>
                            : typeof val === 'object' ? JSON.stringify(val).slice(0, 80)
                            : String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex items-center justify-center h-full text-white/30 text-sm">
                {result.rowCount} row(s) afetadas
              </div>
            )}
          </motion.div>
        )}
        {!result && !loading && (
          <div className="flex items-center justify-center h-full text-white/20 text-sm">
            Execute uma query para ver os resultados
          </div>
        )}
      </div>
    </div>
  );
}
