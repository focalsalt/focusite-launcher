import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Mesh,
  NearestFilter,
  NoColorSpace,
  PerspectiveCamera,
  ShaderMaterial,
  TextureLoader,
  Vector3,
} from "three";
import lavaUrl from "@/assets/party/particle/lava.png";
import fireflyUrl from "@/assets/party/particle/firefly.png";
import type { McUniforms } from "./campWorld";
import { BLOCK } from "./campWorld";
import { B, Voxels } from "./campTerrain";
import type { Rgb } from "./lightmap";

const smokeUrls = Object.values(import.meta.glob("../../assets/party/particle/big_smoke_*.png", { eager: true, import: "default" })) as string[];
const leafUrls = Object.values(import.meta.glob("../../assets/party/particle/leaf_*.png", { eager: true, import: "default" })) as string[];
const genericByName = import.meta.glob("../../assets/party/particle/generic_*.png", { eager: true, import: "default" }) as Record<string, string>;
/** generic_0..7 in order; SmokeParticle plays them from 7 down to 0 over its life. */
const genericUrls = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => genericByName[`../../assets/party/particle/generic_${i}.png`]);

/** FoliageColor.FOLIAGE_BIRCH, for the tinted falling leaves. */
const BIRCH_FOLIAGE: Rgb = [0x80 / 255, 0xa7 / 255, 0x55 / 255];

type Kind = "smoke" | "lava" | "leaf" | "firefly" | "trail";

/** One particle; distances in blocks, velocities in blocks per tick, ages in ticks (vanilla Particle fields). */
interface Particle {
  kind: Kind;
  x: number;
  y: number;
  z: number;
  xd: number;
  yd: number;
  zd: number;
  age: number;
  lifetime: number;
  /** Half the quad's width, in blocks. */
  size: number;
  sprite: number;
  alpha: number;
  roll: number;
  rollSpeed: number;
  color: Rgb;
  /** FallingLeavesParticle state. */
  rotSpeed: number;
  spinAcceleration: number;
  swirlPeriod: number;
  gravity: number;
  /** Position, roll and alpha at the previous tick: frames draw between the two, like vanilla's partialTick. */
  xo: number;
  yo: number;
  zo: number;
  oRoll: number;
  oAlpha: number;
}

export interface ParticleWorld {
  firePos: Vector3;
  animateTick: (center: Vector3, visit: (id: number, x: number, y: number, z: number, block: number, sky: number, below: number) => void) => void;
  lightAt: (pos: Vector3) => [number, number];
  groundAt: (x: number, z: number) => number | null;
}

/** TintedParticleLeavesBlock chance for birch leaves (Blocks.BIRCH_LEAVES). */
const BIRCH_LEAF_CHANCE = 0.01;
/** FallingLeavesParticle$TintedLeavesProvider: fall acceleration 0.07, wind 10, swirl on, no flow-away, size 2, initial fall 0.021. */
const LEAF_FALL = 0.07;
const LEAF_WIND = 10;
const LEAF_SIZE = 2;
const LEAF_Y_SPEED = 0.021;

const rnd = Math.random;
const sign = () => (rnd() < 0.5 ? -1 : 1);

/** Vanilla Particle constructor jitter for a given velocity. */
const jitter = (xa: number, ya: number, za: number): [number, number, number] => {
  let xd = xa + (rnd() * 2 - 1) * 0.4;
  let yd = ya + (rnd() * 2 - 1) * 0.4;
  let zd = za + (rnd() * 2 - 1) * 0.4;
  const d = (rnd() + rnd() + 1) * 0.15;
  const e = Math.hypot(xd, yd, zd) || 1;
  xd = (xd / e) * d * 0.4;
  yd = (yd / e) * d * 0.4 + 0.1;
  zd = (zd / e) * d * 0.4;
  return [xd, yd, zd];
};

const baseSize = () => 0.1 * (rnd() * 0.5 + 0.5) * 2;

