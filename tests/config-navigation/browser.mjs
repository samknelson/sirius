import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

// Isolated browser fixture: no application server, database, environment file,
// credentials or provider is loaded. Unexpected networking fails closed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath = process.env.CHROMIUM_PATH || [
  "/repl/tools/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);
assert.ok(executablePath, "Set CHROMIUM_PATH to a local Chromium executable");

const server = await createServer({
  configFile: false,
  envFile: false,
  root,
  cacheDir: path.join(root, "node_modules/.vite-config-navigation-browser"),
  optimizeDeps: {
    entries: [path.join(root, "tests/config-navigation/browser.html")],
    holdUntilCrawlEnd: false,
  },
  plugins: [react(), {
    name: "config-navigation-browser-entry",
    configureServer(viteServer) {
      viteServer.middlewares.use((request, _response, next) => {
        if (request.url && !request.url.startsWith("/api/")
          && !request.url.startsWith("/tests/")
          && !request.url.startsWith("/@")
          && !request.url.startsWith("/node_modules/")
          && !request.url.includes(".")) {
          request.url = "/tests/config-navigation/browser.html";
        }
        next();
      });
    },
  }],
  resolve: {
    alias: {
      "@": path.join(root, "client/src"),
      "@shared": path.join(root, "shared"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.CONFIG_NAV_BROWSER_PORT || 5191),
    strictPort: true,
    hmr: false,
  },
});

const enabledComponents = [
  "trust.elections",
  "ledger",
  "event",
  "dispatch",
].map(componentId => ({ componentId, enabled: true }));

function fixture(pathname) {
  if (pathname === "/api/auth/user") {
    return {
      user: { id: "config-nav-admin", email: "config-nav@example.invalid" },
      permissions: ["admin", "staff"],
      components: enabledComponents.map(component => component.componentId),
      timezone: {
        systemTimeZone: "UTC",
        userTimeZone: null,
        allowUserTimezones: false,
      },
    };
  }
  if (pathname === "/api/components/config") return enabledComponents;
  if (pathname.startsWith("/api/access/policies/")) return { access: { granted: true } };
  if (pathname === "/api/catalogs/options-lists") {
    return {
      catalog: {
        id: "options-lists",
        name: "Options Lists",
        entries: [
          {
            id: "gender",
            name: "Gender",
            description: "Gender options",
            detail: { pluralName: "Genders", bespokePath: null },
          },
          {
            id: "event-type",
            name: "Event Type",
            description: "Event type options",
            component: "event",
            detail: { pluralName: "Event Types", bespokePath: "/config/event-types" },
          },
        ],
      },
    };
  }
  throw new Error(`Unexpected API request: ${pathname}`);
}

async function box(page, selector) {
  return page.$eval(selector, element => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });
}

