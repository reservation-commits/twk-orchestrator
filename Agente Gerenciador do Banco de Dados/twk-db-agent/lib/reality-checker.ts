/**
 * TWK Reality Checker
 * Valida dados contra fontes externas: DNS, HTTP, Google Places, Geocoding.
 * Não confia apenas em regex — confirma que o dado representa algo REAL.
 */

import axios from 'axios';
import { promises as dns } from 'dns';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { getPlaceDetails } from './places';

// ── Email: DNS MX lookup ──────────────────────────────────────────────────────

export interface EmailRealityResult {
  email:       string;
  valid_syntax: boolean;
  domain:      string;
  has_mx:      boolean | null;     // null = lookup failed
  mx_records?: string[];
  status:      'valid' | 'invalid_syntax' | 'no_mx' | 'unreachable';
  message:     string;
}

const EMAIL_RE = /^[^\s@]+@([^\s@]+\.[^\s@]{2,})$/;

export async function checkEmailReality(email: string): Promise<EmailRealityResult> {
  const trimmed = email.trim().toLowerCase();
  const m = trimmed.match(EMAIL_RE);
  if (!m) {
    return {
      email: trimmed, valid_syntax: false, domain: '',
      has_mx: null, status: 'invalid_syntax',
      message: 'Formato de e-mail inválido',
    };
  }
  const domain = m[1];
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx.length) {
      return {
        email: trimmed, valid_syntax: true, domain,
        has_mx: false, status: 'no_mx',
        message: `Domínio ${domain} não possui registros MX (não aceita e-mail)`,
      };
    }
    return {
      email: trimmed, valid_syntax: true, domain,
      has_mx: true, mx_records: mx.map((r) => r.exchange).slice(0, 3),
      status: 'valid',
      message: `MX OK — ${mx[0].exchange}`,
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return {
      email: trimmed, valid_syntax: true, domain,
      has_mx: false,
      status: code === 'ENOTFOUND' ? 'no_mx' : 'unreachable',
      message: code === 'ENOTFOUND'
        ? `Domínio ${domain} não existe`
        : `Falha ao verificar MX (${code ?? 'erro desconhecido'})`,
    };
  }
}

// ── Phone: E.164 normalization via libphonenumber ─────────────────────────────

export interface PhoneRealityResult {
  raw:        string;
  e164?:      string;
  national?:  string;
  country?:   string;
  type?:      'MOBILE' | 'FIXED_LINE' | 'FIXED_LINE_OR_MOBILE' | 'TOLL_FREE' | 'PREMIUM_RATE' | 'VOIP' | string;
  is_valid:   boolean;
  is_possible: boolean;
  message:    string;
}

export function checkPhoneReality(raw: string, defaultCountry: CountryCode = 'BR'): PhoneRealityResult {
  try {
    const phone = parsePhoneNumberFromString(raw.trim(), defaultCountry);
    if (!phone) {
      return { raw, is_valid: false, is_possible: false, message: 'Não foi possível parsear o telefone' };
    }
    return {
      raw,
      e164:        phone.format('E.164'),
      national:    phone.formatNational(),
      country:     phone.country,
      type:        phone.getType(),
      is_valid:    phone.isValid(),
      is_possible: phone.isPossible(),
      message:     phone.isValid()
        ? `Válido (${phone.country} · ${phone.getType() ?? 'tipo desconhecido'})`
        : phone.isPossible() ? 'Formato possível mas inválido' : 'Telefone inválido',
    };
  } catch {
    return { raw, is_valid: false, is_possible: false, message: 'Erro ao parsear' };
  }
}

// ── URL: HEAD request liveness check ──────────────────────────────────────────

export interface UrlRealityResult {
  url:          string;
  reachable:    boolean;
  status_code?: number;
  final_url?:   string;        // após redirects
  content_type?: string;
  is_parked?:   boolean;
  latency_ms?:  number;
  message:      string;
}

const PARKED_HINTS = [
  'domain for sale', 'this domain', 'parked', 'godaddy', 'sedoparking',
  'expired domain', 'buy this domain',
];

