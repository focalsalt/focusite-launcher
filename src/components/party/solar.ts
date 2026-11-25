/** Where the camp is: coarse coordinates in degrees (north and east positive). */
export interface Location {
  lat: number;
  lon: number;
}

const RAD = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
const HALF_DAY = MS_PER_DAY / 2;

/** Solar elevation in degrees (NOAA / Meeus low-precision formulas, about 0.05 degrees; no refraction). */
export const solarElevation = (ms: number, { lat, lon }: Location): number => {
  const n = ms / MS_PER_DAY + 2440587.5 - 2451545;
  const meanLon = (280.46 + 0.9856474 * n) % 360;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const eclLon = (meanLon + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const obliq = (23.439 - 0.0000004 * n) * RAD;
  const dec = Math.asin(Math.sin(obliq) * Math.sin(eclLon));
  const ra = Math.atan2(Math.cos(obliq) * Math.sin(eclLon), Math.cos(eclLon));
  const gmstDeg = ((18.697374558 + 24.06570982441908 * n) % 24) * 15;
  const hourAngle = (gmstDeg + lon) * RAD - ra;
  const sinEl = Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
};

/** Equation of time in minutes (NOAA), for the UTC day containing `ms`. */
const equationOfTime = (ms: number): number => {
  const d = new Date(ms);
  const doy = Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / MS_PER_DAY);
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (d.getUTCHours() - 12) / 24);
  return 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
};

/** Solar noon (UTC ms) nearest to `ms`, plus its index (consecutive noons differ by 1). */
const nearestNoon = (ms: number, lon: number): { noon: number; index: number } => {
  const dayIndex = Math.floor(ms / MS_PER_DAY);
  const noons = [dayIndex - 1, dayIndex, dayIndex + 1].map((index) => ({
    index,
    noon: index * MS_PER_DAY + (720 - 4 * lon - equationOfTime(index * MS_PER_DAY + HALF_DAY)) * 60_000,
  }));
  return noons.reduce((best, n) => (Math.abs(n.noon - ms) < Math.abs(best.noon - ms) ? n : best));
};

/** Elevations (degrees) that the camp day is anchored to. */
const CIVIL = -6;
const HORIZON = -0.833;
const GOLDEN = 6;

/** [elevation, tick] while the sun rises; the setting half is the mirror image around noon (tick 30000). */
const RISING: Array<[number, number]> = [[CIVIL, 22200], [HORIZON, 23100], [GOLDEN, 24000]];
const mirror = (tick: number) => 60000 - tick;

/** Tick for a sun elevation inside the twilight band (clamped to its ends). */
const bandTick = (elevation: number): number => {
  if (elevation <= CIVIL) return RISING[0][1];
  if (elevation >= GOLDEN) return RISING[2][1];
  const [a, b] = elevation < HORIZON ? [RISING[0], RISING[1]] : [RISING[1], RISING[2]];
  return a[1] + ((b[1] - a[1]) * (elevation - a[0])) / (b[0] - a[0]);
};

/** Time in [t0, t1] where the (monotonic there) elevation crosses `target`, or null if it does not. */
const crossing = (loc: Location, t0: number, t1: number, target: number): number | null => {
  const e0 = solarElevation(t0, loc) - target;
  const e1 = solarElevation(t1, loc) - target;
  if (e0 * e1 > 0) return null;
  let lo = t0;
  let hi = t1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if ((solarElevation(mid, loc) - target) * e0 > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/**
 * The camp's Minecraft time of day at `ms` for a place: sunrise is tick 23100, sunset 12900, solar noon 6000 and solar
 * midnight 18000, with twilight (sun between -6 and +6 degrees) filling 22200..24000 and 12000..13800.
 * Polar day or night keeps the sun inside the band it reaches: with a noon sun below the golden band the setting half is
 * the rising half played backwards (no jump); otherwise it is the mirror image, and a midnight sun that never set makes the
 * tick jump once at solar midnight from the dusk side to the dawn side.
 * `tick` is 0..24000 and `day` turns over when the tick wraps at sunrise.
 */
export const solarMcTime = (ms: number, loc: Location): { tick: number; day: number } => {
  const { noon, index } = nearestNoon(ms, loc.lon);
  const rising = ms < noon;
  // A half day: rising runs from solar midnight to noon, setting from noon to the next midnight.
  const t0 = rising ? noon - HALF_DAY : noon;
  const t1 = rising ? noon : noon + HALF_DAY;
  const eNoon = solarElevation(noon, loc);
  const eMid = solarElevation(rising ? t0 : t1, loc);

  const noonTick = eNoon >= GOLDEN ? 30000 : eNoon <= CIVIL ? 18000 : bandTick(eNoon);
  const midTick = eMid <= CIVIL ? 18000 : eMid >= GOLDEN ? 24000 : bandTick(eMid);
  const mirrored = eNoon >= GOLDEN;

  // Anchors as [time, unwrapped tick], in time order.
  const anchors: Array<[number, number]> = [];
  if (rising) {
    anchors.push([t0, midTick]);
    for (const [elevation, tick] of RISING) {
      const t = crossing(loc, t0, t1, elevation);
      if (t !== null) anchors.push([t, tick]);
    }
    anchors.push([t1, noonTick]);
  } else {
    anchors.push([t0, noonTick]);
    for (const [elevation, tick] of [...RISING].reverse()) {
      const t = crossing(loc, t0, t1, elevation);
      if (t !== null) anchors.push([t, mirrored ? mirror(tick) : tick]);
    }
    anchors.push([t1, mirrored ? mirror(midTick) : midTick]);
  }

  let unwrapped = anchors[anchors.length - 1][1];
  for (let i = 1; i < anchors.length; i++) {
    const [ta, ka] = anchors[i - 1];
    const [tb, kb] = anchors[i];
    if (ms <= tb) {
      unwrapped = tb === ta ? kb : ka + ((kb - ka) * (ms - ta)) / (tb - ta);
      break;
    }
  }
  // Before sunrise the unwrapped tick is still below 24000 and belongs to the previous Minecraft day.
  return { tick: unwrapped % 24000, day: index - (unwrapped < 24000 ? 1 : 0) };
};
