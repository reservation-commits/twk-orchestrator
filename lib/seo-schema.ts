/**
 * Pure schema.org Restaurant JSON-LD assembly — no DB, so it is unit-testable in isolation.
 * lib/seo.ts fetches the rows and delegates the actual JSON-LD building to `assembleRestaurantSchema`.
 */
import { type RestaurantSchema, imageUrls } from '../types/contract.ts';

const SITE = 'https://theworldkeys.com';

// weekday integer (0–6) → schema.org day. ASSUMPTION: 0 = Monday … 6 = Sunday (EU/ISO-1).
// If a known restaurant's days look shifted on Google, flip this single array.
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const dayUrl = (wd: number) => `https://schema.org/${DAYS[((Math.trunc(wd) % 7) + 7) % 7]}`;
const hhmm = (t: unknown) => String(t ?? '').slice(0, 5);

// restaurant_category format: `[*Michelin|][$$$$|]cuisines, feature` → list of cuisines.
export function parseCuisines(cat?: string | null): string[] {
  if (!cat) return [];
  return [...new Set(
    cat.split(/[|,]/).map((s) => s.trim())
      .filter((s) => s && !/^\*?michelin/i.test(s) && !/^\$+$/.test(s))
  )];
}

// price_range_id (1–4) → schema priceRange ('$'…'$$$$').
export function priceRange(id: unknown): string | undefined {
  if (id == null) return undefined;
  const n = Math.min(4, Math.max(1, Number(id)));
  return Number.isNaN(n) ? undefined : '$'.repeat(n);
}

export interface SchemaRow {
  name?: unknown; slug?: unknown; url_page_twk?: unknown; about_text?: unknown; images_json?: unknown;
  telephone_of_the_establishment?: unknown; address_of_establishment?: unknown;
  city?: unknown; country?: unknown; country_code?: unknown; latitude?: unknown; longitude?: unknown;
  restaurant_category?: unknown; price_range_id?: unknown;
}
export interface HourRow { weekday: number; open_time: unknown; close_time: unknown; }

const pageUrl = (r: SchemaRow) => (r.url_page_twk as string) || `${SITE}/hospitality/${r.slug ?? ''}/`;

/** Build a schema.org Restaurant JSON-LD from a plain row + its hours + award names. */
export function assembleRestaurantSchema(r: SchemaRow, hours: HourRow[] = [], awards: string[] = []): RestaurantSchema {
  const schema: RestaurantSchema = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': `${pageUrl(r)}#restaurant`,
    name: r.name,
    url: pageUrl(r),
  };
  if (r.about_text) schema.description = r.about_text;

  const imgs = imageUrls(r.images_json);
  if (imgs.length) schema.image = imgs.length === 1 ? imgs[0] : imgs;

  if (r.telephone_of_the_establishment) schema.telephone = r.telephone_of_the_establishment;

  const address: Record<string, unknown> = { '@type': 'PostalAddress' };
  if (r.address_of_establishment) address.streetAddress = r.address_of_establishment;
  if (r.city) address.addressLocality = r.city;
  if (r.country_code) address.addressCountry = r.country_code; else if (r.country) address.addressCountry = r.country;
  schema.address = address;

  if (r.latitude != null && r.longitude != null) {
    schema.geo = { '@type': 'GeoCoordinates', latitude: Number(r.latitude), longitude: Number(r.longitude) };
  }

  const cuisines = parseCuisines(r.restaurant_category as string | null);
  if (cuisines.length) schema.servesCuisine = cuisines;

  const price = priceRange(r.price_range_id);
  if (price) schema.priceRange = price;

  if (hours.length) {
    schema.openingHoursSpecification = hours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: dayUrl(Number(h.weekday)),
      opens: hhmm(h.open_time),
      closes: hhmm(h.close_time),
    }));
  }

  if (awards.length) schema.award = [...new Set(awards)];
  schema.acceptsReservations = true;
  return schema;
}
