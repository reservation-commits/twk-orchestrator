import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { bus } from '@/lib/event-bus';
import { auditRows, scoreRowCompleteness } from '@/lib/validator';

export const dynamic = 'force-dynamic';

interface ServiceHealth {
  name: string;
  ok: boolean | null;
  latency_ms?: number;
  checked_at?: string;
  note?: string;
}

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
  services: ServiceHealth[];
}

// Cache module-level da sonda do Google Places (60s) para não gerar custo a cada poll.
const globalForHealth = globalThis as unknown as {
  __twkPlacesHealth?: { health: ServiceHealth; at: number };
};
const PLACES_HEALTH_TTL_MS = 60_000;

async function probeGooglePlaces(): Promise<ServiceHealth | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;

  const cached = globalForHealth.__twkPlacesHealth;
  if (cached && Date.now() - cached.at < PLACES_HEALTH_TTL_MS) return cached.health;

  const start = Date.now();
  let ok = false;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=restaurant&inputtype=textquery&fields=place_id&key=${key}`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const data = (await res.json()) as { status?: string };
      ok = data.status === 'OK' || data.status === 'ZERO_RESULTS';
    }
  } catch { ok = false; }

  const health: ServiceHealth = {
    name: 'google_places',
    ok,
    latency_ms: Date.now() - start,
    checked_at: new Date().toISOString(),
  };
  globalForHealth.__twkPlacesHealth = { health, at: Date.now() };
  return health;
}

export async function GET() {
  const start = Date.now();

  // Ping real do Postgres com latência própria (isolado das queries de métricas).
  const pgStart = Date.now();
  let pgOk = false;
  try { await query('SELECT 1'); pgOk = true; } catch { /* db fora */ }
  const pgLatency = Date.now() - pgStart;

  const results = await Promise.allSettled([
    query<{ n: string }>('SELECT COUNT(*) as n FROM public.db_restaurants'),
    query<{ n: string }>('SELECT COUNT(*) as n FROM information_schema.tables WHERE table_schema NOT IN (\'pg_catalog\',\'information_schema\')'),
    query<{ n: string }>('SELECT COUNT(*) as n FROM public.reservations'),
    query<{ n: string }>('SELECT COUNT(*) as n FROM public.db_restaurants WHERE latitude IS NULL OR longitude IS NULL OR (latitude = 0 AND longitude = 0)'),
    // Amostra determinística: sempre as mesmas linhas (mais recentes primeiro) →
    // o quality_score para de oscilar entre polls.
    query('SELECT * FROM public.db_restaurants ORDER BY restaurant_id DESC LIMIT 500'),
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

  // ── Saúde real dos serviços externos ──────────────────────────────────────
  const services: ServiceHealth[] = [
    { name: 'postgres', ok: pgOk, latency_ms: pgLatency, checked_at: new Date().toISOString() },
  ];
  const placesHealth = await probeGooglePlaces();
  if (placesHealth) services.push(placesHealth);
  // Anthropic: sem sonda ativa (chamada é paga); ok:null = estado desconhecido.
  services.push({ name: 'anthropic', ok: null, note: 'sem sonda ativa' });

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
    services,
  };

  bus.emit('system.metric', { quality_score: qualityScore, db_latency_ms: dbLatency });

  return NextResponse.json(data);
}
