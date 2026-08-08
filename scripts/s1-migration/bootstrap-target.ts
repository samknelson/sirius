/**
 * ONE-COMMAND target bootstrap — no manual preconfiguration.
 *
 * Brings any target database (empty, schema-only, or previously populated)
 * to the exact state the migration loaders expect:
 *
 *   1. Schema: empty-DB bootstrap (if empty) + core migrations + component
 *      cache + pending component migrations — the same sequence the app boots
 *      with.
 *   2. Wipe (only with --wipe): if the target holds data, truncate every
 *      table EXCEPT `variables` (migration/schema bookkeeping), `roles` and
 *      `role_permissions` (access config), preserving the admin users
 *      (--admin-email, comma-separated; default mmcdermott@cgtconsultinginc.com
 *      + john.young@activistcentral.net) with their auth identities and role
 *      assignments. Also drops `s1_staging` for a fresh stage
 *      (unless --keep-staging).
 *      Refuses to touch a populated DB without --wipe.
 *   3. Admin: creates the admin user + full-permission `admin` role if absent
 *      (fresh target), so the operator can always sign in.
 *   4. Components: enables the fund component set (bulk, debug,
 *      employer.company, ledger + all ledger.*, sitespecific.bao,
 *      system.sftp.client, all trust.*, worker.relations).
 *   5. Seeds: policies (all 7, incl. core PA/R/EC/COBRA), employment
 *      statuses, genders, call reasons. All idempotent.
 *
 * trust_providers / trust_benefits are NOT seeded here — they derive from
 * the staged S1 nodes (seed-trust-config.ts, run AFTER stage.ts) per the
 * §4.15 carry-over-as-is ruling.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/bootstrap-target.ts [--wipe] [--keep-staging]
 *       [--admin-email a@example.com,b@example.com]
 */
import { spawnSync } from "child_process";
import path from "path";
import { resolveDatabaseUrl, describeDatabaseTarget } from "../../shared/database-url";

const WIPE = process.argv.includes("--wipe");
const KEEP_STAGING = process.argv.includes("--keep-staging");
const emailIdx = process.argv.indexOf("--admin-email");
/** Comma-separated list; every listed user survives --wipe and is created
 * (with the full-permission admin role) if absent. */
const ADMIN_EMAILS = (emailIdx >= 0
  ? process.argv[emailIdx + 1]
  : "mmcdermott@cgtconsultinginc.com,john.young@activistcentral.net"
)
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);
const ADMIN_EMAILS_LABEL = ADMIN_EMAILS.join(", ");

/** Tables never truncated by --wipe. `variables` carries migrations_version +
 * component schema state (truncating it bricks boot); roles/role_permissions
 * are access config the preserved admin's user_roles rows point at. */
const KEEP_TABLES = new Set(["variables", "roles", "role_permissions"]);

/** Advisory lock key shared by migration tooling (single-run guard). */
const MIGRATION_LOCK_KEY = 727001;

/**
 * TEST-ONLY fault injection for the wipe transaction (used by
 * scripts/oneoffs/s1-wipe-retry-tests.ts to prove atomicity). Values:
 *   S1_BOOTSTRAP_TEST_FAULT=after_truncate|before_commit        → throw mid-tx
 *   S1_BOOTSTRAP_TEST_FAULT=after_truncate:kill|before_commit:kill → SIGKILL self
 * Never set in production; unset = zero behavior change.
 */
function injectTestFault(point: "after_truncate" | "before_commit") {
  const fault = process.env.S1_BOOTSTRAP_TEST_FAULT;
  if (!fault) return;
  if (fault === `${point}:kill`) {
    console.error(`TEST FAULT: hard-killing process at ${point}`);
    process.kill(process.pid, "SIGKILL");
  }
  if (fault === point) {
    throw new Error(`TEST FAULT injected at ${point}`);
  }
}

function runStep(label: string, script: string) {
  console.log(`\n=== ${label}: npx tsx ${script} ===`);
  const res = spawnSync("npx", ["tsx", script], { stdio: "inherit", env: process.env });
  if (res.status !== 0) {
    console.error(`FAIL: step "${label}" exited ${res.status}`);
    process.exit(1);
  }
}

