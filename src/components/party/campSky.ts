import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  DoubleSide,
  Group,
  Mesh,
  NearestFilter,
  NoColorSpace,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Texture,
  TextureLoader,
  Vector3,
} from "three";
import sunUrl from "@/assets/party/environment/sun.png";
import cloudsUrl from "@/assets/party/environment/clouds.png";
import rainUrl from "@/assets/party/environment/rain.png";
import snowUrl from "@/assets/party/environment/snow.png";
import fullMoonUrl from "@/assets/party/environment/moon/full_moon.png";
import waningGibbousUrl from "@/assets/party/environment/moon/waning_gibbous.png";
import thirdQuarterUrl from "@/assets/party/environment/moon/third_quarter.png";
import waningCrescentUrl from "@/assets/party/environment/moon/waning_crescent.png";
import newMoonUrl from "@/assets/party/environment/moon/new_moon.png";
import waxingCrescentUrl from "@/assets/party/environment/moon/waxing_crescent.png";
import firstQuarterUrl from "@/assets/party/environment/moon/first_quarter.png";
import waxingGibbousUrl from "@/assets/party/environment/moon/waxing_gibbous.png";
import { BLOCK } from "./campWorld";
import { Env, RENDER_DISTANCE, Rgba, sunSide } from "./environment";
import type { Rgb } from "./lightmap";
import type { McUniforms } from "./campWorld";

/** timeline/moon.json: one phase per day, starting at full moon. */
const MOON_PHASES = [fullMoonUrl, waningGibbousUrl, thirdQuarterUrl, waningCrescentUrl, newMoonUrl, waxingCrescentUrl, firstQuarterUrl, waxingGibbousUrl];
/** visual/cloud_height minus the camp ground's height (sea level 63, ground at 64). */
const CLOUD_ABOVE_GROUND = 192.33 - 64;
/** CloudRenderer: 12x12 block cells, 4 blocks thick, drifting 0.03 blocks per tick. */
const CLOUD_CELL = 12;
const CLOUD_THICKNESS = 4;
const CLOUD_SPEED = 0.03 * 20;
const CLOUD_RADIUS = 64;
/** WeatherEffectRenderer column radius (fancy graphics). */
const WEATHER_RADIUS = 10;
/** Share of rain columns left out, and the alpha the rest are drawn at (lighter than vanilla, as asked). */
const WEATHER_SKIP = 0.5;
const WEATHER_ALPHA = 0.75;

const loader = new TextureLoader();
/** Sky textures are sampled raw: these shaders output Minecraft-space colours directly, as the game does. */
const rawTexture = async (url: string): Promise<Texture> => {
  const t = await loader.loadAsync(url);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  return t;
};

/** java.util.Random / LegacyRandomSource. */
class JavaRandom {
  private seed: bigint;
  constructor(seed: number) {
    this.seed = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n);
  }
  private next(bits: number): number {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & ((1n << 48n) - 1n);
    return Number(this.seed >> BigInt(48 - bits));
  }
  nextFloat(): number {
    return this.next(24) / (1 << 24);
  }
  nextDouble(): number {
    return (this.next(26) * 2 ** 27 + this.next(27)) / 2 ** 53;
  }
}

