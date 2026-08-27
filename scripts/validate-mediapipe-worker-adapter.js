// @ts-check

import assert from "node:assert/strict";
import {
  createMediaPipeWorkerPoseAdapter,
  mediaPipeDefaultWorkerTasksVisionScriptUrl,
  mediaPipeWorkerCapabilities
} from "../src/index.js";

class FakeWorker {
  onmessage = null;
  onerror = null;
  messages = [];
  terminated = 0;

  postMessage(message, transfer = []) {
    this.messages.push({ message, transfer });
  }

  terminate() {
    this.terminated += 1;
  }

  emit(data) {
    this.onmessage?.({ data });
  }
}

class ImageBitmap {
  closed = 0;
  close() { this.closed += 1; }
}

class VideoFrame {
  closed = 0;
  close() { this.closed += 1; }
}

/** @param {"ImageBitmap" | "VideoFrame"} [type] */
function fakeFrame(type = "ImageBitmap") {
  return type === "VideoFrame" ? new VideoFrame() : new ImageBitmap();
}

async function main() {
  assert.equal(mediaPipeWorkerCapabilities.supportsWorker, true);
  assert.equal(mediaPipeWorkerCapabilities.supportsMainThread, false);
  assert.deepEqual(mediaPipeWorkerCapabilities.transferableFrameTypes, ["ImageBitmap", "VideoFrame"]);

  const loadingWorker = new FakeWorker();
  const loadingAdapter = createMediaPipeWorkerPoseAdapter({ workerFactory: () => loadingWorker });
  const firstLoadingFrame = fakeFrame();
  const estimateDuringLoad = loadingAdapter.estimateNormalizedPoseFrame(firstLoadingFrame, { timestampMs: 100 });
  const concurrentLoadingFrame = fakeFrame();
  await assert.rejects(
    loadingAdapter.estimateNormalizedPoseFrame(concurrentLoadingFrame, { timestampMs: 101 }),
    /only one loading or in-flight/
  );
  assert.equal(concurrentLoadingFrame.closed, 1);
  loadingWorker.emit({ type: "error", error: "load rejected" });
  await assert.rejects(estimateDuringLoad, /load rejected/);
  assert.equal(firstLoadingFrame.closed, 1);
  await loadingAdapter.dispose();

  const factoryFailureAdapter = createMediaPipeWorkerPoseAdapter({
    workerFactory() { throw new Error("worker factory rejected"); }
  });
  await assert.rejects(factoryFailureAdapter.load(), /worker factory rejected/);
  assert.equal(factoryFailureAdapter.status, "failed");
  await factoryFailureAdapter.dispose();

  const postFailureWorker = new FakeWorker();
  postFailureWorker.postMessage = () => { throw new Error("load post rejected"); };
  const postFailureAdapter = createMediaPipeWorkerPoseAdapter({ workerFactory: () => postFailureWorker });
  await assert.rejects(postFailureAdapter.load(), /load post rejected/);
  assert.equal(postFailureAdapter.status, "failed");
  assert.equal(postFailureWorker.terminated, 1);
  await postFailureAdapter.dispose();

  let currentTimeMs = 10;
  const worker = new FakeWorker();
  let workerOptions;
  const adapter = createMediaPipeWorkerPoseAdapter({
    delegate: "gpu-webgl",
    now: () => currentTimeMs,
    workerFactory(_url, options) {
      workerOptions = options;
      return worker;
    }
  });

  const loading = adapter.load();
  assert.deepEqual(workerOptions, { name: "aerobeat-mediapipe" });
  assert.equal(worker.messages[0].message.type, "load");
  assert.equal(worker.messages[0].message.options.tasksVisionScriptUrl, mediaPipeDefaultWorkerTasksVisionScriptUrl);
  assert.equal(worker.messages[0].message.options.delegate, "gpu-webgl");
  worker.emit({ type: "loaded", actualDelegate: "gpu-webgl" });
  currentTimeMs = 25;
  await loading;
  assert.equal(adapter.status, "ready");
  assert.equal(adapter.getExecutionTelemetry().location, "worker");
  assert.equal(adapter.getExecutionTelemetry().provider, "webgl");

  const frame = fakeFrame();
  const estimate = adapter.estimateNormalizedPoseFrame(frame, {
    sourceId: "camera.worker",
    timestampMs: 1234,
    mirrored: false
  });
  const estimateMessage = worker.messages.at(-1);
  assert.equal(estimateMessage.message.type, "estimate");
  assert.equal(estimateMessage.message.metadata.timestampMs, 1234);
  assert.equal(estimateMessage.message.transferFrameType, "ImageBitmap");
  assert.deepEqual(estimateMessage.transfer, [frame]);

  const replaced = fakeFrame();
  await assert.rejects(
    adapter.estimateNormalizedPoseFrame(replaced, { timestampMs: 1267 }),
    /only one loading or in-flight/
  );
  assert.equal(replaced.closed, 1);

  currentTimeMs = 40;
  worker.emit({
    type: "result",
    requestId: estimateMessage.message.requestId,
    frame: {
      sourceId: "camera.worker",
      timestampMs: 1234,
      mirrored: false,
      landmarks: [{ name: "nose", x: 0.5, y: 0.25, confidence: 0.9 }]
    },
    runtimeInferenceDurationMs: 12,
    postprocessDurationMs: 1
  });
  const result = await estimate;
  assert.equal(result.timestampMs, 1234);
  assert.equal(adapter.getExecutionTelemetry().workerRoundTripDurationMs, 15);
  assert.equal(adapter.getExecutionTelemetry().runtimeInferenceDurationMs, 12);
  assert.equal(adapter.getExecutionTelemetry().transferFrameType, "ImageBitmap");

  const videoFrame = fakeFrame("VideoFrame");
  const videoEstimate = adapter.estimateNormalizedPoseFrame(videoFrame, { timestampMs: 1250 });
  const videoMessage = worker.messages.at(-1);
  assert.equal(videoMessage.message.metadata.timestampMs, 1250);
  assert.equal(videoMessage.message.transferFrameType, "VideoFrame");
  assert.deepEqual(videoMessage.transfer, [videoFrame]);
  currentTimeMs = 55;
  worker.emit({
    type: "result",
    requestId: videoMessage.message.requestId,
    frame: { sourceId: "camera.worker", timestampMs: 1250, mirrored: true, landmarks: [] },
    runtimeInferenceDurationMs: 10,
    postprocessDurationMs: 0
  });
  await videoEstimate;
  assert.equal(adapter.getExecutionTelemetry().transferFrameType, "VideoFrame");

  const unsupportedFrame = { closed: 0, close() { this.closed += 1; } };
  await assert.rejects(adapter.estimateNormalizedPoseFrame(unsupportedFrame, { timestampMs: 1251 }), /transferable ImageBitmap or VideoFrame/);
  assert.equal(unsupportedFrame.closed, 1);

  const missingTimestampFrame = fakeFrame();
  await assert.rejects(adapter.estimateNormalizedPoseFrame(missingTimestampFrame), /exact capture timestampMs/);
  assert.equal(missingTimestampFrame.closed, 1);

  const disposal = adapter.dispose();
  assert.equal(worker.messages.at(-1).message.type, "dispose");
  worker.emit({ type: "disposed" });
  await disposal;
  assert.equal(worker.terminated, 1);
  await adapter.dispose();
  assert.equal(worker.terminated, 1);
  assert.equal(adapter.status, "disposed");
  await assert.rejects(adapter.load(), /Disposed/);

  const disposingWorker = new FakeWorker();
  const disposingAdapter = createMediaPipeWorkerPoseAdapter({ workerFactory: () => disposingWorker });
  const disposingLoad = disposingAdapter.load();
  disposingWorker.emit({ type: "loaded", actualDelegate: "cpu-wasm" });
  await disposingLoad;
  const disposingFrame = fakeFrame("VideoFrame");
  const disposedEstimate = disposingAdapter.estimateNormalizedPoseFrame(disposingFrame, { timestampMs: 2000 });
  const disposedRequestId = disposingWorker.messages.at(-1).message.requestId;
  const activeDisposal = disposingAdapter.dispose();
  await assert.rejects(disposedEstimate, /disposed during inference/);
  disposingWorker.emit({
    type: "result",
    requestId: disposedRequestId,
    frame: { sourceId: "late", timestampMs: 2000, mirrored: true, landmarks: [] },
    runtimeInferenceDurationMs: 1,
    postprocessDurationMs: 0
  });
  disposingWorker.emit({ type: "disposed" });
  await activeDisposal;
  assert.equal(disposingAdapter.status, "disposed");
  assert.equal(disposingWorker.terminated, 1);

  const failedWorker = new FakeWorker();
  const failedAdapter = createMediaPipeWorkerPoseAdapter({ workerFactory: () => failedWorker });
  const failedLoad = failedAdapter.load();
  failedWorker.emit({ type: "error", error: "ModuleFactory not set." });
  await assert.rejects(failedLoad, /ModuleFactory not set/);
  assert.equal(failedAdapter.status, "failed");
  assert.equal(failedAdapter.getExecutionTelemetry().provider, undefined);
  await assert.rejects(failedAdapter.load(), /ModuleFactory not set/);
  await failedAdapter.dispose();

  console.log("MediaPipe worker adapter validation passed.");
}

await main();
