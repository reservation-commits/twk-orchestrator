import axios from 'axios';

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';
const API_KEY = () => process.env.GOOGLE_PLACES_API_KEY!;

export interface PlaceSearchResult {
  place_id: string;
  name: string;
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
  rating?: number;
  price_level?: number;
  types: string[];
  photos?: { photo_reference: string; width: number; height: number }[];
  opening_hours?: { open_now: boolean };
}

export interface PlaceDetails extends PlaceSearchResult {
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  url?: string;
  vicinity?: string;
  editorial_summary?: { overview: string };
  opening_hours?: {
    open_now: boolean;
    weekday_text: string[];
    periods: {
      open: { day: number; time: string };
      close?: { day: number; time: string };
    }[];
  };
  reviews?: {
    author_name: string;
    rating: number;
    text: string;
    time: number;
  }[];
  reservable?: boolean;
  serves_dinner?: boolean;
  serves_lunch?: boolean;
  takeout?: boolean;
  delivery?: boolean;
}

export interface RestaurantInsert {
  name: string;
  slug: string;
  address: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  phone?: string;
  website?: string;
  google_place_id: string;
  google_maps_url?: string;
  rating?: number;
  price_level?: number;
  cuisine_types: string[];
  photos: string[];
  description?: string;
  michelin_stars?: number;
  michelin_distinction?: string;
  reservable?: boolean;
  serves_dinner?: boolean;
  serves_lunch?: boolean;
  opening_hours_raw?: object;
}

export async function searchRestaurantsByCity(
  city: string,
  cuisine: string = 'fine dining',
  count: number = 20
): Promise<PlaceSearchResult[]> {
  const results: PlaceSearchResult[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      query: `best ${cuisine} restaurants in ${city}`,
      type: 'restaurant',
      key: API_KEY(),
    };
    if (pageToken) params.pagetoken = pageToken;

    const { data } = await axios.get(`${PLACES_BASE}/textsearch/json`, { params });

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Places API error: ${data.status} — ${data.error_message ?? ''}`);
    }

    const filtered = (data.results as PlaceSearchResult[]).filter(
      (r) => (r.rating ?? 0) >= 3.5
    );
    results.push(...filtered);

    pageToken = data.next_page_token;

    if (pageToken && results.length < count) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  } while (pageToken && results.length < count);

  return results.slice(0, count);
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const fields = [
    'name', 'formatted_address', 'geometry', 'formatted_phone_number',
    'international_phone_number', 'website', 'opening_hours', 'photos',
    'rating', 'price_level', 'reviews', 'types', 'url', 'vicinity',
    'editorial_summary', 'reservable', 'serves_dinner', 'serves_lunch',
    'takeout', 'delivery', 'place_id',
  ].join(',');

  const { data } = await axios.get(`${PLACES_BASE}/details/json`, {
    params: { place_id: placeId, fields, key: API_KEY() },
  });

  if (data.status !== 'OK') {
    throw new Error(`Places Details error: ${data.status}`);
  }
  return data.result as PlaceDetails;
}

export function getPlacePhotoUrls(
  photoReferences: { photo_reference: string }[],
  maxWidth = 1200,
  limit = 5
): string[] {
  return photoReferences.slice(0, limit).map(
    (p) =>
      `${PLACES_BASE}/photo?maxwidth=${maxWidth}&photo_reference=${p.photo_reference}&key=${API_KEY()}`
  );
}

export async function enrichFromMichelinGuide(
  name: string,
  city: string
): Promise<{ stars: number; bib_gourmand: boolean; distinction?: string }> {
  const delay = parseInt(process.env.MICHELIN_SCRAPE_DELAY ?? '2000', 10);
  await new Promise((r) => setTimeout(r, delay));

  try {
    const query = encodeURIComponent(`${name} ${city}`);
    const url = `https://guide.michelin.com/en/restaurants?query=${query}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TWK-Bot/1.0)' },
      timeout: 8000,
    });

    const html: string = response.data;
    const starsMatch = html.match(/(\d)\s*Michelin\s*Star/i);
    const bibMatch = /Bib\s*Gourmand/i.test(html);

    return {
      stars: starsMatch ? parseInt(starsMatch[1], 10) : 0,
      bib_gourmand: bibMatch,
      distinction: starsMatch ? `${starsMatch[1]} Michelin Star${starsMatch[1] !== '1' ? 's' : ''}` : bibMatch ? 'Bib Gourmand' : undefined,
    };
  } catch {
    return { stars: 0, bib_gourmand: false };
  }
}

export function extractCityCountry(address: string, city: string): { city: string; country: string } {
  const parts = address.split(',').map((s) => s.trim());
  const country = parts[parts.length - 1] ?? '';
  return { city, country };
}

export function mapPlaceToDBSchema(
  details: PlaceDetails,
  city: string,
  description?: string,
  michelinData?: { stars: number; bib_gourmand: boolean; distinction?: string }
): RestaurantInsert {
  const { city: resolvedCity, country } = extractCityCountry(details.formatted_address ?? '', city);
  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = slugify(`${details.name}-${resolvedCity}`);

  const photoUrls = details.photos
    ? getPlacePhotoUrls(details.photos, 1200, 5)
    : [];

  const cuisineTypes = (details.types ?? []).filter((t) =>
    !['establishment', 'food', 'point_of_interest'].includes(t)
  );

  return {
    name: details.name,
    slug,
    address: details.formatted_address ?? '',
    city: resolvedCity,
    country,
    latitude: details.geometry.location.lat,
    longitude: details.geometry.location.lng,
    phone: details.formatted_phone_number,
    website: details.website,
    google_place_id: details.place_id,
    google_maps_url: details.url,
    rating: details.rating,
    price_level: details.price_level,
    cuisine_types: cuisineTypes,
    photos: photoUrls,
    description,
    michelin_stars: michelinData?.stars,
    michelin_distinction: michelinData?.distinction,
    reservable: details.reservable,
    serves_dinner: details.serves_dinner,
    serves_lunch: details.serves_lunch,
    opening_hours_raw: details.opening_hours,
  };
}
