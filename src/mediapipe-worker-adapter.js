// @ts-check

import {
  mediaPipeAdapterStatuses,
  mediaPipeDefaultModel,
  mediaPipeDefaultModelName,
  mediaPipeDefaultModelSha256,
  mediaPipeDefaultModelSizeBytes,
  mediaPipeDefaultModelUrl,
  mediaPipeDefaultWasmRootUrl,
  mediaPipeDelegates,
  mediaPipeLiveSourceId,
  mediaPipePackageVersion,
  mediaPipeVendorId
} from "./mediapipe-adapter.js";

export const mediaPipeDefaultWorkerTasksVisionScriptUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.js";

export const mediaPipeWorkerCapabilities = Object.freeze({
  supportsMainThread: false,
  supportsWorker: true,
  supportsMirroring: true,
  supportsFrameSizeOverride: false,
  executionProviders: Object.freeze(["wasm", "webgl"]),
  delegates: Object.freeze([mediaPipeDelegates.cpuWasm, mediaPipeDelegates.gpuWebgl]),
  runningMode: "VIDEO",
  numPoses: 1,
  segmentationMasks: false,
  synchronousInference: false,
  workerInference: true,
  transferableFrameTypes: Object.freeze(["ImageBitmap"]),
  normalizedLandmarkNames: Object.freeze([
    "nose", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist"
  ])
});

/**
 * @typedef {Object} WorkerLike
 * @property {((event: MessageEvent) => void) | null} onmessage
 * @property {((event: ErrorEvent) => void) | null} onerror
 * @property {(message: unknown, transfer?: Transferable[]) => void} postMessage
 * @property {() => void} terminate
 */

/**
 * @typedef {Object} MediaPipeWorkerAdapterOptions
 * @property {string} [sourceId]
 * @property {boolean} [mirrored]
 * @property {"cpu-wasm" | "gpu-webgl"} [delegate]
 * @property {string} [modelUrl]
 * @property {string} [modelId]
 * @property {string} [modelVersion]
 * @property {string} [wasmRootUrl]
 * @property {string} [modelName]
 * @property {string} [modelSha256]
 * @property {number} [modelSizeBytes]
 * @property {number} [minPoseDetectionConfidence]
 * @property {number} [minPosePresenceConfidence]
 * @property {number} [minTrackingConfidence]
 * @property {() => number} [now]
 * @property {(url: URL, options: WorkerOptions) => WorkerLike} [workerFactory]
 * @property {URL} [workerUrl]
 * @property {string} [tasksVisionScriptUrl] Pinned classic-worker bundle URL; injectable for self-hosting/tests.
 */

/**
 * Creates an experimental real Worker adapter. The caller owns latest-frame
 * replacement; this adapter deliberately permits only one accepted request.
 *
 * @param {MediaPipeWorkerAdapterOptions} [options]
 */
