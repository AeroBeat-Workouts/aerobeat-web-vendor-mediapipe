// @ts-check

/**
 * Classic worker bootstrap for Tasks Vision 1.0.1.
 *
 * This adapter deliberately uses the supported IIFE/classic-loader path. Tasks
 * Vision also supports a module worker when forVisionTasks(path, true) selects
 * its module loader; using the classic loader inside a module worker instead
 * reproduces `ModuleFactory not set.`. Keeping this file import-free lets Vite
 * emit a classic worker while the pinned IIFE supplies `globalThis.Vision`.
 */

/** @type {{ detectForVideo: (frame: TexImageSource, timestampMs: number) => MediaPipePoseResultLike, close: () => void } | undefined} */
let poseLandmarker;
let lastVideoTimestampMs = Number.NEGATIVE_INFINITY;
let disposed = false;

self.onmessage = async (event) => {
  const message = event.data ?? {};
  if (message.type === "load") {
    try {
      const options = message.options;
      const tasksVision = loadTasksVision(options.tasksVisionScriptUrl);
      const visionFiles = await tasksVision.FilesetResolver.forVisionTasks(options.wasmRootUrl);
      const loaded = await tasksVision.PoseLandmarker.createFromOptions(visionFiles, {
        baseOptions: {
          modelAssetPath: options.modelUrl,
          delegate: options.delegate === "gpu-webgl" ? "GPU" : "CPU"
        },
        runningMode: "VIDEO",
        numPoses: 1,
        outputSegmentationMasks: false,
        minPoseDetectionConfidence: options.minPoseDetectionConfidence,
        minPosePresenceConfidence: options.minPosePresenceConfidence,
        minTrackingConfidence: options.minTrackingConfidence
      });
      if (disposed) {
        loaded.close();
        return;
      }
      poseLandmarker = loaded;
      self.postMessage({ type: "loaded", actualDelegate: options.delegate });
    } catch (error) {
      self.postMessage({ type: "error", error: readError(error) });
    }
    return;
  }
  if (message.type === "estimate") {
    const frameSource = message.frameSource;
    if (!poseLandmarker || disposed) {
      closeFrame(frameSource);
      self.postMessage({ type: "error", requestId: message.requestId, error: "MediaPipe worker task is unavailable" });
      return;
    }
    const startedAtMs = now();
    let runtimeFinishedAtMs;
    try {
      const inferenceTimestampMs = nextMonotonicTimestamp(now(), lastVideoTimestampMs);
      lastVideoTimestampMs = inferenceTimestampMs;
      const result = poseLandmarker.detectForVideo(frameSource, inferenceTimestampMs);
      runtimeFinishedAtMs = now();
      const frame = normalizePoseFrame(result, message.metadata);
      const finishedAtMs = now();
      self.postMessage({
        type: "result",
        requestId: message.requestId,
        frame,
        runtimeInferenceDurationMs: Math.max(0, runtimeFinishedAtMs - startedAtMs),
        postprocessDurationMs: Math.max(0, finishedAtMs - runtimeFinishedAtMs)
      });
    } catch (error) {
      self.postMessage({ type: "error", requestId: message.requestId, error: readError(error) });
    } finally {
      closeFrame(frameSource);
    }
    return;
  }
  if (message.type === "dispose") {
    if (!disposed) {
      disposed = true;
      poseLandmarker?.close();
      poseLandmarker = undefined;
      lastVideoTimestampMs = Number.NEGATIVE_INFINITY;
    }
    self.postMessage({ type: "disposed" });
    self.close();
  }
};

/**
 * @param {string} scriptUrl
 * @returns {{ FilesetResolver: { forVisionTasks: (wasmRootUrl: string) => Promise<unknown> }, PoseLandmarker: { createFromOptions: (visionFiles: unknown, options: unknown) => Promise<{ detectForVideo: (frame: TexImageSource, timestampMs: number) => MediaPipePoseResultLike, close: () => void }> } }}
 */
function loadTasksVision(scriptUrl) {
  if (!Reflect.get(globalThis, "Vision")) {
    const importWorkerScripts = Reflect.get(globalThis, "importScripts");
    if (typeof importWorkerScripts !== "function") {
      throw new Error("MediaPipe Tasks Vision 1.0.1 requires classic-worker importScripts support");
    }
    importWorkerScripts(scriptUrl);
  }
  const tasksVision = Reflect.get(globalThis, "Vision");
  if (!tasksVision?.FilesetResolver || !tasksVision?.PoseLandmarker) {
    throw new Error("MediaPipe Tasks Vision classic-worker bundle did not expose Vision");
  }
  return tasksVision;
}

/** @type {ReadonlyArray<Readonly<{ index: number, name: string }>>} */
const requiredLandmarks = Object.freeze([
  Object.freeze({ index: 0, name: "nose" }),
  Object.freeze({ index: 11, name: "left_shoulder" }),
  Object.freeze({ index: 12, name: "right_shoulder" }),
  Object.freeze({ index: 13, name: "left_elbow" }),
  Object.freeze({ index: 14, name: "right_elbow" }),
  Object.freeze({ index: 15, name: "left_wrist" }),
  Object.freeze({ index: 16, name: "right_wrist" })
]);

/**
 * @typedef {{ x?: number, y?: number, visibility?: number, presence?: number }} MediaPipeLandmarkLike
 * @typedef {{ landmarks?: readonly (readonly MediaPipeLandmarkLike[])[] }} MediaPipePoseResultLike
 */

/** @param {MediaPipePoseResultLike | undefined} result @param {{ sourceId?: string, timestampMs: number, mirrored?: boolean }} metadata */
function normalizePoseFrame(result, metadata) {
  const pose = result?.landmarks?.[0];
  const landmarks = [];
  if (pose) {
    for (const definition of requiredLandmarks) {
      const landmark = pose[definition.index];
      if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) continue;
      landmarks.push({
        name: definition.name,
        x: clamp01(landmark.x ?? 0),
        y: clamp01(landmark.y ?? 0),
        confidence: clamp01(landmark.visibility ?? landmark.presence ?? 0)
      });
    }
  }
  return {
    sourceId: metadata.sourceId ?? "aero.mediapipe.live",
    timestampMs: metadata.timestampMs,
    mirrored: metadata.mirrored ?? true,
    landmarks
  };
}

/** @param {number} candidate @param {number} previous */
function nextMonotonicTimestamp(candidate, previous) {
  const finiteCandidate = Number.isFinite(candidate) ? candidate : 0;
  return finiteCandidate > previous ? finiteCandidate : previous + 0.001;
}

/** @param {unknown} frame */
function closeFrame(frame) {
  if (frame && typeof frame === "object" && "close" in frame) {
    const close = frame.close;
    if (typeof close === "function") close.call(frame);
  }
}

/** @param {unknown} error */
function readError(error) { return error instanceof Error ? error.message : String(error); }
/** @param {number} value */
function clamp01(value) { return Math.min(1, Math.max(0, value)); }
function now() { return globalThis.performance?.now?.() ?? Date.now(); }
