// @ts-check

import assert from "node:assert/strict";

import {
  aeroPoseAdapterStatuses,
  poseAdapterContractsId
} from "@aerobeat/web-contracts/pose-adapter";
import {
  createMediaPipeMockPoseAdapter,
  createMediaPipePoseAdapter,
  mediaPipeAdapterStatuses,
  mediaPipeCapabilities,
  mediaPipeDefaultModel,
  mediaPipeDefaultModelSha256,
  mediaPipeDefaultModelSizeBytes,
  mediaPipeDefaultModelUrl,
  mediaPipeDelegates,
  mediaPipeLiveSourceId,
  mediaPipeReplayCapabilities,
  mediaPipeReplayModel,
  mediaPipeVendorId
} from "../src/index.js";
import { createMediaPipePoseAdapterFromRuntime } from "../src/mediapipe-adapter.js";
import { normalizeMediaPipePoseFrame } from "../src/mediapipe-normalize.js";

const publicAdapter = createMediaPipePoseAdapter();
/** @type {import("@aerobeat/web-contracts/pose-adapter").AeroPoseAdapter} */
const contractAdapter = publicAdapter;
assert.equal(poseAdapterContractsId, "aero.contracts.pose-adapter");
assert.equal(contractAdapter.vendorId, mediaPipeVendorId);
assert.equal(publicAdapter.vendorId, publicAdapter.model.vendorId);
assert.deepEqual(publicAdapter.model, mediaPipeDefaultModel);
assert.equal(Object.isFrozen(publicAdapter.model), true);
assert.equal(publicAdapter.status, mediaPipeAdapterStatuses.idle);
assert.equal(mediaPipeAdapterStatuses.disposed, aeroPoseAdapterStatuses.disposed);
assert.equal(publicAdapter.getExecutionTelemetry().location, "main-thread");
assert.equal(publicAdapter.getExecutionTelemetry().provider, undefined);
assert.equal("poseLandmarker" in publicAdapter, false);
assert.equal("runtime" in publicAdapter, false);
assert.deepEqual(publicAdapter.capabilities.normalizedLandmarkNames, [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist"
]);
assert.equal(Object.isFrozen(mediaPipeCapabilities), true);
assert.equal(mediaPipeCapabilities.supportsMainThread, true);
assert.equal(mediaPipeCapabilities.supportsWorker, false);
assert.equal(mediaPipeCapabilities.supportsMirroring, true);
assert.equal(mediaPipeCapabilities.supportsFrameSizeOverride, false);
assert.deepEqual(mediaPipeCapabilities.executionProviders, ["wasm", "webgl"]);
assert.throws(
  () => createMediaPipePoseAdapterFromRuntime(async () => createFakeRuntime(), {
    delegate: /** @type {"cpu-wasm"} */ ("invalid")
  }),
  /Unsupported MediaPipe delegate/u
);
const derivedCustomModelAdapter = createMediaPipePoseAdapterFromRuntime(
  async () => createFakeRuntime(),
  { modelUrl: "https://example.invalid/custom.task" }
);
assert.equal(derivedCustomModelAdapter.model.modelId, "https://example.invalid/custom.task");
assert.equal(
  derivedCustomModelAdapter.getTelemetryStatus().modelId,
  derivedCustomModelAdapter.model.modelId
);
assert.equal(derivedCustomModelAdapter.getTelemetryStatus().modelSha256, "");
assert.equal(derivedCustomModelAdapter.getTelemetryStatus().modelSizeBytes, 0);

const mockAdapter = createMediaPipeMockPoseAdapter();
assert.deepEqual(mockAdapter.model, mediaPipeReplayModel);
assert.notDeepEqual(mockAdapter.model, mediaPipeDefaultModel);
assert.equal(Object.isFrozen(mockAdapter.model), true);
assert.deepEqual(mockAdapter.capabilities, mediaPipeReplayCapabilities);
assert.notDeepEqual(mockAdapter.capabilities.executionProviders, mediaPipeCapabilities.executionProviders);
assert.deepEqual(mockAdapter.capabilities.executionProviders, ["replay"]);
assert.equal(mockAdapter.capabilities.supportsMirroring, false);
assert.equal(mockAdapter.capabilities.supportsFrameSizeOverride, false);
assert.equal(mockAdapter.getTelemetryStatus().modelId, mockAdapter.model.modelId);
assert.equal(mockAdapter.getTelemetryStatus().modelVersion, mockAdapter.model.modelVersion);
assert.equal(mockAdapter.getTelemetryStatus().provider, mockAdapter.getExecutionTelemetry().provider);
await mockAdapter.load();
const mockFrame = await mockAdapter.estimateNormalizedPoseFrame();
assert.equal(mockFrame.landmarks.length, 7);
assert.equal(mockAdapter.getExecutionStatus().mode, "replay");
assert.equal(mockAdapter.getExecutionTelemetry().location, "unknown");
assert.equal(mockAdapter.getExecutionTelemetry().provider, "replay");
assert.equal(mockAdapter.getTelemetryStatus().actualDelegate, "replay");
mockAdapter.dispose();
assert.equal(mockAdapter.status, mediaPipeAdapterStatuses.disposed);
assert.equal(mockAdapter.getTelemetryStatus().disposed, true);

