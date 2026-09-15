// @ts-check

import assert from "node:assert/strict";

import {
  installMediaPipeWasmConsoleFilter,
  mediaPipeWasmConsoleSignatures
} from "../src/wasm-console-filter.js";
import { createMediaPipePoseAdapterFromRuntime } from "../src/mediapipe-adapter.js";

const signatures = mediaPipeWasmConsoleSignatures;
assert.deepEqual(signatures, [
  "OpenGL error checking is disabled",
  "Created TensorFlow Lite XNNPACK delegate for CPU.",
  "Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.",
  "Using NORM_RECT without IMAGE_DIMENSIONS is only supported for the square ROI. Provide IMAGE_DIMENSIONS or use PROJECTION_MATRIX."
]);
assert.equal(Object.isFrozen(signatures), true);

// --- Stub the four console levels BEFORE installing the filter so the
// filter wraps our stubs and every delivered message is recorded.
/** @type {{ level: string, args: unknown[] }[]} */
const delivered = [];
/** @type {Record<string, (() => void) | undefined>} */
const originals = { log: undefined, info: undefined, warn: undefined, error: undefined };

for (const level of ["log", "info", "warn", "error"]) {
  originals[level] = /** @type {() => void} */ (console[level]);
  const recorder = function (...args) {
    delivered.push({ level, args });
  };
  console[level] = recorder;
}
function restoreConsole() {
  for (const level of ["log", "info", "warn", "error"]) {
    console[level] = originals[level];
  }
}

// Install through the production path (adapter construction), then prove
// the exported install is idempotent with a direct second call.
const adapter = createMediaPipePoseAdapterFromRuntime(
  async () => createFakeRuntime(),
  { modelUrl: "https://example.invalid/filtersmoke.task" }
);
for (const level of ["log", "info", "warn", "error"]) {
  assert.equal(typeof console[level], "function", `${level} should be wrapped after adapter construction`);
  assert.notEqual(console[level], originals[level], `${level} should not be the original`);
}
const beforeSecondInstall = {
  log: console.log, info: console.info, warn: console.warn, error: console.error
};
installMediaPipeWasmConsoleFilter();
for (const level of ["log", "info", "warn", "error"]) {
  assert.equal(console[level], beforeSecondInstall[level], `reinstall must not re-wrap ${level}`);
}

try {
  // 1. Each of the four signatures is dropped at ALL FOUR levels.
  for (const level of ["log", "info", "warn", "error"]) {
    for (const signature of signatures) {
      /** @type {typeof console} */ (console)[level](signature);
    }
  }
  assert.equal(delivered.length, 0, `no signature message may reach any wrapped level; got: ${JSON.stringify(delivered)}`);

  // 2. A non-matching message passes through unchanged with the same args.
  const args = ["hello", 42, { ok: true }];
  console.log(...args);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].level, "log");
  assert.deepEqual(delivered[0].args, args);
  assert.equal(delivered[0].args[0], "hello");
  assert.equal(delivered[0].args[1], 42);
  assert.deepEqual(delivered[0].args[2], { ok: true });

  // 3. A non-matching console.error passes through unchanged.
  const errorArgs = ["genuine app failure", new Error("boom")];
  console.error(...errorArgs);
  assert.equal(delivered.length, 2);
  assert.equal(delivered[1].level, "error");
  assert.equal(delivered[1].args[0], "genuine app failure");
  assert.ok(delivered[1].args[1] instanceof Error);
  assert.equal(delivered[1].args[1].message, "boom");
} finally {
  restoreConsole();
}

// 4. IMAGE_DIMENSIONS reaches the detectForVideo call as the third argument.
await adapter.load();
adapter.dispose();

/** @type {{ imageProcessingOptions: unknown }[]} */
const detectCalls = [];
const detectingRuntime = {
  async resolveVisionFiles() { return { resolved: true }; },
  async createPoseLandmarker() {
    return {
      detectForVideo(_frameSource, _timestampMs, imageProcessingOptions) {
        detectCalls.push({ imageProcessingOptions });
        return { landmarks: [Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5, visibility: 0.8 }))] };
      },
      close() {}
    };
  }
};
const dimensionsAdapter = createMediaPipePoseAdapterFromRuntime(
  async () => detectingRuntime,
  { modelUrl: "https://example.invalid/filtersmoke2.task" }
);
await dimensionsAdapter.load();
await dimensionsAdapter.estimateNormalizedPoseFrame(
  /** @type {HTMLVideoElement} */ (/** @type {unknown} */ ({ videoWidth: 1280, videoHeight: 720 })),
  { timestampMs: 12 }
);
assert.equal(detectCalls.length, 1);
assert.deepEqual(detectCalls[0].imageProcessingOptions, {
  IMAGE_DIMENSIONS: { height: 720, width: 1280 }
});
dimensionsAdapter.dispose();

// 5. A frame source without readable dimensions must not change the call shape.
/** @type {{ imageProcessingOptions: unknown }[]} */
const bareCalls = [];
const bareRuntime = {
  async resolveVisionFiles() { return { resolved: true }; },
  async createPoseLandmarker() {
    return {
      detectForVideo(_frameSource, _timestampMs, imageProcessingOptions) {
        bareCalls.push({ imageProcessingOptions });
        return { landmarks: [] };
      },
      close() {}
    };
  }
};
const bareAdapter = createMediaPipePoseAdapterFromRuntime(
  async () => bareRuntime,
  { modelUrl: "https://example.invalid/filtersmoke3.task" }
);
await bareAdapter.load();
await bareAdapter.estimateNormalizedPoseFrame(
  /** @type {HTMLVideoElement} */ (/** @type {unknown} */ ({})),
  { timestampMs: 20 }
);
assert.equal(bareCalls.length, 1);
assert.equal(bareCalls[0].imageProcessingOptions, undefined);
bareAdapter.dispose();

console.log("MediaPipe WASM console filter validation passed.");

/** @returns {import("../src/mediapipe-adapter.js").MediaPipeRuntime} */
function createFakeRuntime() {
  return {
    async resolveVisionFiles() { return { resolved: true }; },
    async createPoseLandmarker() {
      return {
        detectForVideo() {
          return { landmarks: [Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5, visibility: 0.8 }))] };
        },
        close() {}
      };
    }
  };
}
