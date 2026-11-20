/** Block ids of the camp's voxel grid. */
export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  PATH: 3,
  STONE: 4,
  SAND: 5,
  WATER: 6,
  LOG: 7,
  LEAVES: 8,
  SHORT_GRASS: 9,
  CAMPFIRE: 10,
  /** block/cross_emissive; light level 2 (Blocks.FIREFLY_BUSH) and fireflies at night. */
  FIREFLY_BUSH: 11,
} as const;

/** A dense block grid with vanilla-style sky and block light. Outside the grid is open sky above and solid ground below. */
export class Voxels {
  readonly ids: Uint8Array;
  readonly blockLight: Uint8Array;
  readonly skyLight: Uint8Array;
  readonly W: number;
  readonly H: number;
  readonly D: number;

  constructor(W: number, H: number, D: number) {
    this.W = W;
    this.H = H;
    this.D = D;
    const n = W * H * D;
    this.ids = new Uint8Array(n);
    this.blockLight = new Uint8Array(n);
    this.skyLight = new Uint8Array(n);
  }

  /** Full opaque cubes: cull neighbours' faces, block all light. */
  static opaque(id: number): boolean {
    return id === B.GRASS || id === B.DIRT || id === B.STONE || id === B.SAND || id === B.LOG;
  }

  /** Whether a block in this neighbour cell hides the face of ours pointing at it. The dirt path is 15/16 tall: only its bottom is a full face. */
  static occludes(neighbour: number, face: string): boolean {
    return Voxels.opaque(neighbour) || (neighbour === B.PATH && face === "up");
  }

  /** Light filtered per block: leaves and water take one extra level. */
  static lightBlock(id: number): number {
    return Voxels.opaque(id) ? 15 : id === B.LEAVES || id === B.WATER ? 1 : 0;
  }

  private index(x: number, y: number, z: number): number {
    return (y * this.D + z) * this.W + x;
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.W && y < this.H && z < this.D;
  }

  get(x: number, y: number, z: number): number {
    if (y >= this.H) return B.AIR;
    if (!this.inside(x, y, z)) return B.STONE;
    return this.ids[this.index(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (this.inside(x, y, z)) this.ids[this.index(x, y, z)] = id;
  }

  /** AO shade source: blocks with a full collision box (leaves included) darken corners to 0.2. */
  occludesAo(x: number, y: number, z: number): boolean {
    const id = this.get(x, y, z);
    return Voxels.opaque(id) || id === B.LEAVES;
  }

  /** [block, sky] light levels. */
  light(x: number, y: number, z: number): [number, number] {
    if (y >= this.H) return [0, 15];
    if (!this.inside(x, y, z)) return y < 0 ? [0, 0] : [0, 15];
    const i = this.index(x, y, z);
    return [this.blockLight[i], this.skyLight[i]];
  }

  /** Grid y just above the highest block that stops rain in this column. */
  top(x: number, z: number): number {
    for (let y = this.H - 1; y >= 0; y--) {
      const id = this.get(x, y, z);
      if (id !== B.AIR && id !== B.SHORT_GRASS && id !== B.CAMPFIRE && id !== B.FIREFLY_BUSH) return y + 1;
    }
    return 0;
  }

  /** Sky light pours straight down from 15, then both kinds spread one level per step (vanilla light engine, simplified to one pass). */
  /** `blockSources`: [x, y, z, light level] of each light-emitting block. */
  computeLight(blockSources: Array<[number, number, number, number]>): void {
    const { W, H, D } = this;
    const queue: number[] = [];
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        let level = 15;
        for (let y = H - 1; y >= 0; y--) {
          const i = this.index(x, y, z);
          level = Math.max(0, level - Voxels.lightBlock(this.ids[i]));
          this.skyLight[i] = level;
          if (level > 1) queue.push(i);
        }
      }
    }
    this.spread(this.skyLight, queue);
    const blockQueue: number[] = [];
    for (const [x, y, z, level] of blockSources) {
      const i = this.index(x, y, z);
      this.blockLight[i] = Math.max(this.blockLight[i], level);
      blockQueue.push(i);
    }
    this.spread(this.blockLight, blockQueue);
  }

  private spread(levels: Uint8Array, queue: number[]): void {
    const { W, H, D } = this;
    const plane = W * D;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const l = levels[i];
      if (l <= 1) continue;
      const x = i % W;
      const z = Math.floor(i / W) % D;
      const y = Math.floor(i / plane);
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < W - 1 ? i + 1 : -1,
        z > 0 ? i - W : -1,
        z < D - 1 ? i + W : -1,
        y > 0 ? i - plane : -1,
        y < H - 1 ? i + plane : -1,
      ];
      for (const n of neighbours) {
        if (n < 0) continue;
        const id = this.ids[n];
        if (Voxels.opaque(id)) continue;
        const nl = l - Math.max(1, Voxels.lightBlock(id));
        if (nl > levels[n]) {
          levels[n] = nl;
          queue.push(n);
        }
      }
    }
  }
}

/* ---------- noise ---------- */

const SEED = 20261120;

