/** Turns a user-picked accent into theme tokens that stay readable. */

const WHITE = "#ffffff";
const BLACK = "#000000";
/** The built-in canvas, assumed when a pack does not name a hex one. */
const DEFAULT_CANVAS = "#0a0f1d";
/** WCAG 2.1 AA for normal text. */
const MIN_CONTRAST = 4.5;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Moves `hex` towards `target` only as far as needed to contrast with `against`. */
function ensureContrast(hex: string, target: string, against: string): string {
  const from = channels(hex);
  const to = channels(target);
  for (let step = 0; step <= 20; step++) {
    const mixed =
      "#" + from.map((c, i) => Math.round(c + ((to[i] - c) * step) / 20).toString(16).padStart(2, "0")).join("");
    if (contrast(mixed, against) >= MIN_CONTRAST) return mixed;
  }
  return target;
}

/** `h` in degrees, `s` and `v` in 0..1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = channels(hex).map((c) => c / 255);
  const v = Math.max(r, g, b);
  const d = v - Math.min(r, g, b);
  const sector = d === 0 ? 0 : v === r ? ((g - b) / d + 6) % 6 : v === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: sector * 60, s: v === 0 ? 0 : d / v, v };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

export const isHexColor = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value);

/** `--fc-primary` carries white button text; `--fc-highlight` is text on the canvas. */
export function accentTokens(accent: string, canvas = DEFAULT_CANVAS): Record<string, string> {
  if (!isHexColor(accent)) return {};
  const background = isHexColor(canvas) ? canvas : DEFAULT_CANVAS;
  // On a light canvas the text colour has to move towards black instead.
  const away = contrast(background, BLACK) > contrast(background, WHITE) ? BLACK : WHITE;
  return {
    "--fc-primary": ensureContrast(accent, BLACK, WHITE),
    "--fc-highlight": ensureContrast(accent, away, background),
  };
}
