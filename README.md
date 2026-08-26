# aerobeat-web-vendor-mediapipe

MediaPipe Tasks Vision Pose Landmarker adapter boundary for AeroBeat browser pose detection.

## Responsibility

This repository owns MediaPipe package loading, WASM asset resolution, Pose Landmarker creation, delegate selection, vendor-output normalization, deterministic replay, telemetry, cleanup, tests, and provenance. It does not own camera permissions, frame pacing, latest-frame-wins orchestration, UI, scoring, or assembly wiring.

The package is intentionally vendor-isolated. Public consumers receive normalized AeroBeat frames and plain status objects only—never `PoseLandmarker`, `FilesetResolver`, landmark result objects, masks, or other MediaPipe instances.

## Pinned Runtime And Model

- npm package: `@mediapipe/tasks-vision@1.0.1` (Apache-2.0)
- npm integrity: `sha512-rvRE2FmAZ6ZxKSw7wq+e+jQDpN3t1B/tD2mJz9SmAzb1msoDkd4dMoE4wAh8Z30Um0PQwLiHr9QtomhmXk3aUQ==`
- model: official Pose Landmarker Lite, float16, version `/1/`
- model URL: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
- SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`
- published asset size: `5,777,746` bytes

No model or WASM binary is committed. Both URLs are injectable so assembly/release work can self-host pinned assets after separately verifying the checksum and redistribution posture. A custom model URL gets a truthful generic identity (the URL becomes `modelId` unless an explicit `modelId`/`modelVersion` is supplied); unknown custom checksum/size telemetry is empty/zero rather than inheriting the official model's provenance.

## Public API

`src/index.js` exports:

- `createMediaPipePoseAdapter()` for the real browser runtime.
- `createMediaPipeMockPoseAdapter()` and `createMediaPipeReplayPoseSource()` for deterministic tests and fallback proving flows.
- stable vendor/model/delegate/status constants and plain capabilities.

Every live, mock, and replay adapter literally conforms to the `@aerobeat/web-contracts` `AeroPoseAdapter` boundary and exposes:

- matching `vendorId` and plain `model` identity plus lifecycle `status` (including `disposed`)
- `load()` and `estimateNormalizedPoseFrame()`
- generic `getExecutionTelemetry()` with actual location/provider plus load, end-to-end estimate, MediaPipe runtime, and seven-point postprocess timings
- additive vendor diagnostics through `getExecutionStatus()` and `getTelemetryStatus()`, including the configured detector/presence/tracking thresholds
- immutable capabilities declaring main-thread/worker/mirroring/frame-size support, with live `wasm`/`webgl` providers and replay-only capabilities for deterministic mock frames
- terminal, idempotent `dispose()`; later load/estimate calls reject and live resources close once

Normalized output contains only nose, shoulders, elbows, and wrists, using names `nose`, `left_shoulder`, `right_shoulder`, `left_elbow`, `right_elbow`, `left_wrist`, and `right_wrist`. `sourceId`, source timestamp, and mirror metadata propagate independently of MediaPipe's internal inference timestamp.

## Delegates

- `cpu-wasm` maps to MediaPipe base-options delegate `CPU`.
- `gpu-webgl` maps to delegate `GPU`, which is the public WebGL path in Tasks Vision 1.0.1.

The adapter reports selected and actual delegates distinctly. It does not claim WebGPU support and performs no silent delegate fallback. A failed delegate load is reported as failed so the caller can make an explicit backend decision.

Defaults are `runningMode: "VIDEO"`, `numPoses: 1`, `outputSegmentationMasks: false`, and `0.5` for pose-detection, pose-presence, and tracking confidence. All three confidence thresholds are injectable at creation time, must be finite values in `[0,1]`, reach Pose Landmarker options exactly, and appear in plain telemetry/detail for reproducible tuning. `detectForVideo()` is synchronous on the calling thread. AeroBeat therefore must keep its existing bounded submission cadence; this package does not pretend the call is worker-isolated. Inference timestamps use an injectable monotonic clock and are forced strictly increasing, while output timestamps preserve capture/source truth.

## Confidence Semantics

MediaPipe landmark `visibility` is mapped to AeroBeat's structural `confidence` field (falling back to `presence`, then zero). It is clamped to `[0, 1]`. This is a vendor diagnostic—not a calibrated probability and not directly comparable to MoveNet score or ONNX heatmap confidence. Gameplay/scoring must not use cross-vendor confidence thresholds without a separate calibration decision.

## Validation

```bash
npm install
npm run check
npm test
npm run test:browser
```

Unit validation uses an injected fake runtime and covers exact load options, CPU/GPU delegate telemetry, strictly monotonic video timestamps, seven-landmark normalization, source metadata, failures, deterministic replay, and `close()` during disposal. Browser smoke launches the local mock demo and fails on console warnings/errors; it never imports the real runtime dynamically or downloads the model.

See `docs/decisions/0001-mediapipe-runtime-and-model.md` for provenance, licensing, asset, and runtime-risk detail.
