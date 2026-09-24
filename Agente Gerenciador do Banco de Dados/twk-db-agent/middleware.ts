import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, isValidSession, timingSafeEqualStr } from '@/lib/auth';

/**
 * Autenticação global do dashboard.
 *
 * - Cookie assinado (HMAC-SHA256) emitido por /api/auth/login com DASHBOARD_PASSWORD.
 * - Ou header `Authorization: Bearer <DASHBOARD_TOKEN>` para chamadas programáticas.
 * - /api/cron/* fica fora daqui: tem seu próprio segredo fail-closed na rota.
 * - Sem DASHBOARD_PASSWORD definido: acesso permitido APENAS de localhost (modo dev).
 */

function isLocalhost(req: NextRequest): boolean {
  const host = (req.headers.get('host') || '').split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname.startsWith('/api/cron/')
  ) {
    return NextResponse.next();
  }

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    if (isLocalhost(req)) return NextResponse.next();
    return new NextResponse(
      'DASHBOARD_PASSWORD não configurado — acesso remoto bloqueado (fail-closed).',
      { status: 503 }
    );
  }

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const apiToken = process.env.DASHBOARD_TOKEN;
  if (bearer && apiToken && timingSafeEqualStr(bearer, apiToken)) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (await isValidSession(cookie, password)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
