/**
 * TWK Observability — periodic, PERSISTED health snapshots so quality/SEO regressions are
 * visible over time (not just via an on-demand audit). Reuses the existing quality_snapshots
 * table (keyed by a synthetic table_name) so it needs no new schema. DB-only, zero external cost.
 */
import { saveSnapshot, getSnapshotHistory } from './monitoring';
import { seoAudit, coversGap } from './seo';

const HEALTH_KEY = '_health';

export interface HealthSnapshot {
  seo_score: number;
  published: number;
  covers_coverage: number;
  covers_missing: number;
  unique_desc_pct: number;
  structured_pct: number;
}

export interface TrendPoint { captured_at: string; seo_score: number; covers_coverage: number; }

/** Compute + persist one health snapshot. Cheap (aggregate queries only). */
export async function captureSnapshot(): Promise<HealthSnapshot> {
  const [audit, covers] = await Promise.all([seoAudit(), coversGap()]);
  const pctOf = (prefix: string) => {
    const c = audit.checks.find((x) => x.check.startsWith(prefix));
    return c && c.of ? Math.round((c.value / c.of) * 100) : 0;
  };
  const snap: HealthSnapshot = {
    seo_score: audit.score,
    published: audit.published,
    covers_coverage: covers.coverage,
    covers_missing: covers.missing,
    unique_desc_pct: pctOf('Descrições'),
    structured_pct: pctOf('Structured'),
  };
  await saveSnapshot({
    table_name: HEALTH_KEY,
    quality_score: snap.seo_score,
    total_rows: snap.published,
    critical_count: snap.covers_missing,
    warning_count: 0,
    info_count: 0,
    duplicates: 0,
    avg_completeness: snap.covers_coverage,
    metadata: snap as unknown as Record<string, unknown>,
  });
  return snap;
}

/** Recent health snapshots for the trend line (oldest → newest). */
export async function getHealthTrend(days = 90): Promise<TrendPoint[]> {
  const rows = await getSnapshotHistory(HEALTH_KEY, days);
  return rows.map((r) => ({
    captured_at: String(r.captured_at),
    seo_score: r.quality_score,
    covers_coverage: r.avg_completeness,
  }));
}
