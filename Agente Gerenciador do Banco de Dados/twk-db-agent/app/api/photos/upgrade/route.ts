import { NextRequest, NextResponse } from 'next/server';
import { fetchBest } from '@/lib/photo-curator';
import { assertPublicUrl } from '@/lib/net-guard';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/photos/upgrade { source_url } → tries to find a higher-resolution version of the
// same image ("best source"). Returns the largest variant found (or the original if none bigger).
export async function POST(req: NextRequest) {
  let source_url: string;
  try { ({ source_url } = (await req.json()) as { source_url: string }); }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  if (!source_url) return NextResponse.json({ error: 'source_url obrigatório' }, { status: 400 });

  // Anti-SSRF explícito antes de qualquer download (fetchBest também filtra com isPublicUrl).
  try { await assertPublicUrl(source_url); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }

  const best = await fetchBest(source_url, 400);
  if (!best) return NextResponse.json({ error: 'Não foi possível obter a imagem.' }, { status: 404 });

  return NextResponse.json({
    source_url: best.url,
    width: best.img.w,
    height: best.img.h,
    upgraded: best.url !== source_url,
  });
}
