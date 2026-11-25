import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from "three";
import campNbtUrl from "@/assets/party/data/camp.nbt?url";
import dirtUrl from "@/assets/party/block/dirt.png";
import dirtPathSideUrl from "@/assets/party/block/dirt_path_side.png";
import dirtPathTopUrl from "@/assets/party/block/dirt_path_top.png";
import grassSideUrl from "@/assets/party/block/grass_block_side.png";
import grassSideOverlayUrl from "@/assets/party/block/grass_block_side_overlay.png";
import grassTopUrl from "@/assets/party/block/grass_block_top.png";
import sandUrl from "@/assets/party/block/sand.png";
import stoneUrl from "@/assets/party/block/stone.png";
import waterUrl from "@/assets/party/block/water_still.png";
import birchLogUrl from "@/assets/party/block/birch_log.png";
import birchLogTopUrl from "@/assets/party/block/birch_log_top.png";
import birchLeavesUrl from "@/assets/party/block/birch_leaves.png";
import shortGrassUrl from "@/assets/party/block/short_grass.png";
import fireflyBushUrl from "@/assets/party/block/firefly_bush.png";
import fireflyBushGlowUrl from "@/assets/party/block/firefly_bush_emissive.png";
import cushionUrl from "@/assets/party/environment/white_cushion.png";
import fireUrl from "@/assets/party/campfire/campfire_fire.png";
import logUrl from "@/assets/party/campfire/campfire_log.png";
import litLogUrl from "@/assets/party/campfire/campfire_log_lit.png";
import campfireTemplate from "@/assets/party/data/template_campfire.json";
import { B, Voxels, generateTerrain } from "./campTerrain";
import type { Rgb } from "./lightmap";

/** World units are texture pixels: one block is 16 units, a player is 32 tall. */
export const BLOCK = 16;
/** Layer index of the campfire in camp.nbt; the top of the layer below is the ground (world y = 0). */
const GROUND_LAYER = 2;
/** Birch forest grass colour, matching the vanilla biome tint of the grass textures. */
const GRASS_TINT = 0x88bb67;
/** FoliageColor.FOLIAGE_BIRCH. */
const BIRCH_FOLIAGE = 0x80a755;
/** birch_forest water_color. */
const WATER_TINT = 0x3f76e4;
/** Terrain reaches this many blocks past the island on every side (past the render-distance fog). */
const PAD = 112;
/** World block y of grid layer 0, and the grid height in blocks. */
const Y0 = -16;
const HEIGHT = 40;

/* ---------- NBT ---------- */

type NbtValue = number | string | NbtValue[] | { [key: string]: NbtValue } | null;

const readNbt = (buf: ArrayBuffer): NbtValue => {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const utf8 = new TextDecoder();
  let p = 0;
  const str = (): string => {
    const n = view.getUint16(p);
    p += 2;
    const s = utf8.decode(bytes.subarray(p, p + n));
    p += n;
    return s;
  };
  const read = (type: number): NbtValue => {
    switch (type) {
      case 1:
        return view.getInt8(p++);
      case 2: {
        const v = view.getInt16(p);
        p += 2;
        return v;
      }
      case 3: {
        const v = view.getInt32(p);
        p += 4;
        return v;
      }
      case 5: {
        const v = view.getFloat32(p);
        p += 4;
        return v;
      }
      case 6: {
        const v = view.getFloat64(p);
        p += 8;
        return v;
      }
      case 4:
        p += 8; // long: not needed
        return null;
      case 7:
      case 11:
      case 12: {
        const n = view.getInt32(p);
        p += 4 + n * (type === 7 ? 1 : type === 11 ? 4 : 8); // arrays: not needed
        return null;
      }
      case 8:
        return str();
      case 9: {
        const itemType = view.getInt8(p++);
        const n = view.getInt32(p);
        p += 4;
        const list: NbtValue[] = [];
        for (let i = 0; i < n; i++) list.push(read(itemType));
        return list;
      }
      case 10: {
        const obj: { [key: string]: NbtValue } = {};
        for (;;) {
          const t = view.getInt8(p++);
          if (t === 0) return obj;
          obj[str()] = read(t);
        }
      }
      default:
        throw new Error(`Unsupported NBT tag type ${type}`);
    }
  };
  if (view.getInt8(p++) !== 10) throw new Error("Not an NBT compound file");
  str();
  return read(10);
};

