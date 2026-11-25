import dayTimeline from "@/assets/party/data/day.json";
import type { Rgb } from "./lightmap";

/** Colours are 0..1 in Minecraft's own colour space; alpha last. */
export type Rgba = [number, number, number, number];

/** Overworld / birch forest base values (dimension_type/overworld.json, worldgen/biome/birch_forest.json). */
const BIOME_SKY: Rgb = [0x7a / 255, 0xa5 / 255, 1];
const BASE_FOG: Rgb = [0xc0 / 255, 0xd8 / 255, 1];
const BASE_CLOUD: Rgba = [1, 1, 1, 0xcc / 255];
const NIGHT_SKY_LIGHT: Rgb = [0x7a / 255, 0x7a / 255, 1];
/** Render distance in chunks; the camp's terrain ends just past it. */
export const RENDER_DISTANCE = 6;

/** The visual environment for one moment: the vanilla day timeline with the rain and thunder layers applied. */
export interface Env {
  skyColor: Rgb;
  fogColor: Rgb;
  cloudColor: Rgba;
  sunriseColor: Rgba;
  skyLightColor: Rgb;
  skyLightFactor: number;
  starBrightness: number;
  /** Degrees; 0 = overhead. */
  sunAngle: number;
  moonAngle: number;
  starAngle: number;
  /** Sun, moon and stars fade out in rain. */
  celestialAlpha: number;
  /** Level.skyDarken: (int) (15 - gameplay/sky_light_level); what block logic (fireflies) subtracts from sky light. */
  skyDarken: number;
}

type Value = number | string;
interface Keyframe {
  ticks: number;
  value: Value;
}
interface Track {
  ease?: string | { cubic_bezier: [number, number, number, number] };
  keyframes: Keyframe[];
}
const timeline = dayTimeline as unknown as { period_ticks: number; tracks: Record<string, Track> };

/** "#rrggbb", "#aarrggbb" or a signed ARGB int, to [r, g, b, a]. */
const toRgba = (v: Value): Rgba => {
  let argb: number;
  if (typeof v === "number") argb = v >>> 0;
  else {
    const hex = v.slice(1);
    argb = parseInt(hex.length === 6 ? `ff${hex}` : hex, 16) >>> 0;
  }
  return [((argb >>> 16) & 255) / 255, ((argb >>> 8) & 255) / 255, (argb & 255) / 255, (argb >>> 24) / 255];
};

/** y of a CSS-style cubic bezier at x. */
const bezier = ([x1, y1, x2, y2]: [number, number, number, number], x: number): number => {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
};

/** Samples a periodic timeline track; keyframes sharing a tick make a jump (the later one wins going forward). */
const sample = (name: string, tick: number): number[] => {
  const track = timeline.tracks[name];
  const period = timeline.period_ticks;
  const kfs = track.keyframes;
  let prev: Keyframe | undefined;
  let next: Keyframe | undefined;
  for (const kf of kfs) if (kf.ticks <= tick) prev = kf;
  for (const kf of kfs) if (kf.ticks > tick) { next = kf; break; }
  const prevT = prev ? prev.ticks : kfs[kfs.length - 1].ticks - period;
  const nextT = next ? next.ticks : kfs[0].ticks + period;
  prev ??= kfs[kfs.length - 1];
  next ??= kfs[0];
  const isColor = typeof prev.value === "string" || name.endsWith("color");
  const a = isColor ? toRgba(prev.value) : [prev.value as number];
  const b = isColor ? toRgba(next.value) : [next.value as number];
  if (track.ease === "constant") return a;
  let t = nextT === prevT ? 0 : (tick - prevT) / (nextT - prevT);
  if (typeof track.ease === "object") t = bezier(track.ease.cubic_bezier, t);
  return a.map((x, i) => x + (b[i] - x) * t);
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpN = <T extends number[]>(a: T, b: readonly number[], t: number) => a.map((x, i) => lerp(x, b[i], t)) as T;
const mul = <T extends number[]>(a: T, b: readonly number[]) => a.map((x, i) => x * (b[i] ?? 1)) as T;
/** ColorModifier.BLEND_TO_GRAY. */
const blendToGray = <T extends number[]>(c: T, brightness: number, factor: number): T => {
  const gray = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) * brightness;
  return c.map((x, i) => (i < 3 ? lerp(x, gray, factor) : x)) as T;
};

/** WeatherAttributes RAIN and THUNDER (26.2). */
const WEATHER = {
  rain: { sky: [0.6, 0.75], fog: [0.5, 0.5, 0.6], cloud: [0.24, 0.5], light: 0.3125, sunrise: [0.5, 0.5, 0.6] },
  thunder: { sky: [0.24, 0.94], fog: [0.25, 0.25, 0.3], cloud: [0.095, 0.94], light: 0.52734375, sunrise: [0.25, 0.25, 0.3] },
} as const;
/** gameplay/sky_light_level default, and the level rain and thunder blend it toward. */
const SKY_LIGHT_LEVEL = 15;
const WEATHER_SKY_LIGHT_LEVEL = 4;

/** How far full cloud cover pushes the sky: saturation, brightness and the sunrise glow (a light touch; rain does the heavy work). */
const CLOUD_DESATURATE = 0.2;
const CLOUD_DIM = 0.08;
const CLOUD_SUNRISE_ALPHA = 0.35;

