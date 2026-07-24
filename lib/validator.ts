/**
 * TWK Data Quality Validator
 * Regras de validação por tipo de campo + scoring de completude
 */

export type IssueSeverity = 'critical' | 'warning' | 'info';

export interface FieldIssue {
  row_id:    unknown;
  column:    string;
  value:     unknown;
  severity:  IssueSeverity;
  rule:      string;
  message:   string;
  suggested?: string;
}

export interface ColumnStats {
  column:       string;
  total:        number;
  nulls:        number;
  blanks:       number;
  duplicates:   number;
  invalid:      number;
  completeness: number; // 0-100
  issues:       FieldIssue[];
}

export interface TableAuditResult {
  table:          string;
  scanned_at:     string;
  total_rows:     number;
  quality_score:  number; // 0-100
  critical_count: number;
  warning_count:  number;
  info_count:     number;
  columns:        ColumnStats[];
  duplicate_groups: DuplicateGroup[];
  consistency_issues: ConsistencyIssue[];
}

export interface DuplicateGroup {
  ids:        unknown[];
  names:      string[];
  similarity: number;
  field:      string;
}

export interface ConsistencyIssue {
  severity: IssueSeverity;
  rule:     string;
  count:    number;
  sample:   unknown[];
}

// ── Regex validators ─────────────────────────────────────────────────────────

export const RULES = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    test: (v: string) => RULES.email.pattern.test(v.trim()),
    message: 'Formato de e-mail inválido',
  },
  phone: {
    // aceita formatos internacionais e brasileiros
    pattern: /^\+?[\d\s\-().]{7,20}$/,
    test: (v: string) => RULES.phone.pattern.test(v.trim()),
    message: 'Formato de telefone inválido',
  },
  url: {
    pattern: /^https?:\/\/.{3,}/,
    test: (v: string) => { try { new URL(v); return true; } catch { return false; } },
    message: 'URL inválida (deve começar com http/https)',
  },
  latitude: {
    // Coerce: validateValue passes the stringified cell, so `typeof number` alone always failed.
    test: (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= -90 && n <= 90; },
    message: 'Latitude fora do intervalo -90…90',
  },
  longitude: {
    test: (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= -180 && n <= 180; },
    message: 'Longitude fora do intervalo -180…180',
  },
  slug: {
    pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    test: (v: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v),
    message: 'Slug deve conter apenas letras minúsculas, números e hífens',
  },
  rating: {
    test: (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 5; },
    message: 'Rating deve estar entre 0 e 5',
  },
  price_level: {
    test: (v: unknown) => [1, 2, 3, 4].includes(Number(v)),
    message: 'price_level deve ser 1, 2, 3 ou 4',
  },
  coordinates_zero: {
    test: (lat: unknown, lng: unknown) => !(lat === 0 && lng === 0),
    message: 'Coordenadas (0,0) indicam dado inválido',
  },
};

// ── Column-level rule map ─────────────────────────────────────────────────────

export const COLUMN_RULES: Record<string, {
  required?: boolean;
  type?: 'email' | 'phone' | 'url' | 'slug' | 'latitude' | 'longitude' | 'rating' | 'price_level';
  minLength?: number;
  maxLength?: number;
  severity?: IssueSeverity;
}> = {
  // db_restaurants — real TWK schema
  name:                          { required: true,  minLength: 2, maxLength: 200 },
  slug:                          { required: true,  type: 'slug' },
  address_of_establishment:      { required: true,  minLength: 10 },
  city:                          { required: true,  minLength: 2 },
  country:                       { required: true,  minLength: 2 },
  latitude:                      { required: true,  type: 'latitude' },
  longitude:                     { required: true,  type: 'longitude' },
  telephone_of_the_establishment:{ required: false, type: 'phone',   severity: 'warning' },
  site_url:                      { required: false, type: 'url',     severity: 'warning' },
  email_for_reservations:        { required: false, type: 'email',   severity: 'warning' },
  about_text:                    { required: false, minLength: 20,   severity: 'info' },
  url_page_twk:                  { required: false, type: 'url',     severity: 'info' },
  logo_url:                      { required: false, type: 'url',     severity: 'info' },
  // generic aliases (for other tables)
  email:                         { required: false, type: 'email',   severity: 'warning' },
  phone:                         { required: false, type: 'phone',   severity: 'warning' },
  website:                       { required: false, type: 'url',     severity: 'warning' },
  address:                       { required: true,  minLength: 10 },
  description:                   { required: false, minLength: 20,   severity: 'info' },
  rating:                        { required: false, type: 'rating' },
  price_level:                   { required: false, type: 'price_level' },
  created_at:                    { required: true },
};

