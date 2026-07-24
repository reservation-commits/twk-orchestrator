/**
 * Pure cover-selection policy — no deps, unit-testable. Encodes the rule that a restaurant's
 * hero/background should be an AMBIENCE shot (a dish is a poor background), which is exactly the
 * bug that kept recurring (dish-heavy sites getting a plate as the cover).
 */
export interface CoverItem { w: number; h: number; category: 'ambiente' | 'prato' }

/**
 * Pick the index of the best cover from a list. Preference order:
 *   1. landscape AMBIENCE ≥ coverMinW   2. landscape dish ≥ coverMinW
 *   3. largest landscape ambience       4. largest landscape dish
 *   5. largest image of any orientation
 * Returns -1 for an empty list.
 */
export function pickCoverIndex(items: CoverItem[], coverMinW = 1500): number {
  if (!items.length) return -1;
  const idx = items.map((it, i) => ({ it, i }));
  const byW = (a: { it: CoverItem }, b: { it: CoverItem }) => b.it.w - a.it.w;
  const land = idx.filter((x) => x.it.w >= x.it.h).sort(byW);
  const amb = land.filter((x) => x.it.category === 'ambiente');
  const dish = land.filter((x) => x.it.category === 'prato');
  const pick =
    amb.find((x) => x.it.w >= coverMinW) ??
    dish.find((x) => x.it.w >= coverMinW) ??
    amb[0] ?? dish[0] ??
    idx.slice().sort(byW)[0];
  return pick ? pick.i : -1;
}
