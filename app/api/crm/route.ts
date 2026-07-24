import { NextRequest, NextResponse } from 'next/server';
import { query, logUpdateEvent } from '@/lib/db';
import { safeColumn } from '@/lib/sql-guard';

// ── CRM data API: a powerful, read-mostly mirror of the database for the command center ──
// All restaurant data is sourced from public.db_restaurants (+ relational tables).

const SORTABLE = new Set([
  'name', 'city', 'country', 'price_range_id', 'published', 'operational_status',
  'confidence_level', 'created_date', 'last_verified_at', 'commission_per_person',
]);

const LIST_COLUMNS = `restaurant_id, name, city, country, email_for_reservations,
  telephone_of_the_establishment, site_url, price_range_id, published, operational_status,
  confidence_level, partner, restaurant_category, establishment_type, latitude, longitude,
  created_date, last_verified_at`;

function buildWhere(sp: URLSearchParams): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, val: unknown) => { params.push(val); clauses.push(clause.replace('?', `$${params.length}`)); };

  const search = sp.get('search')?.trim();
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    clauses.push(`(name ILIKE ${p} OR city ILIKE ${p} OR country ILIKE ${p} OR email_for_reservations ILIKE ${p})`);
  }
  const country = sp.get('country'); if (country) add('country = ?', country);
  const city = sp.get('city'); if (city) add('city = ?', city);
  const status = sp.get('status'); if (status) add('operational_status = ?', status);
  const price = sp.get('price'); if (price) add('price_range_id = ?', parseInt(price, 10));
  const published = sp.get('published');
  if (published === 'true') clauses.push('published = true');
  else if (published === 'false') clauses.push('(published = false OR published IS NULL)');
  const partner = sp.get('partner');
  if (partner === 'true') clauses.push('partner = true');
  const hasEmail = sp.get('has_email');
  if (hasEmail === 'true') clauses.push(`email_for_reservations IS NOT NULL AND email_for_reservations <> ''`);
  else if (hasEmail === 'false') clauses.push(`(email_for_reservations IS NULL OR email_for_reservations = '')`);

  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get('action') ?? 'overview';

  try {
    switch (action) {
      // ── KPI dashboard ──────────────────────────────────────────────────
      case 'overview': {
        const k = (await query(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE published)::int AS published,
            COUNT(*) FILTER (WHERE partner)::int AS partners,
            COUNT(*) FILTER (WHERE email_for_reservations IS NOT NULL AND email_for_reservations <> '')::int AS with_email,
            COUNT(*) FILTER (WHERE telephone_of_the_establishment IS NOT NULL AND telephone_of_the_establishment <> '')::int AS with_phone,
            COUNT(*) FILTER (WHERE site_url IS NOT NULL AND site_url <> '')::int AS with_site,
            COUNT(*) FILTER (WHERE latitude IS NOT NULL)::int AS with_geo,
            COUNT(*) FILTER (WHERE about_text IS NOT NULL AND about_text <> '')::int AS with_about,
            COUNT(DISTINCT country)::int AS countries,
            COUNT(DISTINCT city)::int AS cities,
            COUNT(*) FILTER (WHERE last_verified_at > now() - interval '30 days')::int AS verified_30d
          FROM public.db_restaurants`)).rows[0];

        const status = (await query(`SELECT operational_status AS k, COUNT(*)::int AS v FROM public.db_restaurants GROUP BY 1 ORDER BY v DESC`)).rows;
        const price = (await query(`
          SELECT COALESCE(p.label, '—') AS k, COUNT(*)::int AS v
          FROM public.db_restaurants d LEFT JOIN public.restaurant_price_range p ON p.id = d.price_range_id
          GROUP BY 1 ORDER BY MIN(d.price_range_id) NULLS LAST`)).rows;
        const topCountries = (await query(`SELECT country AS k, COUNT(*)::int AS v, COUNT(*) FILTER (WHERE published)::int AS pub FROM public.db_restaurants WHERE country IS NOT NULL AND country <> '' GROUP BY 1 ORDER BY v DESC LIMIT 12`)).rows;

        let resv = { total: 0, by_status: [] as { k: string; v: number }[] };
        try {
          const rt = (await query(`SELECT COUNT(*)::int AS total FROM public.reservations`)).rows[0];
          const rs = (await query(`SELECT COALESCE(booking_status,'—') AS k, COUNT(*)::int AS v FROM public.reservations GROUP BY 1 ORDER BY v DESC LIMIT 8`)).rows;
          resv = { total: Number(rt.total), by_status: rs as { k: string; v: number }[] };
        } catch { /* reservations optional */ }

        let recentActivity = 0;
        try { recentActivity = Number((await query(`SELECT COUNT(*)::int AS n FROM public.agent_audit_log WHERE created_at > now() - interval '7 days'`)).rows[0].n); } catch {}

        return NextResponse.json({ kpis: k, status, price, topCountries, reservations: resv, recentActivity });
      }

      // ── filter facets ──────────────────────────────────────────────────
      case 'facets': {
        const countries = (await query(`SELECT country AS v, COUNT(*)::int AS n FROM public.db_restaurants WHERE country IS NOT NULL AND country <> '' GROUP BY 1 ORDER BY n DESC`)).rows;
        const statuses = (await query(`SELECT DISTINCT operational_status AS v FROM public.db_restaurants WHERE operational_status IS NOT NULL ORDER BY 1`)).rows;
        const prices = (await query(`SELECT id AS v, label FROM public.restaurant_price_range ORDER BY id`)).rows;
        return NextResponse.json({ countries, statuses, prices });
      }

      // ── paginated, filtered, sorted restaurant list ────────────────────
      case 'restaurants': {
        const page = Math.max(parseInt(sp.get('page') ?? '1', 10), 1);
        const limit = Math.min(parseInt(sp.get('limit') ?? '25', 10), 100);
        const offset = (page - 1) * limit;
        const sort = SORTABLE.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'name';
        const dir = sp.get('dir') === 'desc' ? 'DESC' : 'ASC';
        const { sql: where, params } = buildWhere(sp);

        const rows = (await query(
          `SELECT ${LIST_COLUMNS} FROM public.db_restaurants${where} ORDER BY ${sort} ${dir} NULLS LAST LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        )).rows;
        const total = Number((await query(`SELECT COUNT(*)::int AS n FROM public.db_restaurants${where}`, params)).rows[0].n);
        return NextResponse.json({ rows, total, page, limit });
      }

      // ── full 360° record + related data ────────────────────────────────
      case 'restaurant': {
        const id = sp.get('id');
        if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
        const record = (await query(`SELECT * FROM public.db_restaurants WHERE restaurant_id = $1`, [id])).rows[0];
        if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const related: Record<string, unknown> = {};
        const safe = async (key: string, sql: string) => { try { related[key] = (await query(sql, [id])).rows; } catch { related[key] = []; } };
        await Promise.all([
          safe('hours', `SELECT weekday, open_time, close_time FROM public.opening_hours WHERE restaurant_id = $1 ORDER BY weekday, open_time`),
          safe('categories', `SELECT c.name FROM public.restaurant_category_map m JOIN public.restaurant_categories c ON c.id = m.category_id WHERE m.restaurant_id = $1`),
          safe('types', `SELECT t.name FROM public.establishment_type_map m JOIN public.establishment_types t ON t.id = m.type_id WHERE m.restaurant_id = $1`),
          safe('awards', `SELECT * FROM public.restaurant_awards WHERE restaurant_id = $1 LIMIT 20`),
        ]);
        let reservations = 0;
        try { reservations = Number((await query(`SELECT COUNT(*)::int AS n FROM public.reservations WHERE restaurant_id = $1`, [id])).rows[0].n); } catch {}
        related.reservations_count = reservations;
        return NextResponse.json({ record, related });
      }

      // ── reservations analytics ─────────────────────────────────────────
      case 'reservations': {
        const limit = Math.min(parseInt(sp.get('limit') ?? '40', 10), 100);
        let byStatus: unknown[] = [], recent: unknown[] = [], total = 0;
        try {
          total = Number((await query(`SELECT COUNT(*)::int AS n FROM public.reservations`)).rows[0].n);
          byStatus = (await query(`SELECT COALESCE(booking_status,'—') AS status, COUNT(*)::int AS count FROM public.reservations GROUP BY 1 ORDER BY count DESC`)).rows;
          recent = (await query(`
            SELECT r.restaurant_id, r.booking_status, r.booking_date, d.name AS restaurant_name, d.city
            FROM public.reservations r LEFT JOIN public.db_restaurants d ON d.restaurant_id = r.restaurant_id
            ORDER BY r.booking_date DESC NULLS LAST LIMIT $1`, [limit])).rows;
        } catch (e) { return NextResponse.json({ error: String(e), total: 0, byStatus: [], recent: [] }); }
        return NextResponse.json({ total, byStatus, recent });
      }

      // ── extra analytics for the overview ───────────────────────────────
      case 'reports': {
        const ck = (await query(`
          SELECT COUNT(*)::int total,
            COUNT(*) FILTER (WHERE "emailVerified" IS NOT NULL)::int verified,
            COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone <> '')::int with_phone,
            COUNT(*) FILTER (WHERE "createdAt" > now() - interval '30 days')::int new_30d,
            COUNT(*) FILTER (WHERE "deactivatedAt" IS NOT NULL)::int deactivated,
            COUNT(*) FILTER (WHERE wp_id IS NOT NULL)::int from_wp
          FROM nextauth."User" WHERE role::text = 'CUSTOMER'`)).rows[0];
        const custMonthly = (await query(`SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') m, COUNT(*)::int n FROM nextauth."User" WHERE "createdAt" > now() - interval '12 months' GROUP BY 1`)).rows;
        let resvMonthly: { m: string; n: number }[] = [], topRestaurants: unknown[] = [], stages: unknown[] = [];
        try { resvMonthly = (await query(`SELECT to_char(date_trunc('month', created_date), 'YYYY-MM') m, COUNT(*)::int n FROM public.reservations WHERE created_date > now() - interval '12 months' GROUP BY 1`)).rows as { m: string; n: number }[]; } catch {}
        try { topRestaurants = (await query(`SELECT d.name, d.city, COUNT(*)::int n FROM public.reservations r JOIN public.db_restaurants d ON d.restaurant_id = r.restaurant_id GROUP BY 1, 2 ORDER BY n DESC LIMIT 8`)).rows; } catch {}
        try { stages = (await query(`SELECT COALESCE(customer_stage, '—') stage, COUNT(*)::int n FROM public.reservations GROUP BY 1 ORDER BY n DESC LIMIT 8`)).rows; } catch {}
        const cm = Object.fromEntries(custMonthly.map((r) => [r.m as string, r.n as number]));
        const rm = Object.fromEntries(resvMonthly.map((r) => [r.m, r.n]));
        const months: string[] = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
        const growth = months.map((m) => ({ month: m, customers: cm[m] ?? 0, reservations: rm[m] ?? 0 }));
        return NextResponse.json({ customerKpis: ck, growth, topRestaurants, stages });
      }

      // ── global map: every published restaurant's coordinates ──────────
      case 'map': {
        const rows = (await query(`
          SELECT name, city, country,
            round(latitude::numeric, 3)::float8 AS lat,
            round(longitude::numeric, 3)::float8 AS lng,
            operational_status AS st, price_range_id AS pr
          FROM public.db_restaurants
          WHERE published = true AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND NOT (latitude = 0 AND longitude = 0)`)).rows;
        const byCountry = (await query(`
          SELECT country AS c, COUNT(*)::int AS n FROM public.db_restaurants
          WHERE published = true AND country IS NOT NULL AND country <> ''
          GROUP BY 1 ORDER BY n DESC LIMIT 8`)).rows;
        return NextResponse.json({ points: rows, total: rows.length, byCountry });
      }

      // ── customers (nextauth.User, role CUSTOMER) ───────────────────────
      case 'customers': {
        const page = Math.max(parseInt(sp.get('page') ?? '1', 10), 1);
        const limit = Math.min(parseInt(sp.get('limit') ?? '25', 10), 100);
        const offset = (page - 1) * limit;
        const SORT: Record<string, string> = { name: 'u.name', email: 'u.email', createdAt: 'u."createdAt"', reservations: 'reservations', last_booking: 'last_booking' };
        const sortCol = SORT[sp.get('sort') ?? ''] ?? 'u."createdAt"';
        const dir = sp.get('dir') === 'asc' ? 'ASC' : 'DESC';

        const clauses = [`u.role::text = 'CUSTOMER'`];
        const params: unknown[] = [];
        const search = sp.get('search')?.trim();
        if (search) { params.push(`%${search}%`); const p = `$${params.length}`; clauses.push(`(u.name ILIKE ${p} OR u.email ILIKE ${p} OR u.phone ILIKE ${p})`); }
        const verified = sp.get('verified');
        if (verified === 'true') clauses.push(`u."emailVerified" IS NOT NULL`); else if (verified === 'false') clauses.push(`u."emailVerified" IS NULL`);
        if (sp.get('has_phone') === 'true') clauses.push(`u.phone IS NOT NULL AND u.phone <> ''`);
        const source = sp.get('source');
        if (source === 'wp') clauses.push(`u.wp_id IS NOT NULL`); else if (source === 'native') clauses.push(`u.wp_id IS NULL`);
        const status = sp.get('status');
        if (status === 'active') clauses.push(`u."deactivatedAt" IS NULL`); else if (status === 'deactivated') clauses.push(`u."deactivatedAt" IS NOT NULL`);
        const where = `WHERE ${clauses.join(' AND ')}`;

        const rows = (await query(`
          SELECT u.id, u.name, u.email, u.phone, (u."emailVerified" IS NOT NULL) AS verified,
            u."createdAt", (u."deactivatedAt" IS NOT NULL) AS deactivated, (u.wp_id IS NOT NULL) AS from_wp,
            COALESCE(rc.c, 0) AS reservations, rc.lb AS last_booking
          FROM nextauth."User" u
          LEFT JOIN (SELECT customer_id, COUNT(*)::int c, MAX(booking_date) lb FROM public.reservations GROUP BY customer_id) rc ON rc.customer_id = u.id
          ${where} ORDER BY ${sortCol} ${dir} NULLS LAST LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset])).rows;
        const total = Number((await query(`SELECT COUNT(*)::int n FROM nextauth."User" u ${where}`, params)).rows[0].n);
        return NextResponse.json({ rows, total, page, limit });
      }

      // ── single customer 360° (+ their reservations) ────────────────────
      case 'customer': {
        const id = sp.get('id');
        if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
        const record = (await query(`SELECT id, name, email, phone, "emailVerified", "createdAt", "updatedAt", "deactivatedAt", wp_id, role::text AS role, image FROM nextauth."User" WHERE id = $1`, [id])).rows[0];
        if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        let reservations: unknown[] = [], stats: Record<string, unknown> = { total: 0, by_status: [] };
        try {
          reservations = (await query(`
            SELECT r.reservation_id, r.booking_status, r.booking_date, r.reservation_time, r.people, r.customer_stage, r.reservation_code, d.name AS restaurant_name, d.city
            FROM public.reservations r LEFT JOIN public.db_restaurants d ON d.restaurant_id = r.restaurant_id
            WHERE r.customer_id = $1 ORDER BY r.booking_date DESC NULLS LAST LIMIT 50`, [id])).rows;
          const t = Number((await query(`SELECT COUNT(*)::int n FROM public.reservations WHERE customer_id = $1`, [id])).rows[0].n);
          const bs = (await query(`SELECT COALESCE(booking_status, '—') status, COUNT(*)::int n FROM public.reservations WHERE customer_id = $1 GROUP BY 1 ORDER BY n DESC`, [id])).rows;
          stats = { total: t, by_status: bs };
        } catch {}
        return NextResponse.json({ record, reservations, stats });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── interactive edits from the CRM (inline edit / publish toggle) ──
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    if (action === 'update_field') {
      const { id, column, value } = body as { id: string; column: string; value: unknown };
      const EDITABLE = new Set([
        'name', 'email_for_reservations', 'telephone_of_the_establishment', 'site_url',
        'about_text', 'price_range_id', 'published', 'partner', 'operational_status',
        'commission_per_person', 'address_of_establishment',
      ]);
      if (!EDITABLE.has(column)) return NextResponse.json({ error: 'Column not editable' }, { status: 403 });
      // Allowlist acima já limita; safeColumn é cinto-e-suspensório na interpolação.
      const col = safeColumn(column);
      const before = (await query(`SELECT ${col} FROM public.db_restaurants WHERE restaurant_id = $1`, [id])).rows[0];
      await query(`UPDATE public.db_restaurants SET ${col} = $1 WHERE restaurant_id = $2`, [value, id]);
      await logUpdateEvent({
        table_name: 'public.db_restaurants', operation: 'UPDATE', record_id: id,
        old_data: before, new_data: { [column]: value, source: 'crm' },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'toggle_publish') {
      const { id, published } = body as { id: string; published: boolean };
      await query(`UPDATE public.db_restaurants SET published = $1 WHERE restaurant_id = $2`, [published, id]);
      await logUpdateEvent({ table_name: 'public.db_restaurants', operation: 'UPDATE', record_id: id, new_data: { published, source: 'crm' } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
