import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
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
        if (request.url?.startsWith("/pay/") || request.url?.startsWith("/ea/") || request.url?.startsWith("/admin-pay/") || request.url?.startsWith("/workers/")) request.url = "/tests/ledger/checkout-browser.html";
        next();
      });
    },
  }],
  resolve: {
    alias: [
      { find: "@/plugins/payment-gateway/registry", replacement: path.join(root, "tests/ledger/checkout-browser-registry.ts") },
      { find: "@/components/layouts/WorkerLayout", replacement: path.join(root, "tests/ledger/worker-method-browser-layout.tsx") },
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
    paymentTypes: ["card", "us_bank_account"], payComponentId: "fixture:pay", reusableMethodsSupported: true,
    settings: { allowPartial: true, minAmount: 1 },
    authorization: { version: "fixture-v1", text: "I authorize this payment." },
    readiness: {
      paymentAuthorization: "ready", methodPermission: "allowed",
      reusableMethods: "supported", saveMethod: "ready",
    },
    selectionInput, quote,
  };
  let activeCheckout = checkout;
  const { ADMIN_PAYMENT_CONFIRMATION } = await server.ssrLoadModule("/shared/ledger/admin-payment-confirmation.ts");
  let htmlFailure = "";
  const administratorRequests = [];
  let rejectInitiation = false;
  let submittedPayments = 0;
  const submittedBodies = [];
  let saveFlow = false;
  let flowMethods = [];
  let flowType = "card";
  let flowStatus = "created";
  let optedIn = false;
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
    if (url.pathname.startsWith("/api/ledger/admin-checkout/")) {
      administratorRequests.push({ method: request.method(), path: url.pathname });
      const stage = request.method() === "POST" ? "session" : url.pathname.includes("/sessions/") ? "status" : "preview";
      if (htmlFailure === stage) return request.respond({ status: 200, contentType: "text/html", body: "<html>private upstream response</html>" });
    }
    const responses = {
      "/api/auth/user": {
        user: { id: "fixture-payer", email: "payer@example.invalid" },
        permissions: ["worker"], components: ["ledger"],
        timezone: { systemTimeZone: "UTC", userTimeZone: null, allowUserTimezones: false },
      },
      "/api/ledger/ea/fixture-ea": { entityType: activeCheckout.entityType, entityId: activeCheckout.entityId },
      "/api/ledger/admin-checkout/worker/fixture-worker/fixture-ea": {
        ...activeCheckout, isAdminAssisted: true, adminConfirmation: ADMIN_PAYMENT_CONFIRMATION,
        authorization: null, reusableMethodsSupported: false,
        readiness: { paymentAuthorization: "admin_assisted", methodPermission: "denied", saveMethod: "permission_denied" },
      },
      "/api/ledger/admin-checkout/sessions/fixture-session": {
        id: "fixture-session", entityType: "worker", entityId: "fixture-worker",
        eaId: "fixture-ea", status: "processing", amount: "125.00", currency: "USD",
        canCancel: false, isAdminAssisted: true,
      },
      [`/api/ledger/checkout/${activeCheckout.entityType}/${activeCheckout.entityId}/fixture-ea`]: activeCheckout,
      [`/api/ledger/payment-methods/${activeCheckout.entityType}/${activeCheckout.entityId}`]: [
        { id: "fixture-card", gatewayConfigId: "fixture-gateway", isActive: true,
          providerDetails: { card: { brand: "Visa", last4: "4242" } } },
      ],
      "/api/ledger/payment-methods/worker/fixture-worker/capabilities": { canManageMethods: true },
      "/api/ledger/payment-methods/worker/fixture-worker/authorization": { authorization: { version: "v1", text: "Fixture authorization" } },
      "/api/ledger/payment-methods/worker/fixture-worker/gateways": [],
      "/api/ledger/checkout/sessions/fixture-pending": {
        id: "fixture-pending", entityType: activeCheckout.entityType, entityId: activeCheckout.entityId,
        eaId: "fixture-ea", status: "processing", amount: "150.00", currency: "USD",
        canCancel: false, ledgerPaymentId: "fixture-ledger", paymentStatus: "pending",
      },
    };
    if (saveFlow && request.method() === "GET" && url.pathname === "/api/ledger/payment-methods/worker/fixture-worker") {
      return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(flowMethods) });
    }
    if (saveFlow && request.method() === "GET" && url.pathname === "/api/ledger/checkout/sessions/fixture-session") {
      if (optedIn && flowStatus === "succeeded" && !flowMethods.length) {
        flowMethods = [{ id: `saved-${flowType}`, gatewayConfigId: "fixture-gateway", isActive: true, isDefault: true,
          providerDetails: flowType === "card" ? { card: { brand: "Visa", last4: "1111" } }
            : { us_bank_account: { bank_name: "Fixture Bank", last4: "6789" } } }];
      }
      return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({
        id: "fixture-session", entityType: "worker", entityId: "fixture-worker", eaId: "fixture-ea",
        amount: "307.35", currency: "USD", status: flowStatus,
        ledgerPaymentId: "fixture-payment", paymentStatus: flowStatus === "succeeded" ? "cleared" : "pending",
      }) });
    }
    if (request.method() === "POST" && url.pathname.endsWith("/sessions")) {
      submittedPayments++;
      if (rejectInitiation) return request.respond({ status: 409, contentType: "application/json",
        body: JSON.stringify({ message: "Ask an administrator to enable card payments. No payment was initiated." }) });
      const body = JSON.parse(request.postData());
      if (saveFlow) {
        optedIn = body.saveMethod;
        if (body.paymentMethodId) assert.equal(body.paymentMethodId, `saved-${flowType}`);
        else assert.equal(body.paymentMethodType, flowType);
        return request.respond({ status: 201, contentType: "application/json",
          body: JSON.stringify({ id: "fixture-session", status: body.paymentMethodId ? "requires_action" : "created",
            clientSecret: "fixture-secret", publicConfig: { paymentTypes: [flowType] } }) });
      }
      submittedBodies.push(body);
      if (body.saveMethod && (!body.saveMethodConsent?.accepted || !body.saveMethodConsent?.version ||
          !body.saveMethodConsent?.text.includes("does not authorize future charges"))) {
        failures.push(`Missing separate save consent: ${JSON.stringify(body)}`);
      }
      if (!["card", "us_bank_account"].includes(body.paymentMethodType) || body.paymentMethodId) {
        failures.push(`Wrong provider selection: ${JSON.stringify(body)}`);
      }
      return request.respond({ status: 201, contentType: "application/json",
        body: JSON.stringify({ id: "fixture-session", status: "created", clientSecret: "fixture-secret",
          publicConfig: { paymentTypes: [body.paymentMethodType] } }) });
    }
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
   await page.waitForFunction(() => document.body.textContent.includes("$267.35 to COBRA account using a saved card"));
  await assertNoOverflow("COBRA review");
  mkdirSync(path.join(root, "generated-artifacts"), { recursive: true });
  const screenshotPath = path.join(root, "generated-artifacts/checkout-browser-cobra-review.png");
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
   assert.ok(await page.$('xpath/.//label[contains(., "New credit/debit card")]'));
   assert.ok(await page.$('xpath/.//label[contains(., "New US bank transfer")]'));
   await clickLabel("New US bank transfer");
   assert.equal(await reviewDisabled(), true, "method switch requires renewed consent");
   await clickLabel("I authorize this payment.");
   await clickLabel("Save this payment method for future payments");
   await clickButton("Review payment");
   await page.waitForFunction(() => document.body.textContent.includes("using a new US bank transfer (save for future use)"));
   await clickButton("Continue to secure confirmation");
   await page.waitForSelector('[data-testid="fixture-provider"]');
   assert.ok((await page.$eval('[data-testid="fixture-provider"]', node => node.textContent)).includes("Secure us_bank_account entry"));
   assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Secure payment confirmation");
   assert.ok((await page.$eval("main", node => node.textContent)).includes("Payment not complete"));
   assert.ok(!page.url().includes("/receipt"), "provider confirmation has not happened yet");
   await assertNoOverflow("secure bank entry");
   await page.goto(`${origin}/pay/fixture-ea`, { waitUntil: "domcontentloaded" });
   await page.waitForSelector('main[aria-label="Checkout"]');
   await clickLabel("New credit/debit card");
   await clickLabel("I authorize this payment.");
   await clickLabel("Save this payment method for future payments");
   await clickButton("Review payment");
   await clickButton("Continue to secure confirmation");
   await page.waitForSelector('[data-testid="fixture-provider"]');
   assert.ok((await page.$eval('[data-testid="fixture-provider"]', node => node.textContent)).includes("Secure card entry"));
   assert.ok(!page.url().includes("/receipt"), "created card session stays at secure entry");
   await assertNoOverflow("secure card entry");

  // Reported failure reproduction in a rendered browser, for BOTH shared
  // payer scopes. These are fixture answers, not real provider/DB evidence.
  const fullBalance = (entityType, balance, reserved = "0.00") => {
    const input = { balance, reserved, reservations: [], invoices: [], allowPartial: true, minAmount: 1 };
    return { ...checkout, entityType, entityId: `fixture-${entityType}`,
      account: { ...checkout.account, name: `${entityType} checkout` }, balance,
      available: (Number(balance) - Number(reserved)).toFixed(2),
      invoices: [], selectionInput: input,
      quote: calculateCheckoutSelection(input, { mode: "full", invoiceNumbers: [] }) };
  };
  for (const entityType of ["worker", "employer"]) {
    activeCheckout = fullBalance(entityType, "150.00");
    rejectInitiation = true;
    await page.goto(`${origin}/pay/fixture-ea`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('main[aria-label="Checkout"]');
    await page.waitForFunction(() => document.body.textContent.includes("Available to pay: $150.00"));
    await clickLabel("I authorize this payment.");
    await clickButton("Review payment");
    const count = submittedPayments;
    await clickButton("Continue to secure confirmation");
    await page.waitForFunction(() => document.body.textContent.includes("Ask an administrator to enable card payments"));
    assert.equal(submittedPayments, count + 1, `${entityType}: rejection does not automatically resubmit`);
    const afterRejection = await page.$eval("main", node => node.textContent);
    assert.ok(afterRejection.includes("Posted balance: $150.00") &&
      afterRejection.includes("Pending payments: $0.00") &&
      afterRejection.includes("Available to pay: $150.00"));
    await assertNoOverflow(`${entityType} rejected initiation`);
    activeCheckout = fullBalance(entityType, "387.00");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.textContent.includes("Available to pay: $387.00"));
    assert.ok((await page.$eval("main", node => node.textContent)).includes("Pending payments: $0.00"));
    if (entityType === "employer") {
      await page.goto(`${origin}/ea/fixture-ea`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.body.textContent.includes("Pay online"));
      await page.click('a[href="/pay/fixture-ea"]');
      await page.waitForSelector('main[aria-label="Checkout"]');
    }
    rejectInitiation = false;
    await clickLabel("I authorize this payment.");
    await clickButton("Review payment");
    await clickButton("Continue to secure confirmation");
    await page.waitForSelector('[data-testid="fixture-provider"]');
    activeCheckout = { ...fullBalance(entityType, "387.00"), paymentTypes: [] };
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.textContent.includes("Gateway Payment Types"));
    assert.equal(await reviewDisabled(), true, `${entityType}: explicitly disabled methods cannot be submitted`);
    assert.ok(!(await page.$eval("main", node => node.textContent)).includes("New credit/debit card"));
  }
  activeCheckout = { ...fullBalance("employer", "150.00", "150.00"),
    pendingCheckouts: [{ id: "fixture-pending", amount: "150.00", currency: "USD", status: "processing" }] };
  await page.goto(`${origin}/ea/fixture-ea`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.textContent.includes("Check payment status"));
  assert.ok(!(await page.$eval("main", node => node.textContent)).includes("Pay online"));
  await page.click('a[href="/pay/fixture-ea"]');
  await page.waitForFunction(() => document.body.textContent.includes("Your unfinished payments"));
  await page.click('a[href="/pay/receipt/fixture-pending"]');
  await page.waitForFunction(() => document.body.textContent.includes("Payment pending"));
  assert.ok(!(await page.$eval("main", node => node.textContent)).includes("Abandon this payment"));
  assert.deepEqual(failures, [], "no browser errors or unexpected network requests");
  assert.deepEqual(submittedBodies.filter(body => body.saveMethod).map(body => body.paymentMethodType),
    ["us_bank_account", "card"], "browser submits the explicit save choice for both new method types");

   const saveLabel = "Save this payment method for future payments";
   const authorizationLabel = "I authorize this payment.";
   const checked = async text => page.evaluate(labelText =>
     [...document.querySelectorAll("label")].find(label => label.textContent.includes(labelText))
       ?.querySelector('[role="checkbox"]')?.getAttribute("aria-checked") === "true", text);
   for (const entityType of ["worker", "employer"]) {
     activeCheckout = { ...checkout, entityType, entityId: `fixture-${entityType}` };
     for (const order of ["save-first", "authorization-first"]) {
       await page.goto(`${origin}/pay/fixture-ea`, { waitUntil: "domcontentloaded" });
       await page.waitForSelector('main[aria-label="Checkout"]');
       for (const label of order === "save-first"
         ? [saveLabel, authorizationLabel] : [authorizationLabel, saveLabel]) await clickLabel(label);
       assert.equal(await checked(saveLabel), true, `${entityType} ${order}: save remains selected`);
       assert.equal(await checked(authorizationLabel), true);
       await clickButton("Review payment");
       await clickLabel(authorizationLabel);
       assert.equal(await reviewDisabled(), true, "clearing authorization blocks review");
       assert.equal(await checked(saveLabel), true, "clearing authorization preserves saving");
       assert.equal(await page.$('xpath/.//button[normalize-space()="Continue to secure confirmation"]'), null);
       await clickLabel(authorizationLabel);
       await clickButton("Review payment");
       await clickLabel(saveLabel);
       assert.equal(await checked(authorizationLabel), true, "clearing saving preserves authorization");
       assert.equal(await reviewDisabled(), false);
       await clickLabel(saveLabel);
       await clickButton("Review payment");
       await clickButton("Continue to secure confirmation");
       await page.waitForSelector('[data-testid="fixture-provider"]');
       assert.equal(submittedBodies.at(-1).saveMethod, true);
       assert.equal(submittedBodies.at(-1).saveMethodConsent.accepted, true);
       assert.deepEqual(submittedBodies.at(-1).consent, { ...checkout.authorization, accepted: true });
     }

     // Both method and allocation changes must discard old consents/review;
     // renewing only payment authorization must still submit a one-time payment.
     await page.goto(`${origin}/pay/fixture-ea`, { waitUntil: "domcontentloaded" });
     await page.waitForSelector('main[aria-label="Checkout"]');
     for (const change of ["New US bank transfer", "Pay selected statements"]) {
       await clickLabel(saveLabel);
       await clickLabel(authorizationLabel);
       await clickButton("Review payment");
       await clickLabel(change);
       assert.equal(await checked(saveLabel), false, `${entityType}: ${change} clears saving`);
       assert.equal(await checked(authorizationLabel), false);
       assert.equal(await reviewDisabled(), true);
     }
     await clickLabel("COBRA-APR");
     await clickLabel(authorizationLabel);
     await clickButton("Review payment");
     await clickButton("Continue to secure confirmation");
     await page.waitForSelector('[data-testid="fixture-provider"]');
     assert.equal(submittedBodies.at(-1).saveMethod, false);
     assert.equal(submittedBodies.at(-1).saveMethodConsent, undefined);
     assert.deepEqual(submittedBodies.at(-1).selection, { mode: "statements", invoiceNumbers: ["COBRA-APR"] });
     assert.equal(submittedBodies.at(-1).amount, "267.35");
   }
   assert.deepEqual(failures, [], "independent worker/employer consents have no browser errors");
  // Real router and apiRequest, isolated network answers: no provider or DB.
  activeCheckout = fullBalance("worker", "125.00");
  htmlFailure = "preview";
  await page.goto(`${origin}/admin-pay/worker/fixture-worker/fixture-ea`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.textContent.includes("Administrator checkout could not be loaded"));
  assert.ok(!(await page.$eval("main", node => node.textContent)).includes("private upstream response"));
  htmlFailure = "";
  await clickButton("Retry");
  await page.waitForSelector('main[aria-label="Checkout"]');
  assert.equal(await reviewDisabled(), true, "administrator must attest their on-behalf authorization");
  const adminContent = await page.$eval("main", node => node.textContent);
  assert.ok(adminContent.includes("This can charge real funds"));
  assert.ok(!adminContent.includes("Test mode only") && !adminContent.includes("Test purpose"));
  assert.ok(!adminContent.includes("Visa") && !adminContent.includes("Save this payment method"));
  await assertNoOverflow("administrator checkout");
  await page.screenshot({ path: path.join(root, "generated-artifacts/admin-assisted-checkout.png"), fullPage: true });
  await clickLabel(ADMIN_PAYMENT_CONFIRMATION.text);
  await clickButton("Review payment");
  htmlFailure = "session";
  const priorSubmissions = submittedPayments;
  await clickButton("Continue to secure confirmation");
  await page.waitForFunction(() => document.body.textContent.includes("Check your unfinished payments"));
  assert.equal(submittedPayments, priorSubmissions, "HTML failure does not trigger another session request");
  assert.equal(administratorRequests.filter(item => item.method === "POST").length, 1);
  htmlFailure = "";
  await clickButton("Review payment");
  await clickButton("Continue to secure confirmation");
  await page.waitForSelector('[data-testid="fixture-provider"]');
  assert.equal(submittedBodies.at(-1).consent, undefined);
  assert.equal(submittedBodies.at(-1).saveMethod, false);
  assert.deepEqual(submittedBodies.at(-1).adminConfirmation, { ...ADMIN_PAYMENT_CONFIRMATION, accepted: true });
  htmlFailure = "status";
  await clickButton("Confirm provider payment");
  await page.waitForFunction(() => document.body.textContent.includes("Payment status could not be checked"));
  assert.ok(page.url().includes("/admin-pay/receipt/fixture-session"));
  assert.ok((await page.$eval("main", node => node.textContent)).includes("Confirmation: fixture-session"));
  htmlFailure = "";
  await clickButton("Retry");
  await page.waitForFunction(() => document.body.textContent.includes("Payment processing"));
  assert.equal(administratorRequests.filter(item => item.method === "POST").length, 2, "receipt retries never create a replacement");
  assert.deepEqual(failures, [], "administrator flow has no browser errors or external requests");

  // The real management, checkout and receipt pages share ONE browser query
  // client throughout. HTTP/provider answers here are controlled fixtures.
  activeCheckout = checkout;
  saveFlow = true;
  for (const type of ["card", "us_bank_account"]) {
    flowType = type;
    flowMethods = [];
    flowStatus = "created";
    optedIn = false;
    await page.goto(`${origin}/workers/fixture-worker/ledger/payment-methods`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="text-worker-no-payment-methods"]');
    await page.click('a[href="/pay/fixture-ea"]');
    await page.waitForFunction(() => document.body.textContent.includes("No saved methods for this payer yet"));
    await clickLabel(type === "card" ? "New credit/debit card" : "New US bank transfer");
    await clickLabel("I authorize this payment.");
    await clickLabel("Save this payment method for future payments");
    await clickButton("Review payment");
    await clickButton("Continue to secure confirmation");
    await page.waitForSelector('[data-testid="fixture-provider"]');
    flowStatus = type === "card" ? "succeeded" : "processing";
    await clickButton("Confirm provider payment");
    await page.waitForFunction(() => document.body.textContent.includes("Confirmation: fixture-session"));
    if (type === "us_bank_account") {
      assert.equal(flowMethods.length, 0, "processing ACH is not saved");
      await page.click('a[href="/workers/fixture-worker/ledger/payment-methods"]');
      await page.waitForSelector('[data-testid="text-worker-no-payment-methods"]');
      // Simulate delayed webhook settlement in another browser tab. The
      // management page must refresh on refocus, without a hard reload.
      const otherTab = await browser.newPage();
      await otherTab.bringToFront();
      await page.waitForFunction(() => document.visibilityState === "hidden");
      flowStatus = "succeeded";
      flowMethods = [{ id: `saved-${type}`, gatewayConfigId: "fixture-gateway", isActive: true, isDefault: true,
        providerDetails: { us_bank_account: { bank_name: "Fixture Bank", last4: "6789" } } }];
      await page.bringToFront();
      await otherTab.close();
    } else {
      await page.click('a[href="/workers/fixture-worker/ledger/payment-methods"]');
    }
    await page.waitForSelector(`[data-testid="worker-payment-method-saved-${type}"]`);
    assert.equal(await page.$$eval('[data-testid^="worker-payment-method-"]', nodes => nodes.length), 1);
    await page.click('a[href="/pay/fixture-ea"]');
    await page.waitForFunction(() => document.body.textContent.includes("••••"));
    await clickLabel(type === "card" ? "Visa •••• 1111" : "Fixture Bank •••• 6789");
    await clickLabel("I authorize this payment.");
    await clickButton("Review payment");
    await clickButton("Continue to secure confirmation");
    await page.waitForSelector('[data-testid="fixture-provider"]');
    assert.equal(optedIn, false, "reuse does not attach another method or record new save consent");
    assert.equal(flowMethods.length, 1);
    await assertNoOverflow(`saved ${type} checkout`);
  }
  assert.deepEqual(failures, [], "no errors during saved-method return/reuse");
  console.log(`Checkout browser fixture passed; screenshot: ${screenshotPath}`);
} finally {
  await browser?.close();
  await server.close();
}