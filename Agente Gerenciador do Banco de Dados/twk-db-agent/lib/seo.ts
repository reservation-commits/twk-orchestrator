/**
 * TWK SEO engine — turns the catalog's already-complete data into organic-search assets.
 *
 * - buildRestaurantSchema(): assembles a RICH schema.org Restaurant JSON-LD (address, geo,
 *   telephone, openingHoursSpecification, servesCuisine, priceRange, award, image, reservations)
 *   from data the DB already holds. The live site currently emits only name/description/image,
 *   so this unlocks Google rich results (hours, price, cuisine) for free. Deterministic, no LLM.
 * - seoAudit(): catalog-wide organic-search health (duplicate copy, translation coverage,
 *   schema-feeder completeness, dead published pages) with a 0–100 score.
 */
import { query } from './db';
import type { RestaurantSchema } from '../types/contract';
import { assembleRestaurantSchema } from './seo-schema';

export type { RestaurantSchema };

/** Build a complete schema.org Restaurant JSON-LD (fetches rows; JSON-LD assembly is the pure module). */
export async function buildRestaurantSchema(restaurantId: string): Promise<RestaurantSchema | null> {
  const r = (await query<Record<string, unknown>>(
    `SELECT * FROM public.db_restaurants WHERE restaurant_id = $1`, [restaurantId]
  )).rows[0];
  if (!r) return null;

  const hours = (await query<{ weekday: number; open_time: unknown; close_time: unknown }>(
    `SELECT weekday, open_time, close_time FROM public.opening_hours WHERE restaurant_id = $1 ORDER BY weekday, open_time`,
    [restaurantId]
  )).rows;

  let awardsRows: Record<string, unknown>[] = [];
  try { awardsRows = (await query<Record<string, unknown>>(`SELECT * FROM public.restaurant_awards WHERE restaurant_id = $1`, [restaurantId])).rows; } catch { /* table optional */ }
  const awards = awardsRows
    .map((a) => { for (const k of ['name', 'title', 'award', 'award_name', 'distinction', 'label']) if (a[k]) return String(a[k]); return null; })
    .filter((x): x is string => !!x);

  return assembleRestaurantSchema(r, hours, awards);
}

export interface SeoCheck { check: string; value: number; of: number; weight: number; ideal: 'high' | 'low'; }
export interface SeoAuditResult { published: number; score: number; checks: SeoCheck[]; expansion: SeoCheck[]; notes: string[]; }

export interface CoversGap {
  published: number;
  missing: number;
  coverage: number;
  byCountry: { country: string; missing: number; partners: number }[];
}

/** Catalog-wide organic-search health with a weighted 0–100 score. */
export async function seoAudit(): Promise<SeoAuditResult> {
  const P = Number((await query<{ c: string }>(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published`)).rows[0].c);

  const one = (sql: string) => query<{ c: string }>(sql).then((r) => Number(r.rows[0].c));
  const oneSafe = (sql: string) => one(sql).catch(() => 0);

  // Run all the counts in parallel — one batch of round-trips instead of ~10 sequential.
  const [withAbout, dupRows, withSchema, ptOk, frOk, withGeo, withTel, withHours, withHero, liveOk] = await Promise.all([
    one(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published AND COALESCE(about_text,'')<>''`),
    one(`SELECT COALESCE(SUM(c),0) c FROM (SELECT md5(lower(trim(about_text))) h, COUNT(*) c FROM public.db_restaurants WHERE published AND COALESCE(about_text,'')<>'' GROUP BY 1 HAVING COUNT(*)>1) t`),
    oneSafe(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published AND structured_data_json IS NOT NULL`),
    one(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published AND COALESCE(about_pt,'')<>''`),
    one(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published AND COALESCE(about_fr,'')<>''`),
    one(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published AND latitude IS NOT NULL`),
    one(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published AND COALESCE(telephone_of_the_establishment,'')<>''`),
    one(`SELECT COUNT(*) c FROM public.db_restaurants d WHERE d.published AND EXISTS (SELECT 1 FROM public.opening_hours o WHERE o.restaurant_id=d.restaurant_id)`),
    one(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published AND (COALESCE(images_json->'slider'->0->>'source_url','')<>'' OR COALESCE(images_json->'cover'->>'source_url','')<>'')`),
    one(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published AND operational_status NOT IN ('closed_permanently','temporarily_closed','closed_temporarily')`),
  ]);
  const uniqueAbout = withAbout - dupRows;

  // Core checks (count toward the score) — tuned for the English-default workhorse pages.
  // Translations are NOT scored here: English is the default language, so they are a phase-2
  // expansion lever (shown separately), not a gap that should drag the core score down.
  const checks: SeoCheck[] = [
    { check: 'Descrições únicas',             value: uniqueAbout, of: P, weight: 3, ideal: 'high' },
    { check: 'Structured data (schema rico)', value: withSchema,  of: P, weight: 3, ideal: 'high' },
    { check: 'Imagem de capa (hero/og:image)',value: withHero,    of: P, weight: 3, ideal: 'high' },
    { check: 'Geo (schema + local SEO)',      value: withGeo,     of: P, weight: 2, ideal: 'high' },
    { check: 'Horários (openingHours)',       value: withHours,   of: P, weight: 2, ideal: 'high' },
    { check: 'Telefone (schema)',             value: withTel,     of: P, weight: 1, ideal: 'high' },
    { check: 'Sem páginas mortas',            value: liveOk,      of: P, weight: 2, ideal: 'high' },
  ];
  const totalW = checks.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(checks.reduce((s, c) => s + (c.of ? c.value / c.of : 0) * c.weight, 0) / totalW * 100);

  const expansion: SeoCheck[] = [
    { check: 'Conteúdo PT (expansão)', value: ptOk, of: P, weight: 0, ideal: 'high' },
    { check: 'Conteúdo FR (expansão)', value: frOk, of: P, weight: 0, ideal: 'high' },
  ];

  const notes: string[] = [];
  if (withHero < P) notes.push(`${P - withHero} publicados sem capa/og:image — maior lacuna de conteúdo (resolve no Photo Studio).`);
  if (dupRows > 0) notes.push(`${dupRows} descrições duplicadas — risco de conteúdo duplicado.`);
  return { published: P, score, checks, expansion, notes };
}

/** Published restaurants with no hero image (slider[0]/cover), broken down by country. */
export async function coversGap(): Promise<CoversGap> {
  const noHero = `(COALESCE(images_json->'slider'->0->>'source_url','')='' AND COALESCE(images_json->'cover'->>'source_url','')='')`;
  const [P, missing, rows] = await Promise.all([
    query<{ c: string }>(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published`).then((r) => Number(r.rows[0].c)),
    query<{ c: string }>(`SELECT COUNT(*) c FROM public.db_restaurants WHERE published AND ${noHero}`).then((r) => Number(r.rows[0].c)),
    query<{ country: string; missing: string; partners: string }>(
      `SELECT COALESCE(NULLIF(country,''),'—') country, COUNT(*) missing, COUNT(*) FILTER (WHERE partner) partners
       FROM public.db_restaurants WHERE published AND ${noHero} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 15`
    ).then((r) => r.rows),
  ]);
  const byCountry = rows.map((r) => ({ country: r.country, missing: Number(r.missing), partners: Number(r.partners) }));
  return { published: P, missing, coverage: P ? Math.round((P - missing) / P * 100) : 0, byCountry };
}
