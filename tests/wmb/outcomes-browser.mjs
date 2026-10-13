import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

const root = process.cwd();
const executablePath = process.env.CHROMIUM_PATH || ["/repl/tools/bin/chromium", "/usr/bin/chromium"].find(existsSync);
assert.ok(executablePath, "A local Chromium executable is required");
const server = await createServer({
  configFile: false, envFile: false, root,
  cacheDir: path.join(root, "node_modules/.vite-wmb-outcomes"),
  optimizeDeps: { entries: [path.join(root, "tests/wmb/outcomes-browser.html")], holdUntilCrawlEnd: false },
  plugins: [react()],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: { host: "127.0.0.1", port: 5190, strictPort: true, hmr: false, watch: { ignored: ["**/.local/**"] } },
});
let browser;
try {
  await server.listen();
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  for (const execution of [false, true]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.setViewport({ width: 1100, height: 950 });
    await page.setRequestInterception(true);
    page.on("request", request => {
      if (new URL(request.url()).origin !== "http://127.0.0.1:5190" || request.url().includes("/api/")) {
        errors.push(`Unexpected request ${request.url()}`);
        return request.abort();
      }
      return request.continue();
    });
    await page.goto(`http://127.0.0.1:5190/tests/wmb/outcomes-browser.html${execution ? "?execution=1" : ""}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector('[role="dialog"]', { timeout: 30000 });
    const text = await page.$eval('[role="dialog"]', el => el.textContent);
    assert.match(text, /Failed Starts \(1\)/);
    assert.match(text, /Failed Continuations \(2\)/);
    assert.match(text, /Dependent: Child fixture/);
    assert.match(text, /26 years 1 month old/);
    assert.match(text, /no current-month coverage row was removed/i);
    assert.match(text, /Current-month coverage row removed/);
    assert.doesNotMatch(text, /No benefit changes recorded/);
    if (execution) {
      assert.match(text, /Scan Execution Failed/);
      assert.match(text, /Benefit Execution Errors \(2\)/);
      assert.match(text, /Plugin error: fixture outage/);
      assert.doesNotMatch(text, /Benefits Started/);
    } else assert.doesNotMatch(text, /Scan Execution Failed/);
    assert.deepEqual(errors, []);
    await mkdir(path.join(root, "generated-artifacts/wmb"), { recursive: true });
    await page.screenshot({ path: path.join(root, `generated-artifacts/wmb/outcomes-${execution ? "errors" : "eligibility"}.png`) });
    await page.close();
  }
  console.log("PASS: dependent failed starts, no-delete continuations, removed rows, and execution errors render distinctly.");
} catch (error) {
  console.error("WMB outcome browser fixture failed:", error);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
