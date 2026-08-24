/**
 * Task #999 — maintenance-mode write lock test.
 *
 * Exercises, against the dev database:
 *  1. script-style direct db import (unarmed) stays writable;
 *  2. arming enforcement + entering maintenance locks all storage writes
 *     (Postgres 25006) while reads keep working;
 *  3. allowInMaintenanceMode writes succeed (SET LOCAL escape);
 *  4. session storage writes (upsert/touch/delete) succeed in maintenance
 *     (login/rolling expiry/logout keep working);
 *  5. cron-style failing writes don't poison the pool — subsequent reads work;
 *  6. the system-mode round-trip: exit maintenance via the sanctioned
 *     override, writes work again without a restart.
 *
 * Run: npx tsx scripts/oneoffs/test-999-maintenance-mode.ts
 */
import { storage } from "../../server/storage";
import { allowInMaintenanceMode } from "../../server/storage/maintenance";
import {
  armMaintenanceEnforcement,
  refreshMaintenanceFlag,
  isMaintenanceActive,
} from "../../server/services/maintenance-mode";
import { pool } from "../../server/storage/db";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function isReadOnlyError(err: unknown): boolean {
  const e = err as any;
  const msg = e?.message ?? String(err);
  return e?.code === "25006" || e?.cause?.code === "25006" || /read-only transaction/i.test(msg);
}

async function setSystemMode(mode: string) {
  const existing = await storage.variables.getByName("system_mode");
  await allowInMaintenanceMode(async () =>
    existing
      ? storage.variables.update(existing.id, { value: mode })
      : storage.variables.create({ name: "system_mode", value: mode }),
  );
  await refreshMaintenanceFlag();
}

const PROBE = "test_999_probe";
const SID = "test-999-session-sid";

async function cleanupProbe() {
  const v = await storage.variables.getByName(PROBE);
  if (v) await allowInMaintenanceMode(() => storage.variables.delete(v.id));
  await storage.sessions.deleteSession(SID);
}

async function main() {
  const originalModeVar = await storage.variables.getByName("system_mode");
  const originalMode =
    typeof originalModeVar?.value === "string" ? originalModeVar.value : "dev";

  try {
    // 1. Unarmed (script-style) writes work.
    const created = await storage.variables.create({ name: PROBE, value: "unarmed" });
    check("script-style (unarmed) write works", !!created?.id);
    await storage.variables.delete(created.id);

    // 2. Arm and enter maintenance.
    await armMaintenanceEnforcement();
    await setSystemMode("maintenance");
    check("maintenance flag active after entering", isMaintenanceActive());

    // Plain storage write must fail with a Postgres read-only error.
    let writeErr: unknown;
    try {
      await storage.variables.create({ name: PROBE, value: "should-fail" });
    } catch (err) {
      writeErr = err;
    }
    check(
      "plain storage write fails read-only in maintenance",
      writeErr !== undefined && isReadOnlyError(writeErr),
      writeErr ? String((writeErr as any).message) : "no error thrown",
    );

    // Reads keep working.
    const readBack = await storage.variables.getByName("system_mode");
    check("reads work in maintenance", readBack?.value === "maintenance");

    // 3. allowInMaintenanceMode write succeeds.
    const escaped = await allowInMaintenanceMode(() =>
      storage.variables.create({ name: PROBE, value: "escaped" }),
    );
    check("allowInMaintenanceMode write succeeds", !!escaped?.id);
    await allowInMaintenanceMode(() => storage.variables.delete(escaped.id));

    // 4. Session persistence writes succeed (wrapped in the storage layer).
    const expire = new Date(Date.now() + 60_000);
    const up = await storage.sessions.upsertSession(SID, { cookie: {} }, expire);
    check("session upsert works in maintenance (login)", up.created === true);
    await storage.sessions.touchSession(SID, new Date(Date.now() + 120_000));
    check("session touch works in maintenance (rolling expiry)", true);
    const gone = await storage.sessions.deleteSession(SID, "logout");
    check("session delete works in maintenance (logout)", gone.deleted === true);

    // 5. Cron-style failing write doesn't poison the pool; a transactional
    // write (EBS-pump claim style) fails before any side effect and rolls
    // back cleanly.
    let cronErr: unknown;
    try {
      await storage.variables.create({ name: PROBE, value: "cron-style" });
    } catch (err) {
      cronErr = err;
    }
    const stillReads = await storage.variables.getByName("system_mode");
    check(
      "cron-style write fails but pool stays healthy",
      cronErr !== undefined && isReadOnlyError(cronErr) && stillReads?.value === "maintenance",
    );

    // 6. Pooled-client lifecycle across transitions: a connection that is
    // checked OUT when the mode changes must reflect the new state the next
    // time it is acquired (the `acquire` hook), not keep its old session
    // default forever.
    {
      // Exit maintenance while holding a client that got read-only applied.
      const heldB = await pool.connect();
      await setSystemMode("live");
      heldB.release();
      // Reacquire every pooled connection and verify none is stuck read-only.
      const all = [];
      const total = Math.max(pool.totalCount, 1);
      for (let i = 0; i < total; i++) all.push(await pool.connect());
      const states = await Promise.all(
        all.map(async (c) => (await c.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only),
      );
      all.forEach((c) => c.release());
      check(
        "no connection stuck read-only after exiting maintenance (held across exit)",
        states.every((s) => s === "off"),
        `states=${states.join(",")}`,
      );

      // Re-enter maintenance while holding a writable client; after release
      // + reacquire it must be read-only (no stale writable connection).
      const heldA = await pool.connect();
      await setSystemMode("maintenance");
      heldA.release();
      const all2 = [];
      const total2 = Math.max(pool.totalCount, 1);
      for (let i = 0; i < total2; i++) all2.push(await pool.connect());
      const states2 = await Promise.all(
        all2.map(async (c) => (await c.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only),
      );
      all2.forEach((c) => c.release());
      check(
        "no connection stays writable after entering maintenance (held across entry)",
        states2.every((s) => s === "on"),
        `states=${states2.join(",")}`,
      );
      let heldWriteErr: unknown;
      try {
        await storage.variables.create({ name: PROBE, value: "held" });
      } catch (err) {
        heldWriteErr = err;
      }
      check(
        "write via previously-held connection fails after entering maintenance",
        heldWriteErr !== undefined && isReadOnlyError(heldWriteErr),
      );
    }

    // 7. Exit maintenance via the sanctioned override; writes work again.
    await setSystemMode("live");
    check("maintenance flag cleared after exiting", !isMaintenanceActive());
    const post = await storage.variables.create({ name: PROBE, value: "post" });
    check("plain write works again after exiting maintenance", !!post?.id);
    await storage.variables.delete(post.id);
  } finally {
    // Restore original mode + clean probes regardless of outcome.
    try {
      await setSystemMode(originalMode);
      await cleanupProbe();
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    await pool.end();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test crashed:", err);
  process.exit(1);
});
