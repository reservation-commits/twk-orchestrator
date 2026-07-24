import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, SESSION_HOURS, makeSessionToken, timingSafeEqualStr } from '@/lib/auth';

export const runtime = 'nodejs';

// Rate limit simples em memória por IP: 10 tentativas / 15 min.
const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: 'DASHBOARD_PASSWORD não configurado no servidor.' },
      { status: 503 }
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const slot = attempts.get(ip);
  if (slot && slot.resetAt > now && slot.count >= 10) {
    return NextResponse.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429 });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
  }

  if (!body.password || !timingSafeEqualStr(String(body.password), password)) {
    const cur = slot && slot.resetAt > now ? slot : { count: 0, resetAt: now + 15 * 60 * 1000 };
    cur.count += 1;
    attempts.set(ip, cur);
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 });
  }

  attempts.delete(ip);
  const token = await makeSessionToken(password);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_HOURS * 3600,
    path: '/',
  });
  return res;
}