/** Campfire smoke and embers, falling birch leaves and fireflies, drawn as camera-facing quads lit by the lightmap. */
export const createParticles = async (u: McUniforms) => {
  // Pack every sprite into one 16px-cell atlas.
  const urls = [...smokeUrls, ...leafUrls, lavaUrl, fireflyUrl, ...genericUrls];
  const images = await Promise.all(urls.map((url) => new TextureLoader().loadAsync(url).then((t) => t.image as HTMLImageElement)));
  const cols = 8;
  const rows = Math.ceil(images.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cols * 16;
  canvas.height = rows * 16;
  const g = canvas.getContext("2d")!;
  const rects = images.map((img, i) => {
    const x = (i % cols) * 16;
    const y = Math.floor(i / cols) * 16;
    g.drawImage(img, x, y);
    return [x / canvas.width, 1 - (y + img.height) / canvas.height, (x + img.width) / canvas.width, 1 - y / canvas.height];
  });
  const atlas = new CanvasTexture(canvas);
  atlas.magFilter = NearestFilter;
  atlas.minFilter = NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = NoColorSpace;
  const SMOKE0 = 0;
  const LEAF0 = smokeUrls.length;
  const LAVA = LEAF0 + leafUrls.length;
  const FIREFLY = LAVA + 1;
  const GENERIC0 = FIREFLY + 1;

  const material = new ShaderMaterial({
    uniforms: { atlas: { value: atlas }, mcLightmap: u.mcLightmap, fogColor: { value: [1, 1, 1] }, fogNear: { value: 0 }, fogFar: { value: 1 } },
    vertexShader: `attribute vec2 mcLight; attribute vec4 tint; uniform sampler2D mcLightmap; varying vec2 vUv; varying vec4 vColor; varying float vDepth;
      void main() {
        vUv = uv;
        vColor = tint * vec4(texture2D(mcLightmap, clamp(mcLight / 16.0 + 0.5 / 16.0, 0.5 / 16.0, 15.5 / 16.0)).rgb, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D atlas; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; varying vec2 vUv; varying vec4 vColor; varying float vDepth;
      void main() {
        vec4 c = texture2D(atlas, vUv) * vColor;
        if (c.a < 0.1) discard;
        gl_FragColor = vec4(mix(c.rgb, fogColor, clamp((vDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0)), c.a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;

  const particles: Particle[] = [];
  const add = (p: Partial<Particle> & Pick<Particle, "kind" | "x" | "y" | "z" | "lifetime" | "sprite">) =>
    particles.push({
      xo: p.x,
      yo: p.y,
      zo: p.z,
      oRoll: p.roll ?? 0,
      oAlpha: p.alpha ?? 1, xd: 0, yd: 0, zd: 0, age: 0, size: baseSize(), alpha: 1, roll: 0, rollSpeed: 0, color: [1, 1, 1], rotSpeed: 0, spinAcceleration: 0, swirlPeriod: 0, gravity: 0, ...p });

  /** LeavesBlock.makeFallingLeavesParticles + FallingLeavesParticle constructor, for a leaf block with its min corner at x/y/z (blocks). */
  const spawnLeaf = (x: number, y: number, z: number) => {
    const f = rnd();
    add({
      kind: "leaf",
      x: x + rnd(),
      y: y - 0.05,
      z: z + rnd(),
      yd: -LEAF_Y_SPEED,
      size: LEAF_SIZE * (rnd() < 0.5 ? 0.05 : 0.075),
      lifetime: 300,
      sprite: LEAF0 + Math.floor(rnd() * leafUrls.length),
      color: BIRCH_FOLIAGE,
      rotSpeed: ((rnd() < 0.5 ? -30 : 30) * Math.PI) / 180,
      spinAcceleration: ((rnd() < 0.5 ? -5 : 5) * Math.PI) / 180,
      swirlPeriod: ((1000 + f * 3000) * Math.PI) / 180,
      gravity: LEAF_FALL * 1.2 * 0.0025,
    });
  };

  /** One client tick (1/20 s): spawning (block animateTick / particleTick) and particle physics. */
  const tick = (w: ParticleWorld, skyDarken: number, center: Vector3) => {
    const fx = w.firePos.x / BLOCK - 0.5;
    const fy = w.firePos.y / BLOCK - 0.5;
    const fz = w.firePos.z / BLOCK - 0.5;
    // CampfireBlockEntity.particleTick + CampfireBlock.makeParticles: cosy smoke rising at 0.07 blocks/tick.
    if (rnd() < 0.11) {
      const n = 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        add({
          kind: "smoke",
          x: fx + 0.5 + (rnd() / 3) * sign(),
          y: fy + rnd() + rnd(),
          z: fz + 0.5 + (rnd() / 3) * sign(),
          yd: 0.07 + rnd() / 500,
          size: baseSize() * 3,
          lifetime: 280 + Math.floor(rnd() * 50),
          sprite: SMOKE0 + Math.floor(rnd() * smokeUrls.length),
          alpha: 0.95,
        });
      }
    }
    // Random block ticks around the player (ClientLevel.animateTick): the campfire pops embers, leaves drop leaves,
    // firefly bushes release fireflies. Only blocks the sampler happens to hit tick, as in the game.
    w.animateTick(center, (id, x, y, z, block, sky, below) => {
      const bx = x / BLOCK;
      const by = y / BLOCK;
      const bz = z / BLOCK;
      if (id === B.CAMPFIRE) {
        // CampfireBlock.animateTick: nextInt(5) == 0 gives one lava ember with velocity (nextFloat / 2, 5e-5, nextFloat / 2).
        if (Math.floor(rnd() * 5) !== 0) return;
        const [xd, , zd] = jitter(rnd() / 2, 5e-5, rnd() / 2);
        add({
          kind: "lava",
          x: bx + 0.5,
          y: by + 0.5,
          z: bz + 0.5,
          xd: xd * 0.8,
          yd: rnd() * 0.4 + 0.05,
          zd: zd * 0.8,
          size: baseSize() * (rnd() * 2 + 0.2),
          lifetime: Math.floor(16 / (rnd() * 0.8 + 0.2)),
          sprite: LAVA,
        });
      } else if (id === B.LEAVES) {
        // The block below must not have a full top face (leaves and solid blocks stop it).
        if (rnd() < BIRCH_LEAF_CHANCE && !Voxels.opaque(below) && below !== B.LEAVES) spawnLeaf(bx, by, bz);
      } else if (id === B.FIREFLY_BUSH) {
        // FireflyBushBlock.animateTick: getMaxLocalRawBrightness <= 13 and nextDouble <= 0.7.
        if (Math.max(block, sky - skyDarken) <= 13 && rnd() <= 0.7) {
          add({
            kind: "firefly",
            x: bx + rnd() * 10 - 5,
            y: by + rnd() * 5,
            z: bz + rnd() * 10 - 5,
            size: baseSize() * 0.75 * 1.5,
            lifetime: 200 + Math.floor(rnd() * 100),
            sprite: FIREFLY,
            alpha: 0,
          });
        }
      }
    });

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.xo = p.x;
      p.yo = p.y;
      p.zo = p.z;
      p.oRoll = p.roll;
      p.oAlpha = p.alpha;
      if (++p.age >= p.lifetime || (p.kind === "smoke" && p.alpha <= 0)) {
        particles.splice(i, 1);
        continue;
      }
      switch (p.kind) {
        case "smoke":
          // CampfireSmokeParticle.tick
          p.xd += (rnd() / 5000) * sign();
          p.zd += (rnd() / 5000) * sign();
          p.yd -= 3e-6;
          if (p.age >= p.lifetime - 60 && p.alpha > 0.01) p.alpha -= 0.015;
          break;
        case "lava":
          // LavaParticle.tick: a puff of SmokeParticle while young (chance 1 - age / lifetime), then gravity 0.75, friction 0.999.
          if (rnd() > p.age / p.lifetime) {
            // SmokeParticle -> BaseAshSmokeParticle: 0.1 x jitter plus the ember's speed, one gray 0..0.3, size 0.75, life 8.
            const [jx, jy, jz] = jitter(p.xd, p.yd, p.zd);
            const gray = rnd() * 0.3;
            add({
              kind: "trail",
              x: p.x,
              y: p.y,
              z: p.z,
              xd: jx * 0.1 + p.xd,
              yd: jy * 0.1 + p.yd,
              zd: jz * 0.1 + p.zd,
              size: baseSize() * 0.75,
              lifetime: Math.max(1, Math.floor(8 / (rnd() * 0.8 + 0.2))),
              sprite: GENERIC0 + 7,
              color: [gray, gray, gray],
            });
          }
          p.yd -= 0.04 * 0.75;
          p.xd *= 0.999;
          p.yd *= 0.999;
          p.zd *= 0.999;
          break;
        case "trail":
          // gravity -0.1, friction 0.96. Vanilla steps through generic_7..0 once per tick, which pops between sizes (29 down to
          // 1 visible pixels); the sprite stays generic_7 and the quad shrinks smoothly when drawn instead.
          p.yd += 0.04 * 0.1;
          p.xd *= 0.96;
          p.yd *= 0.96;
          p.zd *= 0.96;
          break;
        case "leaf": {
          // FallingLeavesParticle.tick: a swirl that widens over its life, gravity, and a spin that speeds up.
          const f = Math.min(p.age / 300, 1);
          const da = f * Math.cos(f * p.swirlPeriod) * LEAF_WIND;
          const db = f * Math.sin(f * p.swirlPeriod) * LEAF_WIND;
          p.xd += da * 0.0025;
          p.zd += db * 0.0025;
          p.yd -= p.gravity;
          p.rotSpeed += p.spinAcceleration / 20;
          p.roll += p.rotSpeed / 20;
          break;
        }
        case "firefly": {
          // FireflyParticle: wanders with small random kicks (friction 0.96) and glows in and out.
          p.xd = (p.xd + (rnd() * 0.1 - 0.05) * 0.1) * 0.96;
          p.yd = (p.yd + (rnd() * 0.1 - 0.05) * 0.1) * 0.96;
          p.zd = (p.zd + (rnd() * 0.1 - 0.05) * 0.1) * 0.96;
          const t = p.age / p.lifetime;
          p.alpha = t < 0.3 ? t / 0.3 : t > 0.95 ? (1 - t) / 0.05 : 1;
          break;
        }
      }
      p.x += p.xd;
      p.y += p.yd;
      p.z += p.zd;
      if (p.kind === "leaf" || p.kind === "lava") {
        const ground = w.groundAt(p.x * BLOCK, p.z * BLOCK);
        if (ground !== null && p.y * BLOCK <= ground) {
          // FallingLeavesParticle removes itself once on the ground; embers come to rest there.
          if (p.kind === "leaf") {
            particles.splice(i, 1);
            continue;
          }
          p.y = ground / BLOCK + 0.01;
          p.xd = p.yd = p.zd = 0;
        }
      }
    }
  };

  const right = new Vector3();
  const up = new Vector3();
  const tmp = new Vector3();
  const forward = new Vector3();
  let acc = 0;

  return {
    mesh,
    /** `skyDarken`: Level.skyDarken, for the firefly bushes' darkness check. */
    /** `center`: where random block ticks are sampled around (the local player). */
    update: (w: ParticleWorld, camera: PerspectiveCamera, center: Vector3, dt: number, skyDarken: number, fog: { color: Rgb; near: number; far: number }) => {
      acc += dt;
      let ticks = 0;
      while (acc >= 0.05 && ticks < 10) {
        acc -= 0.05;
        ticks++;
        tick(w, skyDarken, center);
      }
      material.uniforms.fogColor.value = fog.color;
      material.uniforms.fogNear.value = fog.near;
      material.uniforms.fogFar.value = fog.far;

      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      camera.getWorldDirection(forward);
      // Back to front, for the translucent smoke.
      particles.sort((a, b) => forward.dot(tmp.set(b.x - a.x, b.y - a.y, b.z - a.z)));
      const n = particles.length;
      const pos = new Float32Array(n * 12);
      const uv = new Float32Array(n * 8);
      const light = new Float32Array(n * 8);
      const tint = new Float32Array(n * 16);
      const index: number[] = [];
      // How far this frame is between the last tick and the next (vanilla partialTick).
      const partial = Math.min(1, acc / 0.05);
      const lerp = (a: number, b: number) => a + (b - a) * partial;
      particles.forEach((p, i) => {
        let size = p.size;
        const age = p.age - 1 + partial;
        if (p.kind === "lava") size *= 1 - (age / p.lifetime) ** 2;
        if (p.kind === "trail") {
          // Ramp in, then shrink linearly to about the size of vanilla's last frame (about 0.2 of the first).
          const life = Math.min(1, Math.max(0, age / p.lifetime));
          size *= Math.min(1, life * 32) * (1 - 0.8 * life);
        }
        const s = size * BLOCK;
        const roll = lerp(p.oRoll, p.roll);
        const c = Math.cos(roll);
        const sn = Math.sin(roll);
        const cx = lerp(p.xo, p.x) * BLOCK;
        const cy = lerp(p.yo, p.y) * BLOCK;
        const cz = lerp(p.zo, p.z) * BLOCK;
        const corners = [[-1, 1], [-1, -1], [1, -1], [1, 1]];
        corners.forEach(([a, b], k) => {
          const ra = (a * c - b * sn) * s;
          const rb = (a * sn + b * c) * s;
          pos.set([cx + right.x * ra + up.x * rb, cy + right.y * ra + up.y * rb, cz + right.z * ra + up.z * rb], (i * 4 + k) * 3);
        });
        const r = rects[p.sprite];
        uv.set([r[0], r[3], r[0], r[1], r[2], r[1], r[2], r[3]], i * 8);
        // Embers and fireflies are full bright; the rest take the light where they are.
        const l = p.kind === "lava" || p.kind === "firefly" ? [15, 15] : w.lightAt(tmp.set(cx, cy, cz));
        for (let k = 0; k < 4; k++) {
          light.set(l, (i * 4 + k) * 2);
          tint.set([p.color[0], p.color[1], p.color[2], lerp(p.oAlpha, p.alpha)], (i * 4 + k) * 4);
        }
        const base = i * 4;
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(pos, 3));
      geo.setAttribute("uv", new BufferAttribute(uv, 2));
      geo.setAttribute("mcLight", new BufferAttribute(light, 2));
      geo.setAttribute("tint", new BufferAttribute(tint, 4));
      geo.setIndex(index);
      mesh.geometry.dispose();
      mesh.geometry = geo;
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
      atlas.dispose();
    },
  };
};

export type Particles = Awaited<ReturnType<typeof createParticles>>;
