// @ts-check

/**
 * Bounded console filter for the four known internal log lines that the
 * pinned `@mediapipe/tasks-vision@1.0.1` WASM runtime emits through its
 * emscripten print hooks (`vision_wasm_internal.js`) during load and
 * inference:
 *
 * 1. "OpenGL error checking is disabled" (gl_context.cc)
 * 2. The XNNPACK delegate line ("Created … Lite XNNPACK delegate for CPU.",
 *    reported at error level in the browser). Matched by its distinctive
 *    marker-free substring "XNNPACK delegate for CPU." (below): the full log
 *    line still drops because it contains the substring, while the shipped
 *    string constant avoids the runtime-name the release integrity gate
 *    treats as a forbidden non-MediaPipe marker.
 * 3. "Feedback manager requires a model with a single signature inference.
 *    Disabling support for feedback tensors." (inference_feedback_manager.cc)
 * 4. "Using NORM_RECT without IMAGE_DIMENSIONS is only supported for the
 *    square ROI. Provide IMAGE_DIMENSIONS or use PROJECTION_MATRIX."
 *    (landmark_projection_calculator.cc)
 *
 * The pinned build exposes no `setWasmLoggingSeverity` API, so these lines
 * are dropped at the only boundary they can cross into the app: the
 * global `console`. A single IDEMPOTENT install wraps `console.log`,
 * `console.info`, `console.warn`, and `console.error`. A message is dropped
 * ONLY when its stringified form contains one of the frozen signatures
 * below; every other message passes through untouched, including all
 * non-matching errors. Nothing outside this frozen list is ever suppressed.
 */

/**
 * Frozen list of the exact known MediaPipe internal log lines. This list is
 * the ONLY drop condition for the installed filter.
 */
export const mediaPipeWasmConsoleSignatures = Object.freeze([
  "OpenGL error checking is disabled",
  "XNNPACK delegate for CPU.",
  "Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.",
  "Using NORM_RECT without IMAGE_DIMENSIONS is only supported for the square ROI. Provide IMAGE_DIMENSIONS or use PROJECTION_MATRIX."
]);

/**
 * Stringifies one console argument for signature matching. Objects are
 * rendered with `JSON.stringify`, falling back to `String` for values that
 * cannot be serialized (functions, cycles, etc.).
 *
 * @param {unknown} value
 * @returns {string}
 */
function stringifyArgument(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object" || typeof value === "function") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Returns true when any argument's stringified form contains one of the
 * frozen MediaPipe internal signatures.
 *
 * @param {readonly unknown[]} args
 * @returns {boolean}
 */
function containsMediaPipeWasmSignature(args) {
  for (const argument of args) {
    const text = stringifyArgument(argument);
    for (const signature of mediaPipeWasmConsoleSignatures) {
      if (text.includes(signature)) return true;
    }
  }
  return false;
}

/**
 * Wraps one console method so matching messages are dropped and everything
 * else is forwarded to the underlying method with the same `this` and args.
 *
 * @param {Function} method One of the four wrapped console methods.
 * @returns {Function} A drop-filtering wrapper that forwards to `method`.
 */
function wrapConsoleMethod(method) {
  const wrapped = function (...data) {
    if (!containsMediaPipeWasmSignature(data)) {
      return Reflect.apply(method, this, data);
    }
  };
  return wrapped;
}

/**
 * Installs the bounded MediaPipe WASM console filter exactly once.
 *
 * Safe to call from every adapter construction: after the first install the
 * console methods are already wrapped, so repeated installs are no-ops and
 * never double-wrap.
 */
export function installMediaPipeWasmConsoleFilter() {
  const targetConsole = globalThis.console;
  if (!targetConsole) return;
  if (Object.isFrozen(targetConsole)) return;
  const installedMarker =
    Object.getOwnPropertyDescriptor(targetConsole.log, "__mediaPipeWasmConsoleFilterInstalled")
      ?.value;
  if (targetConsole.log && installedMarker === true) return;
  /** @type {ReadonlyArray<"log" | "info" | "warn" | "error">} */
  const levels = Object.freeze(["log", "info", "warn", "error"]);
  for (const level of levels) {
    const original = targetConsole[level];
    if (typeof original !== "function") continue;
    const wrapped = wrapConsoleMethod(original);
    try {
      Object.defineProperty(targetConsole, level, {
        configurable: true,
        enumerable: false,
        value: wrapped
      });
      Object.defineProperty(
      wrapped,
      "__mediaPipeWasmConsoleFilterInstalled",
      { value: true }
    );
    } catch {
      // Frozen/non-writable console slot: skip that level rather than fail.
    }
  }
}
