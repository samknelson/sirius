import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const executablePath = process.env.CHROMIUM_PATH || [
  "/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find(existsSync);
assert.ok(executablePath, "Set CHROMIUM_PATH to a local Chromium executable");

const summary = {
  workerId: "fixture-worker",
  state: "available",
  current: {
    coverageMonth: { year: 2027, month: 2, label: "February 2027" },
    workMonth: { year: 2026, month: 11, label: "November 2026" },
    hours: { reported: 99.75, required: 100, thresholdMet: false },
    coverage: "not-covered",
    causes: { hours: true, balance: null },
  },
  balance: {
    available: true,
    totals: [{ currency: "USD", amount: "-12.50", formatted: "-$12.50" }],
  },
  future: [
    {
      workMonth: { year: 2026, month: 12, label: "December 2026" },
      coverageMonth: { year: 2027, month: 3, label: "March 2027" },
      hours: { reported: 125.25, required: 100, thresholdMet: true },
      status: "met",
      deadline: "2027-01-20",
    },
    {
      workMonth: { year: 2027, month: 1, label: "January 2027" },
      coverageMonth: { year: 2027, month: 4, label: "April 2027" },
      hours: { reported: 49.5, required: 100, thresholdMet: false },
      status: "pending",
      deadline: "2027-02-20",
    },
  ],
};

const server = await createServer({
  configFile: false,
  envFile: false,
  root,
  cacheDir: path.join(root, "node_modules/.vite-bao-worker-coverage-browser"),
  optimizeDeps: { entries: [path.join(root, "tests/sitespecific/bao-worker-coverage/browser.html")], holdUntilCrawlEnd: false },
  plugins: [react()],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.BAO_COVERAGE_BROWSER_PORT || 5193),
    strictPort: true,
    hmr: false,
  },
});

let browser;
const failures = [];
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.config.server.port}`;
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.on("pageerror", error => failures.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    if (url.origin !== origin) return request.abort();
    if (!url.pathname.startsWith("/api/")) return request.continue();
    if (url.pathname !== "/api/dashboard-plugins/bao-worker-coverage/content") {
      failures.push(`Unexpected API request: ${url.pathname}`);
      return request.abort();
    }
    return request.respond({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(summary),
    });
  });

  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(`${origin}/tests/sitespecific/bao-worker-coverage/browser.html`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="card-dashboard-bao-worker-coverage"]');
  await page.waitForSelector(".bao-worker-coverage-status--bad");

  const verifyVisibleCore = async () => {
    const values = await page.evaluate(() => {
      const card = document.querySelector(".bao-worker-coverage-card");
      const status = document.querySelector(".bao-worker-coverage-current-status");
      const footer = document.querySelector(".bao-worker-coverage-footer a");
      if (!card || !status || !footer) throw new Error("Coverage card status or footer is missing");
      const rect = card.getBoundingClientRect();
      const statusRect = status.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        cardLeft: rect.left,
        cardRight: rect.right,
        statusVisible: statusRect.width > 0 && statusRect.height > 0,
        footerVisible: footerRect.width > 0 && footerRect.height > 0,
        statusLabel: status.querySelector(".sr-only")?.textContent?.trim(),
        footerHref: footer.getAttribute("href"),
        footerText: footer.textContent?.trim(),
        footerNote: document.querySelector(".bao-worker-coverage-footer")?.textContent?.trim(),
      };
    });
    assert.equal(values.documentWidth, values.viewportWidth, `horizontal overflow at ${values.viewportWidth}px`);
    assert.ok(values.cardLeft >= 0 && values.cardRight <= values.viewportWidth, `card exceeds viewport at ${values.viewportWidth}px`);
    assert.ok(values.statusVisible, `coverage status is not visible at ${values.viewportWidth}px`);
    assert.ok(values.footerVisible, `footer link is not visible at ${values.viewportWidth}px`);
    assert.equal(values.statusLabel, "Not covered");
    assert.equal(values.footerHref, "/workers/fixture-worker/employment/monthly");
    assert.equal(values.footerText, "View your full monthly hours breakdown");
    assert.ok(values.footerNote.includes("Contact the fund with any questions or concerns."));
  };

  await verifyVisibleCore();
  const desktop = await page.evaluate(() => ({
    headerDisplay: getComputedStyle(document.querySelector(".bao-worker-coverage-table-head")).display,
    rowColumns: getComputedStyle(document.querySelector(".bao-worker-coverage-table-row")).gridTemplateColumns,
    labels: [...document.querySelectorAll(".bao-worker-coverage-table-head span")].map(node => node.textContent.trim()),
  }));
  assert.notEqual(desktop.headerDisplay, "none");
  assert.deepEqual(desktop.labels, ["Work Month", "Reported Hours", "Coverage Month", "Hours Threshold Met"]);
  assert.equal((await page.$$(".bao-worker-coverage-row--met")).length, 1);
  assert.equal((await page.$$(".bao-worker-coverage-row--pending")).length, 1);

  await page.setViewport({ width: 375, height: 812 });
  await verifyVisibleCore();
  const mobile = await page.evaluate(() => {
    const header = document.querySelector(".bao-worker-coverage-table-head");
    const row = document.querySelector(".bao-worker-coverage-table-row");
    const reported = row?.children[1];
    const rect = row?.getBoundingClientRect();
    return {
      headerDisplay: header && getComputedStyle(header).display,
      rowColumns: row && getComputedStyle(row).gridTemplateColumns,
      responsiveLabel: reported && getComputedStyle(reported, "::before").content,
      rowLeft: rect?.left,
      rowRight: rect?.right,
    };
  });
  assert.equal(mobile.headerDisplay, "none");
  assert.equal(mobile.responsiveLabel, '"Reported"');
  assert.ok(mobile.rowLeft >= 0 && mobile.rowRight <= 375, "mobile future row exceeds viewport");
  assert.deepEqual(failures, []);
  console.log("BAO worker coverage browser checks passed at 1200px and 375px");
} finally {
  if (failures.length) console.error("Browser fixture errors:", failures);
  await browser?.close();
  await server.close();
}