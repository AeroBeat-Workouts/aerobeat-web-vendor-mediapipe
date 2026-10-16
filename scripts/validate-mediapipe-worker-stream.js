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
const pinnedRuntimePairs = Object.freeze({
  vision_wasm_internal: { loader: 323_377, binary: 11_756_954 },
  vision_wasm_module_internal: { loader: 323_415, binary: 11_756_972 },
  vision_wasm_nosimd_internal: { loader: 323_180, binary: 10_960_242 }
});
for (const [stem, { loader, binary }] of Object.entries(pinnedRuntimePairs)) {
  assert.equal((await readFile(new URL(`../node_modules/@mediapipe/tasks-vision/wasm/${stem}.js`, import.meta.url))).byteLength, loader, `${stem} shipped loader size`);
  assert.equal((await readFile(new URL(`../node_modules/@mediapipe/tasks-vision/wasm/${stem}.wasm`, import.meta.url))).byteLength, binary, `${stem} shipped binary size`);
}
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

function scenario({ chunks = [bytes], expectedHash = hash, disposeDuringRead = false, disposeDuringFetch = false, rejectCreation = false, fetchFailure = false, urlMode = false, gpu = false, buffered = false, runtimeVariant = "vision_wasm_internal", unexpectedAsset = false } = {}) {
  const messages = [];
  const calls = { fetch: 0, resolver: 0, create: 0, closed: 0, canceled: 0, sourceRead: 0, events: [] };
  let releaseRead;
  let releaseFetch;
  let creationOptions;
  const self = {
    location: { href: `${origin}/worker.js`, origin },
    postMessage(message) { messages.push(message); },
    close() {}, onmessage: null
  };
  const Vision = {
    FilesetResolver: {
      async forVisionTasks() { calls.resolver++; calls.events.push("resolver"); return {
        wasmLoaderPath: `${origin}/wasm/${runtimeVariant}.js`,
        wasmBinaryPath: `${origin}/wasm/${runtimeVariant}.wasm`,
        ...(unexpectedAsset ? { assetBinaryPath: `${origin}/wasm/extra.data` } : {})
      }; }
    },
    PoseLandmarker: {
      async createFromOptions(_files, supplied) {
        calls.create++;
        calls.events.push("create");
        creationOptions = supplied;
        if (rejectCreation) throw Error("creation failed");
        if (supplied.baseOptions.modelAssetBuffer) {
          const buffer = supplied.baseOptions.modelAssetBuffer;
          if (buffer instanceof Uint8Array) assert.deepEqual(buffer, bytes);
          else while (true) { const result = await buffer.read(); if (result.done) break; }
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
      calls.events.push("fetch");
      assert.equal(url, `${origin}/model.task`);
      if (disposeDuringFetch) await new Promise((resolve) => { releaseFetch = resolve; });
      if (fetchFailure) return { ok: false, status: 503, body: null };
      let index = 0;
      return {
        ok: true, status: 200, type: "basic",
        body: new ReadableStream({
          async pull(controller) {
            calls.sourceRead++;
            if (disposeDuringRead && index === 1) await new Promise((resolve) => { releaseRead = resolve; });
            if (init.signal.aborted) { controller.error(Error("aborted")); return; }
            if (index === chunks.length) { calls.events.push("eof"); controller.close(); return; }
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
    ...(gpu ? { delegate: "gpu-webgl" } : {}),
    ...(buffered ? { bufferModelDownload: true, streamModelDownload: false } : {})
  } } });
  return { self, load, messages, calls, get creationOptions() { return creationOptions; }, release() { releaseRead?.(); releaseFetch?.(); } };
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
{
  const run = scenario({ buffered: true, chunks: [bytes.subarray(0, 2), bytes.subarray(2)] });
  await run.load;
  assert.equal(run.calls.fetch, 1);
  assert.deepEqual(run.calls.events, ["resolver", "fetch", "eof", "create"], "select exact signed WASM variant before model bytes without downloading it");
  assert.equal(run.creationOptions.baseOptions.modelAssetPath, undefined);
  assert.equal(run.creationOptions.baseOptions.modelAssetBuffer.constructor.name, "Uint8Array");
  const totalAssets = bytes.length + 323_377 + 11_756_954;
  assert.deepEqual(run.messages.filter((message) => message.type === "model-download-progress").map(({ receivedBytes, totalBytes, verified }) => [receivedBytes, totalBytes, verified]),
    [[2, totalAssets, false], [6, totalAssets, false], [6, totalAssets, false], [totalAssets, totalAssets, true]],
    "bar counts the model AND actual selected runtime JS/WASM, reaching 100% only after task load");
  assert.equal(run.messages.at(-1).type, "loaded");
  await run.self.onmessage({ data: { type: "dispose" } });
  assert.equal(run.calls.closed, 1);
}
for (const [runtimeVariant, pair] of Object.entries(pinnedRuntimePairs)) {
  const run = scenario({ buffered: true, runtimeVariant });
  await run.load;
  const progress = run.messages.filter(message => message.type === "model-download-progress");
  const total = bytes.length + pair.loader + pair.binary;
  assert(progress.every(message => message.totalBytes === total), `${runtimeVariant} exact selected loader+WASM denominator`);
  assert(progress.slice(0, -1).every(message => message.receivedBytes <= bytes.length && !message.verified), "no false 100% while signed WASM has not loaded");
  assert.deepEqual([progress.at(-1).receivedBytes, progress.at(-1).verified], [total, true]);
  assert.equal(run.calls.fetch, 1, "runtime denominator never causes duplicate model/WASM GET");
}
for (const variation of [{ runtimeVariant: "forged_variant" }, { unexpectedAsset: true }]) {
  const run = scenario({ buffered: true, ...variation });
  await run.load;
  assert.equal(run.calls.fetch, 0, "unknown runtime asset inventory fails before touching model network");
  assert.equal(run.messages.some(message => message.type === "loaded" || message.type === "model-download-progress"), false);
  assert.equal(run.messages.at(-1).type, "error");
}
for (const variation of [
  { chunks: [bytes.subarray(0, 3)] },
  { chunks: [new Uint8Array([...bytes, 7])] },
  { expectedHash: "0".repeat(64) },
  { fetchFailure: true },
  { rejectCreation: true }
]) {
  const run = scenario({ buffered: true, ...variation });
  await run.load;
  assert.equal(run.calls.fetch, 1);
  assert.equal(run.messages.some((message) => message.type === "loaded"), false);
  assert.equal(run.messages.some((message) => message.type === "error"), true);
  if (!variation.rejectCreation) assert.equal(run.calls.create, 0);
}
{
  const run = scenario({ buffered: true, chunks: [bytes.subarray(0, 2), bytes.subarray(2)], disposeDuringRead: true });
  await waitFor(() => run.calls.sourceRead === 2);
  await run.self.onmessage({ data: { type: "dispose" } });
  run.release();
  await run.load;
  assert.equal(run.calls.create, 0);
  assert.equal(run.messages.some((message) => message.type === "loaded"), false);
  assert.equal(run.messages.some((message) => message.type === "disposed"), true);
}
{
  const run = scenario({ buffered: true, disposeDuringFetch: true });
  await waitFor(() => run.calls.fetch === 1);
  await run.self.onmessage({ data: { type: "dispose" } });
  run.release();
  await run.load;
  assert.equal(run.calls.create, 0);
  assert.equal(run.messages.some((message) => message.type === "loaded"), false);
  assert.equal(run.messages.some((message) => message.type === "disposed"), true);
}
for (const variant of [{ urlMode: true }, { gpu: true }, { gpu: true, buffered: true }]) {
  const run = scenario(variant);
  await run.load;
  assert.equal(run.calls.fetch, 0);
  assert.equal(run.creationOptions.baseOptions.modelAssetPath, options.modelUrl);
  assert.equal(run.messages.some((message) => message.type === "model-download-progress"), false);
  assert.equal(run.messages.at(-1).type, "loaded");
}
console.log("MediaPipe classic Worker model stream validation passed.");
