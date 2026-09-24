import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestUrlFix, suggestPhoneFix, generateSlug, suggestEmailFix,
  suggestStringFix, generateAutoFixSuggestions,
} from '../lib/auto-fixer.ts';

test('suggestUrlFix adds protocol to bare domains, leaves clean URLs alone', () => {
  assert.equal(suggestUrlFix('example.com'), 'https://example.com');
  assert.equal(suggestUrlFix('www.rest.fr'), 'https://www.rest.fr');
  assert.equal(suggestUrlFix('https://x.com/'), null);
  assert.equal(suggestUrlFix(''), null);
  assert.equal(suggestUrlFix('not a url'), null);
});

test('suggestPhoneFix normalises to E.164, rejects junk', () => {
  assert.equal(suggestPhoneFix('+1 202 456 1111'), '+12024561111');
  assert.equal(suggestPhoneFix('12'), null);
  assert.equal(suggestPhoneFix('abc'), null);
});

test('generateSlug strips diacritics, spaces and symbols', () => {
  assert.equal(generateSlug('São Paulo Café', 'Rio'), 'sao-paulo-cafe-rio');
  assert.equal(generateSlug("L'Atelier de Joël", 'Paris'), 'l-atelier-de-joel-paris');
});

test('suggestEmailFix repairs known domain typos only', () => {
  assert.equal(suggestEmailFix('user@gmial.com'), 'user@gmail.com');
  assert.equal(suggestEmailFix('a@hotmial.com'), 'a@hotmail.com');
  assert.equal(suggestEmailFix('valid@gmail.com'), null);
  assert.equal(suggestEmailFix('no-at-sign'), null);
});

test('suggestStringFix collapses whitespace, else null', () => {
  assert.equal(suggestStringFix('  Bad   spacing  '), 'Bad spacing');
  assert.equal(suggestStringFix('already clean'), null);
});

test('generateAutoFixSuggestions produces the expected rules for a messy row', () => {
  const rows = [{
    id: 1, name: '  Bad   Name ', site_url: 'example.com',
    email_for_reservations: 'x@gmial.com', slug: '', city: 'Paris',
  }];
  const s = generateAutoFixSuggestions(rows, { table: 't', idCol: 'id' });
  const rules = new Set(s.map((x) => x.rule));
  assert.ok(rules.has('url_normalize'));
  assert.ok(rules.has('email_typo'));
  assert.ok(rules.has('slug_regen'));
  assert.ok(rules.has('whitespace'));
  // provenance: every suggestion keeps old + new value
  assert.ok(s.every((x) => 'old_value' in x && 'new_value' in x && x.row_id === 1));
});
