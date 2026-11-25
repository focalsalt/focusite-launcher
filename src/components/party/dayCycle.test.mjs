import test from "node:test";
import assert from "node:assert/strict";
import { mcTimeAt } from "./dayCycle.ts";
import { lightmapColor } from "./lightmap.ts";
import { weatherFromWmo } from "./weather.ts";

const at = (h, m = 0) => mcTimeAt(new Date(2026, 0, 1, h, m));

test("real clock maps onto the Minecraft day", () => {
  assert.equal(at(6).tick, 0);
  assert.equal(at(12).tick, 6000);
  assert.equal(at(18).tick, 12000);
  assert.equal(at(0).tick, 18000);
  assert.equal(at(5, 30).tick, 23500);
});

test("the Minecraft day count turns over at sunrise", () => {
  // 05:00 still belongs to the previous Minecraft day.
  assert.equal(at(7).day, at(5).day + 1);
  assert.equal(at(23).day, at(7).day);
});

const utc = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));
const scan = (loc, start, minutes, step = 2) => {
  const out = [];
  for (let i = 0; i <= minutes; i += step) out.push(mcTimeAt(new Date(start.getTime() + i * 60000), loc));
  return out;
};
const EQUATOR = { lat: 0, lon: 0 };
const TAIPEI = { lat: 25.03, lon: 121.56 };

test("no location (or null) keeps the vanilla timetable on the real clock", () => {
  const d = new Date(2026, 5, 1, 7, 30);
  assert.deepEqual(mcTimeAt(d, null), mcTimeAt(d));
  assert.equal(mcTimeAt(d).tick, 1500);
});

test("with a location, sunrise, noon, sunset and midnight land on the vanilla ticks", () => {
  // Equator at the March equinox: sunrise about 06:06 UTC, solar noon 12:07, sunset about 18:12, midnight 00:07.
  const near = (date, tick, tol) => assert.ok(Math.abs(mcTimeAt(date, EQUATOR).tick - tick) < tol, `${date.toISOString()} -> ${mcTimeAt(date, EQUATOR).tick}`);
  near(utc(2026, 3, 20, 6, 6), 23100, 120);
  near(utc(2026, 3, 20, 12, 7), 6000, 100);
  near(utc(2026, 3, 20, 18, 12), 12900, 120);
  near(utc(2026, 3, 21, 0, 7), 18000, 100);
});

test("with a location, the sun rises when the real one does (Taipei, winter solstice)", () => {
  // Sunrise is about 06:36 and sunset about 17:10 local (UTC+8).
  assert.ok(Math.abs(mcTimeAt(utc(2026, 12, 20, 22, 36), TAIPEI).tick - 23100) < 150);
  assert.ok(Math.abs(mcTimeAt(utc(2026, 12, 21, 9, 10), TAIPEI).tick - 12900) < 150);
});

test("time never jumps and the day turns over exactly when the tick wraps", () => {
  for (const loc of [EQUATOR, TAIPEI, { lat: 50, lon: 10 }, { lat: -34, lon: 151 }]) {
    const series = scan(loc, utc(2026, 9, 1), 3 * 1440);
    let turns = 0;
    for (let i = 1; i < series.length; i++) {
      const delta = (series[i].tick - series[i - 1].tick + 24000) % 24000;
      assert.ok(delta < 200, `${JSON.stringify(loc)} jumped ${delta} ticks at step ${i}`);
      if (series[i].day !== series[i - 1].day) {
        turns++;
        assert.ok(series[i].tick < series[i - 1].tick, "the day turns only at the tick wrap");
      }
    }
    assert.ok(turns >= 2 && turns <= 3, `${JSON.stringify(loc)}: ${turns} day turns in 3 days`);
  }
});

test("polar night never sees the sun and polar day never sees the night", () => {
  const polarNight = scan({ lat: 80, lon: 0 }, utc(2026, 12, 21), 1440).map((t) => t.tick);
  assert.ok(polarNight.every((t) => t === 18000));
  // 70N in December: twilight at noon, but the sun never reaches the horizon.
  const dim = scan({ lat: 70, lon: 0 }, utc(2026, 12, 21), 1440).map((t) => t.tick);
  assert.ok(dim.every((t) => t >= 18000 && t < 23100));
  assert.ok(dim.some((t) => t > 22000));
  const midnightSun = scan({ lat: 80, lon: 0 }, utc(2026, 6, 21), 1440).map((t) => t.tick);
  assert.ok(midnightSun.every((t) => t < 13000 || t >= 23000));
});

test("lightmap: dark at level 0, full white at noon sky 15", () => {
  const noon = { skyFactor: 1, skyLightColor: [1, 1, 1], flicker: 0 };
  const dark = lightmapColor(0, 0, noon);
  assert.ok(dark.every((c) => c < 0.1));
  assert.deepEqual(lightmapColor(0, 15, noon), [1, 1, 1]);
  // Block light 15 is warm only below full strength; at 15 the tint fades to white (parabolic mix 0.9).
  const torch = lightmapColor(15, 0, noon);
  assert.ok(torch[0] >= torch[2]);
});

test("WMO weather codes map to Minecraft weather", () => {
  assert.equal(weatherFromWmo(0), "clear");
  assert.equal(weatherFromWmo(3), "clear");
  assert.equal(weatherFromWmo(45), "clear");
  assert.equal(weatherFromWmo(53), "rain");
  assert.equal(weatherFromWmo(67), "rain");
  assert.equal(weatherFromWmo(81), "rain");
  assert.equal(weatherFromWmo(73), "snow");
  assert.equal(weatherFromWmo(86), "snow");
  assert.equal(weatherFromWmo(95), "thunder");
  assert.equal(weatherFromWmo(99), "thunder");
});
