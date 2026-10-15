// @ts-check
// Exercise the actual classic Worker script under a deterministic Worker-like VM.
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const workerScript = await readFile(new URL("../src/mediapipe-worker.js", import.meta.url), "utf8");
const origin = "https://game.example";
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
const hash = createHash("sha256").update(bytes).digest("hex");
const options = {
  tasksVisionScriptUrl: `${origin}/vision_bundle.js`, wasmRootUrl: `${origin}/wasm`,
  modelUrl: `${origin}/model.task`, delegate: "cpu-wasm", streamModelDownload: true,
  modelSizeBytes: bytes.length, modelSha256: hash,
  minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); }
  throw new Error("Worker did not reach expected state");
}

function scenario({ chunks = [bytes], expectedHash = hash, disposeDuringRead = false, rejectCreation = false, fetchFailure = false, urlMode = false, gpu = false } = {}) {
  const messages = [];
  const calls = { fetch: 0, resolver: 0, create: 0, closed: 0, canceled: 0, sourceRead: 0 };
  let releaseRead;
  let creationOptions;
  const self = {
    location: { href: `${origin}/worker.js`, origin },
    postMessage(message) { messages.push(message); },
    close() {}, onmessage: null
  };
  const Vision = {
    FilesetResolver: {
      async forVisionTasks() { calls.resolver++; return {}; }
    },
    PoseLandmarker: {
      async createFromOptions(_files, supplied) {
        calls.create++;
        creationOptions = supplied;
        if (rejectCreation) throw Error("creation failed");
        if (supplied.baseOptions.modelAssetBuffer) {
          const reader = supplied.baseOptions.modelAssetBuffer;
          while (true) { const result = await reader.read(); if (result.done) break; }
        }
        return { close() { calls.closed++; } };
      }
    }
  };
  const sandbox = {
    self, globalThis: null, console: { log() {}, info() {}, warn() {}, error() {} },
    performance, Date, URL, Uint8Array, ReadableStream, AbortController,
    crypto: webcrypto,
    importScripts() { sandbox.Vision = Vision; },
    async fetch(url, init) {
      calls.fetch++;
      assert.equal(url, `${origin}/model.task`);
      if (fetchFailure) return { ok: false, status: 503, body: null };
      let index = 0;
      return {
        ok: true, status: 200, type: "basic",
        body: new ReadableStream({
          async pull(controller) {
            calls.sourceRead++;
            if (disposeDuringRead && index === 1) await new Promise((resolve) => { releaseRead = resolve; });
            if (init.signal.aborted) { controller.error(Error("aborted")); return; }
            if (index === chunks.length) { controller.close(); return; }
            controller.enqueue(chunks[index++]);
          },
          cancel() { calls.canceled++; }
        }, { highWaterMark: 0 })
      };
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(workerScript, sandbox, { filename: "mediapipe-worker.js" });
  const load = self.onmessage({ data: { type: "load", options: {
    ...options, modelSha256: expectedHash,
    ...(urlMode ? { streamModelDownload: false } : {}),
    ...(gpu ? { delegate: "gpu-webgl" } : {})
  } } });
  return { self, load, messages, calls, get creationOptions() { return creationOptions; }, release() { releaseRead?.(); } };
}

{
  const run = scenario();
  await run.load;
  assert.equal(run.calls.fetch, 1);
  assert.equal(run.calls.resolver, 1);
  assert.equal(run.calls.create, 1);
  assert.equal(run.creationOptions.baseOptions.delegate, "CPU");
  assert.equal(run.creationOptions.baseOptions.modelAssetPath, undefined);
  assert.equal(run.creationOptions.baseOptions.modelAssetBuffer.constructor.name, "ReadableStreamDefaultReader");
  assert.deepEqual(run.messages.filter((message) => message.type === "model-download-progress").map(({ receivedBytes, verified }) => [receivedBytes, verified]), [[6, false], [6, true]]);
  assert.equal(run.messages.at(-1).type, "loaded");
  await run.self.onmessage({ data: { type: "dispose" } });
  assert.equal(run.calls.closed, 1);
}
for (const variation of [
  { chunks: [bytes.subarray(0, 3)] },
  { chunks: [new Uint8Array([...bytes, 7])] },
  { expectedHash: "0".repeat(64) },
  { fetchFailure: true },
  { rejectCreation: true }
]) {
  const run = scenario(variation);
  await run.load;
  assert.equal(run.messages.some((message) => message.type === "loaded"), false);
  assert.equal(run.messages.some((message) => message.type === "error"), true);
  assert.equal(run.calls.fetch, 1);
  assert.equal(run.calls.closed, 0);
}
{
  const run = scenario({ chunks: [bytes.subarray(0, 2), bytes.subarray(2)], disposeDuringRead: true });
  await waitFor(() => run.calls.sourceRead === 2);
  await run.self.onmessage({ data: { type: "dispose" } });
  run.release();
  await run.load;
  assert.equal(run.messages.some((message) => message.type === "loaded"), false);
  assert.equal(run.messages.some((message) => message.type === "disposed"), true);
}
for (const variant of [{ urlMode: true }, { gpu: true }]) {
  const run = scenario(variant);
  await run.load;
  assert.equal(run.calls.fetch, 0);
  assert.equal(run.creationOptions.baseOptions.modelAssetPath, options.modelUrl);
  assert.equal(run.messages.some((message) => message.type === "model-download-progress"), false);
  assert.equal(run.messages.at(-1).type, "loaded");
}
console.log("MediaPipe classic Worker model stream validation passed.");
