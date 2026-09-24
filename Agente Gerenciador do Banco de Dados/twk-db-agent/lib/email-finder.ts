/**
 * TWK Email Finder
 * Estratégia em camadas para descobrir e-mails reais de restaurantes:
 *  1. site_url já no banco → fetch homepage + página de contato
 *  2. Google Places → website
 *  3. Web search → busca pelo nome + cidade → identifica site oficial
 *  4. Extrai e-mails do HTML via regex + mailto:
 *  5. Filtra placeholders e e-mails genéricos suspeitos
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { webSearch } from './scraper';
import { getPlaceDetails } from './places';
import { isPublicUrl } from './net-guard';

// ── Regex e helpers ──────────────────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const GENERIC_LOCAL_PARTS = new Set([
  'webmaster', 'noreply', 'no-reply', 'do-not-reply', 'mailer-daemon',
  'postmaster', 'abuse', 'spam', 'admin@localhost',
]);

const PREFERRED_LOCAL_PARTS = [
  'reservations', 'reservation', 'reservas', 'reserve', 'booking',
  'reservar', 'reserver', 'contact', 'contato', 'hello', 'info',
  'restaurant', 'restaurante',
];

const SUSPICIOUS_DOMAINS = new Set([
  'example.com', 'test.com', 'localhost', 'sentry.io', 'github.com',
  'wixpress.com', 'wordpress.com', 'placeholder.com',
]);

const CONTACT_PATHS = [
  '/contact', '/contacto', '/contato', '/contact-us', '/contacts',
  '/reservations', '/reservas', '/reservation', '/reserver', '/reserve',
  '/about', '/about-us', '/info', '/informations',
];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; TWK-EmailFinder/1.0)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8,fr;q=0.7',
};

function normaliseUrl(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

function urlOk(url: string): boolean {
  try { new URL(url); return true; } catch { return false; }
}

function extractEmailsFromHtml(html: string): string[] {
  const $ = cheerio.load(html);

  // 1. mailto: links (highest signal)
  const fromMailto: string[] = [];
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const m = href.match(/mailto:([^?]+)/);
    if (m) fromMailto.push(m[1].trim());
  });

  // 2. Texto visível (remove scripts/styles primeiro)
  $('script, style, noscript').remove();
  const text = $('body').text() + ' ' + html;
  const fromText = text.match(EMAIL_REGEX) ?? [];

  // Merge + dedup + normalise
  const all = [...fromMailto, ...fromText].map((e) => e.toLowerCase().trim());
  return Array.from(new Set(all));
}

function scoreEmail(email: string, domain?: string): number {
  const lower = email.toLowerCase();
  const [local, dom] = lower.split('@');
  if (!local || !dom) return -100;

  let score = 0;
  // Generic placeholders → eliminar
  if (GENERIC_LOCAL_PARTS.has(local)) return -100;
  if (SUSPICIOUS_DOMAINS.has(dom)) return -100;
  // Preferred local parts (reservations, contact, etc.)
  if (PREFERRED_LOCAL_PARTS.some((p) => local.includes(p))) score += 50;
  // Mesmo domínio do site oficial → MUITO bom sinal
  if (domain) {
    const cleanDom = domain.replace(/^www\./, '');
    const cleanEmDom = dom.replace(/^www\./, '');
    if (cleanEmDom === cleanDom) score += 80;
    else if (cleanEmDom.endsWith(cleanDom) || cleanDom.endsWith(cleanEmDom)) score += 40;
  }
  // E-mails de plataformas genéricas (gmail, hotmail) → menor score
  const consumer = ['gmail.com','hotmail.com','yahoo.com','outlook.com','icloud.com'];
  if (consumer.includes(dom)) score -= 15;
  // E-mail muito curto = suspeito
  if (local.length < 2) score -= 30;

  return score;
}

// ── Estratégia principal ─────────────────────────────────────────────────────

export interface FoundEmail {
  email:        string;
  source:       'mailto' | 'html_text' | 'unknown';
  source_url:   string;
  score:        number;
  domain_match: boolean;
}

export interface EmailFinderResult {
  restaurant_name: string;
  attempted_urls:  string[];
  candidates:      FoundEmail[];
  best?:           FoundEmail;
  reason?:         string;
  duration_ms:     number;
}

async function fetchPage(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    if (!(await isPublicUrl(url))) return null;
    const { data, status } = await axios.get(url, {
      headers: FETCH_HEADERS,
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    if (status >= 200 && status < 400 && typeof data === 'string') return data;
    return null;
  } catch {
    return null;
  }
}

/**
 * Encontra o e-mail real de um restaurante combinando todas as fontes disponíveis.
 */
