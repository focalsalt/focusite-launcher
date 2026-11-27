import test from "node:test";
import assert from "node:assert/strict";
import { formatMcRange } from "./mcVersionRange.ts";

const words = {
  any: "any",
  atLeast: (v) => `${v}+`,
  above: (v) => `>${v}`,
  atMost: (v) => `<=${v}`,
  below: (v) => `<${v}`,
  and: " & ",
  or: " | ",
};
const check = (cases) => {
  for (const [input, expected] of cases) assert.equal(formatMcRange(input, words), expected, input);
};

test("describes Fabric and Quilt predicates", () => {
  check([
    [">=26.3-", "26.3+"],
    ["~26.3-", "26.3.x"],
    ["~1.20.1", "1.20.1+ & <1.21"],
    ["^1.20.1", "1.20.1+ & <2"],
    [">= 1.20 <1.21", "1.20+ & <1.21"],
    ["1.20 || 1.20.1", "1.20 | 1.20.1"],
    ["1.20.x", "1.20.x"],
    ["*", "any"],
  ]);
});

test("describes Maven ranges", () => {
  check([
    ["[1.20.1,1.21)", "1.20.1+ & <1.21"],
    ["[1.20,)", "1.20+"],
    ["(,1.20]", "<=1.20"],
    ["[1.20.1]", "1.20.1"],
    ["[1.19,1.20), [1.21,)", "1.19+ & <1.20 | 1.21+"],
    ["1.12.2", "1.12.2"],
  ]);
});

test("keeps text it does not understand", () => {
  check([
    ["[1.20,1.21", "[1.20,1.21"],
    ["[1.20,) junk", "[1.20,) junk"],
    ["~abc", "~abc"],
    ["latest", "latest"],
  ]);
});
