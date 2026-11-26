/** Elements the Tab key can reach. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab has to jump so focus stays inside a trap holding `count` elements, with `index` focused
 * (-1: none of them). Null means the browser's own move already stays inside.
 */
export function wrapTarget(count: number, index: number, backwards: boolean): number | null {
  const last = count - 1;
  if (index < 0) return backwards ? last : 0;
  if (backwards) return index === 0 ? last : null;
  return index === last ? 0 : null;
}
