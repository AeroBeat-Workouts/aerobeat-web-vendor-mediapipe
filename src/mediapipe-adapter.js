// @ts-check

import { clonePoseFrame, normalizeMediaPipePoseFrame } from "./mediapipe-normalize.js";

/** @type {"mediapipe"} */
export const mediaPipeVendorId = "mediapipe";
/** @type {"1.0.1"} */
export const mediaPipePackageVersion = "1.0.1";
/** @type {"aero.mediapipe.live"} */
export const mediaPipeLiveSourceId = "aero.mediapipe.live";
/** @type {"aero.mediapipe.replay.basic-upper-body"} */
export const mediaPipeReplayFixtureId = "aero.mediapipe.replay.basic-upper-body";
/** @type {"Pose Landmarker Lite float16 /1/"} */
export const mediaPipeDefaultModelName = "Pose Landmarker Lite float16 /1/";
/** @type {"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"} */
export const mediaPipeDefaultModelUrl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
/** @type {"59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"} */
export const mediaPipeDefaultModelSha256 = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a";
/** @type {5777746} */
export const mediaPipeDefaultModelSizeBytes = 5777746;
/** @type {"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"} */
export const mediaPipeDefaultWasmRootUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";

/** @type {Readonly<{ cpuWasm: "cpu-wasm", gpuWebgl: "gpu-webgl" }>} */
export const mediaPipeDelegates = Object.freeze({
  cpuWasm: "cpu-wasm",
  gpuWebgl: "gpu-webgl"
});

/** @type {Readonly<import("@aerobeat/web-contracts/pose-adapter").AeroPoseModelIdentity>} */
export const mediaPipeDefaultModel = Object.freeze({
  vendorId: mediaPipeVendorId,
  modelId: "pose-landmarker-lite",
  modelVersion: "float16/1",
  runtimeId: "@mediapipe/tasks-vision",
  runtimeVersion: mediaPipePackageVersion
});

/** @type {Readonly<import("@aerobeat/web-contracts/pose-adapter").AeroPoseModelIdentity>} */
export const mediaPipeReplayModel = Object.freeze({
  vendorId: mediaPipeVendorId,
  modelId: "deterministic-replay",
  modelVersion: "basic-upper-body/1",
  runtimeId: "aerobeat-replay",
  runtimeVersion: "1"
});

/** @type {Readonly<{ idle: "idle", loading: "loading", ready: "ready", failed: "failed", disposed: "disposed" }>} */
export const mediaPipeAdapterStatuses = Object.freeze({
  idle: "idle",
  loading: "loading",
  ready: "ready",
  failed: "failed",
  disposed: "disposed"
});

export const mediaPipeCapabilities = Object.freeze({
  supportsMainThread: true,
  supportsWorker: false,
  supportsMirroring: true,
  supportsFrameSizeOverride: false,
  executionProviders: Object.freeze(["wasm", "webgl"]),
  delegates: Object.freeze([mediaPipeDelegates.cpuWasm, mediaPipeDelegates.gpuWebgl]),
  runningMode: "VIDEO",
  numPoses: 1,
  segmentationMasks: false,
  synchronousInference: true,
  workerInference: false,
  normalizedLandmarkNames: Object.freeze([
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist"
  ])
});

export const mediaPipeReplayCapabilities = Object.freeze({
  supportsMainThread: true,
  supportsWorker: false,
  supportsMirroring: false,
  supportsFrameSizeOverride: false,
  executionProviders: Object.freeze(["replay"]),
  deterministicReplay: true,
  normalizedLandmarkNames: mediaPipeCapabilities.normalizedLandmarkNames
});

/** @typedef {import("@aerobeat/web-contracts/pose-shapes").NormalizedPoseFrame} NormalizedPoseFrame */
/** @typedef {import("@aerobeat/web-contracts/pose-adapter").AeroPoseFrameSource} MediaPipeFrameSource */
/** @typedef {import("@aerobeat/web-contracts/pose-adapter").AeroPoseEstimateOptions} MediaPipeEstimateOptions */

