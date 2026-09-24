/**
 * Real HTTP session smoke, read-only except for optional test-mode SetupIntent.
 * Never prints credentials, cookies, client secrets or provider config.
 */
import { eq, ne } from "drizzle-orm";
import { contacts, pluginConfigs, users, workers } from "../../shared/schema";
import { getClient } from "../../server/storage/transaction-context";
import { getEnvironmentVariable, registerEnvironmentVariables } from "../../server/config/env-registry";
import { assertFixtureEnvironment } from "./worker-payment-fixture";

registerEnvironmentVariables([
  { name: "WORKER_FIXTURE_BASE_URL", description: "Non-production application's origin for worker fixture HTTP verification.", secret: false, category: "core" },
  { name: "ALLOW_WORKER_PAYMENT_FIXTURE", description: "Explicit opt-in to verify a non-production worker fixture.", secret: false, category: "core" },
  { name: "WORKER_PAYMENT_FIXTURE_PASSWORD", description: "Worker fixture login password.", secret: true, category: "core" },
]);

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main(): Promise<void> {
  assertFixtureEnvironment(getEnvironmentVariable("NODE_ENV"), getEnvironmentVariable("ALLOW_WORKER_PAYMENT_FIXTURE"));
  const base = getEnvironmentVariable("WORKER_FIXTURE_BASE_URL");
  const password = getEnvironmentVariable("WORKER_PAYMENT_FIXTURE_PASSWORD");
  check(base && password, "Set WORKER_FIXTURE_BASE_URL and the fixture password secret");
  const origin = new URL(base);
  check(origin.protocol === "https:" || ["localhost", "127.0.0.1"].includes(origin.hostname), "HTTP verification requires HTTPS (except local loopback)");
  const db = getClient();
  const [user] = await db.select().from(users).where(eq(users.email, "worker-payment-fixture@example.invalid"));
  check(user?.isActive && (user.data as any)?.fixture === "worker-payment-fixture-v1", "Fixture is missing or inactive");
  const [contact] = await db.select().from(contacts).where(eq(contacts.email, user.email));
  const [worker] = contact ? await db.select().from(workers).where(eq(workers.contactId, contact.id)) : [];
  check(worker && (worker.data as any)?.fixture === "worker-payment-fixture-v1", "Fixture worker association is missing");
  const [other] = await db.select({ id: workers.id }).from(workers).where(ne(workers.id, worker.id)).limit(1);
  check(other, "An unrelated worker is required for the denial check");

  const loginPage = await fetch(new URL("/login", origin), { redirect: "manual" });
  check(loginPage.ok, "Login page unavailable");
  const login = await fetch(new URL("/api/auth/local/login", origin), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password }),
    redirect: "manual",
  });
  check(login.ok, `Local login failed (${login.status}); check that the local provider is enabled and pepper matches`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  check(cookie, "Login did not establish a session cookie");
  const request = async (path: string) => {
    const res = await fetch(new URL(path, origin), { headers: { Cookie: cookie }, redirect: "manual" });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };
  const session = await request("/api/auth/user");
  check(session.status === 200 && session.body?.user?.id === user.id && session.body.user.workerId === worker.id, "Persisted session does not resolve the fixture worker");
  const permissions = new Set<string>(session.body.permissions);
  for (const permission of ["worker", "worker.ledger", "worker.ledger.pay", "worker.ledger.methods"]) {
    check(permissions.has(permission), `Fixture permission missing: ${permission}`);
  }
  check(!permissions.has("staff") && !permissions.has("admin") && !session.body.masquerade, "Fixture has elevated access or masquerade");
  check(session.body.components.includes("ledger"), "Setup blocker: ledger component is disabled");
  check((await request(`/api/workers/${worker.id}`)).status === 200, "Own worker page API denied");
  check([401, 403, 404].includes((await request(`/api/workers/${other.id}`)).status), "Unrelated worker page is accessible");
  check([401, 403, 404].includes((await request(`/api/ledger/pay-accounts/worker/${other.id}`)).status), "Unrelated worker checkout is accessible");
  check([401, 403, 404].includes((await request(`/api/ledger/payment-methods/worker/${other.id}/capabilities`)).status), "Unrelated worker payment methods are accessible");
  check([401, 403].includes((await request("/api/admin/users")).status), "Fixture has staff/admin access");
  console.log("PASS: real local login, persisted session, own worker, unrelated-worker and admin denials");

  const scope = `worker/${worker.id}`;
  const capability = await request(`/api/ledger/payment-methods/${scope}/capabilities`);
  check(capability.status === 200 && capability.body?.canManageMethods === true, "Fixture defect: method authority denied");
  const accounts = await request(`/api/ledger/pay-accounts/${scope}`);
  check(accounts.status === 200, `Fixture defect: own checkout permission denied (${accounts.status})`);
  const authorization = await request(`/api/ledger/payment-methods/${scope}/authorization`);
  if (authorization.status !== 200 || !authorization.body?.authorization) {
    console.log("SETUP BLOCKER: approved consumer payment authorization is not configured"); return;
  }
  const gateways = await request(`/api/ledger/payment-methods/${scope}/gateways`);
  check(gateways.status === 200, "Fixture defect: gateway picker denied");
  const stripe = Array.isArray(gateways.body) ? gateways.body.find((g: any) => g.pluginId === "stripe") : null;
  if (!stripe) { console.log("SETUP BLOCKER: no enabled Stripe gateway"); return; }
  // The public key is returned by setup. Do not create a SetupIntent for an
  // unknown/live gateway: the operator must explicitly identify a test config.
  const expectedGateway = process.argv[2];
  if (!expectedGateway || expectedGateway !== stripe.id) {
    console.log("SETUP BLOCKER: pass the verified Stripe test-mode gateway ID as the script argument"); return;
  }
  const [config] = await db.select().from(pluginConfigs).where(eq(pluginConfigs.id, stripe.id));
  if (config?.pluginId !== "stripe" || !config.enabled ||
      !String((config.data as Record<string, unknown> | null)?.publishableKey ?? "").startsWith("pk_test_")) {
    console.log("SETUP BLOCKER: Stripe gateway is not configured with a test publishable key"); return;
  }
  const setup = await fetch(new URL(`/api/ledger/payment-methods/${scope}/setup`, origin), {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ gatewayConfigId: stripe.id, consent: { ...authorization.body.authorization, accepted: true } }),
  });
  const setupBody = await setup.json().catch(() => null);
  check(setup.ok && typeof setupBody?.clientSecret === "string", `Setup blocker: provider entry unavailable (${setup.status})`);
  check(typeof setupBody.publicConfig?.publishableKey === "string" && setupBody.publicConfig.publishableKey.startsWith("pk_test_"), "Gateway is not demonstrably Stripe test mode; stop before provider entry");
  console.log("PASS: test-mode provider method setup reached; no method attached or funds charged");
  if (!Array.isArray(accounts.body) || !accounts.body.length) {
    console.log("SETUP BLOCKER: no eligible payable account for checkout"); return;
  }
  const selected = accounts.body.find((a: any) => a.gatewayConfigId === stripe.id && Number(a.available) > 0);
  if (!selected) { console.log("SETUP BLOCKER: no positive available balance on a Stripe test-mode payable account"); return; }
  const checkout = await request(`/api/ledger/checkout/${scope}/${selected.eaId}`);
  check(checkout.status === 200, `Setup blocker: checkout unavailable (${checkout.status})`);
  check(checkout.body?.readiness?.paymentAuthorization === "ready" && checkout.body?.account?.gatewayConfigId === stripe.id, "Setup blocker: checkout authorization or gateway not ready");
  console.log("PASS: own-worker checkout quote ready for secure test-mode entry; no payment session created");
}

main().catch((error) => {
  // Never print provider responses, cookies or credentials from exceptions.
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
});