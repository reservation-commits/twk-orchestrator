import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Proteção anti-SSRF para todos os fetchers de URL arbitrária
 * (scraper, photo-curator, publish download, upgrade).
 *
 * Bloqueia: schemes não-http(s), localhost, IPs privados/link-local/metadata.
 */

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata']);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low.startsWith('::ffff:')) return isPrivateIp(low.replace('::ffff:', ''));
    return (
      low === '::1' ||
      low === '::' ||
      low.startsWith('fe80') || // link-local
      low.startsWith('fc') ||
      low.startsWith('fd') // unique local
    );
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // na dúvida, bloqueia
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast/reserved
  );
}

export class SsrfBlockedError extends Error {
  constructor(url: string, reason: string) {
    super(`URL bloqueada por proteção SSRF (${reason}): ${url}`);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * Valida uma URL externa antes de qualquer fetch server-side.
 * Resolve DNS e recusa destinos privados. Lança SsrfBlockedError se inseguro.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, 'URL malformada');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(rawUrl, `scheme ${url.protocol} não permitido`);
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) throw new SsrfBlockedError(rawUrl, 'hostname interno');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new SsrfBlockedError(rawUrl, 'IP privado');
    return url;
  }
  try {
    const addrs = await dns.lookup(host, { all: true });
    for (const { address } of addrs) {
      if (isPrivateIp(address)) throw new SsrfBlockedError(rawUrl, `resolve para IP privado ${address}`);
    }
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err;
    throw new SsrfBlockedError(rawUrl, 'DNS não resolveu');
  }
  return url;
}

/** Versão booleana para call-sites que preferem filtrar a lançar. */
export async function isPublicUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertPublicUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
