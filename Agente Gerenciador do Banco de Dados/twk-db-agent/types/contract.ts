/**
 * Shared agent ↔ frontend contract for restaurant media + structured data.
 *
 * This is the single source of truth for the shapes that cross the boundary between the agent
 * (which WRITES them) and the public site (which RENDERS them). Both sides import from here so a
 * field can never silently drift — the class of bug where the site read `slider[0]` while the
 * agent wrote `cover`.
 */
import { z } from 'zod';

// One image reference inside images_json. Only `source_url` is guaranteed; legacy rows carry
// extra/variant keys (`file_name`, `type`), so validation is permissive (passthrough).
export interface ImageRef {
  source_url: string;
  alt_text?: string;
  filename?: string;
  id?: number | null;
  origin_source?: string;
  origin_url?: string;
}

/**
 * The `db_restaurants.images_json` column.
 *
 * INVARIANT: the public site renders the hero/background AND og:image from `slider[0]` — NOT
 * from `cover`. So the chosen cover must LEAD the slider; `cover` is kept mirrored to slider[0]
 * for listing cards / SEO. Verified against live theworldkeys.com pages (og:image === slider[0]).
 */
export interface ImagesJson {
  logo?: ImageRef | null;
  cover?: ImageRef | null;
  slider?: ImageRef[];
  gallery?: ImageRef[];
}

/**
 * THE canonical hero resolver. Every place that shows or decides "the cover" (admin preview,
 * publish writer, SEO/schema image, missing-photo detection) MUST use this, so they can never
 * disagree. Returns slider[0] first, then cover, else null.
 */
export function heroUrl(images: unknown): string | null {
  if (!images || typeof images !== 'object') return null;
  const o = images as ImagesJson;
  return o.slider?.[0]?.source_url ?? o.cover?.source_url ?? null;
}

export function hasHero(images: unknown): boolean {
  return !!heroUrl(images);
}

// Up to `limit` distinct image URLs for schema.org `image` (hero first, then the rest of slider).
export function imageUrls(images: unknown, limit = 6): string[] {
  if (!images || typeof images !== 'object') return [];
  const o = images as ImagesJson;
  const urls = [heroUrl(o), ...(o.slider ?? []).map((s) => s?.source_url)];
  return [...new Set(urls.filter((u): u is string => !!u))].slice(0, limit);
}

// ── Runtime validators (used by tests and can guard writes) ──────────────────
export const ImageRefSchema = z.object({
  source_url: z.string().min(1),
  alt_text: z.string().optional(),
  filename: z.string().optional(),
  id: z.union([z.number(), z.null()]).optional(),
}).passthrough();

export const ImagesJsonSchema = z.object({
  logo: ImageRefSchema.nullable().optional(),
  cover: ImageRefSchema.nullable().optional(),
  slider: z.array(ImageRefSchema).optional(),
  gallery: z.array(ImageRefSchema).optional(),
}).passthrough();

// schema.org Restaurant JSON-LD payload (loose — many optional fields).
export type RestaurantSchema = Record<string, unknown>;
