/**
 * Real development PostgreSQL verification, using transaction-local shadow
 * tables and an intentional rollback. Never changes actual variables/sessions.
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

// Establish the storage graph before leaf imports (standalone tsx cycle safety).
await import("../../server/storage/index");
const { getClient, runInTransaction } = await import("../../server/storage/transaction-context");
const { createVariableStorage } = await import("../../server/storage/system/variables");
const { createSessionStorage } = await import("../../server/storage/system/sessions");
const { readMaskComponent } = await import("../../server/storage/system/mask-component");
const { pool } = await import("../../server/storage/db");
const rolledBack = new Error("intentional test rollback");
let passed = false;
try {
  await runInTransaction(async () => {
    const db = getClient();
    await db.execute(sql`CREATE TEMP TABLE variables (LIKE public.variables INCLUDING ALL) ON COMMIT DROP`);
    await db.execute(sql`CREATE TEMP TABLE sessions (LIKE public.sessions INCLUDING ALL) ON COMMIT DROP`);
    const variables = createVariableStorage();
    const sessions = createSessionStorage();
    const identity = { passport: { user: { dbUser: { id: "fictional-component-test" } } } };
    const expiry = new Date("2099-01-01T00:00:00Z");
    assert.equal((await readMaskComponent()).enabled, false);
    await sessions.upsertSession("disabled-login", identity, expiry);
    await variables.setByName("components", { "system.mask_mode": true, ledger: true });
    const first = await readMaskComponent();
    assert.ok(first.enabled && first.epoch);
    await variables.setComponentEnabled("bulk", true);
    assert.deepEqual((await variables.getByName("components"))?.value,
      { "system.mask_mode": true, ledger: true, bulk: true });
    assert.equal((await readMaskComponent()).epoch, first.epoch, "unrelated component changes retain the protection generation");
    assert.equal((await sessions.transitionMaskMode("disabled-login", 1, "on"))?.mode, "on");
    await sessions.upsertSession("enabled-login", identity, expiry);
    assert.equal((await sessions.transitionMaskMode("enabled-login", 1, "on"))?.mode, "on");
    const stale = await sessions.getSessionData("enabled-login");
    const config = await variables.getByName("components");
    assert.ok(config);
    await variables.update(config.id, { value: { "system.mask_mode": false, ledger: true } });
    assert.equal((await readMaskComponent()).enabled, false);
    assert.equal((await sessions.getSessionData("enabled-login") as any).maskMode.mode, "off");
    await sessions.upsertSession("enabled-login", stale, expiry, true);
    assert.equal((await sessions.getSessionData("enabled-login") as any).maskMode.mode, "off");
    assert.equal(await sessions.transitionMaskMode("enabled-login", 2, "off"), null);
    await variables.setByName("components", { "system.mask_mode": true, ledger: true });
    const second = await readMaskComponent();
    assert.notEqual(first.epoch, second.epoch);
    assert.equal((await sessions.transitionMaskMode("enabled-login", 3, "on"))?.mode, "on");
    await sessions.upsertSession("fresh-login", identity, expiry);
    assert.equal((await sessions.transitionMaskMode("fresh-login", 1, "on"))?.mode, "on");
    await variables.delete(config.id);
    assert.equal((await readMaskComponent()).enabled, false);
    assert.equal((await sessions.getSessionData("fresh-login") as any).maskMode.mode, "off");
    passed = true;
    throw rolledBack;
  });
} catch (error) {
  if (error !== rolledBack) throw error;
} finally {
  await pool.end();
}
assert.ok(passed);
console.log("PASS real PostgreSQL component authority, generic write paths, legacy recovery and stale-save preference fencing; all test writes rolled back.");