async function navigate(page, pathname) {
  await page.evaluate(next => {
    history.pushState(null, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, pathname);
  await page.waitForFunction(expected =>
    document.querySelector('[data-testid="fixture-location"]')?.textContent === expected,
  {}, pathname);
}

let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.config.server.port}`;
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    if (url.origin !== origin) {
      failures.push(`Unexpected external request ${url.origin}`);
      return request.abort();
    }
    if (!url.pathname.startsWith("/api/")) return request.continue();
    try {
      await request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixture(url.pathname)),
      });
    } catch (error) {
      failures.push(error.message);
      await request.abort();
    }
  });

  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
  await page.goto(`${origin}/trust-benefits/benefit-fixture`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForSelector('[data-testid="nav-config-trust"]');
  assert.equal(
    await page.$eval('[data-testid="fixture-location"]', node => node.textContent),
    "/trust-benefits/benefit-fixture",
    "direct descendants load inside the configuration boundary",
  );
  assert.equal(await page.$$eval('aside[aria-label="Configuration menu"]', nodes => nodes.length), 1,
    "nested configuration layouts must render one sidebar");

  // Access filtering and dynamic catalog resolution both run through the real hooks.
  await page.waitForSelector('[data-testid="nav-config-open-enrollment-windows"]');
  assert.ok(await page.$('[data-testid="nav-config-open-enrollment-windows"]'),
    "enabled Trust entries are visible");
  assert.equal(await page.$('[data-testid="nav-config-bao-thresholds"]'), null,
    "component-filtered Trust entries are absent");
  await page.click('[data-testid="nav-config-dropdown-lists"]');
  await page.waitForSelector('[data-testid="nav-config-options-gender"]');
  assert.equal(
    await page.$eval('[data-testid="nav-config-options-gender"]', node => node.textContent.trim()),
    "Gender",
    "catalog-derived entries are rendered under the dynamic section",
  );

  // Long production Trust labels wrap without colliding with icons or content.
  const trustItem = await box(page, '[data-testid="nav-config-open-enrollment-windows"]');
  const sidebar = await box(page, 'aside[aria-label="Configuration menu"]');
  assert.ok(trustItem.right <= sidebar.right && trustItem.scrollWidth <= trustItem.clientWidth,
    "long Trust labels remain within the sidebar");
  assert.equal(await page.$eval('aside[aria-label="Configuration menu"]', element =>
    getComputedStyle(element).overflowX), "hidden");

  // An active section remains user-collapsible, and a new destination opens its ancestor.
  await page.click('[data-testid="nav-config-trust"]');
  assert.equal(await page.$('[data-testid="nav-trust-benefits"]'), null,
    "active Trust section can be collapsed");
  await navigate(page, "/config/system-mode");
  await page.waitForSelector('[data-testid="nav-config-system-mode"]');
  assert.equal(
    await page.$eval('[data-testid="nav-config-system"]', node => node.getAttribute("aria-expanded")),
    "true",
    "a newly active destination opens its ancestor",
  );

  // Keyboard toggle plus persistence across navigation and full remount/refresh.
  const desktopToggle = '[data-testid="button-configuration-menu-desktop"]';
  await page.focus(desktopToggle);
  await page.keyboard.press("Enter");
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "false");
  await navigate(page, "/config/auth-settings");
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "false",
    "whole-menu state survives navigation");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(desktopToggle);
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "false",
    "whole-menu state survives remount and refresh");
  await page.focus(desktopToggle);
  await page.keyboard.press("Space");
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "true");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('aside[aria-label="Configuration menu"]');
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "true");

  // A 640-CSS-pixel viewport represents a desktop viewport at 200% zoom.
  await navigate(page, "/trust-benefits/benefit-fixture");
  await page.setViewport({ width: 640, height: 760, deviceScaleFactor: 2 });
  await page.waitForSelector('[data-testid="button-configuration-menu-mobile"]');
  assert.equal(await page.$eval('aside[aria-label="Configuration menu"]', element =>
    getComputedStyle(element).display), "none");
  const mobileToggle = '[data-testid="button-configuration-menu-mobile"]';
  await page.focus(mobileToggle);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('aside[aria-label="Configuration menu"]')).display !== "none");
  const mobileSidebar = await box(page, 'aside[aria-label="Configuration menu"]');
  assert.ok(mobileSidebar.left >= 0 && mobileSidebar.right <= 640,
    "mobile configuration menu stays inside the viewport");
  assert.equal(await page.$eval('aside[aria-label="Configuration menu"]', element =>
    element.scrollWidth <= element.clientWidth), true,
    "mobile menu has no horizontal overflow");
  await page.waitForSelector('[data-testid="nav-config-open-enrollment-windows"]');
  const mobileTrustItem = await box(page, '[data-testid="nav-config-open-enrollment-windows"]');
  assert.ok(mobileTrustItem.right <= mobileSidebar.right
    && mobileTrustItem.scrollWidth <= mobileTrustItem.clientWidth,
    "long Trust labels wrap inside the 200%-equivalent mobile menu");

  await mkdir(path.join(root, "screenshots"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "screenshots/config-navigation-mobile-200-percent.png"),
    fullPage: true,
  });
  assert.deepEqual(failures, [], "No browser exceptions, console errors, or unexpected networking");
  console.log("PASS config navigation: desktop, mobile, persistence, filtering, nesting");
  console.log(`Screenshot: screenshots/config-navigation-mobile-200-percent.png`);
  await page.close();
} finally {
  await browser?.close();
  await server.close();
}