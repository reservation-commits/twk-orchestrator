/**
 * Sessão assinada por HMAC-SHA256 via Web Crypto — funciona em Edge (middleware)
 * e em Node 18+ (rotas). Token: `${expiresAtMs}.${hmacHex(secret, expiresAtMs)}`.
 */

export const AUTH_COOKIE = 'twk_auth';
export const SESSION_HOURS = 24 * 7;

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function makeSessionToken(secret: string): Promise<string> {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const sig = await hmacHex(secret, String(exp));
  return `${exp}.${sig}`;
}

export async function isValidSession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = await hmacHex(secret, exp);
  return timingSafeEqualStr(sig, expected);
}
