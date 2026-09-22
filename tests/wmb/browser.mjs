import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

// Local fixture harness only: no app server, auth credentials, environment file,
// database or provider is loaded. Unexpected networking fails closed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath = process.env.CHROMIUM_PATH || [
  "/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find(existsSync);
assert.ok(executablePath, "Set CHROMIUM_PATH to a local Chromium executable");
const server = await createServer({
  configFile: false, envFile: false, root,
  cacheDir: path.join(root, "node_modules/.vite-wmb-browser"),
  optimizeDeps: { entries: [path.join(root, "tests/wmb/browser.html")], holdUntilCrawlEnd: false },
  plugins: [react(), {
    name: "wmb-browser-entry",
    configureServer(s) {
      s.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith("/workers/")) req.url = "/tests/wmb/browser.html";
        next();
      });
    },
  }],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: { host: "127.0.0.1", port: Number(process.env.WMB_BROWSER_PORT || 5189), strictPort: true, hmr: false },
});
const worker = { id: "worker-fixture", siriusId: 612, contactId: "contact-fixture" };
const benefit = {
  benefitId: "benefit-fixture", benefitName: "Fixture Medical",
  benefitType: { id: null, name: null, color: null, icon: null, sequence: null },
  activeSinceYear: 2026, activeSinceMonth: 1, electedOn: "2026-01-01",
  activeInCurrentMonth: true, endDate: null, sourceRelation: null,
};
function fixture(p) {
  if (p === "/api/auth/user") return {
    user: { id: "staff-fixture", email: "wmb@example.invalid" },
    permissions: ["staff"], components: ["trust.benefits", "trust.benefits.scan"],
  };
  if (["/api/variables/by-name/system_mode", "/api/variables/by-name/site_terminology"].includes(p)) return { value: null };
  if (p === "/api/access/tabs") return { tabs: ["identity", "details", "benefits", "benefits-current"].map(tabId => ({ tabId, granted: true })) };
  if (p === "/api/workers/worker-fixture") return worker;
  if (p === "/api/contacts/contact-fixture") return { id: "contact-fixture", displayName: "Fixture Worker", given: "Fixture", family: "Worker" };
  if (p === "/api/workers/worker-fixture/benefits/current") return [benefit];
  if (p === "/api/workers/worker-fixture/benefits") return [{
    id: "wmb-fixture", month: new Date().getMonth() + 1, year: new Date().getFullYear(),
    benefit: { id: "benefit-fixture", name: "Fixture Medical" },
    employer: { id: "employer-fixture", name: "Fixture Employer" },
  }];
  if ([
    "/api/contacts/contact-fixture/addresses", "/api/contacts/contact-fixture/phone-numbers",
    "/api/workers/worker-fixture/ids", "/api/workers/worker-fixture/hours",
    "/api/options/worker-id-type", "/api/options/worker-ws",
    "/api/options/worker-ms", "/api/options/industry",
  ].includes(p)) return [];
  throw new Error(`Unexpected API request: ${p}`);
}
const reports = [];
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.config.server.port}`;
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  for (const scenario of ["slow", "error", "details"]) {
    const page = await browser.newPage();
    const failures = [];
    const requests = [];
    let held;
    page.on("pageerror", error => failures.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", async request => {
      const url = new URL(request.url());
      if (url.origin !== origin) {
        failures.push(`Unexpected external request ${url.origin}`);
        return request.abort();
      }
      if (!url.pathname.startsWith("/api/")) return request.continue();
      requests.push(url.pathname);
      try {
        if (url.pathname.endsWith("/wmb-scan-state")) {
          if (scenario === "slow") { held = request; return; }
          return request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Fixture scan-state outage" }) });
        }
        await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(fixture(url.pathname)) });
      } catch (error) {
        failures.push(error.message);
        await request.abort();
      }
    });
    await page.goto(`${origin}/workers/worker-fixture${scenario === "details" ? "" : "/benefits/current"}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    const selector = scenario === "details" ? '[data-testid="current-benefit-wmb-fixture"]' : '[data-testid="row-current-benefit-benefit-fixture"]';
    await page.waitForSelector(selector, { timeout: 30000 });
    const visibleAt = await page.evaluate(() => performance.now());
    assert.match(await page.$eval(selector, node => node.textContent), /Fixture Medical/);
    if (scenario === "slow") {
      assert.ok(held, "Scan-state request must actually be pending when benefits render");
      assert.equal(await page.$('[data-testid="text-scan-state"]'), null);
      // Keep pending after content paints; completion is not required for rendering.
      await new Promise(resolve => setTimeout(resolve, 1200));
      await held.respond({ status: 200, contentType: "application/json", body: JSON.stringify({
        lastScan: { month: 1, year: 2026, status: "success", completedAt: "2026-01-01", triggerSource: "monthly_batch" },
        queued: [],
      }) });
      await page.waitForSelector('[data-testid="text-last-scan"]');
    } else if (scenario === "error") {
      await page.waitForFunction(() => performance.getEntriesByType("resource").some(r => r.name.endsWith("/wmb-scan-state")));
      assert.equal(await page.$('[data-testid="text-scan-state"]'), null);
    } else {
      assert.ok(!requests.some(p => /scan|queue/.test(p)), "Details must not request queue state");
    }
    assert.match(await page.$eval(selector, node => node.textContent), /Fixture Medical/);
    assert.deepEqual(failures, [], "No unexpected networking or browser exceptions");
    const timings = await page.evaluate(() => performance.getEntriesByType("resource")
      .filter(r => r.name.includes("/api/"))
      .map(r => ({ path: new URL(r.name).pathname, startMs: Math.round(r.startTime), endMs: Math.round(r.responseEnd), durationMs: Math.round(r.duration) })));
    reports.push({ scenario, benefitsVisibleMs: Math.round(visibleAt), timings });
    console.log(`PASS ${scenario}: benefits visible at ${Math.round(visibleAt)}ms`);
    await mkdir(path.join(root, "screenshots"), { recursive: true });
    await page.screenshot({ path: path.join(root, `screenshots/wmb-queue-${scenario}.png`), fullPage: true });
    await page.close();
  }
  console.log(JSON.stringify({ fixtureOnly: true, browser: await browser.version(), reports }, null, 2));
  await writeFile(path.join(root, "screenshots/wmb-queue-waterfall.json"), JSON.stringify({ fixtureOnly: true, reports }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}