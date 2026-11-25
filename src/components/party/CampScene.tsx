import React, { useEffect, useRef } from "react";
import {
  BackSide,
  BoxGeometry,
  Color,
  Fog,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { NameTagObject, PlayerObject } from "skinview3d";
import minecraftFontUrl from "@/assets/party/fonts/mojangles.ttf?url";
import unifontUrl from "@/assets/party/fonts/unifont_t.otf?url";
import shadowUrl from "@/assets/party/environment/shadow.png";
import { toHttps } from "@/lib/assetUrl";
import { applyEntityLighting, BLOCK, CampWorld, createMcUniforms, loadCampWorld } from "./campWorld";
import { createSky, createWeather, Sky, WeatherRenderer } from "./campSky";
import { createParticles, Particles } from "./campParticles";
import type { McTime } from "./dayCycle";
import { environmentAt, fogColorFor, RENDER_DISTANCE } from "./environment";
import { fillLightmap, lightmapColor, tickFlicker } from "./lightmap";
import type { Weather } from "./weather";

export const MAX_PARTY = 8;

// Mojangles, registered once for the name tags.
const minecraftFont = new FontFace("Minecraft", `url(${minecraftFontUrl}) format("truetype")`);
document.fonts.add(minecraftFont);
void minecraftFont.load();

// Mojangles has no CJK glyphs; the game falls back to Unifont, drawn at half scale. Unifont is 16 px tall per em, drawn
// at half scale (8 game px), while Mojangles has 12 game px per em, so its em (8 game px) is two thirds of the Mojangles em (12 game px).
const unifont = new FontFace("McUnifont", `url(${unifontUrl}) format("opentype")`, {
  unicodeRange: "U+2E80-D7FF, U+F900-FFEF",
  sizeAdjust: "67%",
} as FontFaceDescriptors);
document.fonts.add(unifont);
void unifont.load().catch(() => undefined);

/** font-family for text drawn in the game's style. */
export const MC_FONT_FAMILY = "Minecraft, McUnifont, sans-serif";

export interface CampMember {
  id: string;
  name: string;
  skinUrl?: string;
  /** Cape texture; players without one must not show a cape. */
  capeUrl?: string;
  slim?: boolean;
  isSelf?: boolean;
  /** The host's name tag is yellow. */
  host?: boolean;
  /** A smaller second line under the name (the way a scoreboard shows below the name). */
  subtitle?: string;
}

interface CampSceneProps {
  members: CampMember[];
  time: McTime;
  weather: Weather;
  /** How overcast it is, 0..1; dims and greys the sky a little. */
  cloud?: number;
  /** Whether the first batch of members walks in from below the screen. Later joiners always walk in. */
  playIntro: boolean;
  /** Called once the camp world has loaded (or failed to), so a loading screen can go away. */
  onReady?: () => void;
  /** Loading progress, 0..1. */
  onProgress?: (fraction: number) => void;
  /** The member to outline like the Glowing effect (the pointer is on them). */
  glowId?: string | null;
  /** Pointer over a member (null: none) with the pointer's page position. */
  onHoverMember?: (id: string | null, x: number, y: number) => void;
  onPickMember?: (id: string) => void;
  className?: string;
}

const WALK_SPEED = 62;
const ENTRY_STAGGER_S = 0.35;
/** Vanilla default field of view. */
const FOV = 70;
/**
 * A low camera at the island's open south-west side looking north-east across the fire, so the cushion arc reads as
 * a row from left (north-west, the host) to right (south-east) and the land beyond fills the upper half.
 */
const CAMERA_DIR = new Vector3(-0.69, 0.23, 0.69).normalize();
/** Screen-right on the ground plane. */
const RIGHT = new Vector3(CAMERA_DIR.z, 0, -CAMERA_DIR.x).normalize();
/** Walk paths keep this far from the fire. */
const FIRE_CLEARANCE = 2 * BLOCK;

/** Waypoints from `from` to `to`; when the straight line is too close to the fire it detours past the fire on the seat's side. */
const walkPath = (from: Vector3, to: Vector3): Vector3[] => {
  const d = to.clone().sub(from);
  const t = Math.max(0, Math.min(1, -from.dot(d) / d.lengthSq()));
  const closest = from.clone().addScaledVector(d, t);
  if (closest.length() >= FIRE_CLEARANCE) return [to];
  const n = new Vector3(-d.z, 0, d.x).normalize();
  if (n.dot(RIGHT) * (Math.sign(to.dot(RIGHT)) || 1) < 0) n.negate();
  return [closest.add(n.multiplyScalar(FIRE_CLEARANCE)), to];
};
/** Visible half-width at the focus point: wide enough for the whole cushion row. */
const VIEW_HALF_WIDTH = 9 * BLOCK;
/** World units above the ground that a standing player's name tag reaches (body 32, tag centre at 38, tag 4 tall, a little spare). */
const SEAT_TOP = 48;
/** Half the width of the widest name tag (a 16 character name is about 36 units wide), sideways from the seat. */
const NAME_TAG_HALF_WIDTH = 20;
/** How much of the half view (NDC) seats may use; the rest is margin. */
const FIT_LIMIT = 0.97;
/** The bottom edge of the page always shows the ground this far in front of the fire (toward the camera). */
const BOTTOM_EDGE_POINT = new Vector3(CAMERA_DIR.x, 0, CAMERA_DIR.z).normalize().multiplyScalar(3.5 * BLOCK);
/**
 * Seconds the sit-down itself takes; the seated player's centre height: the leg pivot (4 below) sits half an outer leg
 * (2.25) above the 4-unit cushion, so the thighs rest on it without cutting in.
 */
const SIT_SECONDS = 1.2;
const SEATED_Y = 10.25;
/**
 * skinview3d legs: the pivot is 4 below the model's origin; the outer skin layer reaches 12.25 below it and is 4.5 thick,
 * so ground clearance is checked against that.
 */
const LEG_PIVOT_DOWN = 4;
const LEG_LENGTH = 12;
const LEG_OUTER_LENGTH = 12.25;
const LEG_OUTER_HALF = 2.25;
/**
 * Players stop this far in front of their cushion (toward the fire): exactly where the feet end up once seated, so the
 * feet stay planted while the hips go back over the cushion.
 */
const SEAT_APPROACH = LEG_LENGTH * Math.sin(1.4137167);
/** How much the cushion (4 units tall) squashes as the hips land on it. */
const CUSHION_GIVE = 0.15;
/** Vanilla riding legs (HumanoidModel when riding): forward 81 degrees. */
const SIT_LEG_X = -1.4137167;
/** Knees apart: the vanilla riding splay (HumanoidModel yRot 0.314, 18 degrees each leg). */
const SIT_LEG_SPLAY = Math.PI / 10;
/** Vanilla riding leg roll (HumanoidModel zRot 0.0785): the feet tip a little outward. */
const SIT_LEG_ROLL = 0.07853982;
/** The leftmost and rightmost players turn this much toward the screen (0 = face the fire exactly). */
const EDGE_TURN = 0.4;
/** Fog: vanilla render-distance fog ends at the render distance and starts clamp(end / 10, 4, 64) blocks before it. */
const FOG_END = RENDER_DISTANCE * 16;
const FOG_START = FOG_END - Math.min(64, Math.max(4, FOG_END / 10));
/** Weather levels move 0.01 per tick, as ClientLevel's rain and thunder levels do. */
const WEATHER_RATE = 0.01 * 20;
/**
 * LivingEntity.tickHeadTurn: the head may turn 50 degrees from the body (getMaxHeadRotationRelativeToBody); past that the
 * body is dragged along. Pitch is limited to straight up / down like the player's. A cushion does not clamp its rider.
 */
const MAX_HEAD_FROM_BODY = (50 * Math.PI) / 180;
const HEAD_PITCH_LIMIT = Math.PI / 2;
/** tickHeadTurn also turns the body 30% of the way toward the walking direction each tick. */
const BODY_TURN = 0.3;
/** Ground movement: vanilla ground friction (0.6 x 0.91) settles speed within a few ticks. */
const MOVE_KEEP = 0.546;
/** WalkAnimationState: target min(blocks moved per tick x 4, 1), eased 0.4 per tick. */
const WALK_ANIM_EASE = 0.4;
/** Spring frequencies (rad/s): arms lead and the torso follows; the head is quicker; the cape swings (under-damped). */
const ARM_SPRING = 3.5;
const LEAN_SPRING = 2.5;
const HEAD_SPRING = 9;
const CAPE_SPRING = 7;
const CAPE_DAMPING = 0.45;
/** HumanoidModel attack swing lasts 6 ticks; a poke at the fire is 1-3 swings one second apart, every 50-70 seconds. */
const SWING_SECONDS = 0.3;
const SWING_INTERVAL = 1;
const SWING_MIN_S = 50;
const SWING_MAX_S = 70;
/** Seconds a player keeps looking at each kind of thing before turning to one of the other two. */
const LOOK_SECONDS: Record<"fire" | "camera" | "neighbour", [number, number]> = {
  camera: [7, 12],
  fire: [20, 25],
  neighbour: [10, 15],
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Seated idle poses a player drifts between (arm [x, z] rotations, forward lean of the whole model). Right-arm +z and
 * left-arm -z swing a hand toward the body.
 */
const IDLE_POSES = [
  { armL: [-0.63, 0], armR: [-0.63, 0], lean: 0.05 }, // hands on the lap
  { armL: [-1.3, -0.3], armR: [-1.3, 0.3], lean: 0.14 }, // warming the hands at the fire
  { armL: [0.45, 0.3], armR: [0.45, -0.3], lean: -0.12 }, // leaning back on the hands
];
const WARM_POSE = 1;
const LEAN_BACK_POSE = 2;
/** Seconds between idle pose changes. */
const POSE_MIN_S = 20;
const POSE_MAX_S = 40;
/** Breathing: rise of the upper body in units, and one breath every this many seconds. */
const BREATH_RISE = 0.35;
const BREATH_SECONDS = 3.2;
/** Forward lean at full walking speed. */
const WALK_LEAN = 0.06;

/** One step of a damped spring toward `target` (critically damped by default); returns the new [value, velocity]. */
const spring = (x: number, v: number, target: number, omega: number, dt: number, zeta = 1): [number, number] => {
  const nv = v + (omega * omega * (target - x) - 2 * zeta * omega * v) * dt;
  return [x + nv * dt, nv];
};
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const disposeTree = (root: Object3D): void => {
  root.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
};

interface Actor {
  id: string;
  slot: number;
  wrap: Group;
  player: PlayerObject;
  skinUrl?: string;
  capeUrl?: string;
  slim: boolean;
  walking: boolean;
  /** Ground speed (units per second), eased like vanilla movement. */
  velocity: number;
  /** WalkAnimationState: limb swing position and amount. */
  walk: { pos: number; amount: number };
  /** 0 = standing, 1 = fully seated; rises once the player has stopped and turned to the fire. */
  sit: number;
  sitting: boolean;
  path: Vector3[];
  delay: number;
  /** Where the sit-down starts (in front of the bench); the seat itself is the slot. */
  seatFrom: Vector3;
  /** Lightmap colour where this player is, for its entity lighting. */
  light: { value: Color };
  shadow: Mesh;
  /** Name tag (and optional subtitle tag) and the text they were drawn for. */
  tags: NameTagObject[];
  label: string;
  /** Outline shells while the pointer glows this player. */
  glow: Mesh[];
  /** Per-player phase so the idle arm bob is not in step across the party. */
  ageOffset: number;
  /** Look direction relative to the seat (yaw, pitch) and whether it has caught up with its target. */
  head: { yaw: number; pitch: number; vYaw: number; vPitch: number; target: Vector3 | null; lookAt: "fire" | "camera" | "neighbour"; until: number; settled: boolean };
  /** Body yaw relative to the seat, dragged by the head past 50 degrees. */
  bodyYaw: number;
  swing: { left: number; count: number; next: number };
  /** The idle pose being drifted toward and the current blended arm angles and lean. */
  idle: { pose: number; next: number; armL: number[]; armR: number[]; lean: number; vArmL: number[]; vArmR: number[]; vLean: number };
  cape: { angle: number; v: number };
  /** The cushion under this player's seat, squashed a little on landing. */
  cushion: Mesh | null;
  /** Rest heights of the parts that rise when breathing. */
  partY: { head: number; body: number; leftArm: number; rightArm: number };
}

const createCamp = (canvas: HTMLCanvasElement, onReady: () => void, onProgress: (fraction: number) => void) => {
  // No MSAA: vanilla renders without it.
  const renderer = new WebGLRenderer({ canvas, antialias: false });
  renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  scene.fog = new Fog(0xffffff, FOG_START * BLOCK, FOG_END * BLOCK);

  const camera = new PerspectiveCamera(FOV, 1, 1, 3000);
  camera.position.copy(CAMERA_DIR).multiplyScalar(500);
  camera.lookAt(0, 0, 0);

  const uniforms = createMcUniforms();
  const loader = new TextureLoader();
  loader.setCrossOrigin("anonymous");
  // Vanilla entity shadow (textures/misc/shadow.png), 0.5 blocks in radius for players.
  const shadowTex = new TextureLoader().load(shadowUrl);
  shadowTex.colorSpace = SRGBColorSpace;
  const shadowGeo = new PlaneGeometry(BLOCK, BLOCK).rotateX(-Math.PI / 2);
  const textures: Texture[] = [];
  const actors = new Map<string, Actor>();
  let introPending = true;
  let world: CampWorld | null = null;
  let sky: Sky | null = null;
  let weatherFx: WeatherRenderer | null = null;
  let particles: Particles | null = null;
  let disposed = false;
  let ready = false;
  let pending: { members: CampMember[]; playIntro: boolean } | null = null;

  let time: McTime = { tick: 6000, day: 0 };
  let timeAt = performance.now();
  let weather: Weather = "clear";
  let cloudTarget = 0;
  let cloud = 0;
  let rain = 0;
  let thunder = 0;
  let flicker = 0;
  let tickAcc = 0;

  const resize = () => {
    const parent = canvas.parentElement;
    const w = parent?.clientWidth ?? 0;
    const h = parent?.clientHeight ?? 0;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const halfTan = Math.tan((camera.fov * Math.PI) / 360);
    const placeCamera = (dist: number) => {
      camera.position.copy(CAMERA_DIR).multiplyScalar(dist);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      // Slide the camera up its own axis until BOTTOM_EDGE_POINT sits exactly on the bottom edge of the view.
      const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const rel = BOTTOM_EDGE_POINT.clone().sub(camera.position);
      const depth = rel.dot(forward);
      const ndcY = rel.dot(up) / (depth * halfTan);
      camera.position.addScaledVector(up, (ndcY + 1) * depth * halfTan);
      camera.updateMatrixWorld();
    };
    // Whether every seat, its player and its name tag are inside the view (the bottom edge is pinned, so the tops and sides decide).
    const point = new Vector3();
    const seatsVisible = () => {
      if (!world) return true;
      for (const seat of world.slots) {
        for (const side of [-1, 1]) {
          for (const y of [0, SEAT_TOP]) {
            point.copy(seat).addScaledVector(RIGHT, side * NAME_TAG_HALF_WIDTH);
            point.y = y;
            point.project(camera);
            if (Math.abs(point.x) > FIT_LIMIT || point.y > FIT_LIMIT) return false;
          }
        }
      }
      return true;
    };
    // Start from the zoom where VIEW_HALF_WIDTH fills the page width, then back off until all seats fit: a short and wide
    // page would otherwise cut off the heads and name tags.
    let near = VIEW_HALF_WIDTH / (halfTan * camera.aspect);
    placeCamera(near);
    if (seatsVisible()) return;
    let far = near;
    for (let i = 0; i < 20 && !seatsVisible(); i++) {
      near = far;
      far *= 1.25;
      placeCamera(far);
    }
    for (let i = 0; i < 24; i++) {
      const mid = (near + far) / 2;
      placeCamera(mid);
      if (seatsVisible()) far = mid;
      else near = mid;
    }
    placeCamera(far);
  };

  const setSkin = (actor: Actor, url: string | undefined) => {
    actor.skinUrl = url;
    if (!url) return;
    loader.load(toHttps(url), (tex) => {
      // shortcut: legacy 64x32 skins are not converted, so they render with wrong UVs; convert when one shows up.
      tex.magFilter = NearestFilter;
      tex.minFilter = NearestFilter;
      tex.colorSpace = SRGBColorSpace; // without this the skin renders washed out and grey
      textures.push(tex);
      if (actors.get(actor.id) === actor && actor.skinUrl === url) actor.player.skin.map = tex;
      else tex.dispose();
    });
  };

  const setCape = (actor: Actor, url: string | undefined) => {
    actor.capeUrl = url;
    // skinview3d shows an empty cape by default, so hide it unless a cape texture is loaded.
    actor.player.backEquipment = null;
    if (!url) return;
    loader.load(toHttps(url), (tex) => {
      tex.magFilter = NearestFilter;
      tex.minFilter = NearestFilter;
      tex.colorSpace = SRGBColorSpace;
      textures.push(tex);
      if (actors.get(actor.id) === actor && actor.capeUrl === url) {
        actor.player.cape.map = tex;
        actor.player.backEquipment = "cape";
      } else tex.dispose();
    });
  };

  /** Yaw that faces the fire from the player's seat. */
  const seatYaw = (actor: Actor) => {
    const seat = world ? world.slots[actor.slot] : actor.wrap.position;
    const toFire = (world ? world.firePos.clone() : new Vector3()).sub(seat).setY(0).normalize();
    // The two end seats of the row turn a little toward the camera so they do not face away from the screen.
    if (world && (actor.slot === 0 || actor.slot === world.slots.length - 1)) {
      toFire.addScaledVector(new Vector3(CAMERA_DIR.x, 0, CAMERA_DIR.z).normalize(), EDGE_TURN);
    }
    return Math.atan2(toFire.x, toFire.z);
  };
  const faceFire = (actor: Actor) => {
    actor.wrap.rotation.y = seatYaw(actor);
  };
  /** Turns the whole player toward `yaw` the way tickHeadTurn eases the body (30% per tick). */
  const turnToward = (actor: Actor, yaw: number, ticks: number) => {
    actor.wrap.rotation.y += wrapAngle(yaw - actor.wrap.rotation.y) * (1 - (1 - BODY_TURN) ** ticks);
  };

  // CJK names fall back to the system fonts, which the Minecraft font does not cover.
  const TAG_FONT = '48px Minecraft, "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  /** (Re)draws the name tag: yellow for the host, and with a subtitle the name moves up and a smaller line sits under it. */
  const setLabels = (actor: Actor, m: CampMember) => {
    const key = `${m.name}|${m.host ? 1 : 0}|${m.subtitle ?? ""}`;
    if (actor.label === key) return;
    actor.label = key;
    for (const old of actor.tags) {
      actor.player.remove(old);
      old.material.map?.dispose();
      old.material.dispose();
    }
    const main = new NameTagObject(m.name, { font: TAG_FONT, textStyle: m.host ? "#ffff55" : "white" });
    main.position.y = m.subtitle ? 26 : 22;
    actor.tags = [main];
    if (m.subtitle) {
      const sub = new NameTagObject(m.subtitle, { font: TAG_FONT, height: 3 });
      sub.position.y = 22;
      actor.tags.push(sub);
    }
    actor.player.add(...actor.tags);
  };

  const spawn = (w: CampWorld, m: CampMember, slot: number, animate: boolean, order: number) => {
    const player = new PlayerObject();
    player.skin.modelType = m.slim ? "slim" : "default";
    const light = { value: new Color(1, 1, 1) };
    applyEntityLighting(light, player);
    const shadow = new Mesh(
      shadowGeo,
      new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, color: 0x000000 }),
    );
    scene.add(shadow);
    const wrap = new Group();
    wrap.add(player);
    // The player's origin is its centre, so lift it by half its height to stand on the ground.
    player.position.y = 16;
    const target = w.slots[slot];
    const actor: Actor = {
      id: m.id,
      slot,
      wrap,
      player,
      slim: !!m.slim,
      walking: false,
      velocity: 0,
      walk: { pos: 0, amount: 0 },
      sit: 0,
      sitting: false,
      path: [],
      delay: 0,
      seatFrom: target.clone(),
      light,
      shadow,
      tags: [],
      label: "",
      glow: [],
      ageOffset: Math.random() * 1000,
      head: { yaw: 0, pitch: 0.4, vYaw: 0, vPitch: 0, target: null, lookAt: "fire", until: rand(...LOOK_SECONDS.fire), settled: false },
      bodyYaw: 0,
      swing: { left: 0, count: 0, next: rand(SWING_MIN_S, SWING_MAX_S) },
      idle: {
        pose: 0,
        next: rand(POSE_MIN_S, POSE_MAX_S),
        armL: [...IDLE_POSES[0].armL],
        armR: [...IDLE_POSES[0].armR],
        lean: IDLE_POSES[0].lean,
        vArmL: [0, 0],
        vArmR: [0, 0],
        vLean: 0,
      },
      cape: { angle: Math.PI / 12, v: 0 },
      cushion: w.cushions.find((c) => Math.hypot(c.position.x - target.x, c.position.z - target.z) < 1)?.mesh ?? null,
      partY: { head: player.skin.head.position.y, body: player.skin.body.position.y, leftArm: player.skin.leftArm.position.y, rightArm: player.skin.rightArm.position.y },
    };
    player.skin.head.rotation.order = "YXZ";
    player.rotation.order = "YXZ";
    // ModelPart applies rotations as rotationZYX: pitch first, then yaw, then roll; otherwise a yaw on a hanging leg does nothing.
    for (const part of [player.skin.leftLeg, player.skin.rightLeg, player.skin.leftArm, player.skin.rightArm]) part.rotation.order = "ZYX";
    // The walk ends in front of the bench; sitting down then moves the player back onto it.
    const toFire = w.firePos.clone().sub(target).setY(0).normalize();
    actor.seatFrom = target.clone().addScaledVector(toFire, SEAT_APPROACH);
    if (animate) {
      // Everyone walks in from below the bottom edge of the screen, roughly in line with their seat.
      const start = new Vector3(CAMERA_DIR.x, 0, CAMERA_DIR.z)
        .normalize()
        .multiplyScalar(w.halfWidth * Math.SQRT2 + 2.5 * BLOCK)
        .addScaledVector(RIGHT, target.dot(RIGHT) * 0.8);
      wrap.position.copy(start);
      actor.path = walkPath(start, actor.seatFrom);
      actor.walking = true;
      actor.wrap.rotation.y = Math.atan2(actor.path[0].x - start.x, actor.path[0].z - start.z);
      actor.delay = m.isSelf ? 0 : order * ENTRY_STAGGER_S;
    } else {
      wrap.position.copy(target);
      faceFire(actor);
      actor.sitting = true;
      actor.sit = 1;
    }
    setLabels(actor, m);
    setSkin(actor, m.skinUrl);
    setCape(actor, m.capeUrl);
    scene.add(wrap);
    actors.set(m.id, actor);
  };

  const remove = (actor: Actor) => {
    if (glowId === actor.id) glowId = null;
    scene.remove(actor.wrap, actor.shadow);
    disposeTree(actor.wrap);
    (actor.shadow.material as Material).dispose();
    actors.delete(actor.id);
  };

  // Pointer picking and the Glowing outline: a white back-face shell, 0.5 units thick, around every box of the player.
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const hullMaterial = new MeshBasicMaterial({ color: 0xffffff, side: BackSide, fog: false });
  let glowId: string | null = null;
  let handlers: { onHover?: (id: string | null, x: number, y: number) => void; onPick?: (id: string) => void } = {};

  const pickAt = (clientX: number, clientY: number): string | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const list = [...actors.values()];
    const hit = raycaster.intersectObjects(list.map((a) => a.wrap), true)[0];
    if (!hit) return null;
    for (let o: Object3D | null = hit.object; o; o = o.parent) {
      const found = list.find((a) => a.wrap === o);
      if (found) return found.id;
    }
    return null;
  };

  const setGlow = (id: string | null) => {
    if (id === glowId) return;
    const old = glowId ? actors.get(glowId) : undefined;
    if (old) {
      for (const hull of old.glow) hull.parent?.remove(hull);
      old.glow = [];
    }
    glowId = id;
    canvas.style.cursor = id ? "pointer" : "";
    const actor = id ? actors.get(id) : undefined;
    if (!actor) return;
    const boxes: Mesh[] = [];
    actor.player.traverse((o) => {
      if (o instanceof Mesh && o.geometry instanceof BoxGeometry) boxes.push(o);
    });
    for (const box of boxes) {
      const { width, height, depth } = (box.geometry as BoxGeometry).parameters;
      const hull = new Mesh(box.geometry, hullMaterial);
      hull.scale.set((width + 1) / width, (height + 1) / height, (depth + 1) / depth);
      box.add(hull);
      actor.glow.push(hull);
    }
  };

  canvas.addEventListener("pointermove", (e) => handlers.onHover?.(pickAt(e.clientX, e.clientY), e.clientX, e.clientY));
  canvas.addEventListener("pointerleave", () => handlers.onHover?.(null, 0, 0));
  canvas.addEventListener("click", (e) => {
    const id = pickAt(e.clientX, e.clientY);
    if (id) handlers.onPick?.(id);
  });

  const sync = (members: CampMember[], playIntro: boolean) => {
    if (!world) {
      pending = { members, playIntro }; // applied once the world has loaded
      return;
    }
    const wanted = new Set(members.map((m) => m.id));
    for (const actor of [...actors.values()]) if (!wanted.has(actor.id)) remove(actor);

    const animate = introPending ? playIntro : true;
    let order = 0;
    for (const m of members.slice(0, Math.min(MAX_PARTY, world.slots.length))) {
      const existing = actors.get(m.id);
      if (existing) {
        setLabels(existing, m);
        if (existing.skinUrl !== m.skinUrl) setSkin(existing, m.skinUrl);
        if (existing.capeUrl !== m.capeUrl) setCape(existing, m.capeUrl);
        continue;
      }
      const used = new Set([...actors.values()].map((a) => a.slot));
      // Slot 0 is the leftmost cushion; until party roles exist it is yours.
      const slot = m.isSelf ? 0 : [...world.slots.keys()].find((s) => s !== 0 && !used.has(s));
      if (slot === undefined || (m.isSelf && used.has(0))) continue;
      spawn(world, m, slot, animate, m.isSelf ? 0 : ++order);
    }
    if (members.length > 0) introPending = false;
  };

  const flatDir: [number, number] = [CAMERA_DIR.x, CAMERA_DIR.z];
  const flatLen = Math.hypot(...flatDir);
  let stagesDone = 0;
  const stage = <T,>(task: Promise<T>): Promise<T> =>
    task.then((value) => {
      onProgress(++stagesDone / 4);
      return value;
    });
  Promise.all([
    stage(loadCampWorld(uniforms, [flatDir[0] / flatLen, flatDir[1] / flatLen])),
    stage(createSky()),
    stage(createWeather(uniforms)),
    stage(createParticles(uniforms)),
  ])
    .then(([w, s, fx, pt]) => {
      if (disposed) {
        disposeTree(w.group);
        w.textures.forEach((t) => t.dispose());
        s.dispose();
        fx.dispose();
        pt.dispose();
        return;
      }
      world = w;
      sky = s;
      weatherFx = fx;
      particles = pt;
      scene.add(w.group, fx.group, pt.mesh);
      resize();
      if (pending) sync(pending.members, pending.playIntro);
      ready = true;
      onReady();
    })
    .catch((e) => {
      console.error("CampScene: failed to load camp world", e);
      onReady();
    });

  /**
   * Lowest point (world y, ground = 0) of the leg boxes for a leg pitch `theta` (negative = forward), with the model's
   * origin at `originY` and the whole model leaning forward by `lean`.
   */
  const footLow = (theta: number, originY: number, lean: number) => {
    let low = Infinity;
    for (const z of [-LEG_OUTER_HALF, LEG_OUTER_HALF]) {
      const y = -LEG_OUTER_LENGTH * Math.cos(theta) - z * Math.sin(theta) - LEG_PIVOT_DOWN;
      const zz = -LEG_OUTER_LENGTH * Math.sin(theta) + z * Math.cos(theta);
      low = Math.min(low, originY + y * Math.cos(lean) - zz * Math.sin(lean));
    }
    return low;
  };
  /** The least forward leg pitch (up to level) that keeps the feet on (not in) the ground. */
  const plantedLeg = (originY: number, lean: number) => {
    if (footLow(0, originY, lean) >= 0) return 0;
    let lo = -Math.PI / 2;
    let hi = 0;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (footLow(mid, originY, lean) >= 0) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  /**
   * The sit-down, as a body would do it (no knees to bend, so the legs pivot at the hips): the torso tips forward and the
   * arms reach out to keep the weight over the feet; the hips go down and back, the legs swinging forward exactly as far
   * as keeps the feet planted on the ground; the cushion gives a little as the hips land on it; then the torso
   * straightens, the feet lift into the riding pose and the hands come back to the lap. Nothing passes through the
   * ground or the cushion.
   */
  const pose = (actor: Actor, dt: number) => {
    actor.sit = Math.min(1, actor.sit + dt / SIT_SECONDS);
    const s = actor.sit;
    const { player } = actor;
    const { leftLeg, rightLeg, leftArm, rightArm } = player.skin;
    // Counterbalance: lean forward and reach out while lowering, back upright once seated.
    const counter = Math.sin(Math.PI * Math.min(1, Math.max(0, (s - 0.05) / 0.8)));
    const settle = smooth(0.6, 1, s);
    const lean = 0.42 * counter + actor.idle.lean * settle;
    player.rotation.x = lean;
    // Hips: slow to start, fastest mid-way, caught by the cushion, which squashes a little and springs back.
    const land = s > 0.78 ? Math.sin(((s - 0.78) / 0.22) * Math.PI) : 0;
    if (actor.cushion) actor.cushion.scale.y = 1 - CUSHION_GIVE * land;
    let originY = 16 + (SEATED_Y - 16) * smooth(0.1, 0.85, s) - 4 * CUSHION_GIVE * land;
    // Legs: planted feet while lowering, then eased up to the vanilla riding pitch (that only ever lifts the feet).
    let theta = plantedLeg(originY, lean);
    theta += (Math.min(theta, SIT_LEG_X) - theta) * smooth(0.82, 1, s);
    if (footLow(theta, originY, lean) < 0) theta = plantedLeg(originY, lean);
    // Safety: if even level legs cannot clear the ground, the hips stay up instead of the feet sinking.
    originY += Math.max(0, -footLow(theta, originY, lean));
    player.position.y = originY;
    const splay = smooth(0.55, 1, s);
    leftLeg.rotation.set(theta, SIT_LEG_SPLAY * splay, -SIT_LEG_ROLL * splay);
    rightLeg.rotation.set(theta, -SIT_LEG_SPLAY * splay, SIT_LEG_ROLL * splay);
    // The hips travel back only as far as the swinging legs allow, so the feet stay where they were.
    if (world) {
      const seat = world.slots[actor.slot];
      const back = Math.max(0, SEAT_APPROACH - LEG_LENGTH * Math.sin(-theta)) / SEAT_APPROACH;
      actor.wrap.position.lerpVectors(seat, actor.seatFrom, back);
    }
    const lap = IDLE_POSES[0];
    const reach = -1.1 * smooth(0, 0.35, s) * (1 - settle);
    leftArm.rotation.set(reach + lap.armL[0] * settle, 0, lap.armL[1] * settle - 0.12 * counter);
    rightArm.rotation.set(reach + lap.armR[0] * settle, 0, lap.armR[1] * settle + 0.12 * counter);
    player.skin.head.rotation.set(0.35 * counter, 0, 0);
    swingCape(actor, Math.PI / 12 + 0.9 * settle - player.rotation.x * 0.5, dt);
  };

  /** The cape hangs from the shoulders and lags behind the body like cloth (under-damped spring). */
  const swingCape = (actor: Actor, target: number, dt: number) => {
    [actor.cape.angle, actor.cape.v] = spring(actor.cape.angle, actor.cape.v, target, CAPE_SPRING, dt, CAPE_DAMPING);
    actor.player.cape.rotation.x = actor.cape.angle;
  };

  /** HumanoidModel walk cycle (cos(pos x 0.6662), legs x1.4, arms opposite) driven by WalkAnimationState, plus bobArms. */
  const walkPose = (actor: Actor, dt: number, t: number) => {
    const ticks = dt * 20;
    const target = Math.min((actor.velocity / 20 / BLOCK) * 4, 1);
    actor.walk.amount += (target - actor.walk.amount) * (1 - (1 - WALK_ANIM_EASE) ** ticks);
    actor.walk.pos += actor.walk.amount * ticks;
    const { pos, amount } = actor.walk;
    const { leftLeg, rightLeg, leftArm, rightArm, head } = actor.player.skin;
    const age = (t + actor.ageOffset) * 20;
    const bobZ = Math.cos(age * 0.09) * 0.05 + 0.05;
    const bobX = Math.sin(age * 0.067) * 0.05;
    rightArm.rotation.set(Math.cos(pos * 0.6662 + Math.PI) * amount + bobX, 0, -bobZ);
    leftArm.rotation.set(Math.cos(pos * 0.6662) * amount - bobX, 0, bobZ);
    rightLeg.rotation.set(Math.cos(pos * 0.6662) * 1.4 * amount, 0.005, 0.005);
    leftLeg.rotation.set(Math.cos(pos * 0.6662 + Math.PI) * 1.4 * amount, -0.005, -0.005);
    head.rotation.set(0.1, 0, 0);
    actor.player.rotation.x = WALK_LEAN * amount;
    actor.player.position.y = 16;
    // Moving lifts the cape behind the player.
    swingCape(actor, Math.PI / 12 + 0.55 * amount, dt);
  };

  const neighbourHead = new Vector3();
  const lookLocal = new Vector3();
  /** Seated players glance between the fire, a neighbour and the viewer, turning the head smoothly. */
  const lookAround = (actor: Actor, dt: number, t: number, firePos: Vector3) => {
    const h = actor.head;
    if (t >= h.until) {
      // Turn to one of the other two kinds of target (a neighbour only if someone else is seated).
      const others = [...actors.values()].filter((a) => a !== actor && a.sitting);
      const choices = (["fire", "camera", "neighbour"] as const).filter((k) => k !== h.lookAt && (k !== "neighbour" || others.length > 0));
      h.lookAt = choices[Math.floor(Math.random() * choices.length)];
      h.target = h.lookAt === "neighbour" ? others[Math.floor(Math.random() * others.length)].wrap.position : null;
      h.until = t + rand(...LOOK_SECONDS[h.lookAt]);
    }
    const target =
      h.lookAt === "camera" ? camera.position : h.lookAt === "neighbour" && h.target ? neighbourHead.copy(h.target).setY(SEATED_Y + 6) : firePos;
    lookLocal.copy(target);
    actor.wrap.worldToLocal(lookLocal);
    lookLocal.y -= actor.player.position.y + 6;
    const yaw = Math.atan2(lookLocal.x, lookLocal.z);
    const pitch = Math.max(-HEAD_PITCH_LIMIT, Math.min(HEAD_PITCH_LIMIT, Math.atan2(-lookLocal.y, Math.hypot(lookLocal.x, lookLocal.z))));
    const dYaw = wrapAngle(yaw - h.yaw);
    [h.yaw, h.vYaw] = spring(h.yaw, h.vYaw, h.yaw + dYaw, HEAD_SPRING, dt);
    [h.pitch, h.vPitch] = spring(h.pitch, h.vPitch, pitch, HEAD_SPRING, dt);
    h.settled = Math.abs(dYaw) < 0.1 && Math.abs(pitch - h.pitch) < 0.1 && Math.abs(h.vYaw) < 0.3;
    // tickHeadTurn: drag the body once the head is more than 50 degrees off it.
    const fromBody = Math.atan2(Math.sin(h.yaw - actor.bodyYaw), Math.cos(h.yaw - actor.bodyYaw));
    if (Math.abs(fromBody) > MAX_HEAD_FROM_BODY) actor.bodyYaw += fromBody - Math.sign(fromBody) * MAX_HEAD_FROM_BODY;
    actor.player.rotation.y = actor.bodyYaw;
    actor.player.skin.head.rotation.set(h.pitch, h.yaw - actor.bodyYaw, 0);
  };

  /**
   * Seated life: drift between idle poses, breathe, sway the cape, AnimationUtils.bobArms on top, and now and then a
   * few HumanoidModel attack swings toward the fire.
   */
  const armLife = (actor: Actor, dt: number, t: number) => {
    const { player } = actor;
    const { leftArm, rightArm, head, body } = player.skin;
    const idle = actor.idle;
    if (t >= idle.next) {
      // Back to the lap pose about half the time, otherwise one of the others.
      const others = IDLE_POSES.map((_, i) => i).filter((i) => i !== idle.pose);
      idle.pose = idle.pose !== 0 && Math.random() < 0.5 ? 0 : others[Math.floor(Math.random() * others.length)];
      idle.next = t + rand(POSE_MIN_S, POSE_MAX_S);
    }
    const target = IDLE_POSES[idle.pose];
    for (let i = 0; i < 2; i++) {
      [idle.armL[i], idle.vArmL[i]] = spring(idle.armL[i], idle.vArmL[i], target.armL[i], ARM_SPRING, dt);
      [idle.armR[i], idle.vArmR[i]] = spring(idle.armR[i], idle.vArmR[i], target.armR[i], ARM_SPRING, dt);
    }
    [idle.lean, idle.vLean] = spring(idle.lean, idle.vLean, target.lean, LEAN_SPRING, dt);
    leftArm.rotation.x = idle.armL[0];
    leftArm.rotation.z = idle.armL[1];
    rightArm.rotation.x = idle.armR[0];
    rightArm.rotation.z = idle.armR[1];
    player.rotation.x = idle.lean;

    const breath = Math.sin(((t + actor.ageOffset) / BREATH_SECONDS) * Math.PI * 2) * BREATH_RISE;
    head.position.y = actor.partY.head + breath;
    body.position.y = actor.partY.body + breath;
    leftArm.position.y = actor.partY.leftArm + breath;
    rightArm.position.y = actor.partY.rightArm + breath;
    swingCape(actor, Math.PI / 12 + 0.9 - idle.lean + Math.sin((t + actor.ageOffset) * 1.3) * 0.04, dt);

    const age = (t + actor.ageOffset) * 20;
    const bobZ = Math.cos(age * 0.09) * 0.05 + 0.05;
    const bobX = Math.sin(age * 0.067) * 0.05;
    rightArm.rotation.z -= bobZ;
    rightArm.rotation.x += bobX;
    leftArm.rotation.z += bobZ;
    leftArm.rotation.x -= bobX;

    const s = actor.swing;
    // Only poke at the fire while actually looking at it, and not while warming both hands or leaning back on them.
    const atFire = actor.head.lookAt === "fire" && actor.head.settled && idle.pose !== WARM_POSE && idle.pose !== LEAN_BACK_POSE;
    // A series stops if the player looks away; a new one waits until they look at the fire again.
    if (s.count > 0 && !atFire) {
      s.count = 0;
      s.next = t + rand(SWING_MIN_S, SWING_MAX_S);
    }
    if (s.left <= 0 && t >= s.next) {
      if (s.count === 0 && !atFire) s.next = t + rand(1, 3);
      else {
        if (s.count === 0) s.count = 1 + Math.floor(Math.random() * 3);
        s.count -= 1;
        s.left = SWING_SECONDS;
        s.next = s.count > 0 ? t + SWING_INTERVAL : t + rand(SWING_MIN_S, SWING_MAX_S);
      }
    }
    if (s.left > 0) {
      s.left -= dt;
      const f = Math.min(1, 1 - Math.max(0, s.left) / SWING_SECONDS);
      const g = Math.sin((1 - (1 - f) ** 4) * Math.PI);
      const hh = Math.sin(f * Math.PI) * -(actor.head.pitch - 0.7) * 0.75;
      rightArm.rotation.x -= g * 1.2 + hh;
      rightArm.rotation.z += Math.sin(f * Math.PI) * 0.4;
    }
  };

  const forward = new Vector3();
  const seat = new Vector3();
  const lightmapData = uniforms.mcLightmap.value.image.data as unknown as Uint8Array;

  const step = (dt: number, t: number) => {
    for (const actor of actors.values()) {
      if (actor.delay > 0) {
        actor.delay -= dt;
        continue;
      }
      const ticks = dt * 20;
      const next = actor.path[0];
      if (next) {
        const pos = actor.wrap.position;
        const dx = next.x - pos.x;
        const dz = next.z - pos.z;
        const dist = Math.hypot(dx, dz);
        // Speed up from a standstill and brake into the last waypoint instead of starting and stopping dead.
        const want = actor.path.length > 1 ? WALK_SPEED : Math.min(WALK_SPEED, dist * 3);
        actor.velocity += (want - actor.velocity) * (1 - MOVE_KEEP ** ticks);
        const move = Math.min(dist, actor.velocity * dt);
        if (dist > 0) {
          pos.x += (dx / dist) * move;
          pos.z += (dz / dist) * move;
          turnToward(actor, Math.atan2(dx, dz), ticks);
        }
        if (dist - move < 0.5) {
          pos.copy(next);
          actor.path.shift();
          if (actor.path.length === 0) actor.walking = false;
        }
      } else if (!actor.sitting) {
        // Arrived: let the stride die out and turn to the fire before sitting down.
        actor.velocity *= MOVE_KEEP ** ticks;
        const yaw = seatYaw(actor);
        turnToward(actor, yaw, ticks);
        if (Math.abs(wrapAngle(yaw - actor.wrap.rotation.y)) < 0.05 && actor.walk.amount < 0.12) {
          actor.sitting = true;
          actor.sit = 0;
        }
      }
      if (actor.sitting) {
        pose(actor, dt);
        if (actor.sit >= 1 && world) {
          lookAround(actor, dt, t, world.firePos);
          armLife(actor, dt, t);
        }
      } else walkPose(actor, dt, t);
    }
    if (!world || !sky || !weatherFx) return;

    // 20 Hz client ticks: block light flicker.
    tickAcc += dt;
    while (tickAcc >= 0.05) {
      tickAcc -= 0.05;
      flicker = tickFlicker(flicker);
    }
    const toward = (v: number, target: number) => (v < target ? Math.min(target, v + WEATHER_RATE * dt) : Math.max(target, v - WEATHER_RATE * dt));
    rain = toward(rain, weather === "clear" ? 0 : 1);
    thunder = toward(thunder, weather === "thunder" ? 1 : 0);
    cloud = toward(cloud, cloudTarget);
    const flash = weatherFx.update(world, camera.position, rain, thunder, weather === "snow", t);

    // One real day is one Minecraft day: 1000 ticks per real hour.
    const tick = time.tick + ((performance.now() - timeAt) / 3_600_000) * 1000;
    const env = environmentAt(tick, rain, thunder, flash, cloud);
    const lightEnv = { skyFactor: env.skyLightFactor, skyLightColor: env.skyLightColor, flicker };
    fillLightmap(lightmapData, lightEnv);
    uniforms.mcLightmap.value.needsUpdate = true;
    // Each player is lit by the light of the cell around its head (the bench block itself is solid and dark).
    for (const actor of actors.values()) {
      const p = actor.wrap.position;
      seat.set(p.x, p.y + actor.player.position.y + 8, p.z);
      const [bl, sl] = world.lightAt(seat);
      const c = lightmapColor(bl, sl, lightEnv);
      actor.light.value.setRGB(c[0], c[1], c[2]);
      // Entity shadow on the surface below; vanilla scales its alpha (0.5) by the brightness there.
      const ground = world.groundAt(p.x, p.z) ?? 0;
      actor.shadow.position.set(p.x, ground + 0.05, p.z);
      (actor.shadow.material as MeshBasicMaterial).opacity = 0.5 * ((c[0] + c[1] + c[2]) / 3);
      actor.shadow.visible = actor.delay <= 0;
    }
    for (const c of world.cushions) {
      seat.copy(c.position).setY(c.position.y + 8);
      const [bl, sl] = world.lightAt(seat);
      c.light.value.setRGB(...lightmapColor(bl, sl, lightEnv));
    }

    camera.getWorldDirection(forward);
    const fog = fogColorFor(env, forward.x, rain, thunder);
    (scene.fog as Fog).color.setRGB(fog[0], fog[1], fog[2], SRGBColorSpace);
    renderer.setClearColor((scene.fog as Fog).color);
    sky.update(env, fog, camera, time.day, t);
    world.update(t);
    // Random block ticks centre on the local player (your seat), as ClientLevel.animateTick centres on the player.
    const self = [...actors.values()].find((a) => a.slot === 0);
    particles?.update(world, camera, self ? self.wrap.position : world.firePos, dt, env.skyDarken, { color: fog, near: FOG_START * BLOCK, far: FOG_END * BLOCK });
  };

  const draw = () => {
    renderer.clear();
    sky?.render(renderer);
    renderer.clearDepth();
    renderer.render(scene, camera);
  };

  let raf = 0;
  let last = performance.now();
  const loop = (now: number) => {
    // Uncapped: one frame per display refresh.
    raf = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    step(dt, now / 1000);
    draw();
  };
  raf = requestAnimationFrame(loop);

  // Resizing clears the canvas and the observer fires after the frame's rAF, so redraw now or the blank buffer gets painted.
  const observer = new ResizeObserver(() => {
    resize();
    draw();
  });
  if (canvas.parentElement) observer.observe(canvas.parentElement);
  resize();

  return {
    /** Stops drawing while the canvas is off screen; the scene keeps its state. */
    pause: () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    },
    /** Starts drawing again in the canvas's current parent. */
    attach: () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(loop);
      observer.disconnect();
      if (canvas.parentElement) observer.observe(canvas.parentElement);
      resize();
    },
    isReady: () => ready,
    sync,
    setGlow,
    setHandlers: (h: typeof handlers) => {
      handlers = h;
    },
    setTime: (t: McTime) => {
      time = t;
      timeAt = performance.now();
    },
    setWeather: (w: Weather, cloudCover = 0) => {
      weather = w;
      cloudTarget = cloudCover;
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      actors.clear();
      disposeTree(scene);
      world?.textures.forEach((t) => t.dispose());
      sky?.dispose();
      weatherFx?.dispose();
      particles?.dispose();
      textures.forEach((t) => t.dispose());
      shadowTex.dispose();
      shadowGeo.dispose();
      hullMaterial.dispose();
      uniforms.mcLightmap.value.dispose();
      // No forceContextLoss: React StrictMode re-runs the effect on the same canvas, and a lost context stays lost (blank scene).
      renderer.dispose();
    },
  };
};

