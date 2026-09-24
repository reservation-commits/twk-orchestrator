'use client';

import { motion } from 'framer-motion';
import type { ToolEvent } from './ToolStream';

/**
 * Horizontal scrollable timeline showing tool calls over the last hour.
 * Each event = a dot. Color codes by status.
 */
export default function ActivityTimeline({ events }: { events: ToolEvent[] }) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // last hour
  const visible = events.filter((e) => now - e.startedAt < windowMs);

  // Group into 60 minute buckets
  const buckets: Array<{ minute: number; count: number; success: number; error: number }> = [];
  for (let i = 0; i < 60; i++) buckets.push({ minute: i, count: 0, success: 0, error: 0 });

  for (const e of visible) {
    const min = Math.floor((now - e.startedAt) / 60000);
    if (min >= 0 && min < 60) {
      const b = buckets[59 - min];
      b.count++;
      if (e.status === 'error') b.error++; else if (e.status === 'success') b.success++;
    }
  }

  const max = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium">Activity Timeline · última hora</p>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{visible.filter((e) => e.status === 'success').length} ok</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />{visible.filter((e) => e.status === 'error').length} erros</span>
          <span className="text-white/30">{visible.length} total</span>
        </div>
      </div>

      <div className="h-16 flex items-end gap-px relative bg-white/[0.01] border border-white/5 rounded-xl px-2 pt-2 pb-1">
        {buckets.map((b, i) => {
          const h = b.count > 0 ? (b.count / max) * 100 : 0;
          return (
            <div key={i} className="flex-1 h-full flex flex-col justify-end relative group">
              {b.count > 0 && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ delay: i * 0.01 }}
                  className={`w-full rounded-sm ${
                    b.error > 0 ? 'bg-gradient-to-t from-red-400/40 to-red-400'
                    : 'bg-gradient-to-t from-gold/30 to-gold'
                  }`}
                />
              )}
              {/* Hover tooltip */}
              {b.count > 0 && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  <div className="bg-black/90 border border-white/10 rounded px-2 py-1 text-[10px] text-white whitespace-nowrap">
                    <p className="font-medium">{b.count} eventos</p>
                    <p className="text-white/40">{60 - i} min atrás</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-1 text-[9px] text-white/30 px-2">
        <span>60min atrás</span>
        <span>30min</span>
        <span>agora →</span>
      </div>
    </div>
  );
}