const runtime = createFakeRuntime();
const now = createClock([100, 100, 100, 99, 101, 102, 103, 104]);
const liveAdapter = createMediaPipePoseAdapterFromRuntime(async () => runtime, {
  delegate: mediaPipeDelegates.cpuWasm,
  modelUrl: "https://example.invalid/pinned.task",
  modelId: "fixture-pose",
  modelVersion: "test/1",
  modelName: "Fixture Pose",
  modelSha256: "fixture-sha256",
  modelSizeBytes: 123,
  wasmRootUrl: "https://example.invalid/wasm",
  now
});
await liveAdapter.load();
assert.equal(liveAdapter.status, mediaPipeAdapterStatuses.ready);
assert.equal(runtime.wasmRootUrl, "https://example.invalid/wasm");
assert.deepEqual(runtime.createOptions, {
  baseOptions: {
    modelAssetPath: "https://example.invalid/pinned.task",
    delegate: "CPU"
  },
  runningMode: "VIDEO",
  numPoses: 1,
  outputSegmentationMasks: false
});

const frameSource = /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ ({
  width: 640,
  height: 480,
  currentTime: 2
}));
const firstFrame = await liveAdapter.estimateNormalizedPoseFrame(frameSource, {
  sourceId: "camera.primary",
  timestampMs: 1234,
  mirrored: false
});
const secondFrame = await liveAdapter.estimateNormalizedPoseFrame(frameSource, {
  timestampMs: 1234
});
assert.equal(runtime.detectTimestamps.length, 2);
assert.equal(runtime.detectTimestamps[1] > runtime.detectTimestamps[0], true);
assert.equal(firstFrame.sourceId, "camera.primary");
assert.equal(firstFrame.timestampMs, 1234);
assert.equal(firstFrame.mirrored, false);
assert.deepEqual(firstFrame.landmarks.map((landmark) => landmark.name), [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist"
]);
assert.deepEqual(firstFrame.landmarks[0], {
  name: "nose",
  x: 0.5,
  y: 0.25,
  confidence: 0.9
});
assert.deepEqual(firstFrame.landmarks[6], {
  name: "right_wrist",
  x: 1,
  y: 0,
  confidence: 0.4
});
assert.equal(secondFrame.timestampMs, 1234);
assert.equal(liveAdapter.getExecutionStatus().delegate, mediaPipeDelegates.cpuWasm);
assert.match(liveAdapter.getExecutionStatus().detail, /CPU.*WASM/u);
const cpuTelemetry = liveAdapter.getTelemetryStatus();
assert.equal(liveAdapter.model.vendorId, liveAdapter.vendorId);
assert.equal(liveAdapter.model.modelId, "fixture-pose");
assert.equal(liveAdapter.model.modelVersion, "test/1");
assert.equal(cpuTelemetry.modelId, liveAdapter.model.modelId);
assert.equal(cpuTelemetry.modelVersion, liveAdapter.model.modelVersion);
assert.equal(cpuTelemetry.selectedDelegate, mediaPipeDelegates.cpuWasm);
assert.equal(cpuTelemetry.actualDelegate, mediaPipeDelegates.cpuWasm);
assert.equal(cpuTelemetry.fallback, false);
assert.equal(cpuTelemetry.model, "Fixture Pose");
assert.equal(cpuTelemetry.modelSha256, "fixture-sha256");
assert.equal(cpuTelemetry.modelSizeBytes, 123);
assert.equal(typeof cpuTelemetry.loadDurationMs, "number");
assert.equal(typeof cpuTelemetry.lastInferenceDurationMs, "number");
const genericCpuTelemetry = liveAdapter.getExecutionTelemetry();
assert.equal(genericCpuTelemetry.location, "main-thread");
assert.equal(genericCpuTelemetry.provider, "wasm");
assert.equal(genericCpuTelemetry.fallback, false);
assert.equal(typeof genericCpuTelemetry.loadDurationMs, "number");
assert.equal(typeof genericCpuTelemetry.estimateDurationMs, "number");

liveAdapter.dispose();
assert.equal(runtime.closed, 1);
assert.equal(liveAdapter.status, mediaPipeAdapterStatuses.disposed);
assert.equal(liveAdapter.getTelemetryStatus().disposed, true);