export async function findRestaurantEmail(input: {
  name:     string;
  city?:    string;
  site_url?: string;
  place_id?: string;
}): Promise<EmailFinderResult> {
  const start = Date.now();
  const candidates: FoundEmail[] = [];
  const attempted: string[] = [];

  // 1. Determinar URL do site (banco > Places > Web Search)
  let siteUrl = input.site_url && urlOk(normaliseUrl(input.site_url))
    ? normaliseUrl(input.site_url)
    : '';

  if (!siteUrl && input.place_id) {
    try {
      const details = await getPlaceDetails(input.place_id);
      if (details.website) siteUrl = normaliseUrl(details.website);
    } catch { /* ignore */ }
  }

  if (!siteUrl) {
    try {
      const q = `${input.name} ${input.city ?? ''} restaurant official site`.trim();
      const results = await webSearch(q, 5);
      const official = results.find((r) => {
        const host = (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
        return host && !host.includes('tripadvisor') && !host.includes('thefork')
          && !host.includes('opentable') && !host.includes('yelp')
          && !host.includes('google.') && !host.includes('facebook')
          && !host.includes('instagram') && !host.includes('michelin');
      });
      if (official) siteUrl = normaliseUrl(official.url);
    } catch { /* ignore */ }
  }

  if (!siteUrl) {
    return {
      restaurant_name: input.name,
      attempted_urls: [],
      candidates: [],
      reason: 'Site oficial não encontrado (sem site_url, place_id ou resultado de busca confiável)',
      duration_ms: Date.now() - start,
    };
  }

  const domain = (() => { try { return new URL(siteUrl).hostname.replace(/^www\./, ''); } catch { return undefined; } })();

  // 2. Fetch homepage
  attempted.push(siteUrl);
  const homepage = await fetchPage(siteUrl);
  if (homepage) {
    for (const email of extractEmailsFromHtml(homepage)) {
      const src: 'mailto' | 'html_text' = homepage.includes(`mailto:${email}`) ? 'mailto' : 'html_text';
      const score = scoreEmail(email, domain);
      if (score > -50) candidates.push({
        email, source: src, source_url: siteUrl, score,
        domain_match: domain ? email.endsWith('@' + domain) : false,
      });
    }
  }

  // 3. Tentar páginas de contato (paralelo, máx 4)
  const contactUrls = CONTACT_PATHS.slice(0, 4).map((p) => siteUrl + p);
  const contactPages = await Promise.allSettled(contactUrls.map((u) => fetchPage(u, 6000)));

  contactPages.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      attempted.push(contactUrls[i]);
      for (const email of extractEmailsFromHtml(r.value)) {
        const src: 'mailto' | 'html_text' = r.value!.includes(`mailto:${email}`) ? 'mailto' : 'html_text';
        const score = scoreEmail(email, domain) + (src === 'mailto' ? 20 : 0)
          + (contactUrls[i].includes('reserv') || contactUrls[i].includes('contact') ? 15 : 0);
        if (score > -50) candidates.push({
          email, source: src, source_url: contactUrls[i], score,
          domain_match: domain ? email.endsWith('@' + domain) : false,
        });
      }
    }
  });

  // 4. Dedup por e-mail, mantendo o maior score
  const byEmail = new Map<string, FoundEmail>();
  for (const c of candidates) {
    const existing = byEmail.get(c.email);
    if (!existing || c.score > existing.score) byEmail.set(c.email, c);
  }
  const deduped = Array.from(byEmail.values()).sort((a, b) => b.score - a.score);

  return {
    restaurant_name: input.name,
    attempted_urls: attempted,
    candidates: deduped,
    best: deduped[0],
    reason: deduped.length === 0 ? 'Nenhum e-mail encontrado nas páginas analisadas' : undefined,
    duration_ms: Date.now() - start,
  };
}

/**
 * Versão em lote com concorrência controlada.
 */
export async function batchFindEmails(
  restaurants: Array<{ id: unknown; name: string; city?: string; site_url?: string; place_id?: string }>,
  concurrency = 4
): Promise<Array<EmailFinderResult & { id: unknown }>> {
  const out: Array<EmailFinderResult & { id: unknown }> = [];
  for (let i = 0; i < restaurants.length; i += concurrency) {
    const batch = restaurants.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((r) => findRestaurantEmail({
        name: r.name, city: r.city, site_url: r.site_url, place_id: r.place_id,
      }))
    );
    settled.forEach((s, idx) => {
      if (s.status === 'fulfilled') out.push({ ...s.value, id: batch[idx].id });
    });
  }
  return out;
}
