import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Proxy de fotos do Google Places: o cliente pede /api/places/photo?ref=...&w=...
// e o servidor busca a imagem com a GOOGLE_PLACES_API_KEY — a chave nunca sai daqui.

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';
const MAX_WIDTH = 1600;
// photo_reference é um token opaco alfanumérico (com - e _); rejeita qualquer outra coisa.
const REF_RE = /^[A-Za-z0-9_-]{10,1024}$/;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ref = sp.get('ref');
  const wParam = parseInt(sp.get('w') ?? '800', 10);
  const w = Math.min(Number.isFinite(wParam) && wParam > 0 ? wParam : 800, MAX_WIDTH);

  if (!ref || !REF_RE.test(ref)) {
    return NextResponse.json({ error: 'Parâmetro ref ausente ou inválido' }, { status: 400 });
  }
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY não configurada' }, { status: 503 });
  }

  try {
    const url = `${PLACES_BASE}/photo?maxwidth=${w}&photo_reference=${encodeURIComponent(ref)}&key=${key}`;
    // O endpoint /photo responde 302 para a imagem final; seguimos o redirect
    // server-side e devolvemos os bytes para não expor a URL com a chave.
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return NextResponse.json({ error: `Google Places photo respondeu ${res.status}` }, { status: 502 });
    }
    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: `Falha ao buscar foto: ${String(err)}` }, { status: 502 });
  }
}
