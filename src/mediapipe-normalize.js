// @ts-check

/** @typedef {import("@aerobeat/web-contracts/pose-shapes").NormalizedPoseLandmark} NormalizedLandmark */
/** @typedef {import("@aerobeat/web-contracts/pose-shapes").NormalizedPoseFrame} NormalizedPoseFrame */

/**
 * @typedef {Object} MediaPipeLandmarkLike
 * @property {number} [x] Normalized horizontal coordinate.
 * @property {number} [y] Normalized vertical coordinate.
 * @property {number} [visibility] Landmark visibility diagnostic.
 * @property {number} [presence] Landmark presence diagnostic.
 */

/**
 * @typedef {Object} MediaPipePoseResultLike
 * @property {readonly (readonly MediaPipeLandmarkLike[])[]} [landmarks] Detected normalized landmark sets.
 */

/**
 * @typedef {Object} FrameSourceLike
 * @property {number} [currentTime] Media current time in seconds.
 */

/**
 * @typedef {Object} MediaPipeFrameMetadata
 * @property {string} [sourceId] Output source identifier.
 * @property {number} [timestampMs] Capture/source timestamp in milliseconds.
 * @property {boolean} [mirrored] Display-mirror metadata.
 * @property {() => number} now Monotonic fallback timestamp provider.
 */

/** @type {ReadonlyArray<Readonly<{ index: number, name: string }>>} */
const aeroBeatLandmarks = Object.freeze([
  Object.freeze({ index: 0, name: "nose" }),
  Object.freeze({ index: 11, name: "left_shoulder" }),
  Object.freeze({ index: 12, name: "right_shoulder" }),
  Object.freeze({ index: 13, name: "left_elbow" }),
  Object.freeze({ index: 14, name: "right_elbow" }),
  Object.freeze({ index: 15, name: "left_wrist" }),
  Object.freeze({ index: 16, name: "right_wrist" })
]);

/**
 * Converts MediaPipe Pose Landmarker output into the AeroBeat seven-landmark
 * structural frame. No MediaPipe result object crosses this function boundary.
 *
 * @param {MediaPipePoseResultLike | undefined} result Raw MediaPipe result.
 * @param {FrameSourceLike} frameSource Source passed to inference.
 * @param {MediaPipeFrameMetadata} metadata Output metadata.
 * @returns {NormalizedPoseFrame}
 */
export function normalizeMediaPipePoseFrame(result, frameSource, metadata) {
  const pose = result?.landmarks?.[0];
  const timestampMs = finiteNumber(metadata.timestampMs)
    ?? getMediaTimestampMs(frameSource)
    ?? finiteNumber(metadata.now())
    ?? Date.now();

  return {
    sourceId: metadata.sourceId ?? "aero.mediapipe.live",
    timestampMs,
    mirrored: metadata.mirrored ?? true,
    landmarks: pose ? normalizeRequiredLandmarks(pose) : []
  };
}

/**
 * @param {NormalizedPoseFrame} frame
 * @returns {NormalizedPoseFrame}
 */
export function clonePoseFrame(frame) {
  return {
    sourceId: frame.sourceId,
    timestampMs: frame.timestampMs,
    mirrored: frame.mirrored,
    landmarks: frame.landmarks.map((landmark) => ({ ...landmark }))
  };
}

/**
 * @param {readonly MediaPipeLandmarkLike[]} pose
 * @returns {NormalizedLandmark[]}
 */
function normalizeRequiredLandmarks(pose) {
  /** @type {NormalizedLandmark[]} */
  const normalized = [];
  for (const definition of aeroBeatLandmarks) {
    const landmark = pose[definition.index];
    if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
      continue;
    }
    normalized.push({
      name: definition.name,
      x: clamp01(landmark.x ?? 0),
      y: clamp01(landmark.y ?? 0),
      confidence: clamp01(landmark.visibility ?? landmark.presence ?? 0)
    });
  }
  return normalized;
}

/**
 * @param {FrameSourceLike} frameSource
 * @returns {number | undefined}
 */
function getMediaTimestampMs(frameSource) {
  return typeof frameSource.currentTime === "number" && Number.isFinite(frameSource.currentTime)
    ? frameSource.currentTime * 1000
    : undefined;
}

/**
 * @param {number | undefined} value
 * @returns {number | undefined}
 */
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * @param {number} value
 * @returns {number}
 */
function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
