// @ts-check

import assert from "node:assert/strict";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(".");
const server = createServer((request, response) => {
  const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const relativePath = requestPath === "/" ? ".testbed/demo/index.html" : requestPath.slice(1);
  const filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    if (!statSync(filePath).isFile()) {
      throw new Error("Not a file");
    }
    response.setHeader("content-type", contentType(filePath));
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
assert.ok(address && typeof address === "object");
const url = `http://127.0.0.1:${address.port}/.testbed/demo/index.html`;
/** @type {string[]} */
const consoleProblems = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  assert.equal(response?.ok(), true);
  await page.waitForSelector("#app[data-ready='true']");
  const text = await page.locator("#app").textContent();
  assert.match(text ?? "", /MediaPipe mock ready/u);
  assert.match(text ?? "", /7 normalized landmarks/u);
  assert.deepEqual(consoleProblems, []);
} finally {
  await browser?.close();
  await new Promise((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise(undefined)));
}
console.log(`MediaPipe browser mock/console smoke passed at ${url}`);

/**
 * @param {string} filePath
 * @returns {string}
 */
function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    default: return "application/octet-stream";
  }
}
