/**
 * TWK Quality Monitoring
 * Snapshots históricos de quality score para detectar tendências e regressões.
 */

import { query } from './db';

export interface QualitySnapshot {
  id?:           number;
  table_name:    string;
  quality_score: number;
  total_rows:    number;
  critical_count: number;
  warning_count: number;
  info_count:    number;
  duplicates:    number;
  avg_completeness: number;
  metadata?:     Record<string, unknown>;
  captured_at?:  string;
}

/**
 * Cria a tabela de snapshots se não existir.
 * Chamada na primeira execução de monitoring.
 */
export async function ensureSnapshotTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS public.quality_snapshots (
      id               SERIAL PRIMARY KEY,
      table_name       TEXT NOT NULL,
      quality_score    INTEGER NOT NULL,
      total_rows       INTEGER NOT NULL,
      critical_count   INTEGER DEFAULT 0,
      warning_count    INTEGER DEFAULT 0,
      info_count       INTEGER DEFAULT 0,
      duplicates       INTEGER DEFAULT 0,
      avg_completeness INTEGER DEFAULT 0,
      metadata         JSONB,
      captured_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_quality_snapshots_table_time
    ON public.quality_snapshots (table_name, captured_at DESC)
  `);
}

export async function saveSnapshot(snap: QualitySnapshot): Promise<number> {
  await ensureSnapshotTable();
  const result = await query<{ id: number }>(
    `INSERT INTO public.quality_snapshots
       (table_name, quality_score, total_rows, critical_count, warning_count,
        info_count, duplicates, avg_completeness, metadata, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     RETURNING id`,
    [snap.table_name, snap.quality_score, snap.total_rows,
     snap.critical_count, snap.warning_count, snap.info_count,
     snap.duplicates, snap.avg_completeness,
     snap.metadata ? JSON.stringify(snap.metadata) : null]
  );
  return result.rows[0].id;
}

export async function getSnapshotHistory(
  tableName: string,
  days = 30
): Promise<QualitySnapshot[]> {
  await ensureSnapshotTable();
  const result = await query<QualitySnapshot>(
    `SELECT * FROM public.quality_snapshots
     WHERE table_name = $1
       AND captured_at > NOW() - ($2 || ' days')::interval
     ORDER BY captured_at ASC`,
    [tableName, days]
  );
  return result.rows;
}

export interface TrendAnalysis {
  current?: QualitySnapshot;
  previous?: QualitySnapshot;
  delta_score: number;
  delta_critical: number;
  delta_completeness: number;
  trend: 'improving' | 'degrading' | 'stable' | 'no_data';
  alert?: string;
}

export async function analyzeTrend(tableName: string): Promise<TrendAnalysis> {
  const history = await getSnapshotHistory(tableName, 30);
  if (history.length === 0) {
    return { delta_score: 0, delta_critical: 0, delta_completeness: 0, trend: 'no_data' };
  }
  if (history.length === 1) {
    return { current: history[0], delta_score: 0, delta_critical: 0, delta_completeness: 0, trend: 'stable' };
  }

  const current = history[history.length - 1];
  const previous = history[history.length - 2];
  const dScore = current.quality_score - previous.quality_score;
  const dCritical = current.critical_count - previous.critical_count;
  const dCompleteness = current.avg_completeness - previous.avg_completeness;

  let trend: TrendAnalysis['trend'] = 'stable';
  let alert: string | undefined;
  if (dScore <= -5) {
    trend = 'degrading';
    alert = `🚨 Quality score caiu ${Math.abs(dScore)} pontos desde a última verificação`;
  } else if (dCritical > 10) {
    trend = 'degrading';
    alert = `⚠️ +${dCritical} novos problemas críticos detectados`;
  } else if (dScore >= 5) {
    trend = 'improving';
  }

  return { current, previous, delta_score: dScore, delta_critical: dCritical,
    delta_completeness: dCompleteness, trend, alert };
}
