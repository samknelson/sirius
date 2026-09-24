import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

// Fixture-only Vite server; never contacts the application server, database,
// payment provider, or production data. All unexpected requests fail closed.
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
  cacheDir: path.join(root, "node_modules/.vite-checkout-browser"),
  optimizeDeps: {
    entries: [path.join(root, "tests/ledger/checkout-browser.html")],
    holdUntilCrawlEnd: false,
  },
  plugins: [react(), {
    name: "checkout-browser-entry",
    configureServer(viteServer) {
      viteServer.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith("/pay/")) request.url = "/tests/ledger/checkout-browser.html";
        next();
      });
    },
  }],
  resolve: {
    alias: [
      { find: "@/plugins/payment-gateway/registry", replacement: path.join(root, "tests/ledger/checkout-browser-registry.ts") },
      { find: "@shared", replacement: path.join(root, "shared") },
      { find: "@", replacement: path.join(root, "client/src") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.CHECKOUT_BROWSER_PORT || 5192),
    strictPort: true,
    hmr: false,
    watch: { ignored: ["**/.local/**", "**/node_modules/**", "**/.git/**"] },
  },
});

let browser;
try {
  await server.listen();
  const { calculateCheckoutSelection } = await server.ssrLoadModule("/shared/ledger/checkout-selection.ts");
  const selectionInput = {
    balance: "307.35",
    reserved: "0.00",
    reservations: [],
    invoices: [
      { invoiceNumber: "COBRA-APR", month: 4, year: 2026, invoiceBalance: "267.35" },
      { invoiceNumber: "COBRA-MAY", month: 5, year: 2026, invoiceBalance: "40.00" },
    ],
    allowPartial: true,
    minAmount: 1,
  };
  const quote = calculateCheckoutSelection(selectionInput, { mode: "full", invoiceNumbers: [] });
  const checkout = {
    entityType: "worker", entityId: "fixture-worker", eaId: "fixture-ea",
    account: { name: "COBRA account", currency: "USD", gatewayConfigId: "fixture-gateway" },
    balance: "307.35", available: "307.35", invoices: selectionInput.invoices,
    paymentTypes: ["card"], payComponentId: null, reusableMethodsSupported: false,
    settings: { allowPartial: true, minAmount: 1 },
    authorization: { version: "fixture-v1", text: "I authorize this payment." },
    readiness: {
      paymentAuthorization: "ready", methodPermission: "allowed",
      reusableMethods: "unsupported", saveMethod: "provider_unsupported",
    },
    selectionInput, quote,
  };
  const origin = `http://127.0.0.1:${server.config.server.port}`;
  const failures = [];
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
    if (url.origin !== origin) {
      failures.push(`Unexpected external request: ${url.origin}`);
      return request.abort();
    }
    if (!url.pathname.startsWith("/api/")) return request.continue();
    const responses = {
      "/api/auth/user": {
        user: { id: "fixture-payer", email: "payer@example.invalid" },
        permissions: ["worker"], components: ["ledger"],
        timezone: { systemTimeZone: "UTC", userTimeZone: null, allowUserTimezones: false },
      },
      "/api/ledger/ea/fixture-ea": { entityType: "worker", entityId: "fixture-worker" },
      "/api/ledger/checkout/worker/fixture-worker/fixture-ea": checkout,
      "/api/ledger/payment-methods/worker/fixture-worker": [
        { id: "fixture-card", gatewayConfigId: "fixture-gateway", isActive: true,
          providerDetails: { card: { brand: "Visa", last4: "4242" } } },
      ],
    };
    if (request.method() !== "GET" || !Object.hasOwn(responses, url.pathname)) {
      failures.push(`Unexpected API request: ${request.method()} ${url.pathname}`);
      return request.abort();
    }
    await request.respond({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responses[url.pathname]),
    });
  });

  await page.setViewport({ width: 375, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${origin}/pay/fixture-ea`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector('main[aria-label="Checkout"]');
  await page.waitForFunction(() => document.body.textContent.includes("COBRA account")
    && document.body.textContent.includes("COBRA-APR")
    && document.body.textContent.includes("Visa"));
  const clickLabel = async text => {
    const label = await page.$(`xpath/.//label[contains(., "${text}")]`);
    assert.ok(label, `Missing label: ${text}`);
    await label.click();
  };
  const clickButton = async text => {
    const button = await page.$(`xpath/.//button[normalize-space()="${text}"]`);
    assert.ok(button, `Missing button: ${text}`);
    await button.click();
  };
  const total = async () => page.$eval("main", main => {
    const title = [...main.querySelectorAll("*")].find(node =>
      node.textContent?.trim() === "Payment total" && node.classList.contains("font-semibold"));
    return title?.closest(".rounded-lg")?.querySelector(".text-2xl")?.textContent?.trim();
  });
  const assertNoOverflow = async stage => {
    const bounds = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      main: document.querySelector("main").getBoundingClientRect().right,
    }));
    assert.ok(bounds.document <= bounds.viewport && bounds.body <= bounds.viewport
      && bounds.main <= bounds.viewport + 1, `${stage}: narrow viewport has no horizontal overflow: ${JSON.stringify(bounds)}`);
  };
  await assertNoOverflow("initial full balance");
  assert.equal(await total(), "$307.35", "full selection covers both statements");

  await clickLabel("Pay selected statements");
  await page.waitForFunction(() => document.querySelector('input[name="payment-choice"]:checked')?.parentElement?.textContent.includes("Pay selected statements"));
  const reviewDisabled = async () => page.$eval("main", main =>
    [...main.querySelectorAll("button")].find(item => item.textContent?.trim() === "Review payment")?.disabled);
  assert.equal(await reviewDisabled(), true, "empty statement selection cannot be reviewed");

  // Focus the actual accessible control; Space must select it without a pointer.
  const april = await page.$('xpath/.//label[contains(., "COBRA-APR")]/*[@role="checkbox"]');
  assert.ok(april, "statement checkbox is present");
  await april.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => {
    const label = [...document.querySelectorAll("label")].find(node => node.textContent?.includes("COBRA-APR"));
    return label?.querySelector('[role="checkbox"]')?.getAttribute("aria-checked") === "true";
  });
  assert.equal(await total(), "$267.35", "COBRA statement is paid in full");
  await clickLabel("Visa");
  // Locate consent by its wording, not its position in the page.
  const consentHandle = await page.$('xpath/.//label[contains(., "I authorize this payment.")]/*[@role="checkbox"]');
  assert.ok(consentHandle, "authorization checkbox is present");
  await consentHandle.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("label")].find(node => node.textContent?.includes("I authorize this payment."))
      ?.querySelector('[role="checkbox"]')?.getAttribute("aria-checked") === "true");
  assert.equal(await reviewDisabled(), false);
  await clickButton("Review payment");
  await page.waitForFunction(() => document.body.textContent.includes("$267.35 to COBRA account using a saved method"));
  await assertNoOverflow("COBRA review");
  const screenshotPath = path.join(root, "tests/ledger/checkout-browser-cobra-review.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await clickButton("Edit");
  await clickLabel("COBRA-MAY");
  assert.equal(await total(), "$307.35", "multiple selected statements add to the total");
  assert.equal(await reviewDisabled(), true, "changing selection requires renewed authorization");
  await clickLabel("I authorize this payment.");
  await clickButton("Review payment");
  await page.waitForFunction(() => document.body.textContent.includes("$307.35 to COBRA account"));
  await assertNoOverflow("multiple-statement review");
  await clickButton("Edit");
  await clickLabel("Pay full balance");
  assert.equal(await total(), "$307.35", "full-balance choice restores the full quote");
  await assertNoOverflow("full-balance selection");
  assert.deepEqual(failures, [], "no browser errors or unexpected network requests");
  console.log(`Checkout browser fixture passed; screenshot: ${screenshotPath}`);
} finally {
  await browser?.close();
  await server.close();
}