interface Structure {
  size: [number, number, number];
  palette: Array<{ id: string; properties?: Record<string, string> }>;
  blocks: Array<{ pos: [number, number, number]; state: number }>;
  entities: Array<{ blockPos: [number, number, number]; nbt: { id: string; Rotation?: number[] } }>;
}

const loadStructure = async (): Promise<Structure> => {
  const res = await fetch(campNbtUrl);
  const raw = await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return readNbt(raw) as unknown as Structure;
};

/* ---------- textures ---------- */

const loader = new TextureLoader();

const pixelated = <T extends Texture>(tex: T): T => {
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = SRGBColorSpace;
  return tex;
};

const loadTexture = async (url: string): Promise<Texture> => pixelated(await loader.loadAsync(url));

/** Grass side = base side texture + the overlay tinted with the grass colour, like the vanilla block model. */
const compositeGrassSide = (base: Texture, overlay: Texture): CanvasTexture => {
  const layer = document.createElement("canvas");
  layer.width = layer.height = BLOCK;
  const lg = layer.getContext("2d")!;
  lg.drawImage(overlay.image as CanvasImageSource, 0, 0);
  lg.globalCompositeOperation = "multiply";
  lg.fillStyle = `#${GRASS_TINT.toString(16)}`;
  lg.fillRect(0, 0, BLOCK, BLOCK);
  lg.globalCompositeOperation = "destination-in";
  lg.drawImage(overlay.image as CanvasImageSource, 0, 0);

  const out = document.createElement("canvas");
  out.width = out.height = BLOCK;
  const og = out.getContext("2d")!;
  og.drawImage(base.image as CanvasImageSource, 0, 0);
  og.drawImage(layer, 0, 0);
  return pixelated(new CanvasTexture(out));
};

/* ---------- vanilla lighting in three.js materials ---------- */

/** Uniforms shared by every Minecraft-lit material in the scene. */
export interface McUniforms {
  /** 16x16 lightmap (x = block light, y = sky light), refreshed every frame. */
  mcLightmap: { value: DataTexture };
}

export const createMcUniforms = (): McUniforms => {
  const lightmap = new DataTexture(new Uint8Array(16 * 16 * 4), 16, 16, RGBAFormat);
  lightmap.magFilter = LinearFilter;
  lightmap.minFilter = LinearFilter;
  lightmap.needsUpdate = true;
  return { mcLightmap: { value: lightmap } };
};

/** Minecraft multiplies colours in sRGB space; three.js works in linear, so the final multiplier is raised to 2.2. */
const FRAGMENT_PATCH = (shader: { fragmentShader: string }) => {
  shader.fragmentShader = shader.fragmentShader
    .replace("void main() {", "varying vec3 vMc;\nvoid main() {")
    .replace("#include <opaque_fragment>", "outgoingLight = diffuseColor.rgb * vMc;\n#include <opaque_fragment>");
};

