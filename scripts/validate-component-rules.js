// @ts-check

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const demo = readFileSync(new URL("../.testbed/demo/main.js", import.meta.url), "utf8");
assert.doesNotMatch(demo, /customElements\.define/u, "vendor testbed must not own product components");
assert.doesNotMatch(demo, /navigator\.mediaDevices/u, "mock smoke must not request a camera");
console.log("Vendor/component boundary validation passed.");
