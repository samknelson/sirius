/**
 * Isolated Chromium check of the actual directory with fictional authorized
 * staff responses. Does not create accounts or change authentication in the app.
 * Run: node --import tsx tests/workers/directory-browser.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";
import { getSystemHelp } from "../../server/help/system/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const origin = "http://127.0.0.1:5193";
const requests = [];
const errors = [];
let optional = true;
let configuredIds = true;
const worker = { id: "fixture-worker-1", contact_id: "fixture-contact-1", sirius_id: 424242,
  given: "Morgan", family: "Example", contact_name: "Morgan Example", denorm_job_title: "Fixture carpenter",
  denorm_ms_ids: [], denorm_employer_ids: [], benefits: [] };
const components = ["cardcheck", "bargainingunits", "trust.benefits", "sitespecific.btu.political", "worker.steward", "sitespecific.btu", "bulk"];
const help = getSystemHelp("system:worker-directory");
const vite = await createServer({
  configFile: false, envFile: false, root,
  cacheDir: path.join(root, "node_modules/.vite-worker-directory-browser"),
  optimizeDeps: { entries: [path.join(root, "tests/workers/directory-browser.html")], holdUntilCrawlEnd: false },
  plugins: [react(), {
    name: "fictional-directory-entry",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/workers" || req.url === "/legacy-workers") req.url = "/tests/workers/directory-browser.html";
        next();
      });
    },
  }],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: { host: "127.0.0.1", port: 5193, strictPort: true, hmr: false },
});
let browser;
try {
  await vite.listen();
  browser = await puppeteer.launch({ executablePath: "/repl/tools/bin/chromium", headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"], timeout: 60000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1365, height: 1000 });
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    if (url.origin !== origin) return request.abort();
    if (!url.pathname.startsWith("/api/")) return request.continue();
    const body = request.postData() ? JSON.parse(request.postData()) : Object.fromEntries(url.searchParams);
    if (!request.postData()) {
      for (const key of url.searchParams.keys()) {
        if (url.searchParams.getAll(key).length > 1) body[key] = url.searchParams.getAll(key).join(",");
      }
    }
    requests.push({ path: url.pathname, method: request.method(), body, url: request.url() });
    let response = [];
    switch (url.pathname) {
      case "/api/auth/user":
        response = { user: { id: "fictional-staff", email: "staff@example.invalid" }, permissions: ["staff", "workers.ssn", "admin"],
          components: optional ? components : [], timezone: { systemTimeZone: "UTC", userTimeZone: null, allowUserTimezones: false } }; break;
      case "/api/components/config": response = components.map(componentId => ({ componentId, enabled: optional })); break;
      case "/api/workers/with-details/paginated":
        response = { data: [{ ...worker, id: Number(body.page) === 2 ? "fixture-worker-2" : worker.id }], total: 51, page: Number(body.page ?? 1), pageSize: 50, totalPages: 2 }; break;
      case "/api/workers/with-details/all-ids": response = { contactIds: ["fixture-contact-1"], total: 1 }; break;
      case "/api/employers": response = [
        { id: "B", name: "Bravo employer", isActive: true },
        { id: "A", name: "Alpha employer", isActive: true },
      ]; break;
      case "/api/options/employment-status": response = [
        { id: "hired", name: "Working", employed: true }, { id: "leave", name: "On leave", employed: true },
        { id: "term", name: "Terminated", employed: false },
      ]; break;
      case "/api/options/worker-ws": response = [
        { id: "active", name: "Available", data: { isActive: true } }, { id: "inactive", name: "Unavailable", data: { isActive: false } },
      ]; break;
      case "/api/options/industry": response = [{ id: "trade", name: "Fixture trade" }]; break;
      case "/api/options/worker-ms": response = [{ id: "member", name: "Member", code: "member", industryId: "trade" }]; break;
      case "/api/bargaining-units": response = [{ id: "unit", name: "Fixture unit", siriusId: "FICTIONAL" }]; break;
      case "/api/trust-benefits": response = [{ id: "medical", name: "Fixture medical", isActive: true }]; break;
      case "/api/sitespecific/btu/political/officials": response = [{ id: "official", name: "Fictional official", officeName: "Fixture office", level: "state" }]; break;
      case "/api/sitespecific/btu/territories/field-reps": response = [{ id: "rep-contact", name: "Fictional field representative" }]; break;
      case "/api/worker-id-types/show-on-lists": response = configuredIds ? [{ id: "local", name: "Local ID" }, { id: "badge", name: "Badge ID" }] : []; break;
      case "/api/worker-ids/for-list": response = body.workerIds.flatMap(workerId => workerId === "fixture-worker-2" ? [] : [
        { workerId, typeId: "badge", value: "B-123" }, { workerId, typeId: "local", value: "L-456" },
      ]); break;
      case "/api/workers/list-settings": response = { displayMode: "member-status", accountConfigured: false, cardcheckDefinitionIds: [] }; break;
      case "/api/workers/latest-dues": response = {}; break;
      case "/api/workers/export":
        return request.respond({ status: 200, contentType: "text/csv",
          headers: { "Content-Disposition": 'attachment; filename="fixture-workers.csv"' }, body: "First Name\nMorgan\n" });
      case "/api/helps/lookup": response = [help]; break;
      default:
        if (url.pathname.startsWith("/api/variables/by-name/")) response = { value: null };
    }
    await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.goto(`${origin}/workers`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForSelector('[data-testid="text-worker-count"]');
  assert.deepEqual(errors, []);
  const text = await page.$eval("body", element => element.innerText);
  assert.ok(text.includes("Local ID") && text.includes("L-456"));
  assert.ok(text.indexOf("L-456") < text.indexOf("B-123"), "IDs follow configured sequence");
  assert.ok(!text.includes("424242"), "Configured IDs replace the Sirius subtitle");
  assert.ok(text.includes("Fixture carpenter"), "Job subtitle remains");
  assert.deepEqual(requests.filter(request => request.path === "/api/worker-ids/for-list").map(request => request.body.workerIds), [["fixture-worker-1"]]);
  const headings = await page.$$eval('[data-testid="contextual-worker-filters"] h3 button', elements => elements.map(element => element.textContent));
  assert.equal(headings.length, 6);
  for (const [index, name] of ["Contact", "Membership", "Employment", "Work Status", "Benefits", "Political"].entries()) {
    assert.ok(headings[index].startsWith(name), `Section ${name} is in the required order`);
  }
  const clickHeading = async label => {
    for (const element of await page.$$('[data-testid="contextual-worker-filters"] h3 button')) {
      if ((await element.evaluate(el => el.textContent)).startsWith(label)) {
        await element.click();
        return;
      }
    }
    assert.fail(`Missing section ${label}`);
  };
  const clickOption = async label => {
    for (const element of await page.$$('[cmdk-item]')) {
      if ((await element.evaluate(el => el.textContent)).trim() === label) {
        await element.click();
        return;
      }
    }
    assert.fail(`Missing dropdown option ${label}`);
  };
  const closeDropdown = async () => {
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-radix-popper-content-wrapper]', { hidden: true });
  };
  const populationCalls = () => requests.filter(request => request.path === "/api/workers/with-details/paginated");
  const initialCalls = populationCalls().length;
  const contactOpen = await page.$('[data-testid="input-search-contact"]');
  if (!contactOpen) await clickHeading("Contact");
  await page.type('[data-testid="input-search-contact"]', "fictional@example.invalid");
  await clickHeading("Contact");
  await clickHeading("Contact");
  assert.equal(await page.$eval('[data-testid="input-search-contact"]', el => el.value), "fictional@example.invalid");
  await clickHeading("Employment");
  await page.click('[data-testid="select-employer-filter"]');
  assert.deepEqual(await page.$$eval('[cmdk-item]', elements => elements.map(el => el.textContent.trim())), ["Alpha employer", "Bravo employer"]);
  await page.type('[cmdk-input]', "Alpha");
  await page.click('[data-testid="select-employer-filter-all"]');
  await closeDropdown();
  assert.equal(await page.$eval('input[aria-label="Currently employed, including leave"]', el => el.checked), true);
  assert.equal(populationCalls().length, initialCalls, "Draft filters must not query the population");
  await page.click('input[aria-label="Ever worked there"]');
  await page.click('[data-testid="select-employer-filter"]');
  await clickOption("Alpha employer");
  await closeDropdown();
  assert.equal(await page.$eval('input[aria-label="Ever worked there"]', el => el.checked), true, "Explicit ever survives employer edits");
  await page.click('[data-testid="select-employer-filter"]');
  await page.click('[data-testid="select-employer-filter-all"]');
  await closeDropdown();
  await page.click('input[aria-label="Specific statuses"]');
  await page.click('[data-testid="select-employment-status-filter"]');
  await clickOption("Terminated");
  await page.type('[cmdk-input]', "Terminated");
  await page.click('[data-radix-popper-content-wrapper] summary');
  await page.click('button[aria-label="Employed: Select all"]');
  await closeDropdown();
  assert.equal(await page.$eval('[data-testid="select-employment-status-filter"]', el => el.textContent.includes("3 selected")), true);
  await page.click('[data-testid="select-employment-status-filter"]');
  await page.click('[data-radix-popper-content-wrapper] summary');
  await page.click('button[aria-label="Employed: Select none"]');
  await closeDropdown();
  await page.waitForFunction(() => document.querySelector('[data-testid="select-employment-status-filter"]')?.textContent.includes("Terminated"), { timeout: 5000 });
  assert.equal(await page.$eval('[data-testid="select-employment-status-filter"]', el => el.textContent.includes("Terminated")), true, "Group None preserves the other group");
  await page.click('[data-testid="button-apply-worker-filters"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="applied-worker-filter-chips"]')?.textContent.includes("Specific employment statuses"));
  const applied = populationCalls().at(-1).body;
  assert.equal(applied.employerIds, "A,B");
  assert.equal(applied.employmentStatusIds, "term");
  assert.equal(applied.employmentMode, "custom");
  assert.equal(applied.contactSearch, "fictional@example.invalid");
  await page.click('input[aria-label="Currently employed, including leave"]');
  assert.ok(await page.$eval('[data-testid="applied-worker-filter-chips"]', el => el.textContent.includes("Specific employment statuses")), "Applied mode chip must not follow the draft");
  await page.click('[data-testid="button-export-csv"]');
  await page.waitForNetworkIdle({ idleTime: 200 });
  const exported = requests.findLast(request => request.path === "/api/workers/export");
  assert.equal(exported.body.employmentMode, "custom");
  assert.equal(exported.body.employmentStatusIds, "term");
  assert.equal(exported.body.employerIds, "A,B");
  await page.click('[data-testid="checkbox-select-worker-fixture-worker-1"]');
  await page.click('[data-testid="workers-bulk-action-select-all-matching"]');
  await page.waitForNetworkIdle({ idleTime: 200 });
  assert.equal(requests.findLast(request => request.path.endsWith("/all-ids")).body.employmentMode, "custom");
  await page.click('[data-testid="button-page-next"]');
  await page.waitForNetworkIdle({ idleTime: 200 });
  assert.deepEqual(requests.filter(request => request.path === "/api/worker-ids/for-list").at(-1).body.workerIds, ["fixture-worker-2"]);
  assert.ok(!(await page.$eval("body", el => el.innerText)).includes("424242"), "A worker missing configured IDs still hides the redundant Sirius subtitle");
  await page.type('[data-testid="input-search-ssn"]', "6789");
  await page.click('[data-testid="button-apply-worker-filters"]');
  await page.waitForNetworkIdle({ idleTime: 200 });
  assert.equal(populationCalls().at(-1).method, "POST");
  assert.equal(populationCalls().at(-1).body.ssn, "6789");
  assert.ok(requests.every(request => !request.url.includes("6789")));
  assert.ok(!(await page.evaluate(() => window.directoryFixtureKeys())).includes("6789"));
  await page.click('button[aria-label="Remove Currently employed"]');
  await page.waitForNetworkIdle({ idleTime: 200 });
  assert.equal(populationCalls().at(-1).body.employmentMode, "ever", "Removing the current-employment chip actually removes its status restriction");
  assert.ok(!populationCalls().at(-1).body.employmentStatusIds?.length);
  await page.click('[data-testid="button-clear-worker-filters"]');
  await page.waitForNetworkIdle({ idleTime: 200 });
  assert.equal(await page.$eval('[data-testid="input-search-ssn"]', el => el.value), "");
  await page.click('[data-testid="select-employer-filter"]');
  await page.type('[cmdk-input]', "Alpha");
  await clickOption("Alpha employer");
  await page.click('[data-testid="select-employer-filter-invert"]');
  await closeDropdown();
  assert.equal(await page.$eval('[data-testid="select-employer-filter"]', el => el.textContent.includes("Bravo employer")), true, "Invert includes search-hidden choices");
  await page.click('[data-testid="select-employer-filter"]');
  await page.click('[data-testid="select-employer-filter-none"]');
  await closeDropdown();
  assert.equal(await page.$('input[aria-label="Currently employed, including leave"]'), null);
  await page.click('[data-testid="button-apply-worker-filters"]');
  await page.waitForNetworkIdle({ idleTime: 200 });
  assert.equal(populationCalls().at(-1).body.employmentMode, undefined);
  assert.ok(!populationCalls().at(-1).body.employmentStatusIds);
  await page.click('[data-testid="button-help-more-system:worker-directory"]');
  await page.waitForSelector('[role="dialog"]');
  assert.ok(await page.$eval('[role="dialog"]', el => el.textContent.includes("Group All/None")));
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  await page.waitForFunction(() => document.body.style.pointerEvents !== "none");
  await mkdir(path.join(root, "generated-artifacts/worker-directory"), { recursive: true });
  await page.screenshot({ path: path.join(root, "generated-artifacts/worker-directory/desktop.jpg"), fullPage: true });
  optional = false;
  configuredIds = false;
  const marker = requests.length;
  await page.reload({ waitUntil: "networkidle0", timeout: 120000 });
  const disabledHeadings = await page.$$eval('[data-testid="contextual-worker-filters"] h3 button', elements => elements.map(element => element.textContent));
  assert.equal(disabledHeadings.length, 3);
  assert.ok(disabledHeadings[0].startsWith("Contact") && disabledHeadings[1].startsWith("Employment") && disabledHeadings[2].startsWith("Work Status"));
  assert.ok(await page.$eval("body", el => el.textContent.includes("424242")), "No configured list types preserves Sirius");
  assert.equal(requests.slice(marker).some(request => request.path === "/api/worker-ids/for-list"), false);
  await page.setViewport({ width: 402, height: 874 });
  await page.screenshot({ path: path.join(root, "generated-artifacts/worker-directory/mobile.jpg"), fullPage: true });
  configuredIds = true;
  await page.goto(`${origin}/legacy-workers`, { waitUntil: "networkidle0", timeout: 120000 });
  assert.equal(await page.$('[data-testid="contextual-worker-filters"]'), null, "Legacy consumers retain their original filter controls");
  assert.ok(await page.$eval("body", el => el.innerText.includes("L-456")), "Legacy consumers retain their batch-loaded ID values");
  assert.deepEqual(requests.filter(request => request.path === "/api/worker-ids/for-list").at(-1).body.workerIds, ["legacy-visible-worker"]);
  assert.deepEqual(errors, []);
  console.log("Worker directory Chromium fixture passed: accordion draft persistence, metadata groups, search-independent bulk actions, employer defaults and cleanup, applied/export/select-all parity, page ID batching, optional modules, help and mobile rendering");
} catch (error) {
  if (browser) {
    const current = (await browser.pages()).at(-1);
    if (current) console.error("Visible fixture text at failure:", (await current.$eval("body", el => el.innerText)).slice(-12000));
  }
  console.error("Worker directory browser fixture failed", error, errors);
  throw error;
} finally {
  await browser?.close();
  await Promise.race([vite.close(), new Promise((_, reject) => setTimeout(() => reject(new Error("Vite cleanup timed out")), 10000))]);
}
