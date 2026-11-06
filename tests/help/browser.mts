import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";
import { getAllSystemHelps, findSystemHelpsForPath } from "../../server/help/system";

// Run: node --import tsx tests/help/browser.mts
// No application sessions, database reads/writes, or auth changes.
const root = process.cwd();
const local = { id: "fixture-local", source: "config", paths: ["/config/helps"],
  summary: "Local procedure remains intact.", details: "<p>Local content.</p>" };
const cases = [
  ["/workers/fixture/sitespecific/bao/disability-credit", "system:disability-credit-worker"],
  ["/bao/dc/cases/fixture", "system:disability-credit-staff"],
  ["/employers/fixture/wizards", "system:employer-upload-launcher"],
  ["/wizards/fixture", "system:shared-wizard-runner"],
] as const;
const server = await createServer({
  configFile: false, envFile: false, root,
  cacheDir: path.join(root, "node_modules/.vite-help-fixture"),
  plugins: [react(), { name: "help-fixture", configureServer(vite) {
    vite.middlewares.use((req, _res, next) => {
      if (req.headers.accept?.includes("text/html")) req.url = "/tests/help/browser.html";
      next();
    });
  } }],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  optimizeDeps: { entries: [path.join(root, "tests/help/browser.html")], holdUntilCrawlEnd: false },
  server: { host: "127.0.0.1", port: 5196, strictPort: true, hmr: false,
    watch: { ignored: ["**/.local/**", "**/artifacts/**", "**/generated-artifacts/**"] } },
});
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
try {
  await server.listen();
  browser = await puppeteer.launch({
    executablePath: ["/repl/tools/bin/chromium", "/usr/bin/chromium"].find(existsSync),
    headless: true, timeout: 60_000, args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return void request.continue();
    assert.equal(request.method(), "GET", "Help verification must never mutate data");
    let data: unknown;
    if (url.pathname === "/api/helps/lookup") {
      const route = url.searchParams.get("path")!;
      data = [...findSystemHelpsForPath(route), ...(route === "/config/helps" ? [local] : [])];
    } else if (url.pathname === "/api/helps") data = [...getAllSystemHelps(), local];
    else {
      errors.push(`Unexpected API ${url.pathname}`); data = {};
    }
    await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 });
    for (const [route, id] of cases) {
      await page.goto(`http://127.0.0.1:5196${route}`, { waitUntil: "domcontentloaded" });
      const summary = `[data-testid="help-summary-${id}"]`;
      await page.waitForSelector(summary);
      assert.ok((await page.$eval(summary, el => el.textContent))!.length > 20);
      await page.click(`[data-testid="button-help-more-${id}"]`);
      await page.waitForSelector('[data-testid="text-help-details"]');
      const text = await page.$eval('[data-testid="text-help-details"]', el => el.textContent!);
      assert.match(text, /saved.*threshold/i);
      assert.match(text, /annual/i);
      assert.match(text, /restor/i);
      assert.equal(await page.$$eval('[data-testid="text-help-details"] h3', nodes => nodes.length) >= 4, true);
      assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    }
  }
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:5196/config/helps", { waitUntil: "domcontentloaded" });
  for (const [, id] of cases) {
    await page.waitForSelector(`[data-testid="row-help-${id}"]`);
    assert.equal(await page.$eval(`[data-testid="badge-help-system-${id}"]`, el => el.textContent), "System");
    assert.equal(await page.$eval(`[data-testid="text-help-builtin-${id}"]`, el => el.textContent), "Built-in");
    assert.equal(await page.$(`[data-testid="button-edit-help-${id}"]`), null);
  }
  assert.match(await page.$eval('[data-testid="row-help-fixture-local"]', el => el.textContent!), /Local procedure remains intact/);
  for (const route of ["/workers/fixture/sitespecific/bao/dp", "/bao/dc/queue/extra", "/employers/fixture/wizards/extra"]) {
    await page.goto(`http://127.0.0.1:5196${route}`, { waitUntil: "networkidle0" });
    for (const [, id] of cases) assert.equal(await page.$(`[data-testid="help-summary-${id}"]`), null);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: four correction help entries, real Help dialogs at desktop/mobile widths, built-in listing, local coexistence, and near misses");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await Promise.race([server.close(), new Promise((_, reject) => setTimeout(() => reject(new Error("Vite shutdown timed out")), 10_000))]);
}