// ── Validate a single value ───────────────────────────────────────────────────

export function validateValue(
  column: string,
  value: unknown,
  rowId: unknown
): FieldIssue | null {
  const rule = COLUMN_RULES[column];
  const isNull = value === null || value === undefined;
  const isBlank = !isNull && String(value).trim() === '';
  const str = isNull ? '' : String(value).trim();

  if (isNull || isBlank) {
    if (rule?.required) {
      return {
        row_id: rowId, column, value,
        severity: 'critical',
        rule: 'required',
        message: `Campo obrigatório está ${isNull ? 'nulo' : 'vazio'}`,
      };
    }
    if (column in COLUMN_RULES) {
      return {
        row_id: rowId, column, value,
        severity: rule?.severity ?? 'warning',
        rule: 'missing',
        message: `Campo recomendado está vazio`,
      };
    }
    return null;
  }

  if (rule?.type) {
    const validator = RULES[rule.type] as { test: (v: unknown) => boolean; message: string } | undefined;
    if (validator && !validator.test(str)) {
      return {
        row_id: rowId, column, value,
        severity: rule.severity ?? 'critical',
        rule: `format:${rule.type}`,
        message: validator.message,
        suggested: rule.type === 'url' && !str.startsWith('http') ? `https://${str}` : undefined,
      };
    }
  }

  if (rule?.minLength && str.length < rule.minLength) {
    return {
      row_id: rowId, column, value,
      severity: rule.severity ?? 'warning',
      rule: 'min_length',
      message: `Muito curto (${str.length} chars, mínimo ${rule.minLength})`,
    };
  }

  if (rule?.maxLength && str.length > rule.maxLength) {
    return {
      row_id: rowId, column, value,
      severity: 'info',
      rule: 'max_length',
      message: `Muito longo (${str.length} chars, máximo ${rule.maxLength})`,
    };
  }

  return null;
}

// ── Completeness score per row ────────────────────────────────────────────────

const SCORED_COLUMNS = [
  // db_restaurants real columns
  'name','address_of_establishment','city','country','latitude','longitude',
  'telephone_of_the_establishment','site_url','email_for_reservations',
  'about_text','logo_url','images_json','business_hours_json','slug','published',
  // generic fallbacks
  'address','phone','website','email','description','rating','price_level','photos',
];

