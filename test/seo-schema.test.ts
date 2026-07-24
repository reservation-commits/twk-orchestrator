import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleRestaurantSchema, parseCuisines, priceRange, dayUrl } from '../lib/seo-schema.ts';

test('parseCuisines strips Michelin/price tokens and dedups', () => {
  assert.deepEqual(parseCuisines('$$$$|European|Portuguese, Vegetarian friendly'), ['European', 'Portuguese', 'Vegetarian friendly']);
  assert.deepEqual(parseCuisines('*Michelin|$$$|French|French'), ['French']);
  assert.deepEqual(parseCuisines(''), []);
  assert.deepEqual(parseCuisines(null), []);
});

test('priceRange maps 1-4 to $ signs and clamps', () => {
  assert.equal(priceRange(1), '$');
  assert.equal(priceRange(4), '$$$$');
  assert.equal(priceRange(9), '$$$$');
  assert.equal(priceRange(null), undefined);
});

test('dayUrl maps weekday index to schema.org day (0=Monday assumption)', () => {
  assert.equal(dayUrl(0), 'https://schema.org/Monday');
  assert.equal(dayUrl(6), 'https://schema.org/Sunday');
  assert.equal(dayUrl(7), 'https://schema.org/Monday');
});

test('assembleRestaurantSchema builds a rich, valid-shaped Restaurant JSON-LD', () => {
  const s = assembleRestaurantSchema(
    {
      name: '88 Restaurant', slug: '88-restaurant-cascais', about_text: 'A place.',
      images_json: { cover: { source_url: 'C' }, slider: [{ source_url: 'HERO' }, { source_url: 'G2' }] },
      telephone_of_the_establishment: '+351 123', address_of_establishment: 'Rua X',
      city: 'Cascais', country_code: 'PT', latitude: 38.7, longitude: -9.4,
      restaurant_category: '$$$$|European|Portuguese', price_range_id: 4,
    },
    [{ weekday: 0, open_time: '12:00:00', close_time: '23:00:00' }],
    ['1 Michelin Star']
  );
  assert.equal(s['@type'], 'Restaurant');
  assert.equal(s.name, '88 Restaurant');
  assert.equal((s.image as string[])[0], 'HERO'); // hero (slider[0]) leads the image array
  assert.equal(s.priceRange, '$$$$');
  assert.deepEqual(s.servesCuisine, ['European', 'Portuguese']);
  assert.equal((s.geo as { latitude: number }).latitude, 38.7);
  assert.equal((s.address as { addressCountry: string }).addressCountry, 'PT');
  assert.equal((s.openingHoursSpecification as unknown[]).length, 1);
  assert.deepEqual(s.award, ['1 Michelin Star']);
  assert.equal(s.acceptsReservations, true);
});

test('assembleRestaurantSchema omits empty optionals gracefully', () => {
  const s = assembleRestaurantSchema({ name: 'X', slug: 'x' });
  assert.equal(s.name, 'X');
  assert.equal(s.geo, undefined);
  assert.equal(s.priceRange, undefined);
  assert.equal(s.openingHoursSpecification, undefined);
  assert.equal(s.acceptsReservations, true);
});