/** Block material: per-vertex colour (face shade x AO x biome tint) times the lightmap at the vertex's light levels. */
const blockMaterial = (u: McUniforms, map: Texture, opts: { cutout?: boolean; translucent?: boolean; doubleSided?: boolean } = {}) => {
  const m = new MeshBasicMaterial({
    map,
    alphaTest: opts.cutout ? 0.1 : 0,
    transparent: !!opts.translucent,
    depthWrite: !opts.translucent,
    side: opts.doubleSided ? DoubleSide : undefined,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.mcLightmap = u.mcLightmap;
    shader.vertexShader = shader.vertexShader
      .replace(
        "void main() {",
        "attribute vec3 mcColor;\nattribute vec2 mcLight;\nuniform sampler2D mcLightmap;\nvarying vec3 vMc;\nvoid main() {",
      )
      .replace(
        "#include <color_vertex>",
        "#include <color_vertex>\nvMc = pow(mcColor * texture2D(mcLightmap, clamp(mcLight / 16.0 + 0.5 / 16.0, 0.5 / 16.0, 15.5 / 16.0)).rgb, vec3(2.2));",
      );
    FRAGMENT_PATCH(shader);
  };
  m.customProgramCacheKey = () => "mc-block";
  return m;
};

const patched = new WeakSet<Material>();

/**
 * Entity lighting (shaders/include/light.glsl): two fixed world lights at 0.6 plus 0.4 ambient, times `light`,
 * the lightmap colour where this entity stands (Minecraft colour space).
 */
export const applyEntityLighting = (light: { value: Color }, root: { traverse: (cb: (o: unknown) => void) => void }): void => {
  root.traverse((o) => {
    const mat = (o as Mesh).material as Material | undefined;
    if (!(o as Mesh).isMesh || !mat || patched.has(mat)) return;
    patched.add(mat);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.mcEntityLight = light;
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "uniform vec3 mcEntityLight;\nvarying vec3 vMc;\nvoid main() {")
        .replace(
          "#include <color_vertex>",
          `#include <color_vertex>
          vec3 mcN = normalize(mat3(modelMatrix) * normal);
          float mcL = min(1.0, (max(0.0, dot(normalize(vec3(0.2, 1.0, -0.7)), mcN)) + max(0.0, dot(normalize(vec3(-0.2, 1.0, 0.7)), mcN))) * 0.6 + 0.4);
          vMc = pow(mcEntityLight * mcL, vec3(2.2));`,
        );
      FRAGMENT_PATCH(shader);
    };
    mat.customProgramCacheKey = () => "mc-entity";
    mat.needsUpdate = true;
  });
};

/* ---------- block models ---------- */

interface ModelFace {
  uv: [number, number, number, number];
  texture: string;
  rotation?: number;
}
interface ModelElement {
  from: number[];
  to: number[];
  rotation?: { origin: number[]; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
  shade_direction_override?: string;
  faces: Record<string, ModelFace>;
}

/** Quad corners as seen from outside the face: upper-left, lower-left, lower-right, upper-right. */
const faceCorners = (face: string, [x1, y1, z1]: number[], [x2, y2, z2]: number[]): number[][] => {
  switch (face) {
    case "north":
      return [[x2, y2, z1], [x2, y1, z1], [x1, y1, z1], [x1, y2, z1]];
    case "south":
      return [[x1, y2, z2], [x1, y1, z2], [x2, y1, z2], [x2, y2, z2]];
    case "east":
      return [[x2, y2, z2], [x2, y1, z2], [x2, y1, z1], [x2, y2, z1]];
    case "west":
      return [[x1, y2, z1], [x1, y1, z1], [x1, y1, z2], [x1, y2, z2]];
    case "up":
      return [[x1, y2, z1], [x1, y2, z2], [x2, y2, z2], [x2, y2, z1]];
    default: // down
      return [[x1, y1, z2], [x1, y1, z1], [x2, y1, z1], [x2, y1, z2]];
  }
};

const rotateAxis = (v: number[], axis: "x" | "y" | "z", angle: number, origin: number[], rescale: boolean): number[] => {
  const a = (angle * Math.PI) / 180;
  const k = rescale ? 1 / Math.cos(a) : 1;
  const [dx, dy, dz] = [v[0] - origin[0], v[1] - origin[1], v[2] - origin[2]];
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (axis === "y") return [origin[0] + (dx * c + dz * s) * k, origin[1] + dy, origin[2] + (-dx * s + dz * c) * k];
  if (axis === "x") return [origin[0] + dx, origin[1] + (dy * c - dz * s) * k, origin[2] + (dy * s + dz * c) * k];
  return [origin[0] + (dx * c - dy * s) * k, origin[1] + (dx * s + dy * c) * k, origin[2] + dz];
};

const FACES = ["north", "south", "east", "west", "up", "down"] as const;
type Face = (typeof FACES)[number];
const NORMAL: Record<Face, [number, number, number]> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};
/** Direction shade (BlockModelLighter / Direction): up 1.0, down 0.5, north/south 0.8, east/west 0.6. */
const SHADE: Record<Face, number> = { north: 0.8, south: 0.8, east: 0.6, west: 0.6, up: 1, down: 0.5 };

