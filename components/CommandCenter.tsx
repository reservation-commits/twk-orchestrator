'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck, Database, AlertCircle, Activity, Clock,
  Sparkles, Brain, Zap, Command as CommandIcon, Radio,
} from 'lucide-react';
import LiveMetricCard from './command-center/LiveMetricCard';
import ToolStream, { type ToolEvent } from './command-center/ToolStream';
import SystemHealth from './command-center/SystemHealth';
import ActivityTimeline from './command-center/ActivityTimeline';

interface Metrics {
  quality_score:      number;
  total_restaurants:  number;
  total_tables:       number;
  total_reservations: number;
  avg_completeness:   number;
  critical_issues:    number;
  last_audit?:        string;
  bus_stats: {
    events_5min:        number;
    events_1h:          number;
    tool_calls_1h:      number;
    avg_tool_latency_ms: number;
    errors_1h:          number;
  };
  db_latency_ms: number;
}

interface AgentEvent {
  id:        string;
  type:      string;
  timestamp: number;
  duration?: number;
  source?:   string;
  data:      Record<string, unknown>;
}

export default function CommandCenter({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [events, setEvents]   = useState<ToolEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [qualityHistory, setQualityHistory] = useState<number[]>([]);
  const eventMap = useRef<Map<string, ToolEvent>>(new Map());

  // Fetch metrics every 10s
  const fetchMetrics = useCallback(async () => {
    try {
      const r = await fetch('/api/metrics');
      const data: Metrics = await r.json();
      setMetrics(data);
      setLatencyHistory((h) => [...h.slice(-19), data.db_latency_ms]);
      setQualityHistory((h) => [...h.slice(-19), data.quality_score]);
    } catch (err) {
      console.error('metrics fetch failed', err);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 12000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // SSE stream connection
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        const ev: AgentEvent = JSON.parse(msg.data);
        // Build ToolEvent from agent event
        if (ev.type === 'tool.call.start') {
          const te: ToolEvent = {
            id: ev.id,
            tool: String(ev.data.tool ?? 'unknown'),
            status: 'running',
            startedAt: ev.timestamp,
            input: ev.data.input as Record<string, unknown>,
          };
          eventMap.current.set(te.tool + '|' + ev.timestamp, te);
          setEvents((prev) => [te, ...prev].slice(0, 100));
        } else if (ev.type === 'tool.call.end' || ev.type === 'tool.call.error') {
          setEvents((prev) => prev.map((e) => {
            if (e.tool === ev.data.tool && e.status === 'running') {
              return {
                ...e,
                status: ev.type === 'tool.call.error' ? 'error' : 'success',
                duration: ev.duration,
                result: ev.data.result_summary as Record<string, unknown>,
                error: ev.data.error as string,
              };
            }
            return e;
          }));
        }
      } catch {}
    };
    return () => es.close();
  }, []);

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      {/* Cinematic background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 20% 30%, rgba(201,169,110,0.08), transparent 50%),
                            radial-gradient(circle at 80% 70%, rgba(167,139,250,0.05), transparent 50%)`,
        }} />
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(rgba(201,169,110,0.02) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(201,169,110,0.02) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }} />
      </div>

      {/* Top header bar */}
      <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/30 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <motion.div
            className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-gold to-amber-700 flex items-center justify-center"
            animate={{ boxShadow: ['0 0 20px rgba(201,169,110,0.3)','0 0 40px rgba(201,169,110,0.5)','0 0 20px rgba(201,169,110,0.3)'] }}
            transition={{ repeat: Infinity, duration: 3 }}
          >
            <CommandIcon className="w-5 h-5 text-black" />
          </motion.div>
          <div>
            <h1 className="font-cormorant text-2xl text-white leading-none">Command Center</h1>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mt-1">TWK Data Intelligence · Real-time</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* LIVE indicator */}
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
            <motion.div
              className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`}
              animate={connected ? { opacity: [1, 0.3, 1] } : {}}
              transition={{ repeat: Infinity, duration: 1.5 }}
            />
            <span className="text-[10px] font-bold tracking-widest text-white/70">{connected ? 'LIVE' : 'OFFLINE'}</span>
          </div>

          {/* ⌘K hint */}
          <kbd className="hidden md:flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white/50 cursor-pointer hover:bg-white/10 transition-colors"
            onClick={() => {
              // Trigger ⌘K
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
            }}>
            <CommandIcon className="w-3 h-3" />
            <span>K</span>
          </kbd>
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto p-6 space-y-6">
        {/* Metric Cards Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <LiveMetricCard
            label="Quality Score" value={metrics?.quality_score ?? 0}
            icon={ShieldCheck} accent="gold" format="percent"
            spark={qualityHistory}
          />
          <LiveMetricCard
            label="Restaurants" value={metrics?.total_restaurants ?? 0}
            icon={Database} accent="blue"
          />
          <LiveMetricCard
            label="Reservations" value={metrics?.total_reservations ?? 0}
            icon={Sparkles} accent="emerald"
          />
          <LiveMetricCard
            label="Critical Issues" value={metrics?.critical_issues ?? 0}
            icon={AlertCircle} accent="red"
          />
          <LiveMetricCard
            label="Tool Calls / 1h" value={metrics?.bus_stats?.tool_calls_1h ?? 0}
            icon={Brain} accent="amber"
          />
          <LiveMetricCard
            label="DB Latency" value={metrics?.db_latency_ms ?? 0}
            icon={Zap} accent="emerald" format="time" spark={latencyHistory}
          />
        </div>

        {/* Main split: Tool Stream (60%) + System (40%) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Tool stream */}
          <div className="lg:col-span-2 bg-black/30 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden h-[460px]">
            <ToolStream events={events} />
          </div>

          {/* System health + insights */}
          <div className="space-y-4">
            <div className="bg-black/30 backdrop-blur-xl border border-white/5 rounded-2xl p-5">
              <SystemHealth dbLatency={metrics?.db_latency_ms ?? 0} />
            </div>

            {/* Quick stats */}
            <div className="bg-black/30 backdrop-blur-xl border border-white/5 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Radio className="w-3.5 h-3.5 text-gold/60" />
                <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium">Live Insights</p>
              </div>
              <div className="space-y-3">
                <StatRow label="Eventos · 5min" value={metrics?.bus_stats?.events_5min ?? 0} />
                <StatRow label="Latência média tools" value={`${metrics?.bus_stats?.avg_tool_latency_ms ?? 0} ms`} />
                <StatRow label="Erros · 1h" value={metrics?.bus_stats?.errors_1h ?? 0}
                  emphasize={(metrics?.bus_stats?.errors_1h ?? 0) > 0 ? 'red' : 'ok'} />
                <StatRow label="Completude média" value={`${metrics?.avg_completeness ?? 0}%`} />
                <StatRow label="Tabelas no DB" value={metrics?.total_tables ?? 0} />
              </div>
            </div>

            {/* Last audit */}
            {metrics?.last_audit && (
              <div className="bg-gradient-to-br from-gold/10 to-transparent border border-gold/15 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-3.5 h-3.5 text-gold/60" />
                  <p className="text-[10px] uppercase tracking-widest text-gold/60 font-medium">Última auditoria</p>
                </div>
                <p className="text-sm text-white/80">
                  {new Date(metrics.last_audit).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Activity timeline */}
        <div className="bg-black/30 backdrop-blur-xl border border-white/5 rounded-2xl p-5">
          <ActivityTimeline events={events} />
        </div>

        {/* Quick action buttons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ActionCard label="Auditar Restaurantes"  icon={ShieldCheck} onClick={() => onNavigate('audit')}  accent="gold" />
          <ActionCard label="Conversar com Agente"   icon={Brain}       onClick={() => onNavigate('agent')}   accent="amber" />
          <ActionCard label="Console SQL"            icon={Activity}    onClick={() => onNavigate('query')}   accent="blue" />
          <ActionCard label="Abrir CRM"              icon={Sparkles}    onClick={() => onNavigate('crm')}     accent="emerald" />
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, emphasize }: { label: string; value: string | number; emphasize?: 'red' | 'ok' }) {
  const color = emphasize === 'red' ? 'text-red-400' : emphasize === 'ok' ? 'text-emerald-400' : 'text-white/80';
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-white/40">{label}</span>
      <span className={`font-mono font-medium ${color}`}>{value}</span>
    </div>
  );
}

function ActionCard({ label, icon: Icon, onClick, accent }: { label: string; icon: React.ElementType; onClick: () => void; accent: 'gold' | 'amber' | 'blue' | 'emerald' }) {
  const colors = {
    gold:    'from-gold/15 border-gold/20 text-gold hover:from-gold/25',
    amber:   'from-amber-500/15 border-amber-500/20 text-amber-400 hover:from-amber-500/25',
    blue:    'from-blue-500/15 border-blue-500/20 text-blue-400 hover:from-blue-500/25',
    emerald: 'from-emerald-500/15 border-emerald-500/20 text-emerald-400 hover:from-emerald-500/25',
  };
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={`bg-gradient-to-br ${colors[accent]} to-transparent border rounded-xl p-4 flex items-center gap-3 transition-all`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-sm font-medium">{label}</span>
    </motion.button>
  );
}
