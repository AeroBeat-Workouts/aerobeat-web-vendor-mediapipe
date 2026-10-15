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

/**
 * @type {{
 *   detectForVideo: (
 *     frame: TexImageSource,
 *     timestampMs: number,
 *     imageProcessingOptions?: { IMAGE_DIMENSIONS: { height: number, width: number } }
 *   ) => MediaPipePoseResultLike,
 *   close: () => void
 * } | undefined}
 */
let poseLandmarker;
let lastVideoTimestampMs = Number.NEGATIVE_INFINITY;
let disposed = false;
/** @type {AbortController | undefined} */
let modelDownloadAbort;
/** @type {(() => Promise<void>) | undefined} */
let cancelModelDownload;

// Drop the four known MediaPipe WASM internal log lines in the worker
// console. This file is deliberately import-free (classic worker), so the
// install is the self-contained mirror of `wasm-console-filter.js`: same
// frozen signatures, idempotent single global wrap, everything else passes
// through untouched.
installWorkerWasmConsoleFilter();

self.onmessage = async (event) => {
  const message = event.data ?? {};
  if (message.type === "load") {
    /** @type {typeof poseLandmarker} */
    let loaded;
    try {
      const options = message.options;
      const tasksVision = loadTasksVision(options.tasksVisionScriptUrl);
      if (disposed) return;
      const streaming = options.streamModelDownload === true && options.delegate === "cpu-wasm";
      // Start the single model GET after Vision import. Only headers gate the
      // resolver; MediaPipe consumes the reader while initializing WASM.
      const download = streaming ? await startModelDownload(options) : undefined;
      if (disposed) return;
      const visionFiles = await tasksVision.FilesetResolver.forVisionTasks(options.wasmRootUrl);
      if (disposed) return;
      loaded = await tasksVision.PoseLandmarker.createFromOptions(visionFiles, {
        baseOptions: streaming
          ? { modelAssetBuffer: download.reader, delegate: "CPU" }
          : { modelAssetPath: options.modelUrl, delegate: options.delegate === "gpu-webgl" ? "GPU" : "CPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        outputSegmentationMasks: false,
        minPoseDetectionConfidence: options.minPoseDetectionConfidence,
        minPosePresenceConfidence: options.minPosePresenceConfidence,
        minTrackingConfidence: options.minTrackingConfidence
      });
      if (disposed) return;
      if (download) await download.integrity;
      if (disposed) return;
      poseLandmarker = loaded;
      loaded = undefined;
      self.postMessage({ type: "loaded", actualDelegate: options.delegate });
    } catch (error) {
      loaded?.close();
      loaded = undefined;
      modelDownloadAbort?.abort();
      // A reader may still be pending when MediaPipe rejects construction.
      // Cancel without waiting before reporting the failed load.
      void cancelModelDownload?.();
      if (!disposed) self.postMessage({ type: "error", error: readError(error) });
    } finally {
      if (!poseLandmarker) modelDownloadAbort?.abort();
      cancelModelDownload = undefined;
      modelDownloadAbort = undefined;
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
      const imageProcessingOptions = imageDimensionsForFrame(frameSource);
      const result = imageProcessingOptions === undefined
        ? poseLandmarker.detectForVideo(frameSource, inferenceTimestampMs)
        : poseLandmarker.detectForVideo(frameSource, inferenceTimestampMs, imageProcessingOptions);
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
      modelDownloadAbort?.abort();
      void cancelModelDownload?.();
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

/**
 * @param {{ modelUrl: string, modelSizeBytes: number, modelSha256: string }} options
 */
async function startModelDownload(options) {
  if (!Number.isSafeInteger(options.modelSizeBytes) || options.modelSizeBytes <= 0 ||
    !/^[a-f\d]{64}$/i.test(options.modelSha256)) throw new Error("Model stream requires pinned SHA-256 and decoded size");
  const url = new URL(options.modelUrl, self.location.href);
  if (url.origin !== self.location.origin || !/^https?:$/.test(url.protocol)) {
    throw new Error("Model stream requires a same-origin HTTP(S) URL");
  }
  const abort = new AbortController();
  modelDownloadAbort = abort;
  const response = await fetch(url.href, { signal: abort.signal });
  if (disposed || abort.signal.aborted) {
    await response.body?.cancel();
    throw new Error("Model download canceled");
  }
  if (!response.ok || !response.body || response.type === "opaque") {
    throw new Error(`Model stream GET failed: ${response.status}`);
  }
  const source = response.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let receivedBytes = 0;
  let settled = false;
  /** @type {(value: void) => void} */
  let resolveIntegrity;
  /** @type {(error: Error) => void} */
  let rejectIntegrity;
  const integrity = new Promise((resolve, reject) => {
    resolveIntegrity = resolve;
    rejectIntegrity = reject;
  });
  // Creation can fail before consuming the reader. Avoid an unhandled rejection.
  void integrity.catch(() => {});
  /** @param {unknown} reason */
  const fail = (reason) => {
    if (settled) return;
    settled = true;
    rejectIntegrity(reason instanceof Error ? reason : new Error(String(reason)));
  };
  cancelModelDownload = async () => {
    abort.abort();
    fail(new Error("Model download canceled"));
    try { await source.cancel(); } catch { /* Already consumed or errored. */ }
  };
  const observed = new ReadableStream({
    async pull(controller) {
      try {
        if (disposed || abort.signal.aborted) throw new Error("Model download canceled");
        const result = await source.read();
        if (disposed || abort.signal.aborted) throw new Error("Model download canceled");
        if (result.done) {
          if (receivedBytes !== options.modelSizeBytes) throw new Error("Decoded model length differs from pinned size");
          const bytes = new Uint8Array(receivedBytes);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
            .map((byte) => byte.toString(16).padStart(2, "0")).join("");
          if (disposed || abort.signal.aborted) throw new Error("Model download canceled");
          if (hash !== options.modelSha256.toLowerCase()) throw new Error("Model SHA-256 mismatch");
          if (!disposed && !abort.signal.aborted) {
            self.postMessage({ type: "model-download-progress", receivedBytes, totalBytes: options.modelSizeBytes, verified: true });
            controller.close();
            settled = true;
            resolveIntegrity();
          } else throw new Error("Model download canceled");
          return;
        }
        const chunk = result.value;
        if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0 ||
          chunk.byteLength > options.modelSizeBytes - receivedBytes) {
          throw new Error("Decoded model length exceeded pinned size or invalid stream chunk");
        }
        receivedBytes += chunk.byteLength;
        chunks.push(chunk);
        self.postMessage({ type: "model-download-progress", receivedBytes, totalBytes: options.modelSizeBytes, verified: false });
        controller.enqueue(chunk);
      } catch (error) {
        fail(error);
        abort.abort();
        controller.error(error);
      }
    },
    async cancel(reason) {
      fail(reason ?? new Error("Model reader canceled"));
      abort.abort();
      await source.cancel(reason);
    }
  }, { highWaterMark: 0 });
  return { reader: observed.getReader(), integrity };
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

/**
 * Passes the actual frame pixel dimensions to the landmarker as
 * `IMAGE_DIMENSIONS: {height, width}` in the `detectForVideo` image
 * processing options, so the "NORM_RECT without IMAGE_DIMENSIONS" warning is
 * fixed at source. The pinned `@mediapipe/tasks-vision@1.0.1`
 * `ImageProcessingOptions` type declares only `regionOfInterest`/
 * `rotationDegrees`; `IMAGE_DIMENSIONS` is the documented MediaPipe
 * side-channel name (later releases type it explicitly) and unknown keys are
 * ignored by the pinned runtime. When no dimensions can be read, nothing is
 * passed so the call shape is unchanged.
 *
 * @param {TexImageSource} frameSource
 * @returns {{ IMAGE_DIMENSIONS: { height: number, width: number } } | undefined}
 */
function imageDimensionsForFrame(frameSource) {
  if (!frameSource || typeof frameSource !== "object") return undefined;
  const width = readFrameDimension(frameSource, "videoWidth", "displayWidth", "width");
  const height = readFrameDimension(frameSource, "videoHeight", "displayHeight", "height");
  if (width === undefined || height === undefined) return undefined;
  return { IMAGE_DIMENSIONS: { height, width } };
}

/** @param {object} source @param {...string} propertyNames @returns {number | undefined} */
function readFrameDimension(source, ...propertyNames) {
  for (const propertyName of propertyNames) {
    const value = Reflect.get(source, propertyName);
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  return undefined;
}

/**
 * @typedef {("log" | "info" | "warn" | "error") & keyof Console} WasmConsoleLevel
 */

/**
 * The four known MediaPipe internal log lines (frozen mirror of
 * `wasm-console-filter.js`). The only drop condition for this filter.
 * The XNNPACK delegate line is matched by its marker-free substring
 * "XNNPACK delegate for CPU." (see `wasm-console-filter.js` for the
 * release-integrity rationale); the full log line still drops.
 * @type {ReadonlyArray<string>}
 */
const wasmConsoleSignatures = Object.freeze([
  "OpenGL error checking is disabled",
  "XNNPACK delegate for CPU.",
  "Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.",
  "Using NORM_RECT without IMAGE_DIMENSIONS is only supported for the square ROI. Provide IMAGE_DIMENSIONS or use PROJECTION_MATRIX."
]);

/** @param {unknown} value @returns {string} */
function stringifyConsoleArgument(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object" || typeof value === "function") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

/** @param {readonly unknown[]} args @returns {boolean} */
function containsWasmSignature(args) {
  for (const argument of args) {
    const text = stringifyConsoleArgument(argument);
    for (const signature of wasmConsoleSignatures) {
      if (text.includes(signature)) return true;
    }
  }
  return false;
}

/**
 * Idempotent single global console wrap in the worker: drops only the four
 * known MediaPipe internal lines, forwards everything else with the same
 * `this` and args.
 */
function installWorkerWasmConsoleFilter() {
  const targetConsole = globalThis.console;
  if (!targetConsole || Object.isFrozen(targetConsole)) return;
  const installedMarker =
    Object.getOwnPropertyDescriptor(targetConsole.log, "__aeroWasmConsoleFilter")?.value;
  if (targetConsole.log && installedMarker === true) return;
  /** @type {ReadonlyArray<"log" | "info" | "warn" | "error">} */
  const levels = Object.freeze(["log", "info", "warn", "error"]);
  for (const level of levels) {
    const original = targetConsole[level];
    if (typeof original !== "function") continue;
    const wrapped = function (...args) {
      if (!containsWasmSignature(args)) return Reflect.apply(original, this, args);
    };
    try {
      Object.defineProperty(targetConsole, level, { configurable: true, enumerable: false, value: wrapped });
      Object.defineProperty(wrapped, "__aeroWasmConsoleFilter", { value: true });
    } catch {
      // Frozen/non-writable console slot: skip that level rather than fail.
    }
  }
}
