/**
 * Vanilla lightmap (assets/minecraft/shaders/core/lightmap.fsh and LightmapRenderStateExtractor, 26.2).
 * All colours are in Minecraft's own (sRGB-ish) space; convert to linear only when handing them to three.js.
 */
export type Rgb = [number, number, number];

export interface LightEnv {
  /** visual/sky_light_factor after weather. */
  skyFactor: number;
  /** visual/sky_light_color after weather. */
  skyLightColor: Rgb;
  /** Random-walk flicker; the shader's BlockFactor is flicker + 1.4. */
  flicker: number;
}

/** Overworld visual/ambient_light_color #0a0a0a. */
const AMBIENT = 10 / 255;
/** visual/block_light_tint default (int -10100 = #ffd88c). */
const BLOCK_TINT: Rgb = [1, 216 / 255, 140 / 255];
/** options.gamma default (brightness slider at 50%). */
const BRIGHTNESS = 0.5;

const brightness = (level: number) => level / (4 - 3 * level);

/** Lightmap colour for block and sky light levels 0..15. */
export const lightmapColor = (block: number, sky: number, env: LightEnv): Rgb => {
  const bl = block / 15;
  const sl = sky / 15;
  const blockB = brightness(bl) * (env.flicker + 1.4);
  const skyB = brightness(sl) * env.skyFactor;
  const mix = 0.9 * (2 * bl - 1) * (2 * bl - 1);
  const c = [0, 1, 2].map((i) => {
    const tint = BLOCK_TINT[i] + (1 - BLOCK_TINT[i]) * mix;
    return Math.min(1, Math.max(0, AMBIENT + env.skyLightColor[i] * skyB + tint * blockB));
  });
  const max = Math.max(c[0], c[1], c[2]);
  const inv = 1 - max;
  const scaled = max > 0 ? (1 - inv * inv * inv * inv) / max : 0;
  return c.map((v) => v + (v * scaled - v) * BRIGHTNESS) as Rgb;
};

/** Writes the 16x16 lightmap (x = block light, y = sky light) as RGBA bytes. */
export const fillLightmap = (data: Uint8Array, env: LightEnv): void => {
  for (let sky = 0; sky < 16; sky++) {
    for (let block = 0; block < 16; block++) {
      const c = lightmapColor(block, sky, env);
      const o = (sky * 16 + block) * 4;
      data[o] = Math.round(c[0] * 255);
      data[o + 1] = Math.round(c[1] * 255);
      data[o + 2] = Math.round(c[2] * 255);
      data[o + 3] = 255;
    }
  }
};

/** One client tick (1/20 s) of the block light flicker random walk. */
export const tickFlicker = (flicker: number, rand: () => number = Math.random): number =>
  (flicker + (rand() - rand()) * rand() * rand() * 0.1) * 0.9;
