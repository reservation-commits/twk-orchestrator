import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import axios from 'axios';
import { query, logUpdateEvent } from '@/lib/db';
import { uploadObject, extForContentType, isStorageConfigured, storageStatus } from '@/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface ApprovedPhoto { source_url: string; source: string; is_cover?: boolean; alt_text?: string; category?: string; }
interface PublishBody { restaurant_id: string; cover: ApprovedPhoto | null; gallery: ApprovedPhoto[]; }

interface ImageObj { id: null; alt_text: string; filename: string; source_url: string; origin_source?: string; origin_url?: string; category?: string; }

async function download(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const r = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 30000, maxRedirects: 5, validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TWK-Bot/1.0)' }, maxContentLength: 10 * 1024 * 1024,
    });
    if (r.status < 200 || r.status >= 300) return null;
    let ct = String(r.headers['content-type'] || 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (ct === 'image/jpg') ct = 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(ct)) return null;
    return { buffer: Buffer.from(r.data), contentType: ct };
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: `Storage não configurado: ${storageStatus().reason}` }, { status: 409 });
  }

  let body: PublishBody;
  try { body = (await req.json()) as PublishBody; } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const { restaurant_id, cover, gallery } = body;
  if (!restaurant_id || (!cover && (!gallery || !gallery.length))) {
    return NextResponse.json({ error: 'restaurant_id e ao menos uma foto são obrigatórios' }, { status: 400 });
  }

  const row = (await query<{ name: string; city: string; slug: string; images_json: Record<string, unknown> | null }>(
    `SELECT name, city, slug, images_json FROM public.db_restaurants WHERE restaurant_id = $1`,
    [restaurant_id]
  )).rows[0];
  if (!row) return NextResponse.json({ error: 'Restaurante não encontrado' }, { status: 404 });

  const slugBase = (row.slug || row.name || restaurant_id).toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const altDefault = `${row.name}${row.city ? ' ' + row.city : ''}`;
  const errors: string[] = [];

  const put = async (photo: ApprovedPhoto, kind: 'Cover' | 'Gallery', n: number): Promise<ImageObj | null> => {
    const dl = await download(photo.source_url);
    if (!dl) { errors.push(`download falhou: ${photo.source_url.slice(0, 80)}`); return null; }
    const ext = extForContentType(dl.contentType);
    // Content hash in the filename → a different image always gets a fresh URL, so the CDN can
    // never serve a stale cover when you re-publish; an identical image reuses the same name.
    const hash = crypto.createHash('md5').update(dl.buffer).digest('hex').slice(0, 8);
    const fname = `${slugBase}_${kind.toLowerCase()}${kind === 'Gallery' ? '_' + n : ''}_${hash}.${ext}`;
    const objectPath = `Restaurants/${restaurant_id}/${kind}/${fname}`;
    try {
      const up = await uploadObject(dl.buffer, objectPath, dl.contentType);
      return {
        id: null, alt_text: photo.alt_text || altDefault, filename: fname, source_url: up.url,
        origin_source: photo.source, origin_url: photo.source_url, category: photo.category,
      };
    } catch (e) { errors.push(`upload falhou (${fname}): ${String(e)}`); return null; }
  };

  // Upload cover + gallery (gallery in parallel).
  const coverObj = cover ? await put(cover, 'Cover', 0) : null;
  const galleryObjs = (await Promise.all((gallery ?? []).map((g, i) => put(g, 'Gallery', i + 1)))).filter((x): x is ImageObj => !!x);

  if (!coverObj && !galleryObjs.length) {
    return NextResponse.json({ error: 'Nenhuma imagem pôde ser hospedada.', errors }, { status: 502 });
  }

  // Preserve existing logo + keep a backup of the previous images_json for reversibility.
  const prev = (row.images_json && typeof row.images_json === 'object') ? row.images_json : {};
  const existingLogo = (prev as { logo?: unknown }).logo ?? null;

  // IMPORTANT: the public site renders the hero/background and og:image from `slider[0]`,
  // NOT from `cover`. So the chosen cover must LEAD the slider. We still set `cover` too
  // (used by listing cards / SEO), keeping both in sync.
  const headCover: ImageObj | null = coverObj ?? ((prev as { cover?: ImageObj }).cover ?? null);
  const slider: ImageObj[] = [headCover, ...galleryObjs].filter((x): x is ImageObj => !!x);

  const newImages: Record<string, unknown> = {
    logo: existingLogo,
    cover: headCover,
    slider,
  };

  const backupEntry = {
    field: 'images_json', action: 'photo_studio_publish',
    cover: coverObj?.source_url ?? null, gallery_count: galleryObjs.length,
    sources: [coverObj, ...galleryObjs].filter(Boolean).map((o) => (o as ImageObj).origin_source),
    previous: prev, at: new Date().toISOString(),
  };

  await query(
    `UPDATE public.db_restaurants
       SET images_json = $1::jsonb,
           last_verified_at = now(),
           enrichment_log = COALESCE(enrichment_log,'[]'::jsonb) || $2::jsonb
     WHERE restaurant_id = $3`,
    [JSON.stringify(newImages), JSON.stringify([backupEntry]), restaurant_id]
  );

  await logUpdateEvent({
    table_name: 'public.db_restaurants', operation: 'UPDATE', record_id: String(restaurant_id),
    new_data: { images_json: 'photo_studio', cover: coverObj?.source_url, gallery: galleryObjs.length },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    images_json: newImages,
    uploaded: { cover: !!coverObj, gallery: galleryObjs.length },
    errors: errors.length ? errors : undefined,
  });
}