export async function checkUrlReality(url: string, timeoutMs = 6000): Promise<UrlRealityResult> {
  const start = Date.now();
  let normalised = url.trim();
  if (!/^https?:\/\//i.test(normalised)) normalised = 'https://' + normalised;

  try {
    const r = await axios.head(normalised, {
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TWK-Audit/1.0)' },
    });
    const latency = Date.now() - start;
    const ok = r.status >= 200 && r.status < 400;

    // Some sites reject HEAD — fall back to GET for 4xx
    if (!ok && r.status === 405) {
      const g = await axios.get(normalised, {
        timeout: timeoutMs, maxRedirects: 5, validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TWK-Audit/1.0)' },
      });
      const body = String(g.data ?? '').toLowerCase().slice(0, 2000);
      const isParked = PARKED_HINTS.some((h) => body.includes(h));
      return {
        url: normalised, reachable: g.status < 400,
        status_code: g.status, latency_ms: latency, is_parked: isParked,
        content_type: g.headers['content-type'] != null ? String(g.headers['content-type']) : undefined,
        message: g.status < 400 ? (isParked ? 'Domínio parqueado' : 'OK') : `HTTP ${g.status}`,
      };
    }

    return {
      url: normalised, reachable: ok, status_code: r.status,
      content_type: r.headers['content-type'] != null ? String(r.headers['content-type']) : undefined, latency_ms: latency,
      message: ok ? `OK (${r.status})` : `HTTP ${r.status}`,
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return {
      url: normalised, reachable: false, latency_ms: Date.now() - start,
      message: code === 'ENOTFOUND' ? 'Domínio não existe'
        : code === 'ETIMEDOUT' || code === 'ECONNABORTED' ? 'Timeout'
        : code === 'ECONNREFUSED' ? 'Conexão recusada' : `Erro: ${code ?? 'desconhecido'}`,
    };
  }
}

// ── Places freshness: compara DB com Google Places ────────────────────────────

export interface PlacesFreshnessDiff {
  place_id:        string;
  business_status?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' | string;
  diffs:           Array<{ field: string; db_value: unknown; places_value: unknown }>;
  health:          'fresh' | 'stale' | 'closed' | 'closed_temp' | 'unreachable';
  message:         string;
}

export async function checkPlacesFreshness(
  placeId: string,
  dbData: {
    name?: string;
    address?: string;
    telephone?: string;
    site_url?: string;
  }
): Promise<PlacesFreshnessDiff> {
  try {
    const details = await getPlaceDetails(placeId);
    // Cast to broader type since some fields aren't in our TypeScript definition but come back
    const wider = details as unknown as Record<string, unknown>;
    const status = wider.business_status as string | undefined;

    const diffs: PlacesFreshnessDiff['diffs'] = [];
    const compare = (field: string, db: unknown, places: unknown) => {
      if (db == null || places == null) return;
      const norm = (v: unknown) => String(v).trim().toLowerCase().replace(/\s+/g, ' ');
      if (norm(db) !== norm(places)) diffs.push({ field, db_value: db, places_value: places });
    };

    compare('name',      dbData.name,      details.name);
    compare('address',   dbData.address,   details.formatted_address);
    compare('telephone', dbData.telephone, details.formatted_phone_number);
    compare('website',   dbData.site_url,  details.website);

    let health: PlacesFreshnessDiff['health'] = 'fresh';
    if (status === 'CLOSED_PERMANENTLY') health = 'closed';
    else if (status === 'CLOSED_TEMPORARILY') health = 'closed_temp';
    else if (diffs.length > 0) health = 'stale';

    return {
      place_id: placeId, business_status: status,
      diffs, health,
      message: health === 'closed' ? 'FECHADO PERMANENTEMENTE no Google Places'
        : health === 'closed_temp' ? 'Temporariamente fechado'
        : health === 'stale' ? `${diffs.length} campo(s) desatualizado(s) vs Google Places`
        : 'Sincronizado',
    };
  } catch (err) {
    return {
      place_id: placeId, diffs: [], health: 'unreachable',
      message: `Falha ao consultar Places: ${(err as Error).message}`,
    };
  }
}