async function main() {
  console.log(`[bootstrap-target] target: ${describeDatabaseTarget(resolveDatabaseUrl())}`);
  process.env.ALLOW_EMPTY_DB_BOOTSTRAP = "1";

  // Imports AFTER env setup; these mirror server/app-init.ts boot order.
  const { ensureEmptyDatabaseBootstrap } = await import("../../server/services/empty-db-bootstrap");
  const { pool } = await import("../../server/storage/db");
  const q = async (text: string, params?: unknown[]) => (await pool.query(text, params)).rows;

  // --- 0. Single-run guard (advisory lock, session-scoped on one client) ---
  const lockClient = await pool.connect();
  const [{ got }] = (await lockClient.query(`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS got`)).rows;
  if (!got) {
    console.error("FAIL: another migration process holds the advisory lock on this target.");
    process.exit(1);
  }

  // --- 0b. Populated guard BEFORE any mutating step (schema included) ---
  // Any row in any public table other than bookkeeping/access-config/admin
  // identity/sessions counts as data — not just the seven spine tables.
  const probeExclude = new Set([...KEEP_TABLES, "users", "auth_identities", "user_roles", "sessions"]);
  const preTables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)) as Array<{ tablename: string }>;
  const populatedTables: string[] = [];
  for (const { tablename } of preTables) {
    if (probeExclude.has(tablename)) continue;
    const rows = await q(`SELECT EXISTS (SELECT 1 FROM "${tablename}" LIMIT 1) AS x`);
    if (rows[0]?.x) populatedTables.push(tablename);
  }
  console.log(`populated probe: ${populatedTables.length} non-empty data table(s)`);
  if (populatedTables.length > 0 && !WIPE) {
    console.error(
      `FAIL: target holds data (${populatedTables.slice(0, 8).join(", ")}${populatedTables.length > 8 ? ", …" : ""}).\n` +
        `Nothing was modified. Re-run with --wipe to truncate everything except\n` +
        `roles/permissions/variables, preserving admin(s) ${ADMIN_EMAILS_LABEL}.`,
    );
    process.exit(1);
  }

  // --- 1. Schema ---
  await ensureEmptyDatabaseBootstrap();
  const { runMigrations } = await import("../../scripts/migrate");
  const mig = await runMigrations();
  console.log(`migrations: ran=${mig.ran} skipped=${mig.skipped}`);
  if (mig.errors.length > 0) {
    console.error("FAIL: migration errors:", mig.errors);
    process.exit(1);
  }
  const { loadComponentCache } = await import("../../server/services/component-cache");
  await loadComponentCache();
  const { runPendingComponentMigrationsAtStartup } = await import("../../server/services/migration-runner");
  await runPendingComponentMigrationsAtStartup();

  // --- 2. Wipe (single transaction: snapshot → truncate → restore → staging) ---
  // Atomic on one dedicated client: a failure at ANY point (including admin
  // restore) rolls back the truncate — the target is never left wiped without
  // its admin.
  if (WIPE) {
    console.log(`wiping target (preserving admin(s) ${ADMIN_EMAILS_LABEL}) ...`);
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      const adminUsers = (
        await tx.query(
          `SELECT * FROM users WHERE lower(email) = ANY($1::text[])`,
          [ADMIN_EMAILS.map((e) => e.toLowerCase())],
        )
      ).rows;
      const adminIds = adminUsers.map((u) => u.id);
      const adminIdentities = adminIds.length
        ? (await tx.query(`SELECT * FROM auth_identities WHERE user_id = ANY($1::text[])`, [adminIds])).rows
        : [];
      const adminUserRoles = adminIds.length
        ? (await tx.query(`SELECT * FROM user_roles WHERE user_id = ANY($1::text[])`, [adminIds])).rows
        : [];

      const allTables = (await tx.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows as Array<{ tablename: string }>;
      const toTruncate = allTables.map((r) => r.tablename).filter((t) => !KEEP_TABLES.has(t));
      await tx.query(`TRUNCATE TABLE ${toTruncate.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
      injectTestFault("after_truncate");

      const reinsert = async (table: string, rows: Array<Record<string, unknown>>) => {
        for (const row of rows) {
          const cols = Object.keys(row);
          await tx.query(
            `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")})
             VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
            cols.map((c) => row[c]),
          );
        }
      };
      if (adminUsers.length > 0) {
        await reinsert("users", adminUsers);
        await reinsert("auth_identities", adminIdentities);
        await reinsert("user_roles", adminUserRoles);
      }

      if (KEEP_STAGING) {
        // Staged S1 records survive, but id_map/runs point at rows that no
        // longer exist — stale mappings would make every loader (and
        // seed-trust-config) skip recreation. Always clear them on wipe.
        await tx.query(`TRUNCATE TABLE s1_staging.id_map`).catch(() => undefined);
        await tx.query(`TRUNCATE TABLE s1_staging.runs`).catch(() => undefined);
      } else {
        await tx.query(`DROP SCHEMA IF EXISTS s1_staging CASCADE`);
      }
      injectTestFault("before_commit");
      await tx.query("COMMIT");
      console.log(
        `truncated ${toTruncate.length} table(s); kept: ${[...KEEP_TABLES].join(", ")}; ` +
          (adminUsers.length > 0
            ? `restored admin(s) (users=${adminUsers.length} auth_identities=${adminIdentities.length} user_roles=${adminUserRoles.length}); `
            : `no existing admin rows (will create below); `) +
          (KEEP_STAGING ? "kept staged records, CLEARED id_map+runs" : "dropped s1_staging (re-run stage.ts)"),
      );
    } catch (e) {
      await tx.query("ROLLBACK").catch(() => undefined);
      console.error("FAIL: wipe rolled back — target unchanged.");
      throw e;
    } finally {
      tx.release();
    }
  }

  // --- 3. Ensure admin role exists and carries ALL current permissions ---
  //
  // This block runs unconditionally so a re-run after a copy (where the role
  // already existed but its role_permissions rows were absent) is idempotent.
  const { storage } = await import("../../server/storage/database");
  const { withNotificationsSuppressed } = await import("../../server/middleware/request-context");

  await withNotificationsSuppressed(async () => {
    // Ensure the admin role exists.
    let roleId: string;
    const roleRows = await q(`SELECT id FROM roles WHERE name = 'admin'`);
    if (roleRows.length > 0) {
      roleId = roleRows[0].id;
    } else {
      const role = await storage.users.createRole({ name: "admin", description: "Administrator role with all permissions" });
      roleId = role.id;
      console.log(`created role admin`);
    }

    // Reconcile permissions: grant every currently registered permission to
    // the admin role. ON CONFLICT DO NOTHING makes this idempotent so
    // re-running after a DB copy (empty role_permissions) heals the gap.
    const allPermissions = await storage.users.getAllPermissions();
    let granted = 0;
    for (const p of allPermissions) {
      try {
        await storage.users.assignPermissionToRole({ roleId, permissionKey: p.key });
        granted++;
      } catch {
        // already assigned — skip
      }
    }
    console.log(`admin role: ${allPermissions.length} permission(s) registered, ${granted} newly granted`);

    // Ensure each configured admin user exists and has the admin role.
    for (const adminEmail of ADMIN_EMAILS) {
      const adminNow = await q(`SELECT id FROM users WHERE lower(email) = lower($1)`, [adminEmail]);
      if (adminNow.length === 0) {
        const user = await storage.users.createUser({
          email: adminEmail,
          firstName: null,
          lastName: null,
          accountStatus: "active",
          isActive: true,
        });
        await storage.users.assignRoleToUser({ userId: user.id, roleId });
        console.log(`created admin user ${adminEmail}`);
      } else {
        // User exists — ensure the role is still attached (idempotent).
        try {
          await storage.users.assignRoleToUser({ userId: adminNow[0].id, roleId });
        } catch {
          // already assigned — skip
        }
        console.log(`admin present: ${adminEmail}`);
      }
    }
  });

  lockClient.release(); // advisory lock is session-scoped; freed when pool closes
  await pool.end();

  // --- 4/5. Components + seeds (child processes: fresh caches per step) ---
  const base = path.dirname(new URL(import.meta.url).pathname);
  runStep("components", path.join(base, "dev/enable-components.ts"));
  runStep("policies", path.join(base, "seed-migration-policies.ts"));
  runStep("employment statuses", path.join(base, "seed-employment-statuses.ts"));
  runStep("genders", path.join(base, "dev/seed-genders.ts"));
  runStep("call reasons", path.join(base, "dev/seed-call-reasons.ts"));

  console.log(
    `\nDONE. Next: stage.ts (at freeze) → seed-trust-config.ts → loaders (RUNBOOK §4).`,
  );
  process.exit(0);
}

main().catch((e) => {
  const dbg = process.env.S1_MIGRATION_DEBUG === "1";
  console.error(dbg ? e : `FATAL ${(e as Error).name}: ${String((e as Error).message ?? e).split("\n")[0]}`);
  process.exit(1);
});
