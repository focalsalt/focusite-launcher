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