// ── Geo validation: lat/lng está dentro da cidade declarada? ──────────────────

export interface GeoValidationResult {
  lat:        number;
  lng:        number;
  expected_city?: string;
  resolved_city?: string;
  match:      boolean | null;
  distance_km?: number;
  message:    string;
}

/** Distância haversine entre dois pontos em km */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Valida coords contra cidade via Geocoding API.
 * Retorna match=true se a cidade resolvida bate (case-insensitive contains).
 */
export async function validateGeoCoords(
  lat: number, lng: number, expectedCity?: string
): Promise<GeoValidationResult> {
  if (lat === 0 && lng === 0) {
    return { lat, lng, expected_city: expectedCity, match: false,
      message: 'Coordenadas (0,0) — provavelmente null' };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { lat, lng, expected_city: expectedCity, match: false,
      message: 'Coordenadas fora dos limites geográficos' };
  }
  if (!expectedCity) {
    return { lat, lng, match: null, message: 'Sem cidade declarada para comparar' };
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return { lat, lng, expected_city: expectedCity, match: null,
      message: 'GOOGLE_PLACES_API_KEY ausente — não é possível validar' };
  }

  try {
    const { data } = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { latlng: `${lat},${lng}`, key, language: 'en', result_type: 'locality|administrative_area_level_2' },
      timeout: 8000,
    });
    if (data.status !== 'OK' || !data.results?.length) {
      return { lat, lng, expected_city: expectedCity, match: null,
        message: `Geocoding retornou ${data.status}` };
    }
    const components: { long_name: string; short_name: string; types: string[] }[]
      = data.results[0].address_components ?? [];
    const cityComp = components.find((c) => c.types.includes('locality'))
      ?? components.find((c) => c.types.includes('administrative_area_level_2'));
    const resolved = cityComp?.long_name ?? '';
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const match = !!resolved && (norm(resolved).includes(norm(expectedCity)) || norm(expectedCity).includes(norm(resolved)));
    return {
      lat, lng, expected_city: expectedCity, resolved_city: resolved, match,
      message: match
        ? `OK — coords ficam em ${resolved}`
        : `DIVERGÊNCIA — coords ficam em "${resolved}", mas registro diz "${expectedCity}"`,
    };
  } catch (err) {
    return { lat, lng, expected_city: expectedCity, match: null,
      message: `Erro no geocoding: ${(err as Error).message}` };
  }
}

// ── Batch helpers ─────────────────────────────────────────────────────────────

export async function batchCheckEmails(
  emails: { id: unknown; email: string }[],
  concurrency = 8
): Promise<Array<EmailRealityResult & { id: unknown }>> {
  const results: Array<EmailRealityResult & { id: unknown }> = [];
  for (let i = 0; i < emails.length; i += concurrency) {
    const batch = emails.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map((e) => checkEmailReality(e.email)));
    settled.forEach((r, idx) => {
      // Falha de checagem NUNCA some do relatório — vira status explícito 'unknown'.
      if (r.status === 'fulfilled') results.push({ ...r.value, id: batch[idx].id });
      else results.push({
        email: batch[idx].email, valid_syntax: false, domain: '', has_mx: null,
        status: 'unreachable',
        message: `Checagem falhou: ${String(r.reason).slice(0, 120)}`, id: batch[idx].id,
      });
    });
  }
  return results;
}

export async function batchCheckUrls(
  urls: { id: unknown; url: string }[],
  concurrency = 5
): Promise<Array<UrlRealityResult & { id: unknown }>> {
  const results: Array<UrlRealityResult & { id: unknown }> = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map((u) => checkUrlReality(u.url)));
    settled.forEach((r, idx) => {
      // Falha de checagem NUNCA some do relatório — vira resultado explícito não-alcançável.
      if (r.status === 'fulfilled') results.push({ ...r.value, id: batch[idx].id });
      else results.push({
        url: batch[idx].url, reachable: false, latency_ms: 0,
        message: `Checagem falhou: ${String(r.reason).slice(0, 120)}`, id: batch[idx].id,
      } as UrlRealityResult & { id: unknown });
    });
  }
  return results;
}