/** Geometry under construction for one material. */
class Bucket {
  pos: number[] = [];
  uv: number[] = [];
  color: number[] = [];
  light: number[] = [];
  index: number[] = [];
  quad(corners: number[][], uvs: number[][], colors: Rgb[], lights: number[][]) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(...corners[i]);
      this.uv.push(...uvs[i]);
      this.color.push(...colors[i]);
      this.light.push(...lights[i]);
    }
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute("mcColor", new BufferAttribute(new Float32Array(this.color), 3));
    g.setAttribute("mcLight", new BufferAttribute(new Float32Array(this.light), 2));
    g.setIndex(this.index);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const rgb = (hex: number): Rgb => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const scale = (c: Rgb, s: number): Rgb => [c[0] * s, c[1] * s, c[2] * s];
const WHITE: Rgb = [1, 1, 1];

/** Frame-strip animation (.mcmeta): `frames` frames of `frameTime` seconds each. */
interface Animated {
  tex: Texture;
  frames: number;
  frameTime: number;
}

/** campfire_log_lit has "interpolate": true: each frame is blended into the next over its 20 ticks. */
const interpolatedStrip = (strip: Texture, frames: number, frameTime: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = BLOCK;
  const g = canvas.getContext("2d")!;
  const tex = pixelated(new CanvasTexture(canvas));
  const img = strip.image as CanvasImageSource;
  const update = (t: number) => {
    const pos = t / frameTime;
    const f = Math.floor(pos) % frames;
    g.globalAlpha = 1;
    g.clearRect(0, 0, BLOCK, BLOCK);
    g.drawImage(img, 0, f * BLOCK, BLOCK, BLOCK, 0, 0, BLOCK, BLOCK);
    g.globalAlpha = pos - Math.floor(pos);
    g.drawImage(img, 0, ((f + 1) % frames) * BLOCK, BLOCK, BLOCK, 0, 0, BLOCK, BLOCK);
    tex.needsUpdate = true;
  };
  update(0);
  return { tex, update };
};

/* ---------- world ---------- */

export interface CampWorld {
  group: Group;
  /** Player positions (one per cushion), ordered left to right on screen: index 0 is the host's. */
  slots: Vector3[];
  /** Half the island's width; actors spawn just outside it. */
  halfWidth: number;
  /** Centre of the campfire's flames, or the island centre without a campfire. */
  firePos: Vector3;
  /** Block and sky light levels (0..15) of the cell containing this world position. */
  lightAt: (pos: Vector3) => [number, number];
  /** World y (units) of the top of the highest rain-blocking block in the column at x/z, or null outside the world. */
  groundAt: (x: number, z: number) => number | null;
  /** Cushion entities (CushionModel): each has its own entity light for the scene to keep up to date. */
  cushions: Array<{ position: Vector3; light: { value: Color }; mesh: Mesh }>;
  /**
   * ClientLevel.animateTick: 667 random blocks within 16 and 667 within 32 of `center` (triangular spread per axis),
   * handing each campfire, leaf block and firefly bush to `visit` with its min corner (world units), light and the block below.
   */
  animateTick: (center: Vector3, visit: (id: number, x: number, y: number, z: number, block: number, sky: number, below: number) => void) => void;
  /** Advances the texture animations. */
  update: (timeSeconds: number) => void;
  textures: Texture[];
}

/**
 * CushionModel (26.4): one 16x4x16 box, box UV from (0, 0) on a 64x64 texture, rendered as an entity.
 * Faces as [u0, v0, u1, v1] in texture pixels.
 */
const CUSHION_UV: Record<string, [number, number, number, number]> = {
  up: [16, 0, 32, 16],
  down: [32, 0, 48, 16],
  west: [0, 16, 16, 20],
  north: [16, 16, 32, 20],
  east: [32, 16, 48, 20],
  south: [48, 16, 64, 20],
};

