// @ts-check

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = ["src/index.js", "src/mediapipe-adapter.js", "src/mediapipe-normalize.js"];
const sources = files.map((file) => ({
  file,
  source: readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
}));
for (const { file, source } of sources) {
  const staticSpecifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/gu)].map((match) => match[1]);
  assert.equal(staticSpecifiers.every((specifier) => specifier.startsWith("./")), true, `${file} static runtime imports must stay package-local`);
}
const externalSpecifiers = [...new Set(sources.flatMap(({ source }) =>
  [...source.matchAll(/import\(["']([^"']+)["']\)/gu)]
    .map((match) => match[1])
    .filter((specifier) => !specifier.startsWith("."))
))].sort();
assert.deepEqual(externalSpecifiers, [
  "@aerobeat/web-contracts/pose-adapter",
  "@aerobeat/web-contracts/pose-shapes",
  "@mediapipe/tasks-vision"
]);
for (const { file, source } of sources) {
  assert.doesNotMatch(source, /@aerobeat\/(?!web-contracts)/u, `${file} must not reach into sibling implementations`);
}
console.log("Public import-boundary validation passed.");