/**
 * @typedef {Object} MediaPipeAdapterOptions
 * @property {string} [sourceId] Default output source identifier.
 * @property {boolean} [mirrored] Default display-mirror metadata.
 * @property {"cpu-wasm" | "gpu-webgl"} [delegate] Explicit delegate selection.
 * @property {string} [modelUrl] Injectable task model URL.
 * @property {string} [modelId] Stable identity for a custom model artifact; defaults to its URL.
 * @property {string} [modelVersion] Optional custom model version detail.
 * @property {string} [wasmRootUrl] Injectable Tasks Vision WASM root URL.
 * @property {string} [modelName] Injectable telemetry display name.
 * @property {string} [modelSha256] Injectable telemetry checksum.
 * @property {number} [modelSizeBytes] Injectable telemetry asset size.
 * @property {() => number} [now] Monotonic clock used by detectForVideo.
 */

/**
 * @typedef {Object} MediaPipeExecutionStatus
 * @property {"main-thread" | "replay"} mode Execution location.
 * @property {"cpu-wasm" | "gpu-webgl" | "replay"} delegate Actual delegate.
 * @property {string} detail Human-readable execution detail.
 */

/**
 * @typedef {Object} MediaPipeTelemetryStatus
 * @property {"mediapipe"} vendorId Vendor identifier.
 * @property {"@mediapipe/tasks-vision" | "replay"} provider Runtime provider.
 * @property {string} packageVersion Package version.
 * @property {string} model Model display name.
 * @property {string} modelId Stable model identity matching the generic adapter model.
 * @property {string | undefined} modelVersion Model version matching the generic adapter model.
 * @property {string} modelUrl Model asset URL.
 * @property {string} modelSha256 Expected model checksum.
 * @property {number} modelSizeBytes Published model asset size.
 * @property {string} wasmRootUrl Tasks Vision WASM root.
 * @property {"cpu-wasm" | "gpu-webgl" | "replay"} selectedDelegate Requested delegate.
 * @property {"cpu-wasm" | "gpu-webgl" | "replay" | undefined} actualDelegate Actual delegate after successful load.
 * @property {"idle" | "loading" | "ready" | "failed" | "disposed"} loadState Current lifecycle state.
 * @property {boolean} fallback Whether a fallback occurred.
 * @property {boolean} disposed Whether dispose was called since the last load.
 * @property {number | undefined} loadDurationMs Most recent load duration.
 * @property {number | undefined} lastInferenceDurationMs Last synchronous call duration.
 * @property {string} confidenceSemantics Confidence interpretation.
 * @property {string | undefined} error Last failure message.
 */

/**
 * @typedef {import("@aerobeat/web-contracts/pose-adapter").AeroPoseAdapter & {
 *   vendorId: "mediapipe",
 *   model: Readonly<import("@aerobeat/web-contracts/pose-adapter").AeroPoseModelIdentity>,
 *   capabilities: typeof mediaPipeCapabilities | typeof mediaPipeReplayCapabilities,
 *   getExecutionTelemetry: () => import("@aerobeat/web-contracts/pose-adapter").AeroPoseExecutionTelemetry,
 *   getExecutionStatus: () => MediaPipeExecutionStatus,
 *   getTelemetryStatus: () => MediaPipeTelemetryStatus,
 *   dispose: () => void
 * }} MediaPipePoseAdapter
 */

/**
 * @typedef {Object} PoseLandmarkerLike
 * @property {(frameSource: MediaPipeFrameSource, timestampMs: number) => import("./mediapipe-normalize.js").MediaPipePoseResultLike} detectForVideo Runs synchronous video inference.
 * @property {() => void} close Releases MediaPipe resources.
 */

/**
 * @typedef {Object} MediaPipeRuntime
 * @property {(wasmRootUrl: string) => Promise<unknown>} resolveVisionFiles Resolves Tasks Vision WASM files.
 * @property {(visionFiles: unknown, options: { baseOptions: { modelAssetPath: string, delegate: "CPU" | "GPU" }, runningMode: "VIDEO", numPoses: 1, outputSegmentationMasks: false }) => Promise<PoseLandmarkerLike>} createPoseLandmarker Creates a pose task.
 */

/** @typedef {() => Promise<MediaPipeRuntime>} MediaPipeRuntimeLoader */

/**
 * @typedef {Object} MediaPipeReplayPoseSource
 * @property {"replay-fixture"} sourceKind Replay source kind.
 * @property {string} sourceId Replay identifier.
 * @property {readonly NormalizedPoseFrame[]} frames Normalized frames.
 */

/**
 * Creates the real browser MediaPipe adapter. Runtime objects remain private.
 *
 * @param {MediaPipeAdapterOptions} [options]
 * @returns {MediaPipePoseAdapter}
 */
