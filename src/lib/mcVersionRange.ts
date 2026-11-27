/**
 * Rewrites the Minecraft constraint a mod declares (Fabric / Quilt predicates such as `>=1.20 <1.21`
 * or `~26.3-`, Maven ranges such as `[1.20,1.21)`) in plain words.
 */

export interface McRangeWords {
  any: string;
  atLeast: (v: string) => string;
  above: (v: string) => string;
  atMost: (v: string) => string;
  below: (v: string) => string;
  /** Joins two bounds that both apply. */
  and: string;
  /** Joins alternatives. */
  or: string;
}

type Describe = string | null;

const VERSION = /^\d[\w.+-]*$/;

/** A trailing `-` only means "pre-releases included". */
const clean = (v: string) => v.trim().replace(/-$/, "");

function predicate(text: string, words: McRangeWords): Describe {
  if (text === "*") return words.any;
  const [, operator = "", rest] = /^(>=|<=|>|<|=|~|\^)?\s*(.*)$/.exec(text) ?? [];
  const version = clean(rest ?? "");
  if (!VERSION.test(version)) return null;
  if (operator === ">=") return words.atLeast(version);
  if (operator === ">") return words.above(version);
  if (operator === "<=") return words.atMost(version);
  if (operator === "<") return words.below(version);
  if (operator === "" || operator === "=") return version;

  const parts = version.split(".").map((p) => parseInt(p, 10));
  if (parts.some(Number.isNaN)) return null;
  // `~1.20` is every 1.20.x; `~1.20.1` and `^1.2` start at a later point and need both ends.
  if (operator === "~" && parts.length === 2) return `${version}.x`;
  const upper = operator === "~" && parts.length > 2 ? `${parts[0]}.${parts[1] + 1}` : `${parts[0] + 1}`;
  return words.atLeast(version) + words.and + words.below(upper);
}

/** `[a,b)`, `(,b]`, `[a]`. */
function mavenRange(open: string, body: string, close: string, words: McRangeWords): Describe {
  const ends = body.split(",").map(clean);
  if (ends.some((v) => v && !VERSION.test(v))) return null;
  if (ends.length === 1) return ends[0] || null;
  if (ends.length !== 2) return null;
  const [low, high] = ends;
  const bounds = [
    low && (open === "[" ? words.atLeast(low) : words.above(low)),
    high && (close === "]" ? words.atMost(high) : words.below(high)),
  ].filter(Boolean);
  return bounds.length ? bounds.join(words.and) : words.any;
}

/** The constraint in words; text in a form not understood here is returned as written. */
export function formatMcRange(range: string, words: McRangeWords): string {
  const text = range.trim();
  let alternatives: Describe[];
  if (/^[[(]/.test(text)) {
    const ranges = [...text.matchAll(/([[(])([^[\]()]*)([\])])/g)];
    // Anything left over between the ranges means the text was not fully understood.
    if (!ranges.length || ranges.map((m) => m[0]).join(",") !== text.replace(/\s*,\s*(?=[[(])/g, ",")) return text;
    alternatives = ranges.map((m) => mavenRange(m[1], m[2], m[3], words));
  } else {
    alternatives = text.split("||").map((alternative) => {
      const bounds = alternative
        .trim()
        .replace(/(>=|<=|>|<|=|~|\^)\s+/g, "$1")
        .split(/\s+/)
        .map((p) => predicate(p, words));
      return bounds.includes(null) ? null : bounds.join(words.and);
    });
  }
  return alternatives.includes(null) ? text : alternatives.join(words.or);
}
