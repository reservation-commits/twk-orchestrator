import { NextRequest, NextResponse } from 'next/server';
import { query, logUpdateEvent } from '@/lib/db';
import { storageStatus } from '@/lib/storage';

export const runtime = 'nodejs';

// GET /api/photos?action=status|search|missing|get
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get('action') ?? 'status';

  try {
    if (action === 'status') {
      return NextResponse.json({ storage: storageStatus() });
    }

    if (action === 'search') {
      const q = (sp.get('q') ?? '').trim();
      if (!q) return NextResponse.json({ rows: [] });
      const rows = (await query(
        `SELECT restaurant_id, name, city, country, slug, place_id, site_url, published, images_json
         FROM public.db_restaurants
         WHERE name ILIKE $1 OR city ILIKE $1
         ORDER BY published DESC, name LIMIT 30`,
        [`%${q}%`]
      )).rows;
      return NextResponse.json({ rows });
    }

    if (action === 'missing') {
      // The Photos tab lists EVERY restaurant with no usable hero image — published AND
      // unpublished (this "include unpublished" rule is scoped to this tab only). A row is
      // "missing" when BOTH slider[0] and cover have no source_url. Capturable (has site) first.
      const noHero = `(images_json IS NULL
                OR jsonb_typeof(images_json) <> 'object'
                OR (COALESCE(images_json->'slider'->0->>'source_url','') = ''
                    AND COALESCE(images_json->'cover'->>'source_url','') = ''))`;
      const total = Number((await query<{ c: string }>(
        `SELECT COUNT(*) c FROM public.db_restaurants WHERE ${noHero}`
      )).rows[0].c);
      // `ready_pending_photo` marks the ones that WERE published and only lack photos (ready to
      // go back live once a photo is added) — surfaced first and badged in the UI.
      const rows = (await query(
        `SELECT restaurant_id, name, city, country, slug, place_id, site_url, published,
                COALESCE(ready_pending_photo, false) AS ready_pending_photo, images_json
         FROM public.db_restaurants
         WHERE ${noHero}
         ORDER BY COALESCE(ready_pending_photo, false) DESC, (COALESCE(site_url,'') <> '') DESC, published DESC, name
         LIMIT 500`
      )).rows;
      const readyCount = Number((await query<{ c: string }>(
        `SELECT COUNT(*) c FROM public.db_restaurants WHERE ${noHero} AND COALESCE(ready_pending_photo, false)`
      )).rows[0].c);
      return NextResponse.json({ rows, count: total, readyCount });
    }

    if (action === 'get') {
      const id = sp.get('id');
      if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
      const row = (await query(
        `SELECT restaurant_id, name, city, country, slug, place_id, site_url, published, images_json
         FROM public.db_restaurants WHERE restaurant_id = $1`,
        [id]
      )).rows[0];
      if (!row) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
      return NextResponse.json({ row });
    }

    return NextResponse.json({ error: 'ação inválida' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/photos  { action: 'set-published', restaurant_id, published }
// Toggle a restaurant's published state from the Photo Studio. Publishing clears the
// `ready_pending_photo` mark (it's back live). Logged to enrichment_log.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { action?: string; restaurant_id?: string; published?: boolean };
    if (body.action !== 'set-published' || !body.restaurant_id || typeof body.published !== 'boolean') {
      return NextResponse.json({ error: 'payload inválido' }, { status: 400 });
    }
    const logAction = body.published ? 'republished_manual' : 'unpublished_manual';
    const log = JSON.stringify([{ field: 'published', action: logAction, at: new Date().toISOString() }]);
    // O subselect `old` lê published/images_json ANTES do UPDATE, na mesma operação,
    // para alimentar o old_data da trilha de auditoria.
    const res = await query<{ old_published: boolean | null; old_images_json: unknown }>(
      `UPDATE public.db_restaurants d
         SET published = $1,
             ready_pending_photo = CASE WHEN $1 THEN false ELSE d.ready_pending_photo END,
             enrichment_log = COALESCE(d.enrichment_log,'[]'::jsonb) || $2::jsonb
        FROM (SELECT restaurant_id, published, images_json FROM public.db_restaurants WHERE restaurant_id = $3) old
       WHERE d.restaurant_id = old.restaurant_id
       RETURNING old.published AS old_published, old.images_json AS old_images_json`,
      [body.published, log, body.restaurant_id]
    );
    if (!res.rowCount) return NextResponse.json({ error: 'restaurante não encontrado' }, { status: 404 });
    // Fail-closed: se a trilha de auditoria falhar, a resposta vira erro (catch abaixo).
    await logUpdateEvent({
      table_name: 'public.db_restaurants',
      operation: 'UPDATE',
      record_id: body.restaurant_id,
      old_data: { published: res.rows[0].old_published, images_json: res.rows[0].old_images_json },
      new_data: { published: body.published, action: logAction, via: 'photo-studio' },
    });
    return NextResponse.json({ ok: true, restaurant_id: body.restaurant_id, published: body.published });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
