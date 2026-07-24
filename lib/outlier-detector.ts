/**
 * TWK Outlier Detector
 * Detecção estatística de anomalias e padrões suspeitos.
 */

export interface OutlierResult {
  row_id: unknown;
  column: string;
  value:  unknown;
  z_score?: number;
  reason: string;
  severity: 'critical' | 'warning' | 'info';
}

interface NumericStats { mean: number; stdev: number; min: number; max: number; q1: number; q3: number; iqr: number }

function calcStats(values: number[]): NumericStats | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length;
  const stdev = Math.sqrt(variance);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  return { mean, stdev, min: sorted[0], max: sorted[sorted.length - 1], q1, q3, iqr: q3 - q1 };
}

/**
 * Detecta valores numéricos com |z-score| > threshold.
 * Útil para: commission_per_person, rating, prices.
 */
export function detectNumericOutliers(
  rows: Record<string, unknown>[],
  column: string,
  idCol = 'id',
  zThreshold = 3.0
): OutlierResult[] {
  const values = rows
    .map((r) => ({ id: r[idCol], v: Number(r[column]) }))
    .filter((x) => Number.isFinite(x.v));

  const stats = calcStats(values.map((x) => x.v));
  if (!stats || stats.stdev === 0) return [];

  return values
    .filter((x) => Math.abs((x.v - stats.mean) / stats.stdev) > zThreshold)
    .map((x) => ({
      row_id: x.id,
      column,
      value: x.v,
      z_score: Math.round(((x.v - stats.mean) / stats.stdev) * 100) / 100,
      reason: `Valor desvia ${Math.abs(Math.round((x.v - stats.mean) / stats.stdev * 10) / 10)}σ da média (${Math.round(stats.mean * 100) / 100})`,
      severity: Math.abs((x.v - stats.mean) / stats.stdev) > 5 ? 'critical' : 'warning',
    }));
}

/**
 * Detecta datas suspeitas: futuro, antigas demais, ou data zero.
 */
export function detectDateAnomalies(
  rows: Record<string, unknown>[],
  column: string,
  idCol = 'id',
  options: { allowFuture?: boolean; minYear?: number } = {}
): OutlierResult[] {
  const { allowFuture = false, minYear = 1990 } = options;
  const now = Date.now();
  const results: OutlierResult[] = [];

  for (const row of rows) {
    const v = row[column];
    if (v == null || v === '') continue;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) continue;

    if (!allowFuture && d.getTime() > now + 86400000) {
      results.push({
        row_id: row[idCol], column, value: v,
        reason: `Data no futuro: ${d.toISOString().slice(0, 10)}`,
        severity: 'critical',
      });
    } else if (d.getFullYear() < minYear) {
      results.push({
        row_id: row[idCol], column, value: v,
        reason: `Data anterior a ${minYear}: ${d.toISOString().slice(0, 10)}`,
        severity: 'warning',
      });
    } else if (d.getFullYear() === 1970) {
      results.push({
        row_id: row[idCol], column, value: v,
        reason: 'Data unix epoch (1970) — provavelmente null tratado errado',
        severity: 'critical',
      });
    }
  }
  return results;
}

/**
 * Detecta padrões suspeitos em texto:
 * - mesmo valor repetido em N+ registros (e-mail genérico, telefone placeholder)
 * - valores de placeholder (test, example, lorem, asdf)
 */
const PLACEHOLDER_PATTERNS = [
  /\btest\b/i, /\bexample\b/i, /\blorem\b/i, /\basdf+\b/i,
  /\bxxx+\b/i, /\bnull\b/i, /\bn[\/-]?a\b/i, /1234567/, /\bnone\b/i,
];

export function detectPlaceholders(
  rows: Record<string, unknown>[],
  column: string,
  idCol = 'id'
): OutlierResult[] {
  return rows
    .filter((r) => {
      const v = String(r[column] ?? '').trim();
      return v && PLACEHOLDER_PATTERNS.some((p) => p.test(v));
    })
    .map((r) => ({
      row_id: r[idCol],
      column,
      value: r[column],
      reason: 'Valor parece ser placeholder/teste',
      severity: 'warning' as const,
    }));
}

/**
 * Detecta valores excessivamente repetidos numa coluna que deveria ser única-ish.
 */
export function detectOverRepetition(
  rows: Record<string, unknown>[],
  column: string,
  idCol = 'id',
  minRepeats = 5
): OutlierResult[] {
  const counts = new Map<string, unknown[]>();
  for (const r of rows) {
    const v = r[column];
    if (v == null || v === '') continue;
    const key = String(v).toLowerCase().trim();
    if (!counts.has(key)) counts.set(key, []);
    counts.get(key)!.push(r[idCol]);
  }
  const results: OutlierResult[] = [];
  for (const [val, ids] of counts) {
    if (ids.length >= minRepeats) {
      for (const id of ids) {
        results.push({
          row_id: id, column, value: val,
          reason: `Valor "${val.slice(0, 40)}" se repete em ${ids.length} registros`,
          severity: ids.length > 20 ? 'critical' : 'warning',
        });
      }
    }
  }
  return results;
}

/**
 * Verifica se latitude/longitude está dentro do bounding box conhecido da cidade.
 * Usa cache simples de bbox para grandes cidades.
 */
const CITY_BBOX: Record<string, [number, number, number, number]> = {
  // [latMin, latMax, lngMin, lngMax]
  'paris':       [48.8156, 48.9022, 2.2241, 2.4699],
  'london':      [51.2868, 51.6919, -0.5103, 0.3340],
  'new york':    [40.4774, 40.9176, -74.2591, -73.7004],
  'tokyo':       [35.5286, 35.8175, 139.5803, 139.9170],
  'são paulo':   [-23.7330, -23.3565, -46.8265, -46.3650],
  'rio de janeiro':[-23.0822,-22.7460,-43.7958,-43.0964],
  'madrid':      [40.3120, 40.5638, -3.8889, -3.5179],
  'barcelona':   [41.3169, 41.4695, 2.0524, 2.2289],
  'milan':       [45.3878, 45.5374, 9.0405, 9.2773],
  'rome':        [41.7600, 42.0300, 12.3300, 12.6300],
  'dubai':       [24.7800, 25.4000, 54.9000, 55.6500],
};

export function detectGeofenceViolations(
  rows: Record<string, unknown>[],
  latCol = 'latitude',
  lngCol = 'longitude',
  cityCol = 'city',
  idCol = 'id'
): OutlierResult[] {
  const results: OutlierResult[] = [];
  for (const r of rows) {
    const lat = Number(r[latCol]); const lng = Number(r[lngCol]);
    const city = String(r[cityCol] ?? '').toLowerCase().trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !city) continue;
    if (lat === 0 && lng === 0) continue; // já capturado em outro check
    const bbox = CITY_BBOX[city];
    if (!bbox) continue; // sem bbox conhecido, skip
    const [latMin, latMax, lngMin, lngMax] = bbox;
    if (lat < latMin || lat > latMax || lng < lngMin || lng > lngMax) {
      results.push({
        row_id: r[idCol], column: `${latCol},${lngCol}`,
        value: `(${lat}, ${lng})`,
        reason: `Coords fora do bounding box conhecido de ${city}`,
        severity: 'critical',
      });
    }
  }
  return results;
}
