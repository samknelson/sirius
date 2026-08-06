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
 *      `role_permissions` (access config), preserving the admin user
 *      (--admin-email, default mmcdermott@cgtconsultinginc.com) with their
 *      auth identities and role assignments. Also drops `s1_staging` for a
 *      fresh stage (unless --keep-staging).
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
 *       [--admin-email you@example.com]
 */
import { spawnSync } from "child_process";
import path from "path";
import { resolveDatabaseUrl, describeDatabaseTarget } from "../../shared/database-url";

const WIPE = process.argv.includes("--wipe");
const KEEP_STAGING = process.argv.includes("--keep-staging");
const emailIdx = process.argv.indexOf("--admin-email");
const ADMIN_EMAIL = emailIdx >= 0 ? process.argv[emailIdx + 1] : "mmcdermott@cgtconsultinginc.com";

/** Tables never truncated by --wipe. `variables` carries migrations_version +
 * component schema state (truncating it bricks boot); roles/role_permissions
 * are access config the preserved admin's user_roles rows point at. */
const KEEP_TABLES = new Set(["variables", "roles", "role_permissions"]);

/** Row-count probe deciding "populated" (migrated/app data, not config). */
const PROBE_TABLES = ["workers", "contacts", "employers", "ledger_payments", "worker_hours", "trust_wmb", "worker_trust_elections"];

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

  // --- 2. Populated check / wipe ---
  let populatedRows = 0;
  const existing: string[] = [];
  for (const t of PROBE_TABLES) {
    const rows = await q(`SELECT to_regclass($1) reg`, [`public.${t}`]);
    if (rows[0]?.reg) existing.push(t);
  }
  for (const t of existing) {
    const rows = await q(`SELECT count(*)::int n FROM "${t}"`);
    populatedRows += rows[0].n;
  }
  console.log(`populated probe: ${populatedRows} row(s) across ${existing.length} data table(s)`);

  if (populatedRows > 0 && !WIPE) {
    console.error(
      `FAIL: target holds data. Re-run with --wipe to truncate everything except\n` +
        `roles/permissions/variables, preserving admin ${ADMIN_EMAIL}.`,
    );
    process.exit(1);
  }

  if (WIPE) {
    console.log(`wiping target (preserving admin ${ADMIN_EMAIL}) ...`);
    const adminUsers = await q(`SELECT * FROM users WHERE lower(email) = lower($1)`, [ADMIN_EMAIL]);
    const adminUser = adminUsers[0];
    const adminIdentities = adminUser ? await q(`SELECT * FROM auth_identities WHERE user_id = $1`, [adminUser.id]) : [];
    const adminUserRoles = adminUser ? await q(`SELECT * FROM user_roles WHERE user_id = $1`, [adminUser.id]) : [];

    const allTables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)) as Array<{ tablename: string }>;
    const toTruncate = allTables.map((r) => r.tablename).filter((t) => !KEEP_TABLES.has(t));
    await pool.query(`TRUNCATE TABLE ${toTruncate.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
    console.log(`truncated ${toTruncate.length} table(s); kept: ${[...KEEP_TABLES].join(", ")}`);

    const reinsert = async (table: string, rows: Array<Record<string, unknown>>) => {
      for (const row of rows) {
        const cols = Object.keys(row);
        await pool.query(
          `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
          cols.map((c) => row[c]),
        );
      }
    };
    if (adminUser) {
      await reinsert("users", [adminUser]);
      await reinsert("auth_identities", adminIdentities);
      await reinsert("user_roles", adminUserRoles);
      console.log(`restored admin: users=1 auth_identities=${adminIdentities.length} user_roles=${adminUserRoles.length}`);
    } else {
      console.log("no existing admin user row to preserve (will create below)");
    }

    if (!KEEP_STAGING) {
      await pool.query(`DROP SCHEMA IF EXISTS s1_staging CASCADE`);
      console.log("dropped s1_staging (re-run stage.ts before loaders)");
    }
  }

  // --- 3. Ensure admin exists (fresh target or admin row was absent) ---
  const { storage } = await import("../../server/storage/database");
  const { withNotificationsSuppressed } = await import("../../server/middleware/request-context");
  const adminNow = await q(`SELECT id FROM users WHERE lower(email) = lower($1)`, [ADMIN_EMAIL]);
  if (adminNow.length === 0) {
    await withNotificationsSuppressed(async () => {
      let roleId: string;
      const roleRows = await q(`SELECT id FROM roles WHERE name = 'admin'`);
      if (roleRows.length > 0) {
        roleId = roleRows[0].id;
      } else {
        const role = await storage.users.createRole({ name: "admin", description: "Administrator role with all permissions" });
        roleId = role.id;
        const allPermissions = await storage.users.getAllPermissions();
        for (const p of allPermissions) {
          await storage.users.assignPermissionToRole({ roleId, permissionKey: p.key });
        }
        console.log(`created role admin with ${allPermissions.length} permission(s)`);
      }
      const user = await storage.users.createUser({
        email: ADMIN_EMAIL,
        firstName: null,
        lastName: null,
        accountStatus: "active",
        isActive: true,
      });
      await storage.users.assignRoleToUser({ userId: user.id, roleId });
      console.log(`created admin user ${ADMIN_EMAIL}`);
    });
  } else {
    console.log(`admin present: ${ADMIN_EMAIL}`);
  }

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
