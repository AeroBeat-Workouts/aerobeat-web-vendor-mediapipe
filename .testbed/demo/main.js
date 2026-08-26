// @ts-check

import { createMediaPipeMockPoseAdapter } from "../../src/index.js";

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) {
  throw new Error("MediaPipe smoke root is missing.");
}

const adapter = createMediaPipeMockPoseAdapter();
await adapter.load();
const frame = await adapter.estimateNormalizedPoseFrame();
app.textContent = `MediaPipe mock ready: ${frame.landmarks.length} normalized landmarks; ${adapter.getExecutionStatus().delegate} delegate.`;
app.dataset.ready = "true";
adapter.dispose();
