/** Browser smoke for the real login form and persisted worker UI session. */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { eq } from "drizzle-orm";
import { contacts, workers } from "../../shared/schema";
import { getClient } from "../../server/storage/transaction-context";
import { getEnvironmentVariable, registerEnvironmentVariables } from "../../server/config/env-registry";
import { assertFixtureEnvironment } from "./worker-payment-fixture";

registerEnvironmentVariables([
  { name: "ALLOW_WORKER_PAYMENT_FIXTURE", description: "Opt-in for worker fixture browser smoke.", secret: false, category: "core" },
  { name: "WORKER_PAYMENT_FIXTURE_PASSWORD", description: "Local fixture password.", secret: true, category: "core" },
  { name: "WORKER_FIXTURE_BASE_URL", description: "Non-production app HTTPS origin.", secret: false, category: "core" },
  { name: "CHROMIUM_PATH", description: "Optional local Chromium path for browser fixture.", secret: false, category: "core" },
]);

async function main() {
  assertFixtureEnvironment(getEnvironmentVariable("NODE_ENV"), getEnvironmentVariable("ALLOW_WORKER_PAYMENT_FIXTURE"));
  const base = getEnvironmentVariable("WORKER_FIXTURE_BASE_URL");
  const password = getEnvironmentVariable("WORKER_PAYMENT_FIXTURE_PASSWORD");
  if (!base || !password) throw new Error("Set WORKER_FIXTURE_BASE_URL and WORKER_PAYMENT_FIXTURE_PASSWORD");
  const origin = new URL(base);
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Browser verification requires HTTPS (except loopback)");
  const [contact] = await getClient().select().from(contacts).where(eq(contacts.email, "worker-payment-fixture@example.invalid"));
  const [worker] = contact ? await getClient().select().from(workers).where(eq(workers.contactId, contact.id)) : [];
  if (!worker || (worker.data as any)?.fixture !== "worker-payment-fixture-v1") throw new Error("Marked fixture worker missing");
  const executablePath = getEnvironmentVariable("CHROMIUM_PATH") ||
    ["/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
  if (!executablePath) throw new Error("No local Chromium; set CHROMIUM_PATH");
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(new URL("/login", origin).href, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="input-local-email"]');
    await page.type('[data-testid="input-local-email"]', contact.email!);
    await page.type('[data-testid="input-local-password"]', password);
    await page.click('[data-testid="button-local-login"]');
    await page.waitForFunction(async (id) => {
      const response = await fetch("/api/auth/user");
      if (!response.ok) return false;
      const data = await response.json();
      return data.user?.workerId === id;
    }, { timeout: 30000 }, worker.id);
    await page.goto(new URL(`/workers/${worker.id}`, origin).href, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body", { timeout: 15000 });
    if (await page.$('[data-testid="text-login-title"]')) throw new Error("Worker page redirected to login");
    await page.goto(new URL(`/workers/${worker.id}/ledger/payment-methods`, origin).href, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="button-worker-add-payment-method"]', { timeout: 30000 });
    await page.goto(new URL(`/workers/${worker.id}/ledger/pay`, origin).href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Choose an account to pay"), { timeout: 30000 });
    console.log("PASS: real browser login form, persisted worker page, payment methods and checkout account chooser");
    const unavailable = await page.evaluate(() => document.body.innerText.includes("There are no accounts enabled for online payment"));
    if (unavailable) console.log("SETUP BLOCKER: no eligible payable account; browser cannot open account-specific checkout");
  } finally {
    await browser.close();
  }
}

main().catch(() => {
  // Browser exceptions can include form/network details. Do not echo them.
  console.error("Browser fixture verification failed. Check local auth, worker UI routes, and browser availability.");
  process.exitCode = 1;
});