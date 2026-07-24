import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { bus } from '@/lib/event-bus';
import { auditRows, scoreRowCompleteness } from '@/lib/validator';

export const dynamic = 'force-dynamic';

interface OverviewMetrics {
  quality_score: number;
  total_restaurants: number;
  total_tables: number;
  total_reservations: number;
  avg_completeness: number;
  critical_issues: number;
  last_audit?: string;
  bus_stats: ReturnType<typeof bus.getStats>;
  db_latency_ms: number;
}

export async function GET() {
  const start = Date.now();
  const results = await Promise.allSettled([
    query<{ n: string }>('SELECT COUNT(*) as n FROM public.db_restaurants'),
    query<{ n: string }>('SELECT COUNT(*) as n FROM information_schema.tables WHERE table_schema NOT IN (\'pg_catalog\',\'information_schema\')'),
    query<{ n: string }>('SELECT COUNT(*) as n FROM public.reservations'),
    query<{ n: string }>('SELECT COUNT(*) as n FROM public.db_restaurants WHERE latitude IS NULL OR longitude IS NULL OR (latitude = 0 AND longitude = 0)'),
    query('SELECT * FROM public.db_restaurants LIMIT 200'),
    query('SELECT captured_at, quality_score FROM public.quality_snapshots ORDER BY captured_at DESC LIMIT 1'),
  ]);

  const get = <T = unknown>(i: number, fallback: T): T => {
    const r = results[i];
    return r.status === 'fulfilled' ? (r.value.rows as unknown as T) : fallback;
  };

  const totalRest    = parseInt((get<{ n: string }[]>(0, [{ n: '0' }]))[0]?.n ?? '0', 10);
  const totalTables  = parseInt((get<{ n: string }[]>(1, [{ n: '0' }]))[0]?.n ?? '0', 10);
  const totalRes     = parseInt((get<{ n: string }[]>(2, [{ n: '0' }]))[0]?.n ?? '0', 10);
  const criticalCnt  = parseInt((get<{ n: string }[]>(3, [{ n: '0' }]))[0]?.n ?? '0', 10);

  const sample = get<Record<string, unknown>[]>(4, []);
  let qualityScore = 0;
  let avgCompleteness = 0;
  if (sample.length) {
    const report = auditRows(sample, 'public.db_restaurants', 'restaurant_id');
    qualityScore = report.quality_score;
    const scored = sample.map((r) => scoreRowCompleteness(r));
    avgCompleteness = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;
  }

  const lastSnapshot = get<{ captured_at: string; quality_score: number }[]>(5, []);

  const dbLatency = Date.now() - start;

  const data: OverviewMetrics = {
    quality_score: qualityScore,
    total_restaurants: totalRest,
    total_tables: totalTables,
    total_reservations: totalRes,
    avg_completeness: avgCompleteness,
    critical_issues: criticalCnt,
    last_audit: lastSnapshot[0]?.captured_at,
    bus_stats: bus.getStats(),
    db_latency_ms: dbLatency,
  };

  bus.emit('system.metric', { quality_score: qualityScore, db_latency_ms: dbLatency });

  return NextResponse.json(data);
}