/** SkyRenderer.buildStars: 1500 random points on a radius-100 sphere (seed 10842), each a small randomly rotated square. */
const buildStars = (): BufferGeometry => {
  const r = new JavaRandom(10842);
  const pos: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < 1500; i++) {
    let d = r.nextFloat() * 2 - 1;
    let e = r.nextFloat() * 2 - 1;
    let f = r.nextFloat() * 2 - 1;
    const g = 0.15 + r.nextFloat() * 0.1;
    let h = d * d + e * e + f * f;
    if (!(h < 1 && h > 0.01)) continue;
    h = 1 / Math.sqrt(h);
    d *= h;
    e *= h;
    f *= h;
    const m = Math.atan2(d, f);
    const p = Math.atan2(Math.sqrt(d * d + f * f), e);
    const s = r.nextDouble() * Math.PI * 2;
    const base = pos.length / 3;
    for (let v = 0; v < 4; v++) {
      const x = ((v & 2) - 1) * g;
      const y = (((v + 1) & 2) - 1) * g;
      const aa = x * Math.cos(s) - y * Math.sin(s);
      const ab = y * Math.cos(s) + x * Math.sin(s);
      const ad = aa * Math.sin(p);
      const ae = -aa * Math.cos(p);
      pos.push(d * 100 + ae * Math.sin(m) - ab * Math.cos(m), e * 100 + ad, f * 100 + ab * Math.sin(m) + ae * Math.cos(m));
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(index);
  return geo;
};

const VERT_PLAIN = `varying vec3 vPos;
void main() { vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`;

const colorMaterial = (color: Rgba, additive = false) =>
  new ShaderMaterial({
    uniforms: { color: { value: color } },
    vertexShader: VERT_PLAIN,
    fragmentShader: "uniform vec4 color; void main() { gl_FragColor = color; }",
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    blending: additive ? AdditiveBlending : undefined,
  });

const texturedMaterial = (map: Texture) =>
  new ShaderMaterial({
    uniforms: { map: { value: map }, color: { value: [1, 1, 1, 1] } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform sampler2D map; uniform vec4 color; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv) * color; }",
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });

/** Sun, moon and stars hang off this pivot: PoseStack Y(-90) then X(angle), so they rise in the east (+x). */
const celestialPivot = (child: Object3D): { outer: Object3D; inner: Object3D } => {
  const outer = new Object3D();
  outer.rotation.y = -Math.PI / 2;
  const inner = new Object3D();
  outer.add(inner);
  inner.add(child);
  return { outer, inner };
};

