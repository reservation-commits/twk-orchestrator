/**
 * TWK Auto-Fixer
 * Sugere correções automáticas para problemas comuns:
 * - URL sem protocolo → adiciona https://
 * - Telefone bruto → E.164
 * - Slug ausente/quebrado → gera a partir do nome
 * - Strings com espaços extras / casing errado
 * - Emails com domínio mal escrito (gmial → gmail)
 */

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export interface AutoFixSuggestion {
  row_id:    unknown;
  column:    string;
  old_value: unknown;
  new_value: unknown;
  reason:    string;
  confidence: 'high' | 'medium' | 'low';
  rule:      string;
}

// ── URL normalization ─────────────────────────────────────────────────────────

export function suggestUrlFix(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    // already has protocol — check for clean URL
    try {
      const u = new URL(trimmed);
      const clean = u.toString();
      return clean !== trimmed ? clean : null;
    } catch { return null; }
  }
  // common malformed: www.example.com, example.com
  if (/^[a-z0-9-]+(\.[a-z]{2,})+/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

// ── Phone normalization to E.164 ──────────────────────────────────────────────

export function suggestPhoneFix(raw: string, defaultCountry: CountryCode = 'BR'): string | null {
  try {
    const p = parsePhoneNumberFromString(raw.trim(), defaultCountry);
    if (p && p.isValid()) {
      const e164 = p.format('E.164');
      return e164 !== raw.trim() ? e164 : null;
    }
  } catch {}
  return null;
}

// ── Slug generation ───────────────────────────────────────────────────────────

export function generateSlug(name: string, city?: string): string {
  const base = city ? `${name}-${city}` : name;
  return base
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// ── Common email typos ────────────────────────────────────────────────────────

const EMAIL_DOMAIN_FIXES: Record<string, string> = {
  'gmial.com':     'gmail.com',
  'gmai.com':      'gmail.com',
  'gnail.com':     'gmail.com',
  'gmail.co':      'gmail.com',
  'gmail.cm':      'gmail.com',
  'hotmial.com':   'hotmail.com',
  'hotmal.com':    'hotmail.com',
  'hotmai.com':    'hotmail.com',
  'yahooo.com':    'yahoo.com',
  'yahho.com':     'yahoo.com',
  'outloo.com':    'outlook.com',
  'outlok.com':    'outlook.com',
  'icloud.cm':     'icloud.com',
};

export function suggestEmailFix(email: string): string | null {
  const m = email.trim().toLowerCase().match(/^([^@]+)@(.+)$/);
  if (!m) return null;
  const [, local, domain] = m;
  if (EMAIL_DOMAIN_FIXES[domain]) {
    return `${local}@${EMAIL_DOMAIN_FIXES[domain]}`;
  }
  return null;
}

// ── String normalization ──────────────────────────────────────────────────────

export function suggestStringFix(value: string): string | null {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed === value) return null;
  return trimmed;
}

// ── Batch suggestion engine ───────────────────────────────────────────────────

export interface SuggestionOptions {
  table:      string;
  idCol:      string;
  countryCode?: CountryCode;
  fixUrls?:   boolean;
  fixPhones?: boolean;
  fixEmails?: boolean;
  fixSlugs?:  boolean;
  fixWhitespace?: boolean;
}

export function generateAutoFixSuggestions(
  rows: Array<Record<string, unknown>>,
  opts: SuggestionOptions
): AutoFixSuggestion[] {
  const suggestions: AutoFixSuggestion[] = [];
  const country = opts.countryCode ?? 'BR';

  for (const row of rows) {
    const id = row[opts.idCol];

    if (opts.fixUrls !== false) {
      for (const col of ['site_url','website','url_page_twk','logo_url']) {
        const v = row[col];
        if (typeof v === 'string') {
          const fix = suggestUrlFix(v);
          if (fix) suggestions.push({
            row_id: id, column: col, old_value: v, new_value: fix,
            reason: 'URL normalizada (protocolo adicionado)',
            confidence: 'high', rule: 'url_normalize',
          });
        }
      }
    }

    if (opts.fixPhones !== false) {
      for (const col of ['telephone_of_the_establishment','phone']) {
        const v = row[col];
        if (typeof v === 'string' && v.trim()) {
          const fix = suggestPhoneFix(v, country);
          if (fix) suggestions.push({
            row_id: id, column: col, old_value: v, new_value: fix,
            reason: `Telefone normalizado para E.164`,
            confidence: 'high', rule: 'phone_e164',
          });
        }
      }
    }

    if (opts.fixEmails !== false) {
      for (const col of ['email_for_reservations','email']) {
        const v = row[col];
        if (typeof v === 'string' && v.includes('@')) {
          const fix = suggestEmailFix(v);
          if (fix) suggestions.push({
            row_id: id, column: col, old_value: v, new_value: fix,
            reason: `Domínio do e-mail parece um typo conhecido`,
            confidence: 'medium', rule: 'email_typo',
          });
        }
      }
    }

    if (opts.fixSlugs !== false) {
      const slug = row.slug as string | null | undefined;
      const name = row.name as string | undefined;
      const city = row.city as string | undefined;
      if (name && (!slug || slug.length < 3 || !/^[a-z0-9-]+$/.test(slug))) {
        const newSlug = generateSlug(name, city);
        if (newSlug && newSlug !== slug) {
          suggestions.push({
            row_id: id, column: 'slug', old_value: slug, new_value: newSlug,
            reason: 'Slug regenerado a partir do nome',
            confidence: slug ? 'medium' : 'high', rule: 'slug_regen',
          });
        }
      }
    }

    if (opts.fixWhitespace !== false) {
      for (const col of ['name','address_of_establishment','city','country']) {
        const v = row[col];
        if (typeof v === 'string') {
          const fix = suggestStringFix(v);
          if (fix) suggestions.push({
            row_id: id, column: col, old_value: v, new_value: fix,
            reason: 'Espaços extras removidos',
            confidence: 'high', rule: 'whitespace',
          });
        }
      }
    }
  }

  return suggestions;
}