const gpuRuntime = createFakeRuntime();
const gpuAdapter = createMediaPipePoseAdapterFromRuntime(async () => gpuRuntime, {
  delegate: mediaPipeDelegates.gpuWebgl
});
await gpuAdapter.load();
assert.equal(gpuRuntime.createOptions?.baseOptions.delegate, "GPU");
assert.equal(gpuAdapter.getExecutionStatus().delegate, mediaPipeDelegates.gpuWebgl);
assert.equal(gpuAdapter.getExecutionTelemetry().provider, "webgl");
assert.match(gpuAdapter.getExecutionStatus().detail, /GPU.*WebGL/u);
gpuAdapter.dispose();

const defaultRuntime = createFakeRuntime();
const defaultAdapter = createMediaPipePoseAdapterFromRuntime(async () => defaultRuntime);
await defaultAdapter.load();
assert.equal(defaultRuntime.createOptions?.baseOptions.modelAssetPath, mediaPipeDefaultModelUrl);
assert.equal(defaultAdapter.getTelemetryStatus().modelId, defaultAdapter.model.modelId);
assert.equal(defaultAdapter.getTelemetryStatus().modelSha256, mediaPipeDefaultModelSha256);
assert.equal(defaultAdapter.getTelemetryStatus().modelSizeBytes, mediaPipeDefaultModelSizeBytes);
defaultAdapter.dispose();

const failingLoad = createMediaPipePoseAdapterFromRuntime(async () => {
  throw new Error("runtime load failed");
});
await assert.rejects(() => failingLoad.load(), /runtime load failed/u);
assert.equal(failingLoad.status, mediaPipeAdapterStatuses.failed);
assert.equal(failingLoad.getTelemetryStatus().error, "runtime load failed");
assert.equal(failingLoad.getExecutionTelemetry().provider, undefined);
assert.match(failingLoad.getExecutionTelemetry().detail ?? "", /runtime load failed/u);

const failingInferenceRuntime = createFakeRuntime({ failInference: true });
const failingInference = createMediaPipePoseAdapterFromRuntime(
  async () => failingInferenceRuntime
);
await failingInference.load();
await assert.rejects(
  () => failingInference.estimateNormalizedPoseFrame(frameSource),
  /detect failed/u
);
assert.equal(failingInference.status, mediaPipeAdapterStatuses.failed);
assert.equal(failingInference.getTelemetryStatus().error, "detect failed");
failingInference.dispose();
assert.equal(failingInferenceRuntime.closed, 1);

const emptyFrame = normalizeMediaPipePoseFrame(
  { landmarks: [] },
  { currentTime: 1.5 },
  { sourceId: mediaPipeLiveSourceId, timestampMs: undefined, mirrored: true, now: () => 9 }
);
assert.equal(emptyFrame.timestampMs, 1500);
assert.deepEqual(emptyFrame.landmarks, []);

console.log("MediaPipe adapter validation passed.");

/**
 * @typedef {import("../src/mediapipe-adapter.js").MediaPipeRuntime & {
 *   wasmRootUrl: string | undefined,
 *   createOptions: { baseOptions: { modelAssetPath: string, delegate: "CPU" | "GPU" }, runningMode: "VIDEO", numPoses: 1, outputSegmentationMasks: false } | undefined,
 *   detectTimestamps: number[],
 *   closed: number
 * }} FakeRuntime
 */

/**
 * @param {{ failInference?: boolean }} [options]
 * @returns {FakeRuntime}
 */
function createFakeRuntime(options = {}) {
  const landmarks = Array.from({ length: 17 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.8
  }));
  landmarks[0] = { x: 0.5, y: 0.25, visibility: 0.9 };
  landmarks[11] = { x: 0.4, y: 0.35, visibility: 0.8 };
  landmarks[12] = { x: 0.6, y: 0.35, visibility: 0.8 };
  landmarks[13] = { x: 0.3, y: 0.5, visibility: 0.7 };
  landmarks[14] = { x: 0.7, y: 0.5, visibility: 0.7 };
  landmarks[15] = { x: -0.2, y: 1.2, visibility: 1.4 };
  landmarks[16] = { x: 1.2, y: -0.1, visibility: 0.4 };

  /** @type {FakeRuntime} */
  const runtime = {
    wasmRootUrl: undefined,
    createOptions: undefined,
    detectTimestamps: [],
    closed: 0,
    async resolveVisionFiles(wasmRootUrl) {
      runtime.wasmRootUrl = wasmRootUrl;
      return { resolved: true };
    },
    async createPoseLandmarker(visionFiles, createOptions) {
      assert.deepEqual(visionFiles, { resolved: true });
      runtime.createOptions = createOptions;
      return {
        detectForVideo(_frameSource, timestampMs) {
          runtime.detectTimestamps.push(timestampMs);
          if (options.failInference) {
            throw new Error("detect failed");
          }
          return { landmarks: [landmarks] };
        },
        close() {
          runtime.closed += 1;
        }
      };
    }
  };
  return runtime;
}

/**
 * @param {readonly number[]} values
 * @returns {() => number}
 */
function createClock(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}