/**
 * `rain` and `thunder` are the 0..1 weather levels; `flash` brightens the sky during a lightning flash (0..1);
 * `cloud` is the 0..1 cloud cover, which slightly greys and dims clear skies (it fades out as rain takes over).
 */
export const environmentAt = (tick: number, rain: number, thunder: number, flash = 0, cloud = 0): Env => {
  const t = ((tick % 24000) + 24000) % 24000;
  const env: Env = {
    skyColor: mul([...BIOME_SKY] as Rgb, sample("sky_color", t)),
    fogColor: mul([...BASE_FOG] as Rgb, sample("fog_color", t)),
    cloudColor: mul([...BASE_CLOUD] as Rgba, sample("cloud_color", t)),
    sunriseColor: sample("sunrise_sunset_color", t) as Rgba,
    skyLightColor: sample("sky_light_color", t).slice(0, 3) as Rgb,
    skyLightFactor: sample("sky_light_factor", t)[0],
    starBrightness: Math.max(0, sample("star_brightness", t)[0]),
    sunAngle: sample("sun_angle", t)[0],
    moonAngle: sample("moon_angle", t)[0],
    starAngle: sample("star_angle", t)[0],
    celestialAlpha: 1 - rain,
    skyDarken: 0,
  };
  let skyLightLevel = SKY_LIGHT_LEVEL * sample("sky_light_level", t)[0];
  const layers: Array<[keyof typeof WEATHER, number]> = [["rain", rain - thunder], ["thunder", thunder]];
  for (const [kind, w] of layers) {
    if (w <= 0) continue;
    const m = WEATHER[kind];
    env.skyColor = lerpN(env.skyColor, blendToGray(env.skyColor, m.sky[0], m.sky[1]), w);
    env.fogColor = lerpN(env.fogColor, mul(env.fogColor, m.fog), w);
    env.cloudColor = lerpN(env.cloudColor, blendToGray(env.cloudColor, m.cloud[0], m.cloud[1]), w);
    env.skyLightColor = lerpN(env.skyLightColor, lerpN(env.skyLightColor, NIGHT_SKY_LIGHT, m.light), w);
    env.skyLightFactor = lerp(env.skyLightFactor, lerp(env.skyLightFactor, 0.24, m.light), w);
    env.starBrightness = lerp(env.starBrightness, 0, w);
    env.sunriseColor = lerpN(env.sunriseColor, mul(env.sunriseColor, m.sunrise), w);
    skyLightLevel = lerp(skyLightLevel, lerp(skyLightLevel, WEATHER_SKY_LIGHT_LEVEL, m.light), w);
  }
  const overcast = Math.min(1, Math.max(0, cloud)) * (1 - rain);
  if (overcast > 0) {
    const dim = 1 - CLOUD_DIM * overcast;
    env.skyColor = mul(blendToGray(env.skyColor, 1, CLOUD_DESATURATE * overcast), [dim, dim, dim]);
    env.fogColor = mul(blendToGray(env.fogColor, 1, CLOUD_DESATURATE * overcast), [dim, dim, dim]);
    env.skyLightFactor *= dim;
    env.sunriseColor = [env.sunriseColor[0], env.sunriseColor[1], env.sunriseColor[2], env.sunriseColor[3] * (1 - CLOUD_SUNRISE_ALPHA * overcast)];
  }
  env.skyDarken = Math.trunc(15 - skyLightLevel);
  if (flash > 0) {
    // shortcut: pre-26 lightning flash (sky towards pale blue, sky light at full); 26.x moved this into code not checked here.
    env.skyColor = lerpN(env.skyColor, [0.8, 0.8, 1], 0.45 * flash);
    env.skyLightFactor = lerp(env.skyLightFactor, 1, flash);
  }
  return env;
};

/** The sun's side of the horizon: +1 = east (morning), -1 = west (evening); SkyRenderer / fog use sin(sunAngle). */
export const sunSide = (env: Env): number => (Math.sin((env.sunAngle * Math.PI) / 180) > 0 ? -1 : 1);

/**
 * AtmosphericFogEnvironment.getBaseColor: the fog colour leans towards the sunrise colour when looking at the sun,
 * then towards the (weather-darkened) sky colour by render distance.
 */
export const fogColorFor = (env: Env, forwardX: number, rain: number, thunder: number): Rgb => {
  let fog = [...env.fogColor] as Rgb;
  const d = forwardX * sunSide(env);
  const a = env.sunriseColor[3];
  if (d > 0 && a > 0) fog = lerpN(fog, env.sunriseColor.slice(0, 3), d * a);
  const sky = [...env.skyColor] as Rgb;
  if (rain > 0) {
    sky[0] *= 1 - rain * 0.5;
    sky[1] *= 1 - rain * 0.5;
    sky[2] *= 1 - rain * 0.4;
  }
  if (thunder > 0) for (let i = 0; i < 3; i++) sky[i] *= 1 - thunder * 0.5;
  const f = 1 - Math.pow(0.25 + (0.75 * RENDER_DISTANCE) / 32, 0.25);
  return lerpN(fog, sky, f);
};
