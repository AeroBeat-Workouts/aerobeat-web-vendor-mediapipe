# MediaPipe Runtime And Model Decision

**Date:** 2026-08-26
**Status:** Accepted for evaluation

## Selection

AeroBeat evaluates `@mediapipe/tasks-vision@1.0.1` with the official Pose Landmarker Lite float16 version `/1/` task asset. The adapter fixes VIDEO mode, one pose, and segmentation masks off. CPU-WASM and GPU-WebGL are explicit comparison choices; no automatic fallback is hidden inside the package.

## Provenance

| Artifact | Source | Version / integrity | License posture |
| --- | --- | --- | --- |
| Tasks Vision npm package | `https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.0.1.tgz` | `1.0.1`; npm integrity `sha512-rvRE2FmAZ6ZxKSw7wq+e+jQDpN3t1B/tD2mJz9SmAzb1msoDkd4dMoE4wAh8Z30Um0PQwLiHr9QtomhmXk3aUQ==` | Apache-2.0 |
| Pose Landmarker Lite task | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` | SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`; 5,777,746 bytes | Official Google MediaPipe model; review model card/terms before redistribution |

The model size and SHA-256 above were verified against a temporary download on 2026-08-26; the downloaded file was removed. Model and WASM assets stay remote/injectable and are not committed. Self-hosted release assets must be fetched separately, checksum-verified, attributed, and approved for redistribution.

## Output Mapping

MediaPipe indices map to AeroBeat names as follows: 0 nose, 11/12 shoulders, 13/14 elbows, and 15/16 wrists. Coordinates are already normalized and are clamped to `[0, 1]`. `visibility` becomes structural confidence; `presence` is only a fallback. These scores remain vendor-specific diagnostics and cannot be compared numerically with MoveNet or ONNX until calibrated.

## Timing And Execution Risks

`PoseLandmarker.detectForVideo()` is synchronous. Both CPU-WASM and GPU-WebGL calls can occupy the calling thread and must be paced by `aerobeat-web-cv`; this package makes no worker claim. A future worker experiment requires explicit transferable-frame and worker/WASM/WebGL validation rather than a label change.

MediaPipe requires monotonically increasing VIDEO timestamps. The adapter uses a monotonic inference clock and increments ties/regressions. Capture/source timestamps remain separate and are propagated unchanged into normalized output.

GPU delegate availability and implementation details vary by browser/device. The adapter reports the configured delegate as actual only after successful creation; it does not silently relabel load failures as CPU success. Physical-phone telemetry is required before recommending either delegate.
