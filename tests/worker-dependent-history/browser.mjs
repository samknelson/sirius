import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath = ["/repl/tools/bin/chromium", "/usr/bin/chromium"].find(existsSync);
assert.ok(executablePath, "Chromium is required");
const failures = [];
const reads = [];
const month = (ordinal) => {
  const year = Math.floor((ordinal - 1) / 12);
  const number = ordinal - year * 12;
  return { year, month: number, label: `${new Date(Date.UTC(year, number - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${year}` };
};
const latest = 2026 * 12 + 1;
const person = (benefits = ["Medical", "Dental"]) => ({
  personId: "child", name: "Fixture Child With A Long Display Name", relationship: "Child",
  benefits: benefits.map((name) => ({ id: name, name, icon: null, color: null })),
});
const months = Array.from({ length: 14 }, (_, index) => ({
  coverageMonth: month(latest - index), workMonth: month(latest - index - 3),
  employerHours: [], hours: { reported: 0, required: 100 }, status: "unknown", reasons: [],
  medical: [], dental: [], other: [], charge: null,
  dependentCoverage: index === 8 ? { state: "unavailable", dependents: null } : {
    state: "available", dependents: index === 7 ? [] : [person(index === 9 ? ["Dental"] : ["Medical", "Dental"])],
  },
}));
function api(url, method) {
  const p = url.pathname;
  if (p === "/api/auth/user" && method === "GET") return {
    user: { id: "fixture-staff", email: "staff@example.invalid" },
    permissions: ["staff"], components: ["sitespecific.bao"],
    timezone: { systemTimeZone: "UTC", userTimeZone: null, allowUserTimezones: false },
  };
  if (["site_terminology", "site_name", "site_title", "site_footer"].some((key) => p === `/api/variables/by-name/${key}`)) return { value: null };
  if (p === "/api/access/tabs" && method === "POST") return { tabs: [{ tabId: "benefits", granted: true }, { tabId: "benefits-summary", granted: true }] };
  if (p === "/api/workers/fixture-worker") return { id: "fixture-worker", contactId: "fixture-contact" };
  if (p === "/api/contacts/fixture-contact") return { id: "fixture-contact", displayName: "Fixture Subscriber" };
  if (p === "/api/dashboard-plugins/bao-worker-coverage/content/staff-worker") return {
    workerId: "fixture-worker", state: "available",
    current: { coverageMonth: month(latest), workMonth: month(latest - 3), hours: { reported: 0, required: 100, thresholdMet: false },
      coverage: "unavailable", causes: { hours: null, balance: null } },
    balance: { available: true, totals: [{ currency: "USD", amount: "0.00", formatted: "$0.00" }] }, future: [],
  };
  if (p === "/api/workers/fixture-worker/benefits/monthly-history" && method === "GET") {
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    reads.push({ offset, limit });
    return { months: months.slice(offset, offset + limit), total: months.length, showCharges: false,
      partial: offset === 0, dependentHistoryAvailable: true };
  }
  throw new Error(`Unexpected API request: ${method} ${p}`);
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 30000); })]);
  } finally { clearTimeout(timer); }
}
let browser;
const server = await bounded(createServer({
  configFile: false, envFile: false, root,
  cacheDir: path.join(root, "node_modules/.vite-dependent-history-browser"),
  optimizeDeps: { entries: [path.join(root, "tests/worker-dependent-history/browser.html")], holdUntilCrawlEnd: false },
  plugins: [react(), {
    name: "dependent-history-browser",
    configureServer(s) { s.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith("/workers/")) req.url = "/tests/worker-dependent-history/browser.html";
      next();
    }); },
  }],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: { host: "127.0.0.1", port: 5191, strictPort: true, hmr: false,
    watch: { ignored: ["**/.local/**", "**/artifacts/**", "**/generated-artifacts/**"] } },
}), "Vite startup");
try {
  await bounded(server.listen(), "Vite listen");
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.on("pageerror", (error) => failures.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") return request.abort();
    if (!url.pathname.startsWith("/api/")) return request.continue();
    try {
      await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(api(url, request.method())) });
    } catch (error) {
      failures.push(error.message);
      await request.respond({ status: 500, body: error.message });
    }
  });
  await page.setViewport({ width: 1280, height: 1000 });
  console.log("Loading the production Summary page against isolated API fixtures");
  await page.goto("http://127.0.0.1:5191/workers/fixture-worker/benefits/summary", { waitUntil: "domcontentloaded" });
  const button = "#coverage-run-2026-1-button";
  await page.waitForSelector(button);
  await page.focus(button);
  await page.keyboard.press("Enter");
  await page.waitForSelector('[aria-label="Covered dependents in loaded span"]');
  assert.equal(await page.$eval(button, (el) => el.getAttribute("aria-expanded")), "true");
  const text = () => page.$eval("#monthly-coverage-history", (el) => el.textContent);
  assert.ok((await text()).includes("Fixture Child With A Long Display Name"));
  assert.ok((await text()).includes("Older months have not loaded"));
  assert.ok((await text()).includes("evidence is unavailable for 1 month"));
  await page.focus('[aria-label^="Coverage months"] button:nth-child(10)');
  await page.keyboard.press("Enter");
  assert.ok((await page.$eval('[data-testid="monthly-coverage-card"]', (el) => el.textContent)).includes("April 2025"));
  assert.ok((await page.$eval('[aria-label="Covered dependents for April 2025"]', (el) => el.textContent)).includes("Dental"));
  const before = await page.$eval('[data-testid="monthly-coverage-card"]', (el) => el.getAttribute("aria-label"));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((el) => el.textContent === "Load older months").focus());
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#monthly-coverage-history")?.textContent.includes("Showing 14 of 14 months"));
  assert.deepEqual(reads, [{ offset: 0, limit: 12 }, { offset: 12, limit: 12 }]);
  assert.equal(await page.$eval('[data-testid="monthly-coverage-card"]', (el) => el.getAttribute("aria-label")), before);
  const spanText = await page.$eval('[aria-label="Covered dependents in loaded span"]', (el) => el.textContent);
  assert.ok(spanText.includes("December 2024 – March 2025"));
  assert.ok(!spanText.includes("Older months have not loaded"));
  await mkdir(path.join(root, "generated-artifacts/worker-dependent-history"), { recursive: true });
  for (const width of [1280, 360, 320]) {
    await page.setViewport({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Summary overflows at ${width}px`);
    await page.$eval("#coverage-run-2026-1-panel", (el) => el.scrollIntoView());
    await page.screenshot({ path: path.join(root, `generated-artifacts/worker-dependent-history/${width}.png`) });
  }
  assert.deepEqual(failures, []);
  console.log("PASS: production Summary layout, recorded dependent evidence, keyboard month selection, pagination, desktop and 360/320px widths");
} catch (error) {
  console.error(error);
  console.error("Browser/API failures:", failures);
  throw error;
} finally {
  await browser?.close();
  await bounded(server.close(), "Vite close");
}