/** Deterministic 0..1 hash of an integer cell. */
const hash = (x: number, z: number, salt: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(salt + SEED, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const valueNoise = (x: number, z: number): number => {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const tx = s(x - xi);
  const tz = s(z - zi);
  const a = hash(xi, zi, 0) + (hash(xi + 1, zi, 0) - hash(xi, zi, 0)) * tx;
  const b = hash(xi, zi + 1, 0) + (hash(xi + 1, zi + 1, 0) - hash(xi, zi + 1, 0)) * tx;
  return a + (b - a) * tz;
};

const fbm = (x: number, z: number): number => {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += valueNoise(x * 2 ** o, z * 2 ** o) * amp;
    norm += amp;
    amp /= 2;
  }
  return sum / norm;
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ---------- terrain ---------- */

export interface TerrainOptions {
  /** The island's footprint in grid cells (x1/z1 exclusive); it is left as it is. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Grid y of the island's ground surface, and of the sea surface. */
  groundY: number;
  seaY: number;
  /** Horizontal direction from the island towards the camera; the land on that side stays low so it never hides the camp. */
  flatDir: [number, number];
}

/**
 * Hills, shores and a birch forest around the island, meeting the island's ground at its edges.
 * shortcut: one fixed-size grid generated once, no chunks or caves; split into chunks if the area has to grow.
 */
export const generateTerrain = (v: Voxels, o: TerrainOptions): void => {
  const cx = (o.x0 + o.x1) / 2;
  const cz = (o.z0 + o.z1) / 2;
  const heights = new Int16Array(v.W * v.D);
  const flatness = new Float32Array(v.W * v.D);
  for (let z = 0; z < v.D; z++) {
    for (let x = 0; x < v.W; x++) {
      const px = x + 0.5;
      const pz = z + 0.5;
      const inIsland = px > o.x0 && px < o.x1 && pz > o.z0 && pz < o.z1;
      const col = z * v.W + x;
      if (inIsland) {
        // The island is terraced (its edges step down), so fill only its empty cells, up to the ground level.
        for (let y = 0; y < o.groundY; y++) {
          if (v.get(x, y, z) === B.AIR) v.set(x, y, z, y === o.groundY - 1 ? B.GRASS : y >= o.groundY - 4 ? B.DIRT : B.STONE);
        }
        heights[col] = o.groundY;
        flatness[col] = 1;
        continue;
      }
      const ex = Math.max(o.x0 - px, 0, px - o.x1);
      const ez = Math.max(o.z0 - pz, 0, pz - o.z1);
      const edge = Math.hypot(ex, ez);
      const dx = px - cx;
      const dz = pz - cz;
      const r = Math.hypot(dx, dz) || 1;
      const towardCamera = (dx * o.flatDir[0] + dz * o.flatDir[1]) / r;
      const flat = smoothstep(0.1, 0.6, towardCamera) * (1 - smoothstep(30, 55, r));
      const amp = smoothstep(2, 20, edge) * (1 - 0.9 * flat);
      const h = o.groundY + Math.round(amp * (fbm(x / 36, z / 36) - 0.42) * 26);
      heights[col] = h;
      flatness[col] = flat;
      const beach = h <= o.seaY + 1;
      for (let y = 0; y < h && y < v.H; y++) {
        const depth = h - 1 - y;
        v.set(x, y, z, beach ? (depth < 3 ? B.SAND : B.STONE) : depth === 0 ? B.GRASS : depth <= 3 ? B.DIRT : B.STONE);
      }
      for (let y = h; y < o.seaY; y++) v.set(x, y, z, B.WATER);
    }
  }

  // Birch trees (5-7 block trunk, two wide leaf layers, two narrow ones, corners randomly trimmed).
  for (let z = 3; z < v.D - 3; z++) {
    for (let x = 3; x < v.W - 3; x++) {
      const col = z * v.W + x;
      const h = heights[col];
      if (v.get(x, h - 1, z) !== B.GRASS || flatness[col] > 0.3) continue;
      const ex = Math.max(o.x0 - x, 0, x - o.x1);
      const ez = Math.max(o.z0 - z, 0, z - o.z1);
      if (Math.hypot(ex, ez) < 8 || hash(x, z, 1) > 0.03) continue;
      const height = 5 + Math.floor(hash(x, z, 2) * 3);
      if (h + height + 1 >= v.H) continue;
      const topY = h + height;
      for (let y = topY - 3; y <= topY; y++) {
        const rad = y >= topY - 1 ? 1 : 2;
        for (let lz = -rad; lz <= rad; lz++) {
          for (let lx = -rad; lx <= rad; lx++) {
            if (Math.abs(lx) === rad && Math.abs(lz) === rad && (y === topY || hash(x + lx, z + lz, y) < 0.5)) continue;
            if (v.get(x + lx, y, z + lz) === B.AIR) v.set(x + lx, y, z + lz, B.LEAVES);
          }
        }
      }
      for (let y = h; y < topY; y++) v.set(x, y, z, B.LOG);
    }
  }

  // Firefly bushes along the shores (and a few in the open), short grass on the other open grass blocks off the island.
  // The beach sits lower than the grass, so look at each neighbour's own surface block.
  const shore = (x: number, z: number) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      const n = v.get(x + dx, v.top(x + dx, z + dz) - 1, z + dz);
      return n === B.SAND || n === B.WATER;
    });
  for (let z = 0; z < v.D; z++) {
    for (let x = 0; x < v.W; x++) {
      if (x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1) continue;
      const h = heights[z * v.W + x];
      if (v.get(x, h - 1, z) !== B.GRASS || v.get(x, h, z) !== B.AIR) continue;
      if (hash(x, z, 4) < (shore(x, z) ? 0.14 : 0.004)) v.set(x, h, z, B.FIREFLY_BUSH);
      else if (hash(x, z, 3) < 0.15) v.set(x, h, z, B.SHORT_GRASS);
    }
  }
};
