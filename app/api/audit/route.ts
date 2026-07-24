import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { auditRows, scoreRowCompleteness, findDuplicateGroups, validateValue } from '@/lib/validator';
import { batchCheckEmails, batchCheckUrls, checkPhoneReality, checkPlacesFreshness, validateGeoCoords } from '@/lib/reality-checker';
import { detectNumericOutliers, detectDateAnomalies, detectPlaceholders, detectOverRepetition, detectGeofenceViolations } from '@/lib/outlier-detector';
import { batchSemanticAnalysis } from '@/lib/semantic-checker';
import { generateAutoFixSuggestions } from '@/lib/auto-fixer';
import { saveSnapshot, getSnapshotHistory, analyzeTrend } from '@/lib/monitoring';
import { findRestaurantEmail, batchFindEmails } from '@/lib/email-finder';

const BATCH = 2000; // max rows to load for audit

async function loadRows(table: string, limit = BATCH): Promise<Record<string, unknown>[]> {
  const result = await query(`SELECT * FROM ${table} LIMIT $1`, [limit]);
  return result.rows;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {

      // ── Full table audit ─────────────────────────────────────────────────
      case 'audit_table': {
        const { table, columns, id_column } = z.object({
          table:     z.string(),
          columns:   z.array(z.string()).optional(),
          id_column: z.string().optional(),
        }).parse(body);

        const rows = await loadRows(table);
        // Auto-detect primary key: prefer restaurant_id, then id, then first column
        const pk = id_column ?? (rows[0] && 'restaurant_id' in rows[0] ? 'restaurant_id' : 'id');
        const report = auditRows(rows, table, pk, columns);
        return NextResponse.json(report);
      }

      // ── Completeness report per row ──────────────────────────────────────
      case 'completeness_report': {
        const { table, limit } = z.object({
          table: z.string(),
          limit: z.number().default(500),
        }).parse(body);

        const rows = await loadRows(table, limit);
        const scored = rows.map((row) => ({
          id:    row.id ?? row.place_id,
          name:  row.name ?? row.title ?? String(row.id),
          score: scoreRowCompleteness(row),
          row,
        })).sort((a, b) => a.score - b.score);

        const avg = scored.length
          ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length)
          : 0;

        return NextResponse.json({
          total: scored.length,
          avg_completeness: avg,
          worst: scored.slice(0, 50),
          best:  scored.slice(-20).reverse(),
          distribution: {
            critical: scored.filter((r) => r.score < 40).length,
            poor:     scored.filter((r) => r.score >= 40 && r.score < 60).length,
            fair:     scored.filter((r) => r.score >= 60 && r.score < 80).length,
            good:     scored.filter((r) => r.score >= 80 && r.score < 95).length,
            excellent:scored.filter((r) => r.score >= 95).length,
          },
        });
      }

      // ── Find duplicates ──────────────────────────────────────────────────
      case 'find_duplicates': {
        const { table, name_column, id_column, threshold } = z.object({
          table:       z.string(),
          name_column: z.string().default('name'),
          id_column:   z.string().default('id'),
          threshold:   z.number().min(0.5).max(1).default(0.85),
        }).parse(body);

        const rows = await loadRows(table, 3000);
        const groups = findDuplicateGroups(rows, id_column, name_column, threshold);
        return NextResponse.json({ groups, count: groups.length });
      }

      // ── Validate specific column ─────────────────────────────────────────
      case 'validate_column': {
        const { table, column, limit } = z.object({
          table:  z.string(),
          column: z.string(),
          limit:  z.number().default(1000),
        }).parse(body);

        const rows = await loadRows(table, limit);
        const issues = rows
          .map((row) => validateValue(column, row[column], row.id ?? row[Object.keys(row)[0]]))
          .filter(Boolean);

        const valid   = rows.length - issues.length;
        const invalid = issues.length;

        return NextResponse.json({
          column, total: rows.length, valid, invalid,
          validity_rate: Math.round((valid / (rows.length || 1)) * 100),
          issues: issues.slice(0, 200),
          by_severity: {
            critical: issues.filter((i) => i!.severity === 'critical').length,
            warning:  issues.filter((i) => i!.severity === 'warning').length,
            info:     issues.filter((i) => i!.severity === 'info').length,
          },
        });
      }

      // ── Cross-table consistency ──────────────────────────────────────────
      case 'consistency_check': {
        const checks = await Promise.allSettled([
          // Restaurantes sem horários (usando business_hours_json)
          query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE business_hours_json IS NULL OR business_hours_json = 'null'::jsonb`),
          // Restaurantes sem imagens (usando images_json)
          query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE images_json IS NULL OR images_json = 'null'::jsonb OR images_json = '[]'::jsonb`),
          // Coordenadas inválidas/ausentes
          query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE latitude IS NULL OR longitude IS NULL OR (latitude = 0 AND longitude = 0)`),
          // Reservas sem restaurante correspondente
          query(`SELECT COUNT(*) as n FROM public.reservations r WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants d WHERE d.restaurant_id = r.restaurant_id)`),
          // Emails duplicados em usuários
          query(`SELECT COUNT(*) as n FROM (SELECT email, COUNT(*) FROM nextauth."User" GROUP BY email HAVING COUNT(*) > 1) t`),
          // Slugs duplicados em restaurantes
          query(`SELECT COUNT(*) as n FROM (SELECT slug, COUNT(*) FROM public.db_restaurants WHERE slug IS NOT NULL GROUP BY slug HAVING COUNT(*) > 1) t`),
          // Restaurantes sem slug
          query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE slug IS NULL OR slug = ''`),
          // Restaurantes sem e-mail de reservas
          query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE email_for_reservations IS NULL OR email_for_reservations = ''`),
          // Restaurantes não publicados
          query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE published = false OR published IS NULL`),
        ]);

        const labels = [
          'Restaurantes sem horários',
          'Restaurantes sem imagens',
          'Coordenadas inválidas/ausentes',
          'Reservas órfãs (sem restaurante)',
          'E-mails duplicados (usuários)',
          'Slugs duplicados (restaurantes)',
          'Restaurantes sem slug',
          'Restaurantes sem e-mail de reservas',
          'Restaurantes não publicados',
        ];

        const severities = ['warning','warning','critical','critical','critical','critical','critical','warning','info'] as const;

        const results = checks.map((c, i) => ({
          check:    labels[i],
          severity: severities[i],
          count:    c.status === 'fulfilled' ? parseInt(c.value.rows[0]?.n ?? '0', 10) : -1,
          error:    c.status === 'rejected' ? String(c.reason) : null,
        }));

        const totalIssues = results.filter((r) => r.count > 0).reduce((s, r) => s + r.count, 0);
        return NextResponse.json({ checks: results, total_issues: totalIssues });
      }

      // ── Quick quality snapshot (for dashboard) ───────────────────────────
      case 'quality_snapshot': {
        const { table, sample } = z.object({
          table:  z.string().default('public.db_restaurants'),
          sample: z.number().default(300),
        }).parse(body);

        const rows = await loadRows(table, sample);
        const scored = rows.map((r) => scoreRowCompleteness(r));
        const avg = scored.length
          ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
          : 0;

        const report = auditRows(rows.slice(0, 500), table, 'id');

        return NextResponse.json({
          table,
          sampled:       rows.length,
          avg_completeness: avg,
          quality_score: report.quality_score,
          critical:      report.critical_count,
          warnings:      report.warning_count,
          info:          report.info_count,
          duplicates:    report.duplicate_groups.length,
        });
      }

      // ── Apply a single documented fix ─────────────────────────────────────
      case 'apply_fix': {
        const { table, id_column, id_value, column, new_value, reason } = z.object({
          table:      z.string(),
          id_column:  z.string().default('id'),
          id_value:   z.unknown(),
          column:     z.string(),
          new_value:  z.unknown(),
          reason:     z.string(),
        }).parse(body);

        const before = await query(
          `SELECT ${column} FROM ${table} WHERE ${id_column} = $1`, [id_value]
        );
        const old_value = before.rows[0]?.[column];

        await query(
          `UPDATE ${table} SET ${column} = $1 WHERE ${id_column} = $2`,
          [new_value, id_value]
        );

        await query(
          `INSERT INTO public.update_events (table_name, operation, record_id, old_data, new_data, agent, created_at)
           VALUES ($1, 'UPDATE', $2, $3, $4, 'data-quality-engine', NOW())`,
          [table, String(id_value),
           JSON.stringify({ [column]: old_value }),
           JSON.stringify({ [column]: new_value, reason })]
        );

        return NextResponse.json({ ok: true, old_value, new_value, reason });
      }

      // ── Batch fixes ───────────────────────────────────────────────────────
      case 'batch_fix': {
        const { fixes } = z.object({
          fixes: z.array(z.object({
            table:     z.string(),
            id_column: z.string().default('id'),
            id_value:  z.unknown(),
            column:    z.string(),
            new_value: z.unknown(),
            reason:    z.string(),
          })),
        }).parse(body);

        let applied = 0;
        const errors: string[] = [];

        for (const fix of fixes) {
          try {
            await query(
              `UPDATE ${fix.table} SET ${fix.column} = $1 WHERE ${fix.id_column} = $2`,
              [fix.new_value, fix.id_value]
            );
            await query(
              `INSERT INTO public.update_events (table_name, operation, record_id, new_data, agent, created_at)
               VALUES ($1, 'UPDATE', $2, $3, 'data-quality-engine', NOW())`,
              [fix.table, String(fix.id_value),
               JSON.stringify({ [fix.column]: fix.new_value, reason: fix.reason })]
            );
            applied++;
          } catch (err) {
            errors.push(`${fix.id_value}/${fix.column}: ${String(err)}`);
          }
        }

        return NextResponse.json({ applied, errors, total: fixes.length });
      }



      // ══════════════════════════════════════════════════════════════════════
      // ── REALITY CHECK ────────────────────────────────────────────────────
      // ══════════════════════════════════════════════════════════════════════

      case 'check_emails_reality': {
        const { table, email_column, id_column, limit } = z.object({
          table: z.string(),
          email_column: z.string().default('email_for_reservations'),
          id_column: z.string().default('restaurant_id'),
          limit: z.number().default(100),
        }).parse(body);
        const rows = await query(
          `SELECT ${id_column}, ${email_column} FROM ${table}
           WHERE ${email_column} IS NOT NULL AND ${email_column} != '' LIMIT $1`, [limit]);
        const emails = rows.rows.map((r) => ({ id: r[id_column], email: String(r[email_column]) }));
        const results = await batchCheckEmails(emails, 8);
        const invalid = results.filter((r) => r.status !== 'valid');
        return NextResponse.json({
          total: results.length,
          valid: results.length - invalid.length,
          invalid: invalid.length,
          validity_rate: results.length ? Math.round(((results.length - invalid.length) / results.length) * 100) : 100,
          issues: invalid.slice(0, 200),
        });
      }

      case 'check_urls_reality': {
        const { table, url_column, id_column, limit } = z.object({
          table: z.string(),
          url_column: z.string().default('site_url'),
          id_column: z.string().default('restaurant_id'),
          limit: z.number().default(50),
        }).parse(body);
        const rows = await query(
          `SELECT ${id_column}, ${url_column} FROM ${table}
           WHERE ${url_column} IS NOT NULL AND ${url_column} != '' LIMIT $1`, [limit]);
        const urls = rows.rows.map((r) => ({ id: r[id_column], url: String(r[url_column]) }));
        const results = await batchCheckUrls(urls, 5);
        const broken = results.filter((r) => !r.reachable);
        return NextResponse.json({
          total: results.length,
          reachable: results.length - broken.length,
          broken: broken.length,
          health_rate: results.length ? Math.round(((results.length - broken.length) / results.length) * 100) : 100,
          issues: broken.slice(0, 100),
          all_results: results,
        });
      }

      case 'check_phones_reality': {
        const { table, phone_column, id_column, country, limit } = z.object({
          table: z.string(),
          phone_column: z.string().default('telephone_of_the_establishment'),
          id_column: z.string().default('restaurant_id'),
          country: z.string().default('BR'),
          limit: z.number().default(500),
        }).parse(body);
        const rows = await query(
          `SELECT ${id_column}, ${phone_column} FROM ${table}
           WHERE ${phone_column} IS NOT NULL AND ${phone_column} != '' LIMIT $1`, [limit]);
        const results = rows.rows.map((r) => ({
          id: r[id_column],
          ...checkPhoneReality(String(r[phone_column]), country as 'BR'),
        }));
        const invalid = results.filter((r) => !r.is_valid);
        return NextResponse.json({
          total: results.length,
          valid: results.length - invalid.length,
          invalid: invalid.length,
          validity_rate: results.length ? Math.round(((results.length - invalid.length) / results.length) * 100) : 100,
          issues: invalid.slice(0, 200),
        });
      }

      case 'check_places_freshness': {
        const { table, place_id_column, limit } = z.object({
          table: z.string().default('public.db_restaurants'),
          place_id_column: z.string().default('place_id'),
          limit: z.number().default(20),
        }).parse(body);
        const rows = await query(
          `SELECT restaurant_id, name, address_of_establishment, telephone_of_the_establishment, site_url, ${place_id_column}
           FROM ${table} WHERE ${place_id_column} IS NOT NULL AND ${place_id_column} != '' LIMIT $1`, [limit]);
        const results = [];
        for (const r of rows.rows) {
          const diff = await checkPlacesFreshness(String(r[place_id_column]), {
            name: String(r.name ?? ''),
            address: String(r.address_of_establishment ?? ''),
            telephone: String(r.telephone_of_the_establishment ?? ''),
            site_url: String(r.site_url ?? ''),
          });
          results.push({ restaurant_id: r.restaurant_id, name: r.name, ...diff });
        }
        return NextResponse.json({
          total: results.length,
          fresh: results.filter((r) => r.health === 'fresh').length,
          stale: results.filter((r) => r.health === 'stale').length,
          closed: results.filter((r) => r.health === 'closed').length,
          closed_temp: results.filter((r) => r.health === 'closed_temp').length,
          results,
        });
      }

      case 'check_geo_coords': {
        const { table, limit } = z.object({
          table: z.string().default('public.db_restaurants'),
          limit: z.number().default(50),
        }).parse(body);
        const rows = await query(
          `SELECT restaurant_id, latitude, longitude, city FROM ${table}
           WHERE latitude IS NOT NULL AND longitude IS NOT NULL
             AND latitude::numeric != 0 LIMIT $1`, [limit]);
        const results = [];
        for (const r of rows.rows) {
          const res = await validateGeoCoords(Number(r.latitude), Number(r.longitude), String(r.city ?? ''));
          results.push({ restaurant_id: r.restaurant_id, ...res });
        }
        const mismatch = results.filter((r) => r.match === false);
        return NextResponse.json({
          total: results.length,
          mismatched: mismatch.length,
          results,
        });
      }

      // ══════════════════════════════════════════════════════════════════════
      // ── OUTLIER DETECTION ────────────────────────────────────────────────
      // ══════════════════════════════════════════════════════════════════════

      case 'detect_outliers': {
        const { table, limit } = z.object({
          table: z.string(),
          limit: z.number().default(2000),
        }).parse(body);
        const rows = (await query(`SELECT * FROM ${table} LIMIT $1`, [limit])).rows;
        const idCol = rows[0] && 'restaurant_id' in rows[0] ? 'restaurant_id' : 'id';

        const numericOut = [
          ...detectNumericOutliers(rows, 'commission_per_person', idCol),
          ...detectNumericOutliers(rows, 'total_reservation', idCol),
          ...detectNumericOutliers(rows, 'rating', idCol),
        ];
        const dateAnom = [
          ...detectDateAnomalies(rows, 'created_date', idCol),
          ...detectDateAnomalies(rows, 'partnership_start_date', idCol),
        ];
        const placeholders = [
          ...detectPlaceholders(rows, 'name', idCol),
          ...detectPlaceholders(rows, 'about_text', idCol),
          ...detectPlaceholders(rows, 'email_for_reservations', idCol),
        ];
        const repetitions = [
          ...detectOverRepetition(rows, 'telephone_of_the_establishment', idCol, 5),
          ...detectOverRepetition(rows, 'email_for_reservations', idCol, 5),
        ];
        const geofenced = detectGeofenceViolations(rows, 'latitude', 'longitude', 'city', idCol);

        return NextResponse.json({
          numeric_outliers: numericOut,
          date_anomalies: dateAnom,
          placeholders,
          over_repetitions: repetitions,
          geofence_violations: geofenced,
          summary: {
            total: numericOut.length + dateAnom.length + placeholders.length + repetitions.length + geofenced.length,
            numeric: numericOut.length,
            dates: dateAnom.length,
            placeholders: placeholders.length,
            repetitions: repetitions.length,
            geofence: geofenced.length,
          },
        });
      }

      // ══════════════════════════════════════════════════════════════════════
      // ── SEMANTIC AI ANALYSIS ─────────────────────────────────────────────
      // ══════════════════════════════════════════════════════════════════════

      case 'semantic_analysis': {
        const { table, limit, focus } = z.object({
          table: z.string(),
          limit: z.number().default(30),
          focus: z.array(z.string()).optional(),
        }).parse(body);
        const rows = (await query(`SELECT * FROM ${table} LIMIT $1`, [limit])).rows;
        const result = await batchSemanticAnalysis(rows, {
          tableName: table, batchSize: 10, concurrency: 3, focus,
        });
        return NextResponse.json(result);
      }

      // ══════════════════════════════════════════════════════════════════════
      // ── AUTO-FIX SUGGESTIONS ─────────────────────────────────────────────
      // ══════════════════════════════════════════════════════════════════════

      case 'auto_fix_suggestions': {
        const { table, limit, country, ...flags } = z.object({
          table: z.string().default('public.db_restaurants'),
          limit: z.number().default(500),
          country: z.string().default('BR'),
          fixUrls: z.boolean().optional(),
          fixPhones: z.boolean().optional(),
          fixEmails: z.boolean().optional(),
          fixSlugs: z.boolean().optional(),
          fixWhitespace: z.boolean().optional(),
        }).parse(body);
        const rows = (await query(`SELECT * FROM ${table} LIMIT $1`, [limit])).rows;
        const idCol = rows[0] && 'restaurant_id' in rows[0] ? 'restaurant_id' : 'id';
        const suggestions = generateAutoFixSuggestions(rows, {
          table, idCol, countryCode: country as 'BR', ...flags,
        });
        return NextResponse.json({
          total: suggestions.length,
          by_confidence: {
            high: suggestions.filter((s) => s.confidence === 'high').length,
            medium: suggestions.filter((s) => s.confidence === 'medium').length,
            low: suggestions.filter((s) => s.confidence === 'low').length,
          },
          by_rule: suggestions.reduce((acc, s) => { acc[s.rule] = (acc[s.rule] ?? 0) + 1; return acc; }, {} as Record<string, number>),
          suggestions: suggestions.slice(0, 300),
        });
      }

      case 'apply_auto_fixes': {
        const { suggestions, min_confidence } = z.object({
          suggestions: z.array(z.object({
            row_id: z.unknown(),
            column: z.string(),
            new_value: z.unknown(),
            reason: z.string(),
            rule: z.string(),
            confidence: z.enum(['high','medium','low']),
            table: z.string().default('public.db_restaurants'),
            id_column: z.string().default('restaurant_id'),
          })),
          min_confidence: z.enum(['high','medium','low']).default('high'),
        }).parse(body);

        const order = { high: 3, medium: 2, low: 1 };
        const eligible = suggestions.filter((s) => order[s.confidence] >= order[min_confidence]);

        let applied = 0; const errors: string[] = [];
        for (const fix of eligible) {
          try {
            await query(
              `UPDATE ${fix.table} SET ${fix.column} = $1 WHERE ${fix.id_column} = $2`,
              [fix.new_value, fix.row_id]
            );
            await query(
              `INSERT INTO public.update_events (table_name, operation, record_id, new_data, agent, created_at)
               VALUES ($1, 'UPDATE', $2, $3, 'auto-fixer', NOW())`,
              [fix.table, String(fix.row_id),
               JSON.stringify({ [fix.column]: fix.new_value, reason: fix.reason, rule: fix.rule })]
            );
            applied++;
          } catch (err) { errors.push(`${fix.row_id}/${fix.column}: ${String(err)}`); }
        }
        return NextResponse.json({ applied, errors, total: eligible.length, skipped: suggestions.length - eligible.length });
      }

      // ══════════════════════════════════════════════════════════════════════
      // ── MONITORING / SNAPSHOTS ───────────────────────────────────────────
      // ══════════════════════════════════════════════════════════════════════

      case 'save_snapshot': {
        const { table } = z.object({ table: z.string() }).parse(body);
        const rows = (await query(`SELECT * FROM ${table} LIMIT 2000`)).rows;
        const idCol = rows[0] && 'restaurant_id' in rows[0] ? 'restaurant_id' : 'id';
        const report = auditRows(rows, table, idCol);
        const scored = rows.map((r) => scoreRowCompleteness(r));
        const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;
        const id = await saveSnapshot({
          table_name: table,
          quality_score: report.quality_score,
          total_rows: report.total_rows,
          critical_count: report.critical_count,
          warning_count: report.warning_count,
          info_count: report.info_count,
          duplicates: report.duplicate_groups.length,
          avg_completeness: avg,
        });
        return NextResponse.json({ id, ok: true });
      }

      case 'snapshot_history': {
        const { table, days } = z.object({
          table: z.string(),
          days: z.number().default(30),
        }).parse(body);
        const history = await getSnapshotHistory(table, days);
        return NextResponse.json({ history, count: history.length });
      }

      case 'trend_analysis': {
        const { table } = z.object({ table: z.string() }).parse(body);
        const trend = await analyzeTrend(table);
        return NextResponse.json(trend);
      }

      // ══════════════════════════════════════════════════════════════════════
      // ── EMAIL FINDER ─────────────────────────────────────────────────────
      // ══════════════════════════════════════════════════════════════════════

      case 'find_email_for_restaurant': {
        const { id_value } = z.object({ id_value: z.unknown() }).parse(body);
        const rows = await query(
          `SELECT restaurant_id, name, city, site_url, place_id
           FROM public.db_restaurants WHERE restaurant_id = $1`, [id_value]
        );
        if (!rows.rows.length) {
          return NextResponse.json({ error: 'Restaurante não encontrado' }, { status: 404 });
        }
        const r = rows.rows[0];
        const result = await findRestaurantEmail({
          name: String(r.name),
          city: r.city ? String(r.city) : undefined,
          site_url: r.site_url ? String(r.site_url) : undefined,
          place_id: r.place_id ? String(r.place_id) : undefined,
        });
        return NextResponse.json(result);
      }

      case 'batch_find_emails': {
        const { limit, only_missing, apply } = z.object({
          limit: z.number().default(20),
          only_missing: z.boolean().default(true),
          apply: z.boolean().default(false),
        }).parse(body);

        const sql = only_missing
          ? `SELECT restaurant_id, name, city, site_url, place_id
             FROM public.db_restaurants
             WHERE (email_for_reservations IS NULL OR email_for_reservations = '')
               AND (site_url IS NOT NULL OR place_id IS NOT NULL)
             LIMIT $1`
          : `SELECT restaurant_id, name, city, site_url, place_id
             FROM public.db_restaurants LIMIT $1`;
        const rows = await query(sql, [limit]);

        const found = await batchFindEmails(
          rows.rows.map((r) => ({
            id: r.restaurant_id, name: String(r.name),
            city: r.city ? String(r.city) : undefined,
            site_url: r.site_url ? String(r.site_url) : undefined,
            place_id: r.place_id ? String(r.place_id) : undefined,
          })),
          4
        );

        let applied = 0;
        if (apply) {
          for (const f of found) {
            if (f.best && f.best.score > 30) {
              try {
                await query(
                  `UPDATE public.db_restaurants SET email_for_reservations = $1 WHERE restaurant_id = $2`,
                  [f.best.email, f.id]
                );
                await query(
                  `INSERT INTO public.update_events (table_name, operation, record_id, new_data, agent, created_at)
                   VALUES ($1, 'UPDATE', $2, $3, 'email-finder', NOW())`,
                  ['public.db_restaurants', String(f.id),
                   JSON.stringify({
                     email_for_reservations: f.best.email,
                     reason: `Encontrado em ${f.best.source_url} (score ${f.best.score})`,
                     source: f.best.source,
                   })]
                );
                applied++;
              } catch { /* ignore */ }
            }
          }
        }

        const withEmail = found.filter((f) => f.best && f.best.score > 30);
        return NextResponse.json({
          total_scanned: found.length,
          found_with_email: withEmail.length,
          applied,
          success_rate: found.length ? Math.round((withEmail.length / found.length) * 100) : 0,
          results: found,
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
