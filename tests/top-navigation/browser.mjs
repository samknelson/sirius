import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath = process.env.CHROMIUM_PATH || [
  "/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find(existsSync);
assert.ok(executablePath, "Set CHROMIUM_PATH to a local Chromium executable");
const menu = {
  plugin: "fixture",
  items: [
    { id: "home", icon: "Home", label: "Home navigation destination", href: "/home" },
    { id: "workers", icon: "Users", label: "Workers and people", children: [
      { id: "workers-list", icon: "List", label: "Worker list", href: "/workers" },
    ] },
    { id: "employers", icon: "Building2", label: "Employers and organizations", href: "/employers" },
    { id: "settings", icon: "Settings", label: "Settings and preferences", href: "/settings" },
  ],
};
const server = await createServer({
  configFile: false, envFile: false, root,
  cacheDir: path.join(root, "node_modules/.vite-top-navigation-browser"),
  optimizeDeps: { entries: [path.join(root, "tests/top-navigation/browser.html")], holdUntilCrawlEnd: false },
  plugins: [react(), {
    name: "top-navigation-browser-entry",
    configureServer(viteServer) {
      viteServer.middlewares.use((request, _response, next) => {
        if (request.url && !request.url.startsWith("/api/") && !request.url.startsWith("/tests/")
          && !request.url.startsWith("/@") && !request.url.startsWith("/node_modules/")
          && !request.url.includes(".")) request.url = "/tests/top-navigation/browser.html";
        next();
      });
    },
  }],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: { host: "127.0.0.1", port: 5192, strictPort: true, hmr: false },
});
let browser;
const failures = [];
try {
  await server.listen();
  const origin = "http://127.0.0.1:5192";
  browser = await puppeteer.launch({ executablePath, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  page.on("pageerror", error => failures.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    if (url.origin !== origin) return request.abort();
    if (!url.pathname.startsWith("/api/")) return request.continue();
    let body;
    if (url.pathname === "/api/auth/user") body = {
      user: { id: "fixture", email: "fixture@example.invalid" },
      permissions: [], components: [],
      timezone: { systemTimeZone: "UTC", userTimeZone: null, allowUserTimezones: false },
    };
    else if (url.pathname === "/api/menu") body = menu;
    else if (url.pathname === "/api/auth/providers") body = { providers: [] };
    else if (url.pathname === "/api/alerts/unread-count") body = { count: 0 };
    else if (url.pathname === "/api/quicksearch/available") body = { available: false };
    else if (url.pathname.startsWith("/api/variables/by-name/")) body = { value: null };
    else {
      failures.push(`Unexpected API request: ${url.pathname}`);
      return request.abort();
    }
    await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  const nav = "#site-menu";
  const compact = value => page.waitForFunction(expected =>
    document.querySelector("#site-menu")?.getAttribute("data-compact") === expected,
  {}, String(value));
  const assertDistributedGeometry = async (expectedCount, isCompact) => {
    const geometry = await page.$eval(nav, el => {
      const row = el.getBoundingClientRect();
      const buttons = [...el.querySelectorAll('[data-testid^="nav-"]')].map(
        button => button.getBoundingClientRect());
      const style = getComputedStyle(el);
      return {
        left: buttons[0].left - row.left,
        right: row.right - buttons.at(-1).right,
        paddingLeft: parseFloat(style.paddingLeft),
        paddingRight: parseFloat(style.paddingRight),
        gaps: buttons.slice(1).map((button, index) => button.left - buttons[index].right),
        widths: buttons.map(button => button.width),
        clippedText: [...el.querySelectorAll('[data-testid^="nav-"]')].some(
          button => button.scrollWidth > button.clientWidth + 1),
        overflow: el.scrollWidth > el.clientWidth || document.documentElement.scrollWidth > innerWidth,
        visible: buttons.every(button => button.left >= row.left && button.right <= row.right),
      };
    });
    assert.equal(geometry.widths.length, expectedCount);
    assert.equal(geometry.overflow, false, "navigation must not overflow horizontally");
    assert.equal(geometry.visible, true, "all controls must remain visible");
    assert.equal(geometry.clippedText, false, "navigation labels must not be clipped");
    assert.ok(Math.abs(geometry.left - geometry.paddingLeft) <= 1 &&
      Math.abs(geometry.right - geometry.paddingRight) <= 1,
    `entries must reach both padded row edges: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.gaps.every(gap => Math.abs(gap) <= 1),
      `clickable areas should cover the intervening space: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.widths.every(width => width >= 36),
      `controls must retain usable width: ${JSON.stringify(geometry)}`);
    if (isCompact) {
      assert.ok(geometry.widths.every(width => Math.abs(width - geometry.widths[0]) <= 1),
        `icon-only controls should divide the row evenly: ${JSON.stringify(geometry)}`);
    }
  };
  await page.setViewport({ width: 1200, height: 760 });
  await page.goto(`${origin}/home`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector('[data-testid="nav-settings"]');
  await compact(false);
  assert.match(await page.$eval('[data-testid="nav-workers"]', el => el.textContent), /Workers/);
  await assertDistributedGeometry(4, false);
  await page.setViewport({ width: 1600, height: 760 });
  await compact(false);
  await assertDistributedGeometry(4, false);
  await page.click('[data-testid="nav-workers"]');
  await page.waitForSelector('[data-testid="menu-workers-list"]');
  await page.keyboard.press("Escape");
  await page.setViewport({ width: 768, height: 760 });
  await compact(true);
  await assertDistributedGeometry(4, true);
  if (process.env.TOP_NAV_SCREENSHOT) {
    await page.screenshot({ path: process.env.TOP_NAV_SCREENSHOT });
  }
  assert.deepEqual(await page.$eval(nav, el => ({
    overflow: el.scrollWidth > el.clientWidth,
     entries: [...el.querySelectorAll('[data-testid^="nav-"]')].map(button =>
       ({ label: button.getAttribute("aria-label"),
        visible: button.getBoundingClientRect().right <= el.getBoundingClientRect().right })),
  })), {
    overflow: false,
    entries: menu.items.map(item => item.label).map(label =>
       ({ label, visible: true })),
  });
  await page.hover('[data-testid="nav-workers"]');
  await page.waitForSelector('[role="tooltip"]');
  assert.match(await page.$eval('[role="tooltip"]', el => el.textContent), /Workers/);
  await page.focus('[data-testid="nav-home"]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="tooltip"]')].some(el => el.textContent.includes("Home navigation")));
  await page.focus('[data-testid="nav-workers"]');
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-testid="menu-workers-list"]');
  assert.equal(await page.$eval('[data-testid="menu-workers-list"]', element =>
    element.getBoundingClientRect().top >= document.querySelector("#site-menu").getBoundingClientRect().bottom),
  true, "dropdown content is visible below the navigation row");
  await page.keyboard.press("Escape");
  await page.focus('[data-testid="nav-employers"]');
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="fixture-location"]')?.textContent === "/employers");
  assert.equal(await page.$eval('[data-testid="nav-employers"]', el =>
    el.getAttribute("aria-current")), "page");
  await page.setViewport({ width: 800, height: 760 });
  await compact(true);
  await assertDistributedGeometry(4, true);
  await page.setViewport({ width: 1200, height: 760 });
  await compact(false);
  await assertDistributedGeometry(4, false);
  await page.evaluate(next => window.setFixtureMenu(next), {
    ...menu, items: menu.items.map(item => ({ ...item, label: `${item.label} — extended navigation label` })),
  });
  await compact(true);
  await assertDistributedGeometry(4, true);
  await page.evaluate(next => window.setFixtureMenu(next), {
    ...menu, items: [
      ...menu.items.map(item => ({ ...item, label: `${item.label} — extended navigation label` })),
      { id: "reports", icon: "FileText", label: "Reports and activity — extended navigation label", href: "/reports" },
    ],
  });
  await page.waitForSelector('[data-testid="nav-reports"]');
  await assertDistributedGeometry(5, true);
  await page.evaluate(next => window.setFixtureMenu(next), menu);
  await compact(false);
  await assertDistributedGeometry(4, false);
  await page.evaluate(next => window.setFixtureMenu(next), {
    ...menu, items: menu.items.slice(0, 2),
  });
  await page.waitForFunction(() => document.querySelectorAll('#site-menu [data-testid^="nav-"]').length === 2);
  await compact(false);
  await assertDistributedGeometry(2, false);
  await page.setViewport({ width: 768, height: 760 });
  await compact(false);
  await assertDistributedGeometry(2, false);
  await page.evaluate(next => window.setFixtureMenu(next), {
    ...menu, items: menu.items.slice(0, 1),
  });
  await page.waitForFunction(() => document.querySelectorAll('#site-menu [data-testid^="nav-"]').length === 1);
  await assertDistributedGeometry(1, false);
  await page.evaluate(next => window.setFixtureMenu(next), menu);
  await compact(true);
  await assertDistributedGeometry(4, true);
  await page.setViewport({ width: 1200, height: 760 });
  await compact(false);
  const termMenu = { ...menu, items: menu.items.map(item => item.id === "workers"
    ? { ...item, label: undefined, labelTerm: { key: "worker", plural: true } } : item) };
  await page.evaluate(next => window.setFixtureMenu(next), termMenu);
  await compact(false);
  await page.evaluate(() => window.setFixtureTerminology({ worker: {
    singular: "Worker",
    plural: "People who work across all our partner organizations and departments in every region",
  } }));
  await compact(true);
  await assertDistributedGeometry(4, true);
  assert.match(await page.$eval('[data-testid="nav-workers"]', el => el.getAttribute("aria-label")), /partner organizations/);
  await page.evaluate(() => window.setFixtureTerminology(null));
  await compact(false);
  await page.evaluate(next => window.setFixtureMenu(next), menu);
  await page.setViewport({ width: 600, height: 760 });
  await page.waitForSelector('[data-testid="button-mobile-menu"]');
  assert.equal(await page.$eval(nav, el => getComputedStyle(el).display), "none");
  await page.click('[data-testid="button-mobile-menu"]');
  await page.waitForSelector('[data-testid="mobile-nav-section-workers"]', { visible: true });
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="mobile-nav-section-workers"]');
    const rect = element?.getBoundingClientRect();
    return rect && rect.left >= 0 && rect.right <= innerWidth;
  });
  await page.click('[data-testid="mobile-nav-section-workers"]');
  await page.waitForSelector('[data-testid="mobile-nav-workers-list"]');
  await page.click('[data-testid="mobile-nav-workers-list"]');
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="fixture-location"]')?.textContent === "/workers");
  await page.waitForFunction(() => !document.querySelector('[data-testid="button-mobile-menu"]')?.closest('[data-state="open"]'));
  await page.setViewport({ width: 768, height: 760 });
  await compact(true);
  await assertDistributedGeometry(4, true);
  assert.deepEqual(failures, []);
  console.log("Top navigation browser checks passed");
} finally {
  // Report fixture failures before closing Vite; cleanup can otherwise obscure them.
  if (failures.length) console.error("Browser fixture errors:", failures);
  await browser?.close();
  await server.close();
}