export function createMediaPipeWorkerPoseAdapter(options = {}) {
  const sourceId = options.sourceId ?? mediaPipeLiveSourceId;
  const mirrored = options.mirrored ?? true;
  const delegate = validateDelegate(options.delegate ?? mediaPipeDelegates.cpuWasm);
  const executionProvider = delegate === mediaPipeDelegates.cpuWasm ? "wasm" : "webgl";
  const modelUrl = options.modelUrl ?? mediaPipeDefaultModelUrl;
  const usesDefaultModel = modelUrl === mediaPipeDefaultModelUrl
    && options.modelId === undefined && options.modelVersion === undefined;
  const model = usesDefaultModel ? mediaPipeDefaultModel : Object.freeze({
    vendorId: mediaPipeVendorId,
    modelId: options.modelId ?? modelUrl,
    ...(options.modelVersion === undefined ? {} : { modelVersion: options.modelVersion }),
    runtimeId: "@mediapipe/tasks-vision",
    runtimeVersion: mediaPipePackageVersion
  });
  const wasmRootUrl = options.wasmRootUrl ?? mediaPipeDefaultWasmRootUrl;
  const modelName = options.modelName ?? (usesDefaultModel ? mediaPipeDefaultModelName : model.modelId);
  const modelSha256 = options.modelSha256 ?? (modelUrl === mediaPipeDefaultModelUrl ? mediaPipeDefaultModelSha256 : "");
  const modelSizeBytes = options.modelSizeBytes ?? (modelUrl === mediaPipeDefaultModelUrl ? mediaPipeDefaultModelSizeBytes : 0);
  const minPoseDetectionConfidence = validateThreshold(options.minPoseDetectionConfidence ?? 0.5, "minPoseDetectionConfidence");
  const minPosePresenceConfidence = validateThreshold(options.minPosePresenceConfidence ?? 0.5, "minPosePresenceConfidence");
  const minTrackingConfidence = validateThreshold(options.minTrackingConfidence ?? 0.5, "minTrackingConfidence");
  const now = options.now ?? defaultNow;
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  const workerUrl = options.workerUrl ?? new URL("./mediapipe-worker.js", import.meta.url);
  const tasksVisionScriptUrl = options.tasksVisionScriptUrl ?? mediaPipeDefaultWorkerTasksVisionScriptUrl;

  /** @type {WorkerLike | undefined} */
  let worker;
  /** @type {"idle" | "loading" | "ready" | "failed" | "disposed"} */
  let status = mediaPipeAdapterStatuses.idle;
  let disposed = false;
  let terminated = false;
  let requestId = 0;
  let generation = 0;
  let estimatePreparing = false;
  /** @type {Promise<void> | undefined} */
  let loading;
  /** @type {{ id: number, generation: number, startedAtMs: number, resolve: (frame: import("@aerobeat/web-contracts/pose-shapes").NormalizedPoseFrame) => void, reject: (error: Error) => void } | undefined} */
  let activeEstimate;
  /** @type {{ resolve: () => void, reject: (error: Error) => void } | undefined} */
  let loadResolver;
  /** @type {Promise<void> | undefined} */
  let disposing;
  /** @type {(() => void) | undefined} */
  let disposeResolver;
  /** @type {number | undefined} */
  let disposeTimeoutHandle;
  /** @type {"cpu-wasm" | "gpu-webgl" | undefined} */
  let actualDelegate;
  /** @type {number | undefined} */
  let loadDurationMs;
  /** @type {number | undefined} */
  let estimateDurationMs;
  /** @type {number | undefined} */
  let runtimeInferenceDurationMs;
  /** @type {number | undefined} */
  let postprocessDurationMs;
  /** @type {number | undefined} */
  let workerRoundTripDurationMs;
  /** @type {string | undefined} */
  let lastError;

  const detail = `MediaPipe Tasks Vision ${delegate === mediaPipeDelegates.cpuWasm ? "CPU/WASM" : "GPU/WebGL"} in dedicated classic worker / thresholds detection ${minPoseDetectionConfidence} presence ${minPosePresenceConfidence} tracking ${minTrackingConfidence}`;

  const adapter = {
    vendorId: mediaPipeVendorId,
    model,
    get status() { return status; },
    capabilities: mediaPipeWorkerCapabilities,
    getExecutionTelemetry() {
      return {
        location: /** @type {const} */ ("worker"),
        provider: actualDelegate ? executionProvider : undefined,
        detail: lastError ?? detail,
        fallback: false,
        loadDurationMs,
        estimateDurationMs,
        runtimeInferenceDurationMs,
        postprocessDurationMs,
        workerRoundTripDurationMs
      };
    },
    getExecutionStatus() {
      return { mode: /** @type {const} */ ("worker"), delegate, detail };
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
        tasksVisionScriptUrl,
        selectedDelegate: delegate,
        actualDelegate,
        loadState: status,
        fallback: false,
        disposed,
        loadDurationMs,
        lastInferenceDurationMs: estimateDurationMs,
        runtimeInferenceDurationMs,
        postprocessDurationMs,
        workerRoundTripDurationMs,
        minPoseDetectionConfidence,
        minPosePresenceConfidence,
        minTrackingConfidence,
        confidenceSemantics: "MediaPipe landmark visibility (presence fallback), vendor-specific and uncalibrated",
        error: lastError
      };
    },
    async load() {
      if (disposed) throw new Error("Disposed MediaPipe worker adapter cannot be loaded.");
      if (status === mediaPipeAdapterStatuses.failed) throw new Error(lastError ?? "MediaPipe worker adapter failed to load.");
      if (status === mediaPipeAdapterStatuses.ready) return;
      if (loading) return loading;
      status = mediaPipeAdapterStatuses.loading;
      lastError = undefined;
      actualDelegate = undefined;
      const startedAtMs = now();
      try {
        worker = workerFactory(workerUrl, { name: "aerobeat-mediapipe" });
        worker.onmessage = handleMessage;
        worker.onerror = handleWorkerError;
        loading = new Promise((resolve, reject) => { loadResolver = { resolve, reject }; });
        worker.postMessage({
          type: "load",
          options: {
            tasksVisionScriptUrl,
            wasmRootUrl,
            modelUrl,
            delegate,
            minPoseDetectionConfidence,
            minPosePresenceConfidence,
            minTrackingConfidence
          }
        });
        await loading;
        if (disposed) throw new Error("MediaPipe worker adapter was disposed while loading.");
        loadDurationMs = Math.max(0, now() - startedAtMs);
      } catch (error) {
        if (!disposed) fail(readError(error));
        terminateWorker();
        throw error;
      } finally {
        loading = undefined;
        loadResolver = undefined;
      }
    },
    async estimateNormalizedPoseFrame(frameSource, estimateOptions = {}) {
      if (disposed) throw new Error("Disposed MediaPipe worker adapter cannot estimate pose.");
      if (!frameSource) throw new Error("MediaPipe worker estimation requires an ImageBitmap frame source.");
      if (!Number.isFinite(estimateOptions.timestampMs)) {
        closeFrame(frameSource);
        throw new Error("MediaPipe worker estimation requires the exact capture timestampMs.");
      }
      if (estimatePreparing || activeEstimate) {
        closeFrame(frameSource);
        throw new Error("MediaPipe worker adapter accepts only one loading or in-flight estimate.");
      }
      estimatePreparing = true;
      let transferred = false;
      try {
        if (status !== mediaPipeAdapterStatuses.ready) await adapter.load();
        if (!worker || status !== mediaPipeAdapterStatuses.ready) {
          throw new Error("MediaPipe worker unavailable after load.");
        }
        const id = ++requestId;
        const acceptedGeneration = generation;
        const startedAtMs = now();
        const promise = new Promise((resolve, reject) => {
          activeEstimate = { id, generation: acceptedGeneration, startedAtMs, resolve, reject };
        });
        worker.postMessage({
          type: "estimate",
          requestId: id,
          frameSource,
          metadata: {
            sourceId: estimateOptions.sourceId ?? sourceId,
            timestampMs: estimateOptions.timestampMs,
            mirrored: estimateOptions.mirrored ?? mirrored
          }
        }, [/** @type {Transferable} */ (frameSource)]);
        transferred = true;
        return promise;
      } catch (error) {
        activeEstimate = undefined;
        if (!transferred) closeFrame(frameSource);
        throw error;
      } finally {
        estimatePreparing = false;
      }
    },
    async dispose() {
      if (disposing) return disposing;
      if (disposed) return;
      disposed = true;
      generation += 1;
      status = mediaPipeAdapterStatuses.disposed;
      actualDelegate = undefined;
      loadResolver?.reject(new Error("MediaPipe worker adapter disposed during load."));
      activeEstimate?.reject(new Error("MediaPipe worker adapter disposed during inference."));
      activeEstimate = undefined;
      if (!worker) return;
      disposing = new Promise((resolve) => { disposeResolver = resolve; });
      disposeTimeoutHandle = globalThis.setTimeout(finishDisposal, 5000);
      try {
        worker.postMessage({ type: "dispose" });
      } catch {
        finishDisposal();
      }
      return disposing;
    }
  };
  return adapter;

  /** @param {MessageEvent} event */
  function handleMessage(event) {
    const message = event.data ?? {};
    if (message.type === "loaded") {
      if (disposed) return;
      actualDelegate = message.actualDelegate;
      status = mediaPipeAdapterStatuses.ready;
      loadResolver?.resolve();
      return;
    }
    if (message.type === "result") {
      const request = activeEstimate;
      if (!request || request.id !== message.requestId) return;
      activeEstimate = undefined;
      if (disposed || request.generation !== generation) return;
      workerRoundTripDurationMs = Math.max(0, now() - request.startedAtMs);
      runtimeInferenceDurationMs = message.runtimeInferenceDurationMs;
      postprocessDurationMs = message.postprocessDurationMs;
      estimateDurationMs = workerRoundTripDurationMs;
      request.resolve(message.frame);
      return;
    }
    if (message.type === "error") {
      const error = new Error(message.error ?? "MediaPipe worker failed");
      if (message.requestId && activeEstimate?.id === message.requestId) {
        const request = activeEstimate;
        activeEstimate = undefined;
        if (!disposed) fail(error.message);
        request.reject(error);
      } else {
        loadResolver?.reject(error);
        if (!disposed) fail(error.message);
      }
      if (!disposed) terminateWorker();
      return;
    }
    if (message.type === "disposed") finishDisposal();
  }

  /** @param {ErrorEvent} event */
  function handleWorkerError(event) {
    const error = new Error(event.message || "MediaPipe worker error");
    loadResolver?.reject(error);
    activeEstimate?.reject(error);
    activeEstimate = undefined;
    if (!disposed) fail(error.message);
    terminateWorker();
    disposeResolver?.();
    disposeResolver = undefined;
  }

  /** @param {string} message */
  function fail(message) {
    status = mediaPipeAdapterStatuses.failed;
    lastError = message;
    actualDelegate = undefined;
  }

  function finishDisposal() {
    if (disposeTimeoutHandle !== undefined) {
      globalThis.clearTimeout(disposeTimeoutHandle);
      disposeTimeoutHandle = undefined;
    }
    terminateWorker();
    disposeResolver?.();
    disposeResolver = undefined;
  }

  function terminateWorker() {
    if (terminated) return;
    terminated = true;
    worker?.terminate();
    worker = undefined;
  }
}

/** @param {URL} url @param {WorkerOptions} options @returns {WorkerLike} */
function defaultWorkerFactory(url, options) {
  return /** @type {WorkerLike} */ (new Worker(url, options));
}

/** @param {unknown} frame */
function closeFrame(frame) {
  if (frame && typeof frame === "object" && "close" in frame && typeof frame.close === "function") frame.close();
}

/** @param {unknown} error */
function readError(error) { return error instanceof Error ? error.message : String(error); }

/** @param {"cpu-wasm" | "gpu-webgl"} delegate */
function validateDelegate(delegate) {
  if (delegate !== mediaPipeDelegates.cpuWasm && delegate !== mediaPipeDelegates.gpuWebgl) throw new Error(`Unsupported MediaPipe delegate: ${delegate}`);
  return delegate;
}

/** @param {number} value @param {string} name */
function validateThreshold(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be a finite number in [0,1]`);
  return value;
}

function defaultNow() { return globalThis.performance?.now?.() ?? Date.now(); }
