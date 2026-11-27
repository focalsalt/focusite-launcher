import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accentTokens, contrast, hexToHsv, hsvToHex } from "./accent.ts";
import { formatEnvVars, parseEnvVars, splitArgs } from "./launchOptions.ts";

test("keeps any accent readable", () => {
  for (const accent of ["#ffffff", "#000000", "#ffff00", "#0000ff", "#3c8527"]) {
    const tokens = accentTokens(accent);
    assert.ok(contrast(tokens["--fc-primary"], "#ffffff") >= 4.5, `${accent} primary`);
    assert.ok(contrast(tokens["--fc-highlight"], "#0a0f1d") >= 4.5, `${accent} highlight`);
  }
  assert.equal(accentTokens("#3c8527")["--fc-primary"], "#3c8527");
  assert.deepEqual(accentTokens("red"), {});
});

test("keeps an accent readable on a light canvas", () => {
  for (const accent of ["#ffff00", "#ffffff", "#3c8527"]) {
    assert.ok(contrast(accentTokens(accent, "#f1f5f9")["--fc-highlight"], "#f1f5f9") >= 4.5, accent);
  }
});

test("the light pack covers the palette and keeps text readable", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const { tokens } = JSON.parse(read("../../src-tauri/themes/light.focusite-theme.json"));
  const palette = read("../styles/theme-tokens.css").match(/--fc-(ink|well|neutral|success|warning|danger)[a-z0-9-]*(?=:)/g);
  assert.deepEqual([...new Set(palette)].filter((name) => !tokens[name]), []);

  const text = ["--fc-ink", "--fc-highlight"].concat(
    ["50", "100", "200", "300", "400", "500"].map((n) => `--fc-neutral-${n}`),
    ["success", "warning", "danger"].flatMap((hue) => [200, 300, 400].map((n) => `--fc-${hue}-${n}`)),
  );
  for (const name of text) {
    for (const surface of ["--fc-bg-canvas", "--fc-neutral-900"]) {
      assert.ok(contrast(tokens[name], tokens[surface]) >= 4.5, `${name} on ${surface}`);
    }
  }
  for (const name of ["--fc-primary", "--fc-primary-hover", "--fc-success-600", "--fc-danger-600", "--fc-danger-700"]) {
    assert.ok(contrast("#ffffff", tokens[name]) >= 4.5, `white on ${name}`);
  }
});

test("built-in packs keep white button text readable, hovered or not", () => {
  const darken = (hex) =>
    "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.85).toString(16).padStart(2, "0")).join("");
  for (const id of ["minecraft", "focusite", "amethyst", "light"]) {
    const url = new URL(`../../src-tauri/themes/${id}.focusite-theme.json`, import.meta.url);
    const { tokens } = JSON.parse(readFileSync(url, "utf8"));
    const primary = tokens["--fc-primary"];
    for (const shade of [primary, tokens["--fc-primary-hover"] ?? darken(primary)]) {
      assert.ok(contrast("#ffffff", shade) >= 4.5, `${id} ${shade}`);
    }
  }
});

test("converts picker colors without drift", () => {
  assert.deepEqual(hexToHsv("#ff0000"), { h: 0, s: 1, v: 1 });
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), "#ff0000");
  for (const hex of ["#000000", "#ffffff", "#3c8527", "#c2410c", "#0000ff", "#ff00fe", "#808080"]) {
    assert.equal(hsvToHex(hexToHsv(hex)), hex);
  }
});

test("the default border color does not override utilities", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  assert.match(css, /@layer base \{\s*\* \{\s*border-color: var\(--border\);/);
});

test("parses launch option text", () => {
  assert.deepEqual(splitArgs("  --a  --b=1 "), ["--a", "--b=1"]);
  assert.deepEqual(parseEnvVars("A=1\r\n\r\n B = x=y \nEMPTY="), { vars: { A: "1", B: "x=y", EMPTY: "" } });
  assert.deepEqual(parseEnvVars("A=1\nnot a variable"), { invalidLine: 2 });
  assert.deepEqual(parseEnvVars("=value"), { invalidLine: 1 });
  assert.equal(formatEnvVars({ A: "1", B: "2" }), "A=1\nB=2");
});
