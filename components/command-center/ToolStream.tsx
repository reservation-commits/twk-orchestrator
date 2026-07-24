'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Loader2, Zap, Database, Globe2, ShieldCheck, Sparkles, Activity, Brain } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface ToolEvent {
  id:        string;
  tool:      string;
  status:    'running' | 'success' | 'error';
  startedAt: number;
  duration?: number;
  input?:    Record<string, unknown>;
  result?:   Record<string, unknown>;
  error?:    string;
}

// Map tool name → icon and category
function categorize(tool: string): { icon: LucideIcon; color: string; category: string } {
  if (tool.startsWith('execute_') || tool.startsWith('bulk_') || tool.includes('table') || tool.includes('row'))
    return { icon: Database, color: '#60a5fa', category: 'DB' };
  if (tool.startsWith('check_') || tool.startsWith('validate_'))
    return { icon: ShieldCheck, color: '#34d399', category: 'CHECK' };
  if (tool.includes('audit') || tool.includes('completeness') || tool.includes('consistency'))
    return { icon: ShieldCheck, color: '#c9a96e', category: 'AUDIT' };
  if (tool.includes('outlier') || tool.includes('duplicate'))
    return { icon: Activity, color: '#fbbf24', category: 'ANOMALY' };
  if (tool.includes('semantic') || tool.includes('generate') || tool.includes('thinking'))
    return { icon: Brain, color: '#a78bfa', category: 'AI' };
  if (tool.includes('fix') || tool.includes('apply'))
    return { icon: Sparkles, color: '#fb923c', category: 'FIX' };
  if (tool.includes('place') || tool.includes('search') || tool.includes('url') || tool.includes('web'))
    return { icon: Globe2, color: '#f472b6', category: 'EXTERNAL' };
  return { icon: Zap, color: '#9ca3af', category: 'OTHER' };
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return 'agora';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s atrás`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m atrás`;
  return `${Math.floor(diff / 3600000)}h atrás`;
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function ToolStream({ events }: { events: ToolEvent[] }) {
  return (
    <div className="relative h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <motion.div className="w-1.5 h-1.5 rounded-full bg-emerald-400"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ repeat: Infinity, duration: 1.5 }} />
          <p className="text-xs uppercase tracking-widest text-white/50 font-medium">Tool Execution Stream</p>
        </div>
        <span className="text-[10px] text-white/30">{events.length} eventos</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        <AnimatePresence initial={false}>
          {events.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-48 text-white/20 gap-3">
              <Zap className="w-8 h-8 opacity-50" />
              <p className="text-xs">Aguardando atividade do agente…</p>
            </motion.div>
          )}
          {events.map((event) => {
            const cat = categorize(event.tool);
            const Icon = cat.icon;
            return (
              <motion.div
                key={event.id}
                layout
                initial={{ opacity: 0, x: -20, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                className="group relative flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors"
              >
                {/* Status pulse */}
                <div className="relative flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: `${cat.color}15`, border: `1px solid ${cat.color}30` }}>
                  {event.status === 'running' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: cat.color }} />
                  ) : event.status === 'error' ? (
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" style={{ color: cat.color }} />
                  )}
                </div>

                {/* Category badge */}
                <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded uppercase flex-shrink-0"
                  style={{ color: cat.color, background: `${cat.color}10`, border: `1px solid ${cat.color}20` }}>
                  {cat.category}
                </span>

                {/* Tool name */}
                <span className="font-mono text-xs text-white/80 truncate flex-shrink min-w-[120px]">
                  {event.tool}
                </span>

                {/* Input summary */}
                {event.input && Object.keys(event.input).length > 0 && (
                  <span className="text-[10px] text-white/30 truncate flex-1">
                    {Object.entries(event.input).slice(0, 2).map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join(', ')}
                  </span>
                )}

                {/* Right side: duration + status */}
                <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                  {event.status === 'success' && (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400/60" />
                  )}
                  <span className={`text-[10px] font-mono ${
                    event.status === 'running' ? 'text-amber-400' :
                    event.status === 'error' ? 'text-red-400' :
                    event.duration && event.duration > 2000 ? 'text-amber-400/70' :
                    'text-white/40'
                  }`}>
                    {event.status === 'running' ? 'live' : formatDuration(event.duration)}
                  </span>
                  <span className="text-[10px] text-white/20 w-12 text-right">{relativeTime(event.startedAt)}</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