export function scoreRowCompleteness(row: Record<string, unknown>): number {
  const available = SCORED_COLUMNS.filter((c) => c in row);
  if (!available.length) return 0;
  const filled = available.filter((c) => {
    const v = row[c];
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  return Math.round((filled.length / available.length) * 100);
}

// ── Fuzzy duplicate detection ─────────────────────────────────────────────────

function normalise(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalise(a);
  const nb = normalise(b);
  if (na === nb) return 1;
  // Jaccard on trigrams
  const tri = (s: string) => {
    const t = new Set<string>();
    for (let i = 0; i < s.length - 2; i++) t.add(s.slice(i, i + 3));
    return t;
  };
  const ta = tri(na);
  const tb = tri(nb);
  const intersection = [...ta].filter((x) => tb.has(x)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

export function findDuplicateGroups(
  rows: Record<string, unknown>[],
  idCol: string,
  nameCol: string,
  threshold = 0.85
): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    if (seen.has(i)) continue;
    const group: number[] = [i];
    const nameI = String(rows[i][nameCol] ?? '');

    for (let j = i + 1; j < rows.length; j++) {
      if (seen.has(j)) continue;
      const nameJ = String(rows[j][nameCol] ?? '');
      const sim = similarity(nameI, nameJ);
      if (sim >= threshold) {
        group.push(j);
        seen.add(j);
      }
    }

    if (group.length > 1) {
      groups.push({
        ids:        group.map((idx) => rows[idx][idCol]),
        names:      group.map((idx) => String(rows[idx][nameCol] ?? '')),
        similarity: Math.max(...group.slice(1).map((idx) => similarity(nameI, String(rows[idx][nameCol] ?? '')))),
        field:      nameCol,
      });
      seen.add(i);
    }
  }

  return groups;
}

// ── Table-level audit ─────────────────────────────────────────────────────────

export function auditRows(
  rows: Record<string, unknown>[],
  tableName: string,
  idCol = 'id',
  checkColumns?: string[]
): TableAuditResult {
  const cols = checkColumns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const columnMap = new Map<string, ColumnStats>();

  for (const col of cols) {
    columnMap.set(col, {
      column: col, total: rows.length,
      nulls: 0, blanks: 0, duplicates: 0, invalid: 0,
      completeness: 0, issues: [],
    });
  }

  // Per-cell validation
  for (const row of rows) {
    for (const col of cols) {
      const stats = columnMap.get(col)!;
      const val = row[col];
      if (val === null || val === undefined) {
        stats.nulls++;
      } else if (String(val).trim() === '') {
        stats.blanks++;
      }
      const issue = validateValue(col, val, row[idCol]);
      if (issue) {
        stats.invalid++;
        stats.issues.push(issue);
      }
    }
  }

  // Completeness per column
  for (const stats of columnMap.values()) {
    const filled = stats.total - stats.nulls - stats.blanks;
    stats.completeness = stats.total > 0 ? Math.round((filled / stats.total) * 100) : 0;
  }

  // Duplicate detection on name column if present
  const nameCol = cols.find((c) => c === 'name') ?? cols[0];
  const duplicateGroups = rows.length <= 5000
    ? findDuplicateGroups(rows, idCol, nameCol)
    : [];

  // Coordinate consistency
  const consistencyIssues: ConsistencyIssue[] = [];
  if (cols.includes('latitude') && cols.includes('longitude')) {
    const zeroCoords = rows.filter((r) => r.latitude === 0 && r.longitude === 0);
    if (zeroCoords.length) {
      consistencyIssues.push({
        severity: 'critical',
        rule: 'coordinates_zero',
        count: zeroCoords.length,
        sample: zeroCoords.slice(0, 3).map((r) => r[idCol]),
      });
    }
  }

  // All issues flat
  const allIssues = [...columnMap.values()].flatMap((c) => c.issues);
  const criticalCount = allIssues.filter((i) => i.severity === 'critical').length;
  const warningCount  = allIssues.filter((i) => i.severity === 'warning').length;
  const infoCount     = allIssues.filter((i) => i.severity === 'info').length;

  // Global quality score
  const totalCells = rows.length * cols.length;
  const problemCells = criticalCount * 3 + warningCount * 1.5 + infoCount * 0.5
    + duplicateGroups.length * 5
    + consistencyIssues.reduce((s, c) => s + c.count, 0) * 2;
  const qualityScore = Math.max(0, Math.round(100 - (problemCells / (totalCells || 1)) * 100));

  return {
    table: tableName,
    scanned_at: new Date().toISOString(),
    total_rows: rows.length,
    quality_score: qualityScore,
    critical_count: criticalCount,
    warning_count: warningCount,
    info_count: infoCount,
    columns: [...columnMap.values()],
    duplicate_groups: duplicateGroups,
    consistency_issues: consistencyIssues,
  };
}
