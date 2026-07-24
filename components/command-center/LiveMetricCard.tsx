'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  label:   string;
  value:   number;
  suffix?: string;
  icon:    LucideIcon;
  trend?:  number;   // delta percentual
  spark?:  number[]; // sparkline data points
  accent?: 'gold' | 'emerald' | 'amber' | 'red' | 'blue';
  format?: 'number' | 'percent' | 'time';
}

const ACCENT = {
  gold:    { stroke: '#c9a96e', glow: 'rgba(201,169,110,0.4)',  bg: 'from-gold/10 to-transparent' },
  emerald: { stroke: '#34d399', glow: 'rgba(52,211,153,0.4)',   bg: 'from-emerald-500/10 to-transparent' },
  amber:   { stroke: '#fbbf24', glow: 'rgba(251,191,36,0.4)',   bg: 'from-amber-500/10 to-transparent' },
  red:     { stroke: '#f87171', glow: 'rgba(248,113,113,0.4)',  bg: 'from-red-500/10 to-transparent' },
  blue:    { stroke: '#60a5fa', glow: 'rgba(96,165,250,0.4)',   bg: 'from-blue-500/10 to-transparent' },
};

// Animated number counter
function useCountUp(target: number, duration = 800): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const start = val;
    const startTime = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(start + (target - start) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return val;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data?.length) return null;
  const w = 100, h = 32;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width="100" height="32" viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,${h} ${pts} ${w},${h}`}
        fill={`url(#spark-${color.replace('#','')})`} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function LiveMetricCard({
  label, value, suffix, icon: Icon, trend, spark, accent = 'gold', format = 'number',
}: Props) {
  const animated = useCountUp(value);
  const cfg = ACCENT[accent];

  const display = format === 'percent' ? `${animated}%`
    : format === 'time' ? `${animated} ms`
    : animated.toLocaleString('pt-BR');

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${cfg.bg} bg-white/[0.02] border border-white/5 p-5 group`}
    >
      {/* Glow effect on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: `radial-gradient(circle at 50% 0%, ${cfg.glow}, transparent 70%)` }} />

      <div className="relative flex items-start justify-between mb-3">
        <Icon className="w-4 h-4 opacity-50" style={{ color: cfg.stroke }} />
        {trend !== undefined && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            trend > 0 ? 'text-emerald-400 bg-emerald-400/10'
            : trend < 0 ? 'text-red-400 bg-red-400/10'
            : 'text-white/30 bg-white/5'
          }`}>
            {trend > 0 ? '↑' : trend < 0 ? '↓' : '–'} {Math.abs(trend)}%
          </span>
        )}
      </div>

      <div className="relative">
        <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">{label}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-cormorant font-light tracking-tight" style={{ color: cfg.stroke }}>
            {display}
          </span>
          {suffix && <span className="text-xs text-white/30">{suffix}</span>}
        </div>
      </div>

      {spark && spark.length > 1 && (
        <div className="mt-3 -mx-1">
          <Sparkline data={spark} color={cfg.stroke} />
        </div>
      )}
    </motion.div>
  );
}
