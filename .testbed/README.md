# MediaPipe Vendor Testbed

The browser smoke imports the package source and exercises only the deterministic mock adapter. It verifies browser-safe module evaluation, normalized seven-landmark output, and a warning/error-free console without downloading Tasks Vision WASM or the real model.

Real camera/model evaluation belongs in the integrated AeroBeat comparison release so frame pacing, input size, telemetry, and phone conditions remain identical across backends.
