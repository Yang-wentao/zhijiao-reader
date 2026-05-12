// Headless debug: open the dev app, upload a PDF via the file input, capture
// every console message, page error, and uncaught exception. Used to diagnose
// the multi-Viewer white-screen bug.
//
// Usage: node scripts/debug-pdf-drop.mjs /path/to/sample.pdf

import { chromium } from "playwright";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const pdfPath = resolve(process.argv[2] || "");
if (!pdfPath || !existsSync(pdfPath)) {
  console.error(`Usage: node scripts/debug-pdf-drop.mjs /path/to/sample.pdf  (got: ${pdfPath})`);
  process.exit(1);
}

const APP_URL = "http://localhost:5173/";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const events = [];
page.on("console", (msg) => {
  events.push(`[console.${msg.type()}] ${msg.text()}`);
});
page.on("pageerror", (err) => {
  events.push(`[pageerror] ${err.message}\n${err.stack ?? ""}`);
});
page.on("requestfailed", (request) => {
  events.push(`[requestfailed] ${request.url()} — ${request.failure()?.errorText ?? ""}`);
});

console.log(`→ Navigating to ${APP_URL}`);
await page.goto(APP_URL, { waitUntil: "load" });

// Wait for the app shell to render so the file input is in the DOM.
await page.waitForSelector('input[type="file"][accept="application/pdf"]', { timeout: 10000 });

console.log(`→ Uploading: ${pdfPath}`);
const fileInput = await page.locator('input[type="file"][accept="application/pdf"]').first();
await fileInput.setInputFiles(pdfPath);

// Give the Viewer time to mount, load, render, and (potentially) crash.
await page.waitForTimeout(4000);

// Capture rendered DOM snapshot snippets that signal success vs failure.
const summary = await page.evaluate(() => {
  return {
    hasErrorBoundary: !!document.querySelector("[data-error-boundary]"),
    tabStripText: document.querySelector(".pdf-tab-strip")?.textContent ?? null,
    hasTabViewer: !!document.querySelector(".pdf-tab-viewer"),
    hasInnerPages: !!document.querySelector('[data-testid="core__inner-pages"]'),
    hasPageLayer: !!document.querySelector('[data-testid^="core__page-layer-"]'),
    bodyTextSample: (document.body.textContent ?? "").slice(0, 300),
  };
});

await page.screenshot({ path: "/tmp/zhijiao-debug.png", fullPage: false });

console.log("\n=== EVENTS ===");
for (const e of events) console.log(e);
console.log("\n=== DOM SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
console.log("\n→ Screenshot at /tmp/zhijiao-debug.png");

await browser.close();
