// @ts-check

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = [
  "src/index.js",
  "src/mediapipe-adapter.js",
  "src/mediapipe-normalize.js"
];
for (const file of files) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /@(?:type|param|returns?)\s*\{\s*any\s*\}/u, `${file} must not escape through any`);
  assert.doesNotMatch(source, /eslint-disable/u, `${file} must not disable lint posture`);
}
console.log("JSDoc/no-any validation passed.");
