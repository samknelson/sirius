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
  currentMonth: "September 2026",
  totalActiveWorkers: 25,
  totalCharges: "8782.14",
  totalPaid: "3500.00",
  totalBalance: "5282.14",
  statusCounts: {
    paid_covered: 7, partially_paid: 3, unpaid_not_covered: 10,
    confirmed_no_charge: 4, unavailable_not_covered: 1,
  },
};

const server = await createServer({
  configFile: false,
  envFile: false,
  root,
  cacheDir: path.join(root, "node_modules/.vite-bao-dp-summary-browser"),
  optimizeDeps: { entries: [path.join(root, "tests/sitespecific/bao-dp-summary/browser.html")], holdUntilCrawlEnd: false },
  plugins: [react()],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: {
    host: "127.0.0.1", port: 5194, strictPort: true, hmr: false,
    watch: { ignored: ["**/.local/**", "**/node_modules/**", "**/.git/**"] },
  },
});

let browser;
try {
  await server.listen();
  const origin = "http://127.0.0.1:5194";
  browser = await puppeteer.launch({
    executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin !== origin) return request.abort();
    if (!url.pathname.startsWith("/api/")) return request.continue();
    assert.equal(url.pathname, "/api/dashboard-plugins/bao-dp-summary/content");
    return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(summary) });
  });

  for (const { viewport, card, font, balance, columns } of [
    { viewport: 1300, card: 390, font: 16, balance: "5282.14", columns: 1 },
    { viewport: 320, card: 320, font: 16, balance: "5282.14", columns: 1 },
    { viewport: 1300, card: 560, font: 16, balance: "1234567890.14", columns: 2 },
    { viewport: 1300, card: 1100, font: 16, balance: "1234567890.14", columns: 4 },
    { viewport: 1300, card: 390, font: 24, balance: "1234567890.14", columns: 1 },
    { viewport: 320, card: 320, font: 24, balance: "1234567890.14", columns: 1 },
    { viewport: 320, card: 320, font: 32, balance: "1234567890.14", columns: 1 },
  ]) {
    summary.totalBalance = balance;
    await page.setViewport({ width: viewport, height: 1000 });
    await page.goto(`${origin}/tests/sitespecific/bao-dp-summary/browser.html`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.evaluate(({ card, font }) => {
      document.documentElement.style.fontSize = `${font}px`;
      document.documentElement.style.setProperty("--card-width", `${card}px`);
    }, { card, font });
    await page.waitForSelector('[data-testid="link-bao-dp-total-balance"]', { timeout: 90_000 });
    const result = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="card-dashboard-bao-dp-summary"]');
      const metrics = [...card.querySelectorAll(".bao-dp-summary-metric")];
      const statusRows = [...card.querySelectorAll('[data-testid^="link-bao-dp-status-"]')];
      const bounds = card.getBoundingClientRect();
      const rects = metrics.map(node => node.getBoundingClientRect());
      const contained = (outer, inner) =>
        inner.left >= outer.left - 1 && inner.right <= outer.right + 1 &&
        inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
      const textInsideTiles = metrics.every(node => {
        const tile = node.getBoundingClientRect();
        return [...node.querySelectorAll("span")].every(span => {
          const range = document.createRange();
          range.selectNodeContents(span);
          return [...range.getClientRects()].every(rect => contained(tile, rect));
        });
      });
      return {
        columns: getComputedStyle(card.querySelector(".bao-dp-summary-metrics")).gridTemplateColumns.split(" ").filter(track => parseFloat(track) > 0).length,
        cardInsideViewport: contained({ left: 0, right: innerWidth, top: -Infinity, bottom: Infinity }, bounds),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        tilesInsideCard: rects.every(rect => contained(bounds, rect)),
        textInsideTiles,
        tilesDisjoint: rects.every((a, i) => rects.every((b, j) =>
          i === j || a.right <= b.left + 1 || b.right <= a.left + 1 ||
          a.bottom <= b.top + 1 || b.bottom <= a.top + 1)),
        links: metrics.map(node => node.getAttribute("href")),
        statusLinks: statusRows.map(node => node.getAttribute("href")),
        balance: metrics[3].textContent,
      };
    });
    const where = `viewport ${viewport}, card ${card}, font ${font}, balance ${balance}`;
    assert.equal(result.columns, columns, `metric columns: ${where}`);
    assert.ok(result.cardInsideViewport && result.documentWidth <= result.viewportWidth, `outer overflow: ${where}`);
    assert.ok(result.tilesInsideCard && result.textInsideTiles && result.tilesDisjoint, `metric overlap/overflow: ${where}`);
    assert.deepEqual(result.links, Array(4).fill("/bao/dp/workers"), `metric links: ${where}`);
    assert.deepEqual(result.statusLinks, [
      "paid_covered", "partially_paid", "unpaid_not_covered", "confirmed_no_charge", "unavailable_not_covered",
    ].map(status => `/bao/dp/workers?status=${status}`), `status links: ${where}`);
    assert.ok(result.balance.includes(Number(balance).toLocaleString("en-US", { style: "currency", currency: "USD" })));
    console.log(`PASS ${where}`);
  }
  await page.click('[data-testid="link-bao-dp-total-balance"]');
  await page.waitForFunction(() => location.pathname === "/bao/dp/workers");
  await page.goto(`${origin}/tests/sitespecific/bao-dp-summary/browser.html`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector('[data-testid="link-bao-dp-status-partially_paid"]');
  await page.click('[data-testid="link-bao-dp-status-partially_paid"]');
  await page.waitForFunction(() => location.pathname === "/bao/dp/workers" && location.search === "?status=partially_paid");
  assert.deepEqual(errors, []);
  console.log("PASS metric and status navigation");
} finally {
  await browser?.close();
  await server.close();
}