/** The Minecraft sky (SkyRenderer + CloudRenderer), drawn by its own camera at the origin, in block units. */
export const createSky = async () => {
  const [sun, clouds, ...moons] = await Promise.all([sunUrl, cloudsUrl, ...MOON_PHASES].map(rawTexture));
  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 1, 0.05, 1000);

  // Sky disc at y = 16, fogged from 0 to the sky fog end (sky.fsh).
  const discGeo = new BufferGeometry();
  const disc: number[] = [0, 16, 0];
  for (let a = -180; a <= 180; a += 45) disc.push(512 * Math.cos((a * Math.PI) / 180), 16, 512 * Math.sin((a * Math.PI) / 180));
  discGeo.setAttribute("position", new BufferAttribute(new Float32Array(disc), 3));
  discGeo.setIndex([...Array(8).keys()].flatMap((i) => [0, i + 2, i + 1]));
  const discMat = new ShaderMaterial({
    uniforms: { sky: { value: [0, 0, 0] }, fog: { value: [0, 0, 0] }, fogEnd: { value: RENDER_DISTANCE * 16 } },
    vertexShader: VERT_PLAIN,
    fragmentShader: `uniform vec3 sky; uniform vec3 fog; uniform float fogEnd; varying vec3 vPos;
      void main() { gl_FragColor = vec4(mix(sky, fog, clamp(length(vPos) / fogEnd, 0.0, 1.0)), 1.0); }`,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  });
  const discMesh = new Mesh(discGeo, discMat);
  discMesh.renderOrder = 0;

  // Sunrise / sunset fan: centre at the horizon on the sun's side, ring tilted 40 up (buildSunriseFan + renderSunriseAndSunset).
  const fanGeo = new BufferGeometry();
  const fanPos: number[] = [-100, 0, 0];
  const fanCenter: number[] = [1];
  for (let i = 0; i <= 16; i++) {
    const a = (i * Math.PI * 2) / 16;
    fanPos.push(-120 * Math.cos(a), 40 * Math.cos(a), 120 * Math.sin(a));
    fanCenter.push(0);
  }
  fanGeo.setAttribute("position", new BufferAttribute(new Float32Array(fanPos), 3));
  fanGeo.setAttribute("center", new BufferAttribute(new Float32Array(fanCenter), 1));
  fanGeo.setIndex([...Array(16).keys()].flatMap((i) => [0, i + 1, i + 2]));
  const fanMat = new ShaderMaterial({
    uniforms: { color: { value: [0, 0, 0, 0] } },
    vertexShader: "attribute float center; varying float vC; void main() { vC = center; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec4 color; varying float vC; void main() { gl_FragColor = vec4(color.rgb, color.a * vC); }",
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  });
  const fan = new Mesh(fanGeo, fanMat);
  fan.renderOrder = 1;

  const starMat = colorMaterial([1, 1, 1, 0], true);
  const stars = celestialPivot(new Mesh(buildStars(), starMat));
  const quad = (size: number, map: Texture) => {
    const m = new Mesh(new PlaneGeometry(size, size), texturedMaterial(map));
    m.position.y = 100;
    m.rotation.x = Math.PI / 2;
    return m;
  };
  const sunMesh = quad(30, sun);
  const moonMesh = quad(20, moons[0]);
  const sunPivot = celestialPivot(sunMesh);
  const moonPivot = celestialPivot(moonMesh);
  for (const [o, order] of [[stars.outer, 2], [sunPivot.outer, 3], [moonPivot.outer, 3]] as const) {
    o.traverse((c) => (c.renderOrder = order));
  }

  // Fancy clouds from clouds.png: one 12x12x4 cell per white pixel, wrapping every 256 cells.
  const cloudCanvas = document.createElement("canvas");
  cloudCanvas.width = cloudCanvas.height = 256;
  const cg = cloudCanvas.getContext("2d", { willReadFrequently: true })!;
  cg.drawImage(clouds.image as CanvasImageSource, 0, 0);
  const cloudPixels = cg.getImageData(0, 0, 256, 256).data;
  const isCloud = (x: number, z: number) => cloudPixels[((((z % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)) * 4 + 3] > 10 && cloudPixels[((((z % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)) * 4] > 127;
  const cloudMat = new ShaderMaterial({
    uniforms: { color: { value: [1, 1, 1, 0.8] }, fogEnd: { value: CLOUD_RADIUS * CLOUD_CELL } },
    vertexShader: `attribute float shade; varying float vShade; varying vec3 vPos;
      void main() { vShade = shade; vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`,
    fragmentShader: `uniform vec4 color; uniform float fogEnd; varying float vShade; varying vec3 vPos;
      void main() { gl_FragColor = vec4(color.rgb * vShade, color.a * (1.0 - clamp(length(vPos) / fogEnd, 0.0, 1.0))); }`,
    transparent: true,
    side: DoubleSide,
  });
  // Clouds draw depth first, then colour, so overlapping faces do not stack their transparency (as vanilla does).
  const cloudDepthMat = cloudMat.clone();
  cloudDepthMat.colorWrite = false;
  cloudDepthMat.transparent = false;
  const cloudGroup = new Group();
  const cloudDepth = new Mesh(new BufferGeometry(), cloudDepthMat);
  const cloudColor = new Mesh(cloudDepth.geometry, cloudMat);
  cloudDepth.renderOrder = 4;
  cloudColor.renderOrder = 5;
  cloudGroup.add(cloudDepth, cloudColor);
  let cloudKey = "";
  const buildClouds = (cellX: number, cellZ: number) => {
    const pos: number[] = [];
    const shade: number[] = [];
    const index: number[] = [];
    const face = (corners: number[][], s: number) => {
      const base = pos.length / 3;
      for (const c of corners) {
        pos.push(...c);
        shade.push(s);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let dz = -CLOUD_RADIUS; dz <= CLOUD_RADIUS; dz++) {
      for (let dx = -CLOUD_RADIUS; dx <= CLOUD_RADIUS; dx++) {
        if (dx * dx + dz * dz > CLOUD_RADIUS * CLOUD_RADIUS) continue;
        const cx = cellX + dx;
        const cz = cellZ + dz;
        if (!isCloud(cx, cz)) continue;
        const [x0, x1, z0, z1] = [dx * CLOUD_CELL, (dx + 1) * CLOUD_CELL, dz * CLOUD_CELL, (dz + 1) * CLOUD_CELL];
        const [y0, y1] = [0, CLOUD_THICKNESS];
        // rendertype_clouds.vsh face colours: bottom 0.7, top 1.0, north/south 0.8, west/east 0.9.
        face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0.7);
        face([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], 1);
        if (!isCloud(cx, cz - 1)) face([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], 0.8);
        if (!isCloud(cx, cz + 1)) face([[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]], 0.8);
        if (!isCloud(cx - 1, cz)) face([[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], 0.9);
        if (!isCloud(cx + 1, cz)) face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], 0.9);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("shade", new BufferAttribute(new Float32Array(shade), 1));
    geo.setIndex(index);
    cloudDepth.geometry.dispose();
    cloudDepth.geometry = geo;
    cloudColor.geometry = geo;
  };

  scene.add(discMesh, fan, stars.outer, sunPivot.outer, moonPivot.outer, cloudGroup);

  return {
    /** Renders after the clear (fog colour) and before the world. */
    render: (renderer: { render: (s: Scene, c: Camera) => void }) => renderer.render(scene, camera),
    /** `world` is the camp camera; `fog` the frame's fog colour; `timeSeconds` drives the cloud drift. */
    update: (env: Env, fog: Rgb, world: PerspectiveCamera, day: number, timeSeconds: number) => {
      camera.quaternion.copy(world.quaternion);
      if (camera.fov !== world.fov || camera.aspect !== world.aspect) {
        camera.fov = world.fov;
        camera.aspect = world.aspect;
        camera.updateProjectionMatrix();
      }
      discMat.uniforms.sky.value = env.skyColor;
      discMat.uniforms.fog.value = fog;

      const sr = env.sunriseColor;
      fan.visible = sr[3] > 0;
      fan.scale.x = -sunSide(env); // centre at -x is the evening (west) side
      fanMat.uniforms.color.value = sr;

      const rad = (deg: number) => (deg * Math.PI) / 180;
      sunPivot.inner.rotation.x = rad(env.sunAngle);
      moonPivot.inner.rotation.x = rad(env.moonAngle);
      stars.inner.rotation.x = rad(env.starAngle);
      const a = env.celestialAlpha;
      (sunMesh.material as ShaderMaterial).uniforms.color.value = [a, a, a, a];
      const moonMat = moonMesh.material as ShaderMaterial;
      moonMat.uniforms.color.value = [a, a, a, a];
      moonMat.uniforms.map.value = moons[((day % 8) + 8) % 8];
      const sb = env.starBrightness * a;
      starMat.uniforms.color.value = [sb, sb, sb, sb];
      stars.outer.visible = sb > 0;

      // Clouds: the camera's position in blocks, with the drift added along -x.
      const camX = world.position.x / BLOCK + timeSeconds * CLOUD_SPEED;
      const camZ = world.position.z / BLOCK;
      const cellX = Math.floor(camX / CLOUD_CELL);
      const cellZ = Math.floor(camZ / CLOUD_CELL);
      const key = `${cellX},${cellZ}`;
      if (key !== cloudKey) {
        cloudKey = key;
        buildClouds(cellX, cellZ);
      }
      cloudGroup.position.set(cellX * CLOUD_CELL - camX, CLOUD_ABOVE_GROUND - world.position.y / BLOCK, cellZ * CLOUD_CELL - camZ);
      cloudMat.uniforms.color.value = env.cloudColor;
    },
    dispose: () => {
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        (m.material as ShaderMaterial | undefined)?.dispose?.();
      });
      cloudDepthMat.dispose();
      [sun, clouds, ...moons].forEach((t) => t.dispose());
    },
  };
};

export type Sky = Awaited<ReturnType<typeof createSky>>;

/* ---------- weather: rain, snow and lightning in the world scene (world units) ---------- */

export interface WeatherWorld {
  groundAt: (x: number, z: number) => number | null;
  lightAt: (pos: Vector3) => [number, number];
}

const columnHash = (x: number, z: number) => {
  const h = Math.imul(x * x * 3121 + x * 45238971, 1) ^ Math.imul(z * z * 418711 + z * 13761, 1);
  return (h >>> 0) / 4294967296;
};

/** WeatherEffectRenderer: textured columns within 10 blocks of the camera, scrolling down; plus lightning bolts. */
export const createWeather = async (u: McUniforms) => {
  const [rain, snow] = await Promise.all([rainUrl, snowUrl].map(rawTexture));
  // Nearest filtering (from rawTexture) keeps the drops pixel-sharp, as in the game.
  for (const t of [rain, snow]) t.wrapS = t.wrapT = RepeatWrapping;
  const mat = new ShaderMaterial({
    uniforms: { map: { value: rain }, mcLightmap: u.mcLightmap },
    vertexShader: `attribute vec2 mcLight; attribute float alpha; uniform sampler2D mcLightmap; varying vec2 vUv; varying vec4 vColor;
      void main() {
        vUv = uv;
        vColor = vec4(texture2D(mcLightmap, clamp(mcLight / 16.0 + 0.5 / 16.0, 0.5 / 16.0, 15.5 / 16.0)).rgb, alpha);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
      void main() { vec4 c = texture2D(map, vUv) * vColor; if (c.a < 0.004) discard; gl_FragColor = c; }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(new BufferGeometry(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  const boltMat = new ShaderMaterial({
    vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    // LightningBoltRenderer colour (0.45, 0.45, 0.5) at 0.3 alpha, drawn additively in layers.
    fragmentShader: "void main() { gl_FragColor = vec4(0.45, 0.45, 0.5, 0.3); }",
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const bolt = new Mesh(new BufferGeometry(), boltMat);
  bolt.visible = false;
  bolt.frustumCulled = false;
  const group = new Group();
  group.add(mesh, bolt);

  let nextBolt = 0;
  let boltUntil = 0;
  const buildBolt = (x: number, ground: number, z: number) => {
    const pos: number[] = [];
    const index: number[] = [];
    let px = 0;
    let pz = 0;
    const segs: number[][] = [[0, 0]];
    for (let i = 0; i < 8; i++) {
      px += (Math.random() - 0.5) * 10;
      pz += (Math.random() - 0.5) * 10;
      segs.push([px, pz]);
    }
    for (let layer = 0; layer < 4; layer++) {
      const w = (0.1 + layer * 0.1) * BLOCK;
      for (let i = 0; i < 8; i++) {
        const [ax, az] = segs[i];
        const [bx, bz] = segs[i + 1];
        const yTop = ground + (128 - i * 16) * BLOCK;
        const yBot = ground + (128 - (i + 1) * 16) * BLOCK;
        for (const [ox, oz] of [[w, 0], [0, w]]) {
          const base = pos.length / 3;
          pos.push(
            x + bx * BLOCK - ox, yBot, z + bz * BLOCK - oz,
            x + bx * BLOCK + ox, yBot, z + bz * BLOCK + oz,
            x + ax * BLOCK + ox, yTop, z + az * BLOCK + oz,
            x + ax * BLOCK - ox, yTop, z + az * BLOCK - oz,
          );
          index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(index);
    bolt.geometry.dispose();
    bolt.geometry = geo;
  };

  const p = new Vector3();
  return {
    group,
    /** Returns the lightning flash strength (0..1) for the sky. */
    update: (world: WeatherWorld, camera: Vector3, rainLevel: number, thunderLevel: number, isSnow: boolean, t: number): number => {
      mesh.visible = rainLevel > 0.01;
      if (mesh.visible) {
        mat.uniforms.map.value = isSnow ? snow : rain;
        const ticks = t * 20;
        const cx = Math.floor(camera.x / BLOCK);
        const cz = Math.floor(camera.z / BLOCK);
        const camY = camera.y / BLOCK;
        const pos: number[] = [];
        const uv: number[] = [];
        const light: number[] = [];
        const alpha: number[] = [];
        const index: number[] = [];
        for (let z = cz - WEATHER_RADIUS; z <= cz + WEATHER_RADIUS; z++) {
          for (let x = cx - WEATHER_RADIUS; x <= cx + WEATHER_RADIUS; x++) {
            const ground = world.groundAt(x * BLOCK + 8, z * BLOCK + 8);
            if (ground === null) continue;
            const g = ground / BLOCK;
            const minY = Math.max(g, Math.floor(camY) - WEATHER_RADIUS);
            const maxY = Math.max(g, Math.floor(camY) + WEATHER_RADIUS);
            if (minY >= maxY) continue;
            const dx = x + 0.5 - camera.x / BLOCK;
            const dz = z + 0.5 - camera.z / BLOCK;
            const dist = Math.hypot(dx, dz);
            if (columnHash(x + 7919, z - 104729) < WEATHER_SKIP) continue;
            const a = ((1 - (dist * dist) / (WEATHER_RADIUS * WEATHER_RADIUS)) * 0.5 + 0.5) * rainLevel * WEATHER_ALPHA;
            if (a <= 0 || dist === 0) continue;
            // The column is a 1-block-wide quad turned to face the camera.
            const hx = (-dz / dist) * 0.5;
            const hz = (dx / dist) * 0.5;
            const h = columnHash(x, z);
            // How far the texture has scrolled down (texture heights): rain 3..4 texture heights per 32 ticks, snow one per
            // 512 ticks. Kept to its fractional part (the texture repeats), so it never jumps.
            let scroll: number;
            let uOff = 0;
            if (isSnow) {
              scroll = ((ticks + h * 512) / 512) % 1;
              uOff = h + t * 0.01 * (h - 0.5);
            } else {
              scroll = (((ticks + h * 32) / 32) * (3 + h)) % 1;
            }
            p.set(x * BLOCK + 8, Math.max(g, camY) * BLOCK, z * BLOCK + 8);
            const l = world.lightAt(p);
            const lv = isSnow ? [l[0], (l[1] * 3 + 15) / 4] : l;
            const base = pos.length / 3;
            const x0 = (x + 0.5 - hx) * BLOCK;
            const x1 = (x + 0.5 + hx) * BLOCK;
            const z0 = (z + 0.5 - hz) * BLOCK;
            const z1 = (z + 0.5 + hz) * BLOCK;
            pos.push(x0, maxY * BLOCK, z0, x0, minY * BLOCK, z0, x1, minY * BLOCK, z1, x1, maxY * BLOCK, z1);
            // three.js v grows upward: the texture stands upright on the column, and a growing scroll moves it down.
            const vTop = maxY * 0.25 + scroll;
            const vBot = minY * 0.25 + scroll;
            uv.push(uOff, vTop, uOff, vBot, uOff + 1, vBot, uOff + 1, vTop);
            for (let i = 0; i < 4; i++) {
              light.push(lv[0], lv[1]);
              alpha.push(a);
            }
            index.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
        geo.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
        geo.setAttribute("mcLight", new BufferAttribute(new Float32Array(light), 2));
        geo.setAttribute("alpha", new BufferAttribute(new Float32Array(alpha), 1));
        geo.setIndex(index);
        mesh.geometry.dispose();
        mesh.geometry = geo;
      }

      // Lightning: a bolt somewhere in the distance every 5-25 s while it thunders.
      let flash = 0;
      if (thunderLevel > 0.5 && t >= nextBolt) {
        nextBolt = t + 5 + Math.random() * 20;
        boltUntil = t + 0.4;
        const ang = Math.random() * Math.PI * 2;
        const r = (25 + Math.random() * 20) * BLOCK;
        const bx = Math.cos(ang) * r;
        const bz = Math.sin(ang) * r;
        buildBolt(bx, world.groundAt(bx, bz) ?? 0, bz);
      }
      bolt.visible = t < boltUntil;
      if (bolt.visible) flash = Math.floor((boltUntil - t) * 15) % 2 === 0 ? 1 : 0.4;
      return flash;
    },
    dispose: () => {
      mesh.geometry.dispose();
      bolt.geometry.dispose();
      mat.dispose();
      boltMat.dispose();
      rain.dispose();
      snow.dispose();
    },
  };
};

export type WeatherRenderer = Awaited<ReturnType<typeof createWeather>>;
