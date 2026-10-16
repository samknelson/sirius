// Isolated authenticated UI fixtures, not a replacement for real signed-in
// environment verification. No application DB, credentials or vendors loaded.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";
import { workerCommsDefinitionSchema, resolveBenefitPeriod } from "../../shared/worker-comms-compliance.ts";
import { getSystemHelp } from "../../server/help/system/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath = ["/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
assert.ok(executablePath, "Chromium is required for the report browser fixture");
let admin = true, component = true, stale = false, chooserError = false;
let definition = { ...workerCommsDefinitionSchema.parse({
  name: "Fixture compliance", commTagId: "tag", statuses: ["offline"],
  population: { benefitIds: ["benefit"] },
}), id: "definition" };
const requests = [], failures = [];
const output = path.join(root, "generated-artifacts/worker-comms-compliance");
const server = await createServer({
  configFile: false, envFile: false, root, cacheDir: path.join(root, "node_modules/.vite-compliance-browser"),
  optimizeDeps: { entries: [path.join(root, "tests/comm/compliance-browser.html")], holdUntilCrawlEnd: false },
  plugins: [react(), { name: "compliance-fixture", configureServer(vite) {
    vite.middlewares.use((req, _res, next) => {
      if (req.url && !req.url.startsWith("/api/") && !req.url.startsWith("/tests/") &&
        !req.url.startsWith("/@") && !req.url.startsWith("/node_modules/") && !req.url.includes(".")) {
        req.url = "/tests/comm/compliance-browser.html";
      }
      next();
    });
  } }],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: { host: "127.0.0.1", port: 5196, strictPort: true, hmr: false },
});
let browser;
const origin = "http://127.0.0.1:5196";
try {
  await server.listen();
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => failures.push(error.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    if (url.origin !== origin) return request.abort();
    if (!url.pathname.startsWith("/api/")) return request.continue();
    let status = 200, body;
    const p = url.pathname;
    if (p === "/api/auth/user") body = { user: { id: "fixture", email: "fixture@example.invalid", isActive: true },
      permissions: admin ? ["admin", "staff"] : ["staff"], components: component ? ["worker.comms_compliance", "bulk"] : ["bulk"] };
    else if (p.startsWith("/api/access/policies/")) body = { access: { granted: true } };
    else if (p === "/api/components/config") body = [{ componentId: "bulk", enabled: true }];
    else if (p === "/api/helps/lookup") body = [getSystemHelp("system:worker-comms-compliance")];
    else if (p.endsWith("/options")) body = {
      tags: [{ id: "tag", name: "Fixture tag" }], memberStatuses: [], benefits: [{ id: "benefit", name: "Fixture benefit" }],
      employers: [], employerTypes: [], bargainingUnits: [], representatives: [],
      benefitsEnabled: true, bargainingUnitsEnabled: false, politicalEnabled: false, canManage: admin, canBulk: true,
    };
    else if (p.endsWith("/definitions")) body = [definition];
    else if (p.endsWith("/report")) body = { definition, counts: { population: 2, with: 1, without: 1 },
      rows: [{ workerId: "w", contactId: "c", siriusId: 1, name: "Fictional Worker", commId: null, status: null, medium: null, sent: null }],
      total: 1, page: Number(url.searchParams.get("page") || 1), pageSize: 50, benefitMonth: "2026-10",
      benefitPeriod: resolveBenefitPeriod(definition.population, "2026-10") };
    else if (p.endsWith("/contacts")) body = { contactIds: ["c"], total: 1 };
    else if (p === "/api/bulk-messages/eligible-drafts") {
      status = chooserError ? 500 : 200;
      body = chooserError ? { message: "Fixture failure" } : [{ id: "existing", name: "Safe existing draft", status: "draft", medium: ["email"], data: {} }];
    } else if (p === "/api/bulk-messages/from-recipients") {
      const payload = JSON.parse(request.postData());
      requests.push(payload);
      status = stale ? 409 : 201;
      body = stale ? { message: "Some selected workers no longer match this report. Refresh and select the workers again." }
        : { bulkMessage: { id: payload.bulkMessageId ?? "new" }, participantsCreated: 1, participantsSkipped: 0, recipientsResolved: 1 };
    } else if (p === "/api/worker-comms-compliance/definitions/definition" && request.method() === "PUT") {
      definition = { ...JSON.parse(request.postData()), id: "definition" };
      body = definition;
    } else {
      failures.push(`Unexpected API ${request.method()} ${p}`);
      status = 500; body = { message: "Unhandled fixture request" };
    }
    await request.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  const open = async () => {
    await page.goto(`${origin}/workers/comms-compliance?definitionId=definition&view=without`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[aria-label="Select Fictional Worker"]:not([disabled])');
  };
  const clickText = async text => {
    const clicked = await page.evaluate(text => {
      const button = [...document.querySelectorAll("button")].find(node => node.textContent.trim() === text);
      if (!button) return false;
      button.click(); return true;
    }, text);
    assert.ok(clicked, `Missing button: ${text}`);
  };
  await open();
  assert.match(await page.content(), /Current month: 2026-10/);
  await page.click('[data-testid="button-help-more-system:worker-comms-compliance"]');
  await page.waitForSelector('[data-testid="text-help-details"]');
  assert.match(await page.$eval('[data-testid="text-help-details"]', node => node.textContent), /Neither action sends/);
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  await page.waitForFunction(() => document.body.style.pointerEvents !== "none");
  await page.click('[aria-label="Edit definition"]');
  await page.waitForSelector("#benefit-period-mode");
  await page.select("#benefit-period-mode", "lookback");
  await page.waitForSelector("#benefit-lookback-months");
  await page.click("#benefit-lookback-months", { clickCount: 3 });
  await page.type("#benefit-lookback-months", "6");
  await clickText("Save definition");
  await page.waitForSelector("#benefit-period-mode", { hidden: true });
  await page.waitForFunction(() => document.body.textContent.includes("Last 6 months"));
  for (const period of [{ mode: "ever" }, { mode: "lookback", months: 1 }, { mode: "range", from: "2025-01-15", through: "2025-12-31" }]) {
    definition = { ...definition, population: { ...definition.population, benefitPeriod: period } };
    await open();
    assert.ok((await page.content()).includes(resolveBenefitPeriod(definition.population, "2026-10").label));
  }
  await page.click('[aria-label="Select Fictional Worker"]');
  await page.click('[data-testid="worker-comms-compliance-bulk-trigger"]');
  await page.click('[data-testid="worker-comms-compliance-bulk-message"]');
  await page.waitForSelector('[data-testid="destination"]');
  assert.equal(requests.at(-1).bulkMessageId, undefined);
  assert.deepEqual(requests.at(-1).reportSelection, { definitionId: "definition", view: "without" });
  await open();
  await page.click('[aria-label="Select Fictional Worker"]');
  await page.click('[data-testid="worker-comms-compliance-bulk-trigger"]');
  await page.click('[data-testid="worker-comms-compliance-bulk-existing-message"]');
  await page.waitForSelector('[data-testid="worker-comms-compliance-bulk-existing-option-existing"]');
  await page.click('[data-testid="worker-comms-compliance-bulk-existing-option-existing"]');
  await page.click('[data-testid="worker-comms-compliance-bulk-existing-submit"]');
  await page.waitForSelector('[data-testid="destination"]');
  assert.equal(requests.at(-1).bulkMessageId, "existing");
  assert.deepEqual(requests.at(-1).reportSelection, { definitionId: "definition", view: "without" });
  await open();
  await page.click('[aria-label="Select Fictional Worker"]');
  chooserError = true;
  await page.click('[data-testid="worker-comms-compliance-bulk-trigger"]');
  await page.click('[data-testid="worker-comms-compliance-bulk-existing-message"]');
  await page.waitForFunction(() => document.body.textContent.includes("Messages couldn’t be loaded"));
  chooserError = false;
  await clickText("Retry");
  await page.waitForSelector('[data-testid="worker-comms-compliance-bulk-existing-option-existing"]');
  await page.click('[data-testid="worker-comms-compliance-bulk-existing-option-existing"]');
  stale = true;
  await page.click('[data-testid="worker-comms-compliance-bulk-existing-submit"]');
  await page.waitForFunction(() => document.body.textContent.includes("Some selected workers no longer match"));
  assert.ok(page.url().includes("/workers/comms-compliance"));
  stale = false;
  admin = false;
  await open();
  assert.equal(await page.$('[aria-label="Edit definition"]'), null);
  assert.ok(!(await page.content()).includes(">New definition<"));
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "staff-report.jpg"), fullPage: true });
  component = false;
  await page.reload({ waitUntil: "networkidle0" });
  assert.equal(await page.$('[aria-label="Select Fictional Worker"]'), null);
  assert.equal(await page.$('[data-testid="worker-comms-compliance-bulk-trigger"]'), null);
  assert.deepEqual(failures, []);
  console.log("PASS: authenticated admin/staff UI fixtures, help dialog, component-off route, month windows, new and existing draft requests; no delivery endpoints called.");
} catch (error) {
  console.error("Report browser fixture failures:", failures);
  if (browser) {
    for (const page of await browser.pages()) {
      console.error("Visible fixture text:", (await page.evaluate(() => document.body?.innerText)).slice(0, 2500));
    }
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await Promise.race([server.close(), new Promise(resolve => setTimeout(resolve, 3000))]);
}
