'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Activity, Database, Pencil, Trash2, Plus } from 'lucide-react';

interface LogEntry {
  id: number;
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  record_id?: string;
  old_data?: unknown;
  new_data?: unknown;
  agent?: string;
  created_at: string;
}

const OP_COLORS: Record<string, string> = {
  INSERT: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  UPDATE: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  DELETE: 'text-red-400 bg-red-400/10 border-red-400/20',
};

const OP_ICONS: Record<string, ReactNode> = {
  INSERT: <Plus className="w-3 h-3" />,
  UPDATE: <Pencil className="w-3 h-3" />,
  DELETE: <Trash2 className="w-3 h-3" />,
};

export default function ActivityLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query',
          sql: `SELECT * FROM public.update_events ORDER BY created_at DESC LIMIT 50 OFFSET ${(page - 1) * 50}`,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLogs(data.rows ?? []);

      const countRes = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'query', sql: 'SELECT COUNT(*) as n FROM public.update_events' }),
      });
      const countData = await countRes.json();
      setTotal(parseInt(countData.rows?.[0]?.n ?? '0', 10));
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLogs(); }, [page]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-white/5 flex items-center justify-between">
        <div>
          <h2 className="font-cormorant text-2xl text-white">Activity Logs</h2>
          <p className="text-sm text-white/40 mt-1">{total.toLocaleString()} eventos registrados</p>
        </div>
        <button onClick={loadLogs} disabled={loading}
          className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white/70 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {logs.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Activity className="w-12 h-12 text-white/10" />
            <p className="text-white/30 text-sm">Nenhum evento registrado ainda.</p>
            <p className="text-white/20 text-xs">A tabela public.update_events precisa existir no banco.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {logs.map((log, i) => (
              <motion.div key={log.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                className="flex items-start gap-4 px-6 py-4 hover:bg-white/[0.01] transition-colors">
                <div className="mt-0.5">
                  <div className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full border ${OP_COLORS[log.operation] ?? 'text-white/40'}`}>
                    {OP_ICONS[log.operation]}
                    {log.operation}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Database className="w-3.5 h-3.5 text-white/20 flex-shrink-0" />
                    <span className="text-sm text-white/70 font-mono">{log.table_name}</span>
                    {log.record_id && <span className="text-xs text-white/30">#{log.record_id}</span>}
                  </div>

                  {log.new_data && (
                    <p className="text-xs text-white/30 mt-1 truncate font-mono">
                      {JSON.stringify(log.new_data).slice(0, 120)}
                    </p>
                  )}
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-white/30">
                    {new Date(log.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {log.agent && <p className="text-[10px] text-white/20 mt-0.5">{log.agent}</p>}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {total > 50 && (
        <div className="flex items-center justify-between p-4 border-t border-white/5">
          <span className="text-xs text-white/30">Página {page} de {Math.ceil(total / 50)}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}
              className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 disabled:opacity-30 transition-colors">
              Anterior
            </button>
            <button disabled={page >= Math.ceil(total / 50)} onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 disabled:opacity-30 transition-colors">
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
