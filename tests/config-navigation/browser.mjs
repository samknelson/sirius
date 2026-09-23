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

async function waitForAbsent(page, selector) {
  await page.waitForFunction(value => !document.querySelector(value), {}, selector);
}

async function setDarkMode(page, dark) {
  await page.evaluate(enabled => {
    document.documentElement.classList.toggle("dark", enabled);
  }, dark);
}

async function waitForSidebarWidth(page, expectedWidth) {
  await page.waitForFunction(width => {
    const sidebar = document.querySelector('aside[aria-label="Configuration menu"]');
    return sidebar && Math.round(sidebar.getBoundingClientRect().width) === width;
  }, {}, expectedWidth);
}

async function waitForPendingCatalog(readPending, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (!readPending()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the fixture catalog request");
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return readPending();
}

let browser;
let pendingCatalogRequest = null;
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
      // Hold the dynamic catalog until the test has observed its honest
      // loading state. All other answers still use the real production hooks.
      if (url.pathname === "/api/catalogs/options-lists" && !pendingCatalogRequest) {
        pendingCatalogRequest = request;
        return;
      }
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

  // Access filtering and dynamic catalog resolution both run through the real
  // hooks. The deferred fixture response makes loading -> error -> retry ->
  // ready deterministic in both expanded and flyout renderers.
  const desktopToggle = '[data-testid="button-configuration-menu-desktop"]';
  const sidebarSelector = 'aside[aria-label="Configuration menu"]';
  const assertBottomControl = async (label, state) => {
    assert.deepEqual(await page.$eval(sidebarSelector, aside => {
      const toggle = aside.querySelector('[data-testid="button-configuration-menu-desktop"]');
      const nav = aside.querySelector('[data-testid="configuration-nav-scroll"]');
      return {
        lastControl: [...aside.querySelectorAll("button, a")].filter(element => element.getClientRects().length).at(-1) === toggle,
        afterSections: !!toggle && !!nav && !!(nav.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING),
        noHomeLink: !aside.querySelector('a[href="/config"]'),
        label: toggle?.getAttribute("aria-label"),
        expanded: toggle?.getAttribute("aria-expanded"),
      };
    }), {
      lastControl: true,
      afterSections: true,
      noHomeLink: true,
      label,
      expanded: state,
    }, `${label} follows the section list without a home link`);
  };
  await assertBottomControl("Collapse configuration menu", "true");
  await page.click('[data-testid="nav-config-dropdown-lists"]');
  await page.waitForSelector('[data-testid="text-dropdown-lists-loading"]');
  assert.match(
    await page.$eval('[data-testid="text-dropdown-lists-loading"]', node => node.textContent),
    /Loading/,
    "dynamic sections expose their loading status",
  );
  await page.click(desktopToggle);
  await waitForSidebarWidth(page, 56);
  await page.click('[data-testid="nav-config-rail-dropdown-lists"]');
  const dropdownFlyout = '[data-testid="configuration-flyout-dropdown-lists"]';
  await page.waitForSelector(`${dropdownFlyout} [data-testid="text-dropdown-lists-loading"]`);
  await (await waitForPendingCatalog(() => pendingCatalogRequest)).respond({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ message: "Fixture catalog unavailable" }),
  });
  pendingCatalogRequest = null;
  await page.waitForSelector(`${dropdownFlyout} [data-testid="text-dropdown-lists-error"]`);
  assert.match(
    await page.$eval(`${dropdownFlyout} [data-testid="text-dropdown-lists-error"]`,
      node => node.textContent),
    /Couldn't load/,
    "dynamic flyouts expose their error status",
  );
  await page.evaluate(() => window.retryConfigurationCatalog?.());
  await (await waitForPendingCatalog(() => pendingCatalogRequest)).respond({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(fixture("/api/catalogs/options-lists")),
  });
  pendingCatalogRequest = null;
  await page.waitForSelector(`${dropdownFlyout} [data-testid="nav-config-options-gender"]`);
  await page.keyboard.press("Escape");
  await waitForAbsent(page, dropdownFlyout);
  await page.click(desktopToggle);
  await waitForSidebarWidth(page, 256);
  await page.click('[data-testid="nav-config-trust"]');
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
  await page.click('[data-testid="nav-config-ledger"]');
  assert.equal(await page.$eval('[data-testid="nav-config-ledger"]', node => node.getAttribute("aria-expanded")), "true");
  assert.equal(await page.$eval('[data-testid="nav-config-dropdown-lists"]', node => node.getAttribute("aria-expanded")), "false",
    "opening Ledger closes Dropdown Lists");
  await page.click('[data-testid="nav-config-dropdown-lists"]');
  assert.equal(await page.$eval('[data-testid="nav-config-ledger"]', node => node.getAttribute("aria-expanded")), "false",
    "opening Dropdown Lists closes Ledger");

  // A fixture-only subsection exercises the production recursive renderer.
  await page.click('[data-testid="nav-config-trust"]');
  await page.click('[data-testid="nav-config-fixture-subsection"]');
  await page.waitForSelector('[data-testid="nav-config-fixture-subsection-destination"]');
  await navigate(page, "/trust-benefits/subsection-fixture");
  assert.equal(
    await page.$eval('[data-testid="nav-config-fixture-subsection"]',
      node => node.getAttribute("aria-expanded")),
    "true",
    "navigation opens an active subsection ancestor",
  );
  assert.equal(
    await page.$eval('[data-testid="nav-config-fixture-subsection-destination"]',
      node => node.getAttribute("aria-current")),
    "page",
    "the active subsection destination is exposed to assistive technology",
  );

  // Long production Trust labels wrap without colliding with icons or content.
  const trustItem = await box(page, '[data-testid="nav-config-open-enrollment-windows"]');
  const sidebar = await box(page, 'aside[aria-label="Configuration menu"]');
  assert.ok(trustItem.right <= sidebar.right && trustItem.scrollWidth <= trustItem.clientWidth,
    "long Trust labels remain within the sidebar");
  assert.equal(await page.$eval('aside[aria-label="Configuration menu"]', element =>
    element.scrollWidth <= element.clientWidth), true,
  "expanded sidebar has no horizontal overflow");

  await mkdir(path.join(root, "screenshots"), { recursive: true });
  await setDarkMode(page, false);
  await page.screenshot({
    path: path.join(root, "screenshots/config-navigation-light-expanded.png"),
  });

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

  // The bottom toggle collapses to a persistent 56px rail.
  await page.focus(desktopToggle);
  await page.keyboard.press("Enter");
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "false");
  await waitForSidebarWidth(page, 56);
  await assertBottomControl("Expand configuration menu", "false");
  assert.equal(await page.$eval(sidebarSelector, aside => aside.scrollHeight <= aside.clientHeight), true,
    "the collapsed sidebar itself does not scroll");
  assert.equal(await page.$eval('[data-testid="configuration-nav-scroll"]',
    nav => nav.scrollHeight <= nav.clientHeight), true,
  "the collapsed icon list does not scroll at a normal desktop height");
  const railToggleTop = (await box(page, desktopToggle)).top;
  await page.evaluate(() => {
    document.querySelector("main").style.minHeight = "200vh";
    window.scrollTo(0, 200);
  });
  await page.waitForFunction(() => window.scrollY > 0);
  assert.equal(Math.round((await box(page, desktopToggle)).top), Math.round(railToggleTop),
    "the collapsed rail stays fixed while the page scrolls");
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main").style.minHeight = "";
  });
  assert.equal(Math.round((await box(page, 'aside[aria-label="Configuration menu"]')).width), 56,
    "collapsed desktop navigation is a 56px rail");
  assert.ok(await page.$('[data-testid="nav-config-rail-system"]'),
    "collapsed rail exposes a trigger for each permitted section");
  assert.equal(await page.$('[data-testid="nav-config-rail-sitespecific-bao"]'), null,
    "component-filtered sections are absent from the rail");
  assert.match(
    await page.$eval('[data-testid="nav-config-rail-system"]', node => node.className),
    /before:bg-primary/,
    "the active rail section has a persistent indicator",
  );

  // At a short desktop viewport, the rail scrolls independently while its
  // bottom control remains fixed, and flyouts stay within the available viewport.
  await page.setViewport({ width: 1280, height: 320, deviceScaleFactor: 1 });
  const railScroll = '[data-testid="configuration-nav-scroll"]';
  assert.equal(await page.$eval(railScroll, node => node.scrollHeight > node.clientHeight), true,
    "the short rail has an independently scrollable section region");
  const railToggleBefore = await box(page, desktopToggle);
  await page.$eval(railScroll, node => {
    node.scrollTop = node.scrollHeight;
  });
  const railToggleAfter = await box(page, desktopToggle);
  assert.equal(Math.round(railToggleAfter.top), Math.round(railToggleBefore.top),
    "scrolling the short rail does not move its bottom control");
  assert.ok(railToggleAfter.top >= 0 && railToggleAfter.bottom <= 320,
    "the rail bottom control remains inside a short viewport");
  assert.ok(railToggleAfter.top >= (await box(page, railScroll)).bottom,
    "the collapsed navigation scrolls above the bottom control");
  await page.$eval(railScroll, node => {
    node.scrollTop = 0;
  });
  const systemRail = '[data-testid="nav-config-rail-system"]';
  const systemFlyout = '[data-testid="configuration-flyout-system"]';
  await page.focus(systemRail);
  await page.keyboard.press("Enter");
  await page.waitForSelector(systemFlyout);
  const shortFlyout = await box(page, systemFlyout);
  assert.ok(shortFlyout.top >= 0 && shortFlyout.bottom <= 320,
    "flyouts remain within a short viewport");
  assert.equal(await page.$eval(systemFlyout, node => node.getAttribute("aria-label")), "System");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(selector => {
    const active = document.activeElement;
    return active?.matches("a[href]") && !!active.closest(selector);
  }, systemFlyout), true, "Tab moves keyboard focus into flyout links");
  await page.keyboard.press("Escape");
  await waitForAbsent(page, systemFlyout);
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });

  await page.screenshot({
    path: path.join(root, "screenshots/config-navigation-light-collapsed.png"),
  });

  // Rail flyouts support keyboard operation and restore focus on Escape.
  await page.focus(systemRail);
  await page.keyboard.press("Enter");
  await page.waitForSelector(systemFlyout);
  assert.equal(await page.$eval(systemRail, node => node.getAttribute("aria-expanded")), "true");
  assert.ok(await page.$(`${systemFlyout} [data-testid="nav-config-auth-settings"]`),
    "permitted links are present in a flyout");
  assert.equal(await page.$(`${systemFlyout} [data-testid="nav-admin-debug-event-bus"]`), null,
    "component-filtered links stay absent from a flyout");
  await page.screenshot({
    path: path.join(root, "screenshots/config-navigation-light-flyout.png"),
  });
  await page.keyboard.press("Escape");
  await waitForAbsent(page, systemFlyout);
  assert.equal(
    await page.evaluate(selector => document.activeElement === document.querySelector(selector), systemRail),
    true,
    "Escape closes the flyout and returns focus to its rail trigger",
  );

  // Outside interaction dismisses without changing location.
  await page.keyboard.press("Enter");
  await page.waitForSelector(systemFlyout);
  await page.click('[data-testid="fixture-page"]');
  await waitForAbsent(page, systemFlyout);
  assert.equal(
    await page.$eval('[data-testid="fixture-location"]', node => node.textContent),
    "/config/system-mode",
  );

  // Navigation and even selecting the already-active link dismiss flyouts.
  const trustRail = '[data-testid="nav-config-rail-trust"]';
  const trustFlyout = '[data-testid="configuration-flyout-trust"]';
  await page.click(trustRail);
  await page.waitForSelector(trustFlyout);
  assert.ok(await page.$(
    `${trustFlyout} [data-testid="nav-config-fixture-subsection-destination"]`,
  ), "flyouts render permitted subsection destinations");
  await page.click(`${trustFlyout} [data-testid="nav-trust-benefits"]`);
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="fixture-location"]')?.textContent === "/trust-benefits");
  await waitForAbsent(page, trustFlyout);
  await page.click(trustRail);
  await page.waitForSelector(trustFlyout);
  await page.click(`${trustFlyout} [data-testid="nav-trust-benefits"]`);
  await waitForAbsent(page, trustFlyout);

  // Collapsed preference survives navigation and a full remount/refresh.
  await navigate(page, "/config/auth-settings");
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "false",
    "whole-menu state survives navigation");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(desktopToggle);
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "false",
    "whole-menu state survives remount and refresh");

  // Dark-mode captures cover the rail, flyout and expanded menu.
  await setDarkMode(page, true);
  await page.screenshot({
    path: path.join(root, "screenshots/config-navigation-dark-collapsed.png"),
  });
  await page.click(systemRail);
  await page.waitForSelector(systemFlyout);
  await page.screenshot({
    path: path.join(root, "screenshots/config-navigation-dark-flyout.png"),
  });
  await page.keyboard.press("Escape");
  await waitForAbsent(page, systemFlyout);

  // The rail bottom control restores the expanded sidebar.
  await page.click(desktopToggle);
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "true");
  await waitForSidebarWidth(page, 256);
  await assertBottomControl("Collapse configuration menu", "true");
  assert.equal(Math.round((await box(page, 'aside[aria-label="Configuration menu"]')).width), 256);
  await page.screenshot({
    path: path.join(root, "screenshots/config-navigation-dark-expanded.png"),
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('aside[aria-label="Configuration menu"]');
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "true");

  // Only the navigation region scrolls; its bottom control remains fixed and usable.
  await page.setViewport({ width: 1280, height: 420, deviceScaleFactor: 1 });
  const navScroll = '[data-testid="configuration-nav-scroll"]';
  await page.waitForSelector(navScroll);
  assert.equal(await page.$eval(navScroll, node => node.scrollHeight > node.clientHeight), true,
    "a long configuration menu has an independently scrollable navigation region");
  const toggleBefore = await box(page, desktopToggle);
  await page.$eval(navScroll, node => {
    node.scrollTop = node.scrollHeight;
  });
  const toggleAfter = await box(page, desktopToggle);
  assert.equal(Math.round(toggleAfter.top), Math.round(toggleBefore.top),
    "scrolling links does not move the bottom toggle");
  assert.ok(toggleAfter.bottom <= 420 && toggleAfter.top >= 0,
    "the bottom toggle remains inside the viewport");
  assert.ok(toggleAfter.top >= (await box(page, navScroll)).bottom,
    "the expanded navigation scrolls above the bottom control");

  // Preserve collapsed desktop preference before crossing the mobile breakpoint.
  await page.click(desktopToggle);
  assert.equal(await page.$eval(desktopToggle, node => node.getAttribute("aria-expanded")), "false");

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
  assert.deepEqual(await page.$eval(sidebarSelector, aside => ({
    firstControlLabel: [...aside.querySelectorAll("button, a")]
      .find(element => element.getClientRects().length)?.getAttribute("aria-label"),
    homeLinks: aside.querySelectorAll('a[href="/config"]').length,
    headerText: aside.querySelector("div")?.textContent?.trim(),
    desktopToggleVisible: !!aside.querySelector('[data-testid="button-configuration-menu-desktop"]')?.getClientRects().length,
  })), { firstControlLabel: "Close configuration menu", homeLinks: 0, headerText: "", desktopToggleVisible: false },
  "the mobile drawer begins with its close control, not a redundant heading or desktop toggle");
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
  assert.ok(await page.$('[data-testid="nav-config-trust"]'),
    "mobile drawer remains the expanded navigation regardless of desktop preference");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("configuration-menu-open")),
    "false",
    "opening the mobile drawer does not overwrite the collapsed desktop preference",
  );

  await page.screenshot({
    path: path.join(root, "screenshots/config-navigation-mobile-200-percent.png"),
    fullPage: true,
  });
  await page.focus(`${sidebarSelector} button[aria-label="Close configuration menu"]`);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('aside[aria-label="Configuration menu"]')).display === "none");
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
  await page.waitForSelector(desktopToggle);
  await waitForSidebarWidth(page, 56);
  assert.equal(Math.round((await box(page, 'aside[aria-label="Configuration menu"]')).width), 56,
    "returning to desktop restores its collapsed preference");

  assert.deepEqual(failures, [], "No browser exceptions, console errors, or unexpected networking");
  console.log("PASS config navigation: rail, flyouts, persistence, filtering, scrolling, mobile");
  console.log("Screenshots: screenshots/config-navigation-{light,dark}-{expanded,collapsed,flyout}.png");
  console.log("Screenshot: screenshots/config-navigation-mobile-200-percent.png");
  await page.close();
} catch (error) {
  console.error("FAIL config navigation browser coverage");
  console.error(error);
  process.exitCode = 1;
} finally {
  if (pendingCatalogRequest && !pendingCatalogRequest.isInterceptResolutionHandled()) {
    await pendingCatalogRequest.abort().catch(() => {});
  }
  await browser?.close();
  await server.close();
}