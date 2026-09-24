'use client';

import { motion } from 'framer-motion';
import { Database, Globe2, Brain, Cpu, Activity } from 'lucide-react';

export interface ServiceProbe {
  name:        string;
  ok:          boolean | null;
  latency_ms?: number;
  checked_at?: string;
  note?:       string;
}

function iconFor(name: string): { Icon: React.ElementType; color: string } {
  if (/postgres|db|banco/i.test(name))        return { Icon: Database, color: '#60a5fa' };
  if (/places|google|maps/i.test(name))       return { Icon: Globe2,   color: '#f472b6' };
  if (/anthropic|claude|ia|ai/i.test(name))   return { Icon: Brain,    color: '#a78bfa' };
  return { Icon: Activity, color: '#c9a96e' };
}

/**
 * Presentational: renders the real probe results from /api/metrics `services`.
 * ok === null means the service has no probe — shown neutral, never fabricated.
 */
export default function SystemHealth({ services, eventsPerMin }: { services?: ServiceProbe[] | null; eventsPerMin: number }) {
  const list = services ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Activity className="w-3.5 h-3.5 text-white/40" />
        <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium">System Health</p>
      </div>

      <div className="space-y-2">
        {list.length === 0 && (
          <p className="text-xs text-white/30 px-1">Aguardando métricas…</p>
        )}
        {list.map((s) => {
          const { Icon, color } = iconFor(s.name);
          const noProbe = s.ok === null;
          return (
            <div key={s.name} className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2" title={s.note}>
              <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
              <span className="text-xs text-white/70 flex-1 truncate">{s.name}</span>
              {noProbe ? (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-white/25" />
                  <span className="text-[9px] font-mono tracking-wider text-white/30 w-14 text-right">SEM SONDA</span>
                </>
              ) : (
                <>
                  <motion.div
                    className={`w-1.5 h-1.5 rounded-full ${s.ok ? 'bg-emerald-400' : 'bg-red-400'}`}
                    animate={s.ok ? { opacity: [1, 0.4, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 2 }}
                  />
                  <span className={`text-[10px] font-mono w-14 text-right ${s.ok ? 'text-white/40' : 'text-red-400/70'}`}>
                    {s.ok
                      ? (typeof s.latency_ms === 'number' ? `${s.latency_ms}ms` : 'OK')
                      : 'FALHA'}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Event throughput */}
      <div className="bg-gradient-to-br from-gold/5 to-transparent border border-gold/10 rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="w-3 h-3 text-gold/60" />
          <span className="text-[10px] uppercase tracking-widest text-gold/60 font-medium">Throughput</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-cormorant text-gold">{eventsPerMin}</span>
          <span className="text-[10px] text-white/40">eventos/min</span>
        </div>
      </div>
    </div>
  );
}