/** `flatDir`: horizontal direction from the island towards the camera (see TerrainOptions.flatDir). */
export const loadCampWorld = async (u: McUniforms, flatDir: [number, number]): Promise<CampWorld> => {
  const structure = await loadStructure();
  const [sx, , sz] = structure.size;
  const offX = (sx * BLOCK) / 2;
  const offZ = (sz * BLOCK) / 2;
  const textures: Texture[] = [];
  const tex = async (url: string) => {
    const t = await loadTexture(url);
    textures.push(t);
    return t;
  };

  const [dirt, grassTop, grassSideBase, grassOverlay, pathTop, pathSide, sand, stone, water, log, logTop, leaves, shortGrass, campLog, litStrip, fire,
    fireflyBush, fireflyGlow, cushionTex] = await Promise.all(
    [dirtUrl, grassTopUrl, grassSideUrl, grassSideOverlayUrl, dirtPathTopUrl, dirtPathSideUrl, sandUrl, stoneUrl, waterUrl,
      birchLogUrl, birchLogTopUrl, birchLeavesUrl, shortGrassUrl, logUrl, litLogUrl, fireUrl, fireflyBushUrl, fireflyBushGlowUrl, cushionUrl].map(tex),
  );
  const grassSide = compositeGrassSide(grassSideBase, grassOverlay);
  const litLog = interpolatedStrip(litStrip, 4, 1);
  textures.push(grassSide, litLog.tex);
  // Frame times from the .mcmeta files (ticks / 20).
  const animated: Animated[] = [
    { tex: fire, frames: 8, frameTime: 0.1 },
    { tex: water, frames: 32, frameTime: 0.1 },
    { tex: fireflyGlow, frames: 10, frameTime: 0.15 },
  ];
  for (const a of animated) a.tex.repeat.set(1, 1 / a.frames);

  /* --- voxels: the island from camp.nbt plus generated terrain around it --- */
  const W = sx + 2 * PAD;
  const D = sz + 2 * PAD;
  const v = new Voxels(W, HEIGHT, D);
  const gy = (worldBlockY: number) => worldBlockY - Y0;
  let fireCell: [number, number, number] | null = null;
  const skipped = new Set<string>();
  const ids: Record<string, number> = { "minecraft:grass_block": B.GRASS, "minecraft:dirt": B.DIRT, "minecraft:dirt_path": B.PATH };
  for (const { pos, state } of structure.blocks) {
    const id = structure.palette[state].id;
    const cell: [number, number, number] = [pos[0] + PAD, gy(pos[1] - GROUND_LAYER), pos[2] + PAD];
    if (id === "minecraft:air") continue;
    if (id === "minecraft:campfire") {
      fireCell = cell;
      v.set(...cell, B.CAMPFIRE);
    } else if (ids[id] !== undefined) v.set(...cell, ids[id]);
    else skipped.add(id);
  }
  if (skipped.size) console.warn("campWorld: skipped unsupported blocks", [...skipped]);
  generateTerrain(v, { x0: PAD, x1: PAD + sx, z0: PAD, z1: PAD + sz, groundY: gy(0), seaY: gy(-3), flatDir });
  const lightSources: Array<[number, number, number, number]> = fireCell ? [[...fireCell, 15]] : [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) if (v.get(x, y, z) === B.FIREFLY_BUSH) lightSources.push([x, y, z, 2]);
    }
  }
  v.computeLight(lightSources);

  /* --- meshing --- */
  const toWorld = (gx: number, gyy: number, gz: number) => [(gx - PAD) * BLOCK - offX, (gyy + Y0) * BLOCK, (gz - PAD) * BLOCK - offZ];
  const kinds: Record<string, { map: Texture; tint?: number; cutout?: boolean; translucent?: boolean; doubleSided?: boolean }> = {
    grassTop: { map: grassTop, tint: GRASS_TINT },
    grassSide: { map: grassSide },
    dirt: { map: dirt },
    pathTop: { map: pathTop },
    pathSide: { map: pathSide },
    sand: { map: sand },
    stone: { map: stone },
    log: { map: log },
    logTop: { map: logTop },
    leaves: { map: leaves, tint: BIRCH_FOLIAGE, cutout: true },
    water: { map: water, tint: WATER_TINT, translucent: true },
    shortGrass: { map: shortGrass, tint: GRASS_TINT, cutout: true, doubleSided: true },
    fireflyBush: { map: fireflyBush, cutout: true, doubleSided: true },
    fireflyGlow: { map: fireflyGlow, cutout: true, doubleSided: true },
  };
  const textureFor = (id: number, face: Face): string => {
    switch (id) {
      case B.GRASS:
        return face === "up" ? "grassTop" : face === "down" ? "dirt" : "grassSide";
      case B.PATH:
        return face === "up" ? "pathTop" : face === "down" ? "dirt" : "pathSide";
      case B.LOG:
        return face === "up" || face === "down" ? "logTop" : "log";
      case B.SAND:
        return "sand";
      case B.STONE:
        return "stone";
      case B.LEAVES:
        return "leaves";
      case B.WATER:
        return "water";
      default:
        return "dirt";
    }
  };
  const buckets = new Map<string, Bucket>();
  const bucket = (k: string) => buckets.get(k) ?? buckets.set(k, new Bucket()).get(k)!;

  /** Smooth lighting (ModelBlockRenderer AO): per-vertex average of the four cells in front of the corner. */
  const vertexLight = (c: number[], corner: number[], face: Face): { ao: number; light: number[] } => {
    const n = NORMAL[face];
    const f = [c[0] + n[0], c[1] + n[1], c[2] + n[2]];
    const axes = [0, 1, 2].filter((i) => n[i] === 0);
    const s1 = [...f];
    const s2 = [...f];
    s1[axes[0]] += corner[axes[0]] >= 8 ? 1 : -1;
    s2[axes[1]] += corner[axes[1]] >= 8 ? 1 : -1;
    const k = [s1[0] + s2[0] - f[0], s1[1] + s2[1] - f[1], s1[2] + s2[2] - f[2]];
    const o1 = v.occludesAo(s1[0], s1[1], s1[2]);
    const o2 = v.occludesAo(s2[0], s2[1], s2[2]);
    const cells = [f, s1, s2, o1 && o2 ? s1 : k];
    const lc = v.light(f[0], f[1], f[2]);
    let block = 0;
    let sky = 0;
    let ao = 0;
    for (const cell of cells) {
      let l = v.light(cell[0], cell[1], cell[2]);
      if (l[0] === 0 && l[1] === 0) l = lc; // vanilla blend(): dark (solid) neighbours take the face's own light
      block += l[0];
      sky += l[1];
      ao += v.occludesAo(cell[0], cell[1], cell[2]) ? 0.2 : 1;
    }
    return { ao: ao / 4, light: [block / 4, sky / 4] };
  };

  const fullUv = (top: number) => [[0, top], [0, 0], [1, 0], [1, top]];
  /** block/cross: two diagonal planes, "shade": false. */
  const cross = (key: string, origin: number[], color: Rgb, light: number[]) => {
    for (const [a, b] of [[[0.8, 0.8], [15.2, 15.2]], [[0.8, 15.2], [15.2, 0.8]]]) {
      const corners = [[a[0], 16, a[1]], [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], 16, b[1]]].map((p) => [
        origin[0] + p[0], origin[1] + p[1], origin[2] + p[2],
      ]);
      bucket(key).quad(corners, fullUv(1), [color, color, color, color], [light, light, light, light]);
    }
  };
  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const id = v.get(x, y, z);
        if (id === B.AIR || id === B.CAMPFIRE) continue;
        const origin = toWorld(x, y, z);
        if (id === B.SHORT_GRASS) {
          cross("shortGrass", origin, rgb(GRASS_TINT), v.light(x, y, z));
          continue;
        }
        if (id === B.FIREFLY_BUSH) {
          // block/cross_emissive: the emissive layer is drawn at full brightness ("light_emission": 15).
          cross("fireflyBush", origin, WHITE, v.light(x, y, z));
          cross("fireflyGlow", origin, WHITE, [15, 15]);
          continue;
        }
        const top = id === B.PATH ? 15 : id === B.WATER && v.get(x, y + 1, z) !== B.WATER ? (16 * 8) / 9 : 16;
        for (const face of FACES) {
          const n = NORMAL[face];
          const nb = v.get(x + n[0], y + n[1], z + n[2]);
          let visible: boolean;
          if (id === B.WATER) visible = nb !== B.WATER && !Voxels.opaque(nb);
          else if (id === B.LEAVES) visible = !Voxels.opaque(nb);
          else if (face === "up" && top < 16) visible = true;
          else visible = !Voxels.occludes(nb, face);
          if (!visible) continue;
          const key = textureFor(id, face);
          const tint = kinds[key].tint !== undefined ? rgb(kinds[key].tint!) : WHITE;
          const local = faceCorners(face, [0, 0, 0], [16, top, 16]);
          const corners = local.map((p) => [origin[0] + p[0], origin[1] + p[1], origin[2] + p[2]]);
          const sideTop = face === "up" || face === "down" ? 1 : top / 16;
          if (id === B.WATER) {
            // The liquid renderer uses flat light, no AO.
            const l = v.light(x + n[0], y + n[1], z + n[2]);
            const c = scale(tint, SHADE[face]);
            bucket(key).quad(corners, fullUv(sideTop), [c, c, c, c], [l, l, l, l]);
            continue;
          }
          const colors: Rgb[] = [];
          const lights: number[][] = [];
          for (const p of local) {
            const { ao, light } = vertexLight([x, y, z], p, face);
            colors.push(scale(tint, SHADE[face] * ao));
            lights.push(light);
          }
          bucket(key).quad(corners, fullUv(sideTop), colors, lights);
        }
      }
    }
  }

  const group = new Group();
  for (const [key, b] of buckets) {
    const k = kinds[key];
    group.add(new Mesh(b.geometry(), blockMaterial(u, k.map, k)));
  }

  /* --- campfire (vanilla block model) --- */
  const firePos = new Vector3(0, 8, 0);
  if (fireCell) {
    const origin = toWorld(...fireCell);
    firePos.set(origin[0] + 8, origin[1] + 8, origin[2] + 8);
    const sky = v.light(...fireCell)[1];
    const maps: Record<string, { map: Texture; cutout?: boolean }> = {
      "#log": { map: campLog },
      "#lit_log": { map: litLog.tex },
      "#fire": { map: fire, cutout: true },
    };
    const fireBuckets = new Map<string, Bucket>();
    for (const el of campfireTemplate.elements as unknown as ModelElement[]) {
      for (const [face, def] of Object.entries(el.faces)) {
        const b = fireBuckets.get(def.texture) ?? fireBuckets.set(def.texture, new Bucket()).get(def.texture)!;
        const [u1, v1, u2, v2] = def.uv;
        const uvCorners = [[u1, v1], [u1, v2], [u2, v2], [u2, v1]];
        const shift = ((def.rotation ?? 0) / 90) % 4;
        const shade = SHADE[(el.shade_direction_override ?? face) as Face];
        const corners = faceCorners(face, el.from, el.to).map((corner) => {
          const p = el.rotation ? rotateAxis(corner, el.rotation.axis, el.rotation.angle, el.rotation.origin, !!el.rotation.rescale) : corner;
          return [origin[0] + p[0], origin[1] + p[1], origin[2] + p[2]];
        });
        const uvs = [0, 1, 2, 3].map((i) => {
          const [uu, vv] = uvCorners[(i + shift) % 4];
          return [uu / BLOCK, 1 - vv / BLOCK];
        });
        const c = scale(WHITE, shade);
        // The campfire sits in its own light-15 cell.
        b.quad(corners, uvs, [c, c, c, c], [[15, sky], [15, sky], [15, sky], [15, sky]]);
      }
    }
    for (const [key, b] of fireBuckets) {
      const src = maps[key];
      group.add(new Mesh(b.geometry(), blockMaterial(u, src.map, { cutout: src.cutout })));
    }
  }

  // Each cushion entity marks a player position; order them clockwise from the west around the fire.
  const angle = (p: Vector3) => Math.atan2(p.x, -p.z);
  const slots = structure.entities
    .filter((e) => e.nbt.id === "minecraft:cushion")
    .map((e) => new Vector3(e.blockPos[0] * BLOCK + BLOCK / 2 - offX, 0, e.blockPos[2] * BLOCK + BLOCK / 2 - offZ))
    .sort((a, b) => angle(a) - angle(b));

  // Cushion entities, lit like entities (two fixed lights) by the light where they sit.
  const cushions: CampWorld["cushions"] = [];
  const cushionMat = new MeshStandardMaterial({ map: cushionTex });
  const cushionBucket = new Bucket();
  for (const face of FACES) {
    const [u0, v0, u1, v1] = CUSHION_UV[face];
    const uvs = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]].map(([uu, vv]) => [uu / 64, 1 - vv / 64]);
    cushionBucket.quad(faceCorners(face, [-8, 0, -8], [8, 4, 8]), uvs, [WHITE, WHITE, WHITE, WHITE], [[0, 0], [0, 0], [0, 0], [0, 0]]);
  }
  const cushionGeo = cushionBucket.geometry();
  for (const e of structure.entities) {
    if (e.nbt.id !== "minecraft:cushion") continue;
    // shortcut: only the white texture is bundled (every cushion in camp.nbt is white); add the other dye colours when the camp uses them.
    const mesh = new Mesh(cushionGeo, cushionMat.clone());
    mesh.position.set(e.blockPos[0] * BLOCK + BLOCK / 2 - offX, 0, e.blockPos[2] * BLOCK + BLOCK / 2 - offZ);
    const yaw = e.nbt.Rotation?.[0] ?? 0;
    mesh.rotation.y = ((180 - yaw) * Math.PI) / 180;
    const light = { value: new Color(1, 1, 1) };
    applyEntityLighting(light, mesh);
    group.add(mesh);
    cushions.push({ position: mesh.position, light, mesh });
  }

  const cellOf = (x: number, y: number, z: number) => [
    Math.floor((x + offX) / BLOCK) + PAD,
    Math.floor(y / BLOCK) - Y0,
    Math.floor((z + offZ) / BLOCK) + PAD,
  ];

  return {
    group,
    slots,
    halfWidth: offX,
    firePos,
    cushions,
    animateTick: (center, visit) => {
      const [cx, cy, cz] = cellOf(center.x, center.y, center.z);
      const r = (n: number) => Math.floor(Math.random() * n);
      for (let i = 0; i < 667; i++) {
        for (const range of [16, 32]) {
          const x = cx + r(range) - r(range);
          const y = cy + r(range) - r(range);
          const z = cz + r(range) - r(range);
          const id = v.get(x, y, z);
          if (id !== B.LEAVES && id !== B.FIREFLY_BUSH && id !== B.CAMPFIRE) continue;
          const o = toWorld(x, y, z);
          const [bl, sl] = v.light(x, y, z);
          visit(id, o[0], o[1], o[2], bl, sl, v.get(x, y - 1, z));
        }
      }
    },
    lightAt: (p) => {
      const [x, y, z] = cellOf(p.x, p.y, p.z);
      const l = v.light(x, y, z);
      return [l[0], l[1]];
    },
    groundAt: (wx, wz) => {
      const [x, , z] = cellOf(wx, 0, wz);
      if (x < 0 || z < 0 || x >= W || z >= D) return null;
      return (v.top(x, z) + Y0) * BLOCK;
    },
    update: (t) => {
      for (const a of animated) a.tex.offset.y = 1 - ((Math.floor(t / a.frameTime) % a.frames) + 1) / a.frames;
      litLog.update(t);
    },
    textures,
  };
};
