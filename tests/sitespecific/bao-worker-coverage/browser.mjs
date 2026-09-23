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
  await page.waitForFunction(() => document.querySelector('[aria-label="Not covered"]'));

  const verifyVisibleCore = async (host) => {
    const values = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="card-dashboard-bao-worker-coverage"]');
      const status = card?.querySelector('[role="status"]');
      const footer = card?.querySelector('[data-testid="link-bao-worker-coverage-monthly-hours"]');
      if (!card || !status || !footer) throw new Error("Coverage card status or footer is missing");
      const rect = card.getBoundingClientRect();
      const statusRect = status.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const future = card.querySelector('[aria-label="Future coverage"]');
      const current = card.querySelector('[aria-label="Current coverage"]');
      const metrics = card.querySelector(".bao-coverage-metrics");
      const periods = card.querySelector(".bao-coverage-periods");
      const colors = [getComputedStyle(card).color, getComputedStyle(card).backgroundColor];
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        cardLeft: rect.left,
        cardRight: rect.right,
        cardWidth: rect.width,
        statusVisible: statusRect.width > 0 && statusRect.height > 0,
        footerVisible: footerRect.width > 0 && footerRect.height > 0,
        statusLabel: status.getAttribute("aria-label"),
        footerHref: footer.getAttribute("href"),
        footerText: footer.textContent?.trim(),
        footerNote: card.textContent?.trim(),
        futureLabels: [...future.querySelectorAll("article")].map(node => node.textContent.trim()),
        currentText: current.textContent.trim(),
        metricsColumns: getComputedStyle(metrics).gridTemplateColumns.split(" ").length,
        periodColumns: getComputedStyle(periods).gridTemplateColumns.split(" ").length,
        blocking: [...current.querySelectorAll("[data-blocking]")].map(node => node.getAttribute("data-blocking")),
        colors,
        widestChild: Math.max(...[...card.querySelectorAll("section, article, [data-blocking]")].map(node => node.getBoundingClientRect().right)),
      };
    });
    assert.ok(values.documentWidth <= values.viewportWidth, `horizontal overflow in ${host} at ${values.viewportWidth}px`);
    assert.ok(values.cardLeft >= 0 && values.cardRight <= values.viewportWidth, `card exceeds viewport in ${host}`);
    assert.ok(values.widestChild <= values.cardRight, `card content overflows in ${host}`);
    assert.ok(values.statusVisible, `coverage status is not visible at ${values.viewportWidth}px`);
    assert.ok(values.footerVisible, `footer link is not visible at ${values.viewportWidth}px`);
    assert.equal(values.statusLabel, "Not covered");
    assert.equal(values.footerHref, "/workers/fixture-worker/employment/monthly");
    assert.equal(values.footerText, "View your full monthly hours breakdown");
    assert.ok(values.footerNote.includes("Contact the fund with any questions or concerns."));
    assert.ok(values.currentText.includes("99.75 hrs"));
    assert.ok(values.currentText.includes("100 hrs"));
    assert.ok(values.currentText.includes("-$12.50"));
    assert.deepEqual(values.blocking, ["hours"]);
    assert.equal(values.futureLabels.length, 2);
    assert.ok(values.futureLabels[0].includes("Hours threshold met"));
    assert.ok(values.futureLabels[0].includes("125.25 hrs / 100 hrs"));
    assert.ok(values.futureLabels[1].includes("Hours threshold pending"));
    assert.ok(values.futureLabels[1].includes("Coverage month"));
    assert.notEqual(values.colors[0], values.colors[1], `unreadable card in ${host}`);
    return values;
  };

  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    for (const host of ["dashboard", "staff"]) {
      await page.setViewport({ width: 1200, height: 900 });
      await page.evaluate(host => {
        document.querySelector("main").style.maxWidth = host === "staff" ? "640px" : "";
      }, host);
      const desktop = await verifyVisibleCore(`${host} ${theme} desktop`);
      assert.equal(desktop.metricsColumns, host === "staff" ? 2 : 3);
      assert.equal(desktop.periodColumns, 2);
      await page.setViewport({ width: 375, height: 812 });
      const mobile = await verifyVisibleCore(`${host} ${theme} phone`);
      assert.equal(mobile.periodColumns, 1);
      assert.ok(mobile.cardWidth < 375);
    }
  }
  assert.deepEqual(failures, []);
  console.log("BAO worker coverage browser checks passed in dashboard/staff widths, light/dark, desktop/phone");
} finally {
  if (failures.length) console.error("Browser fixture errors:", failures);
  await browser?.close();
  await server.close();
}