export function createMediaPipePoseAdapter(options = {}) {
  return createMediaPipePoseAdapterFromRuntime(loadDefaultMediaPipeRuntime, options);
}

/**
 * Internal runtime-injection factory for deterministic package validation.
 * It is deliberately not exported from the public package index.
 *
 * @param {MediaPipeRuntimeLoader} loadRuntime
 * @param {MediaPipeAdapterOptions} [options]
 * @returns {MediaPipePoseAdapter}
 */
export function createMediaPipePoseAdapterFromRuntime(loadRuntime, options = {}) {
  const sourceId = options.sourceId ?? mediaPipeLiveSourceId;
  const mirrored = options.mirrored ?? true;
  const delegate = validateDelegate(options.delegate ?? mediaPipeDelegates.cpuWasm);
  const executionProvider = delegate === mediaPipeDelegates.cpuWasm ? "wasm" : "webgl";
  const modelUrl = options.modelUrl ?? mediaPipeDefaultModelUrl;
  const usesDefaultModelIdentity = modelUrl === mediaPipeDefaultModelUrl
    && options.modelId === undefined
    && options.modelVersion === undefined;
  /** @type {Readonly<import("@aerobeat/web-contracts/pose-adapter").AeroPoseModelIdentity>} */
  const model = usesDefaultModelIdentity
    ? mediaPipeDefaultModel
    : Object.freeze({
      vendorId: mediaPipeVendorId,
      modelId: options.modelId ?? modelUrl,
      ...(options.modelVersion === undefined ? {} : { modelVersion: options.modelVersion }),
      runtimeId: "@mediapipe/tasks-vision",
      runtimeVersion: mediaPipePackageVersion
    });
  const wasmRootUrl = options.wasmRootUrl ?? mediaPipeDefaultWasmRootUrl;
  const modelName = options.modelName
    ?? (usesDefaultModelIdentity ? mediaPipeDefaultModelName : model.modelId);
  const modelSha256 = options.modelSha256
    ?? (modelUrl === mediaPipeDefaultModelUrl ? mediaPipeDefaultModelSha256 : "");
  const modelSizeBytes = options.modelSizeBytes
    ?? (modelUrl === mediaPipeDefaultModelUrl ? mediaPipeDefaultModelSizeBytes : 0);
  const now = options.now ?? defaultNow;

  /** @type {"idle" | "loading" | "ready" | "failed" | "disposed"} */
  let status = mediaPipeAdapterStatuses.idle;
  /** @type {PoseLandmarkerLike | undefined} */
  let poseLandmarker;
  /** @type {Promise<void> | undefined} */
  let loading;
  let lastVideoTimestampMs = Number.NEGATIVE_INFINITY;
  /** @type {"cpu-wasm" | "gpu-webgl" | undefined} */
  let actualDelegate;
  /** @type {number | undefined} */
  let loadDurationMs;
  /** @type {number | undefined} */
  let lastInferenceDurationMs;
  let disposed = false;
  /** @type {string | undefined} */
  let lastError;

  const executionStatus = Object.freeze({
    mode: /** @type {const} */ ("main-thread"),
    delegate,
    detail: delegate === mediaPipeDelegates.cpuWasm
      ? "MediaPipe Tasks Vision CPU delegate via synchronous WASM"
      : "MediaPipe Tasks Vision GPU delegate via synchronous WebGL"
  });

  return {
    vendorId: mediaPipeVendorId,
    model,
    get status() {
      return status;
    },
    capabilities: mediaPipeCapabilities,
    getExecutionTelemetry() {
      return {
        location: "main-thread",
        provider: actualDelegate ? executionProvider : undefined,
        detail: lastError ?? executionStatus.detail,
        fallback: false,
        loadDurationMs,
        estimateDurationMs: lastInferenceDurationMs
      };
    },
    getExecutionStatus() {
      return executionStatus;
    },
    getTelemetryStatus() {
      return {
        vendorId: mediaPipeVendorId,
        provider: "@mediapipe/tasks-vision",
        packageVersion: mediaPipePackageVersion,
        model: modelName,
        modelId: model.modelId,
        modelVersion: model.modelVersion,
        modelUrl,
        modelSha256,
        modelSizeBytes,
        wasmRootUrl,
        selectedDelegate: delegate,
        actualDelegate,
        loadState: status,
        fallback: false,
        disposed,
        loadDurationMs,
        lastInferenceDurationMs,
        confidenceSemantics: "MediaPipe landmark visibility (presence fallback), vendor-specific and uncalibrated",
        error: lastError
      };
    },
    async load() {
      if (status === mediaPipeAdapterStatuses.ready) {
        return;
      }
      if (loading) {
        return loading;
      }
      disposed = false;
      lastError = undefined;
      actualDelegate = undefined;
      loadDurationMs = undefined;
      const loadStartedAtMs = now();
      status = mediaPipeAdapterStatuses.loading;
      loading = (async () => {
        try {
          const runtime = await loadRuntime();
          const visionFiles = await runtime.resolveVisionFiles(wasmRootUrl);
          poseLandmarker = await runtime.createPoseLandmarker(visionFiles, {
            baseOptions: {
              modelAssetPath: modelUrl,
              delegate: delegate === mediaPipeDelegates.cpuWasm ? "CPU" : "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1,
            outputSegmentationMasks: false
          });
          actualDelegate = delegate;
          status = mediaPipeAdapterStatuses.ready;
        } catch (error) {
          status = mediaPipeAdapterStatuses.failed;
          lastError = readErrorMessage(error);
          throw error;
        } finally {
          loadDurationMs = Math.max(0, now() - loadStartedAtMs);
          loading = undefined;
        }
      })();
      return loading;
    },
    async estimateNormalizedPoseFrame(frameSource, estimateOptions = {}) {
      if (!frameSource) {
        throw new Error("MediaPipe pose estimation requires a browser frame source.");
      }
      if (status !== mediaPipeAdapterStatuses.ready) {
        await this.load();
      }
      if (!poseLandmarker) {
        status = mediaPipeAdapterStatuses.failed;
        lastError = "Pose Landmarker unavailable after load";
        throw new Error(lastError);
      }
      const inferenceTimestampMs = nextMonotonicTimestamp(now(), lastVideoTimestampMs);
      lastVideoTimestampMs = inferenceTimestampMs;
      const startedAtMs = now();
      try {
        const result = poseLandmarker.detectForVideo(frameSource, inferenceTimestampMs);
        return normalizeMediaPipePoseFrame(result, {
          currentTime: readMediaCurrentTime(frameSource)
        }, {
          sourceId: estimateOptions.sourceId ?? sourceId,
          timestampMs: estimateOptions.timestampMs,
          mirrored: estimateOptions.mirrored ?? mirrored,
          now
        });
      } catch (error) {
        status = mediaPipeAdapterStatuses.failed;
        lastError = readErrorMessage(error);
        throw error;
      } finally {
        lastInferenceDurationMs = Math.max(0, now() - startedAtMs);
      }
    },
    dispose() {
      poseLandmarker?.close();
      poseLandmarker = undefined;
      loading = undefined;
      lastVideoTimestampMs = Number.NEGATIVE_INFINITY;
      actualDelegate = undefined;
      loadDurationMs = undefined;
      lastInferenceDurationMs = undefined;
      lastError = undefined;
      disposed = true;
      status = mediaPipeAdapterStatuses.disposed;
    }
  };
}

/**
 * @returns {MediaPipeReplayPoseSource}
 */
export function createMediaPipeReplayPoseSource() {
  return {
    sourceKind: "replay-fixture",
    sourceId: mediaPipeReplayFixtureId,
    frames: [
      createReplayFrame(0, 0),
      createReplayFrame(500, 0.04),
      createReplayFrame(1000, -0.03)
    ]
  };
}

/**
 * @param {{ source?: MediaPipeReplayPoseSource }} [options]
 * @returns {MediaPipePoseAdapter}
 */
export function createMediaPipeMockPoseAdapter(options = {}) {
  const source = options.source ?? createMediaPipeReplayPoseSource();
  let cursor = 0;
  /** @type {"idle" | "loading" | "ready" | "failed" | "disposed"} */
  let status = mediaPipeAdapterStatuses.idle;
  let disposed = false;

  return {
    vendorId: mediaPipeVendorId,
    model: mediaPipeReplayModel,
    get status() {
      return status;
    },
    capabilities: mediaPipeReplayCapabilities,
    getExecutionTelemetry() {
      return {
        location: "unknown",
        provider: "replay",
        detail: "deterministic normalized MediaPipe replay",
        fallback: false,
        loadDurationMs: 0,
        estimateDurationMs: 0
      };
    },
    getExecutionStatus() {
      return {
        mode: "replay",
        delegate: "replay",
        detail: "deterministic normalized MediaPipe replay"
      };
    },
    getTelemetryStatus() {
      return {
        vendorId: mediaPipeVendorId,
        provider: "replay",
        packageVersion: mediaPipePackageVersion,
        model: "MediaPipe deterministic replay",
        modelId: mediaPipeReplayModel.modelId,
        modelVersion: mediaPipeReplayModel.modelVersion,
        modelUrl: "",
        modelSha256: "",
        modelSizeBytes: 0,
        wasmRootUrl: "",
        selectedDelegate: "replay",
        actualDelegate: "replay",
        loadState: status,
        fallback: false,
        disposed,
        loadDurationMs: 0,
        lastInferenceDurationMs: 0,
        confidenceSemantics: "fixture values only",
        error: undefined
      };
    },
    async load() {
      disposed = false;
      status = mediaPipeAdapterStatuses.ready;
    },
    async estimateNormalizedPoseFrame() {
      if (status !== mediaPipeAdapterStatuses.ready) {
        await this.load();
      }
      const frame = source.frames[cursor % source.frames.length];
      cursor += 1;
      return clonePoseFrame(frame);
    },
    dispose() {
      disposed = true;
      status = mediaPipeAdapterStatuses.disposed;
      cursor = 0;
    }
  };
}

/**
 * @returns {Promise<MediaPipeRuntime>}
 */
async function loadDefaultMediaPipeRuntime() {
  const tasksVision = await import("@mediapipe/tasks-vision");
  return {
    resolveVisionFiles: (wasmRootUrl) => tasksVision.FilesetResolver.forVisionTasks(wasmRootUrl),
    async createPoseLandmarker(visionFiles, options) {
      const files = /** @type {Awaited<ReturnType<typeof tasksVision.FilesetResolver.forVisionTasks>>} */ (visionFiles);
      const task = await tasksVision.PoseLandmarker.createFromOptions(files, options);
      return {
        detectForVideo(frameSource, timestampMs) {
          return task.detectForVideo(
            /** @type {HTMLVideoElement} */ (frameSource),
            timestampMs
          );
        },
        close() {
          task.close();
        }
      };
    }
  };
}

/**
 * @param {MediaPipeFrameSource} frameSource
 * @returns {number | undefined}
 */
function readMediaCurrentTime(frameSource) {
  return "currentTime" in frameSource && typeof frameSource.currentTime === "number"
    ? frameSource.currentTime
    : undefined;
}

/**
 * @param {"cpu-wasm" | "gpu-webgl"} delegate
 * @returns {"cpu-wasm" | "gpu-webgl"}
 */
function validateDelegate(delegate) {
  if (delegate !== mediaPipeDelegates.cpuWasm && delegate !== mediaPipeDelegates.gpuWebgl) {
    throw new Error(`Unsupported MediaPipe delegate: ${delegate}`);
  }
  return delegate;
}

/**
 * @param {number} candidate
 * @param {number} previous
 * @returns {number}
 */
function nextMonotonicTimestamp(candidate, previous) {
  const safeCandidate = Number.isFinite(candidate) ? candidate : defaultNow();
  return safeCandidate > previous ? safeCandidate : previous + 0.001;
}

/**
 * @returns {number}
 */
function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "unknown MediaPipe error";
}

/**
 * @param {number} timestampMs
 * @param {number} offset
 * @returns {NormalizedPoseFrame}
 */
function createReplayFrame(timestampMs, offset) {
  return {
    sourceId: mediaPipeReplayFixtureId,
    timestampMs,
    mirrored: true,
    landmarks: [
      createLandmark("nose", 0.5 + offset, 0.2, 0.96),
      createLandmark("left_shoulder", 0.4 + offset, 0.35, 0.94),
      createLandmark("right_shoulder", 0.6 + offset, 0.35, 0.94),
      createLandmark("left_elbow", 0.32 + offset, 0.5, 0.92),
      createLandmark("right_elbow", 0.68 + offset, 0.5, 0.92),
      createLandmark("left_wrist", 0.25 + offset, 0.65, 0.9),
      createLandmark("right_wrist", 0.75 + offset, 0.65, 0.9)
    ]
  };
}

/**
 * @param {string} name
 * @param {number} x
 * @param {number} y
 * @param {number} confidence
 * @returns {{ name: string, x: number, y: number, confidence: number }}
 */
function createLandmark(name, x, y, confidence) {
  return { name, x, y, confidence };
}
