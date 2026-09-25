import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

// Isolated browser fixture: no application server, database or Stripe requests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath = process.env.CHROMIUM_PATH || [
  "/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find(existsSync);
assert.ok(executablePath, "Set CHROMIUM_PATH to a local Chromium executable");
const server = await createServer({
  configFile: false, envFile: false, root,
  cacheDir: path.join(root, "node_modules/.vite-worker-method-browser"),
  optimizeDeps: { entries: [path.join(root, "tests/ledger/worker-method-browser.html")], holdUntilCrawlEnd: false },
  plugins: [react()],
  resolve: { alias: [
    { find: "@/components/layouts/WorkerLayout", replacement: path.join(root, "tests/ledger/worker-method-browser-layout.tsx") },
    { find: "@stripe/react-stripe-js", replacement: path.join(root, "tests/ledger/worker-method-browser-stripe.tsx") },
    { find: "@stripe/stripe-js", replacement: path.join(root, "tests/ledger/worker-method-browser-stripe-js.ts") },
    { find: "@shared", replacement: path.join(root, "shared") },
    { find: "@", replacement: path.join(root, "client/src") },
  ] },
  server: { host: "127.0.0.1", port: 5193, strictPort: true, hmr: false,
    watch: { ignored: ["**/.local/**", "**/node_modules/**", "**/.git/**"] } },
});
let browser;
try {
  await server.listen();
  const origin = "http://127.0.0.1:5193";
  const failures = [];
  const mutations = [];
  let failAttach = true;
  browser = await puppeteer.launch({ executablePath, headless: true, timeout: 90_000,
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
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
    const method = request.method();
    const base = "/api/ledger/payment-methods/worker/fixture-worker";
    const answers = {
      [base]: [{ id: "saved-1", isActive: true, isDefault: false, gatewayConfigId: "gateway-1",
        providerDetails: { card: { brand: "Visa", last4: "4242" } } }],
      [`${base}/capabilities`]: { canManageMethods: true },
      [`${base}/authorization`]: { authorization: { version: "v1", text: "I authorize saving this payment method." } },
      [`${base}/gateways`]: [{ id: "gateway-1", name: "Stripe", pluginId: "stripe" }],
    };
    let status = 200;
    let data;
    if (method === "GET" && Object.hasOwn(answers, url.pathname)) data = answers[url.pathname];
    else if (method === "POST" && url.pathname === `${base}/setup`) {
      const payload = JSON.parse(request.postData());
      assert.equal(payload.consent.accepted, true);
      data = { clientSecret: "seti_fixture", componentId: "stripe:StripeAddPaymentMethod",
        publicConfig: { publishableKey: "pk_test_fixture" } };
      mutations.push("setup");
    } else if (method === "POST" && url.pathname === base) {
      const payload = JSON.parse(request.postData());
      assert.equal(payload.methodToken, "pm-fixture");
      assert.equal(payload.consent.accepted, true);
      mutations.push("attach");
      if (failAttach) {
        failAttach = false;
        status = 503;
        data = { message: "Temporary attachment failure" };
      } else {
        data = { id: "saved-2" };
      }
    } else if (method === "POST" && url.pathname.endsWith("/set-default")) {
      mutations.push("default"); data = {};
    } else if (method === "DELETE" && url.pathname.endsWith("/saved-1")) {
      mutations.push("remove"); data = {};
    } else {
      failures.push(`Unexpected API request: ${method} ${url.pathname}`);
      return request.abort();
    }
    return request.respond({ status, contentType: "application/json", body: JSON.stringify(data) });
  });
  const dialog = '[data-testid="dialog-worker-add-payment-method"]';
  const add = '[data-testid="button-confirm-payment-method"]';
  const geometry = async () => page.$eval(dialog, element => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right,
      height: box.height, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop, viewportHeight: innerHeight, viewportWidth: innerWidth };
  });
  for (const viewport of [{ width: 1280, height: 540 }, { width: 375, height: 600 }]) {
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.goto(`${origin}/tests/ledger/worker-method-browser.html`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForSelector('[data-testid="button-worker-add-payment-method"]');
    await page.click('[data-testid="button-worker-add-payment-method"]');
    await page.waitForSelector(dialog);
    // The consent is required before setup, and the real page must hand it over.
    await page.click('[data-testid="checkbox-worker-method-consent"]');
    await page.click('[data-testid="select-worker-payment-gateway"]');
    await page.click('[role="option"]');
    await page.waitForSelector('[data-testid="fixture-payment-element"]');
    await page.click('[data-testid="fixture-payment-element"] > button');
    await page.waitForSelector('[data-testid="fixture-expanded-fields"]');
    const top = await geometry();
    assert.ok(top.top >= 0 && top.bottom <= viewport.height && top.left >= 0 && top.right <= viewport.width,
      `dialog fits ${viewport.width}x${viewport.height}: ${JSON.stringify(top)}`);
    assert.ok(top.scrollHeight > top.clientHeight, "expanded card fields require internal scrolling");
    for (const selector of ['[data-testid="checkbox-worker-method-consent"]', '[aria-label="Card number"]',
      '[aria-label="Link email"]', '[aria-label="Link phone"]', add, `${dialog} button:has(.sr-only)`]) {
      assert.ok(await page.$(selector), `control exists: ${selector}`);
    }
    await page.$eval(dialog, element => { element.scrollTop = element.scrollHeight; });
    const bottom = await geometry();
    const actions = await page.$eval(add, button => button.getBoundingClientRect().bottom);
    assert.ok(bottom.scrollTop > 0 && actions <= viewport.height && actions > 0,
      `card actions reachable at ${viewport.width}x${viewport.height}: ${JSON.stringify(bottom)}`);
    await page.focus('[aria-label="Link phone"]');
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Cancel");
    // Focus moves through the real Stripe form actions, then wraps inside the dialog.
    await page.focus(add);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Close");
    await page.keyboard.press("Enter");
    await page.waitForSelector(dialog, { hidden: true });
    // Reopen to exercise confirmation, failed attachment and retry without
    // re-confirming provider details on the desktop pass.
    if (viewport.width === 1280) {
      await page.click('[data-testid="button-worker-add-payment-method"]');
      await page.click('[data-testid="checkbox-worker-method-consent"]');
      await page.click('[data-testid="select-worker-payment-gateway"]');
      await page.click('[role="option"]');
      await page.waitForSelector(add);
      await page.click(add);
      await page.waitForSelector('[data-testid="text-payment-method-save-failed"]');
      await page.click(add);
      await page.waitForSelector(dialog, { hidden: true });
      assert.deepEqual(mutations.filter(value => value === "attach"), ["attach", "attach"]);
    }
  }
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/saved-1/set-default")),
    page.click('button[aria-label="Set default"]'),
  ]);
  await page.click('button[aria-label="Remove"]');
  await page.waitForSelector('[role="alertdialog"]');
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/saved-1") && response.request().method() === "DELETE"),
    page.click('[role="alertdialog"] button:last-child'),
  ]);
  await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  assert.ok(mutations.includes("default") && mutations.includes("remove"),
    "saved method actions remain usable after closing the dialog");
  assert.deepEqual(failures, [], "no browser errors or unexpected network requests");
  console.log("Worker payment method browser fixture passed (desktop short and narrow viewport)");
} finally {
  await browser?.close();
  await Promise.race([server.close(), new Promise(resolve => setTimeout(resolve, 5000))]);
}
// Vite's dependency optimizer can retain an idle thread after server.close.
process.exit(0);