type Camp = ReturnType<typeof createCamp>;

/**
 * The camp lives for as long as the app: leaving the page only detaches its canvas and pauses drawing, so coming
 * back finds the same scene (loaded, seated, no walk-in) instead of rebuilding it.
 */
let kept: { canvas: HTMLCanvasElement; camp: Camp; progress: number } | null = null;
const progressListeners = new Set<(fraction: number) => void>();

export const isCampReady = (): boolean => kept?.camp.isReady() ?? false;

export const CampScene: React.FC<CampSceneProps> = ({ members, playIntro, time, weather, cloud = 0, onReady, onProgress, glowId = null, onHoverMember, onPickMember, className }) => {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const hoverRef = useRef(onHoverMember);
  hoverRef.current = onHoverMember;
  const pickRef = useRef(onPickMember);
  pickRef.current = onPickMember;
  const hostRef = useRef<HTMLDivElement>(null);
  const campRef = useRef<Camp | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const report = (fraction: number) => onProgressRef.current?.(fraction);
    progressListeners.add(report);
    if (!kept) {
      const canvas = document.createElement("canvas");
      canvas.className = "block h-full w-full";
      host.appendChild(canvas);
      // A WebGL failure must not throw here: an uncaught effect error unmounts the whole app, leaving only the background.
      try {
        const camp = createCamp(
          canvas,
          () => onReadyRef.current?.(),
          (fraction) => progressListeners.forEach((l) => l(fraction)),
        );
        kept = { canvas, camp, progress: 0 };
      } catch (e) {
        console.error("CampScene: failed to create WebGL scene", e);
        canvas.remove();
        onReadyRef.current?.();
        return () => void progressListeners.delete(report);
      }
    } else {
      host.appendChild(kept.canvas);
      kept.camp.attach();
      if (kept.camp.isReady()) onReadyRef.current?.();
    }
    const current = kept;
    campRef.current = current.camp;
    current.camp.setHandlers({ onHover: (id, x, y) => hoverRef.current?.(id, x, y), onPick: (id) => pickRef.current?.(id) });
    return () => {
      progressListeners.delete(report);
      current.camp.pause();
      current.canvas.remove();
      campRef.current = null;
    };
  }, []);

  // These run after the scene effect above, so a first render already finds the camp.
  useEffect(() => {
    campRef.current?.setGlow(glowId);
  }, [glowId]);

  useEffect(() => {
    campRef.current?.setTime(time);
  }, [time]);

  useEffect(() => {
    campRef.current?.setWeather(weather, cloud);
  }, [weather, cloud]);

  useEffect(() => {
    campRef.current?.sync(members, playIntro);
  }, [members, playIntro]);

  return <div ref={hostRef} className={className} />;
};
