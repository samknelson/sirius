/**
 * T27 bulk Okta pre-provisioning CLI. DRY-RUN BY DEFAULT — a real run
 * requires `--execute` AND OKTA_API_TOKEN. Bulk rehearsal runs stay dry-run;
 * the ONLY sanctioned pre-cutover real run is canary-scoped:
 *
 *   npx tsx scripts/s1-migration/provision-okta-users.ts                       # dry-run report, all migrated users
 *   npx tsx scripts/s1-migration/provision-okta-users.ts --only canary@x.org   # dry-run, one user
 *   npx tsx scripts/s1-migration/provision-okta-users.ts --execute --only canary@x.org   # CANARY real run
 *   npx tsx scripts/s1-migration/provision-okta-users.ts --execute             # CUTOVER ONLY (runbook step)
 *
 * Idempotent / resumable: users that already carry an okta auth_identity are
 * skipped, so a partial failure is fixed by re-running. Okta users that
 * already exist for an email are reused (no duplicate accounts, no second
 * activation email). Output is aggregates + opaque ids only (HIPAA-safe).
 */
import { pool as pgPool } from "../../server/storage/db";
import { recordRun, ensureStagingSchema } from "./lib/staging";
import { provisionMigratedUsers, type OktaAdminClient } from "./lib/okta-provision";
import {
  findOktaUsersByEmail,
  createOktaUserAndSendActivation,
  getActiveOktaIssuerUrl,
} from "../../server/auth/okta-admin";

const EXECUTE = process.argv.includes("--execute");
const ONLY: string[] | undefined = (() => {
  const i = process.argv.indexOf("--only");
  if (i < 0) return undefined;
  const v = String(process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (v.length === 0) {
    console.error("--only requires a comma-separated email list");
    process.exit(2);
  }
  return v;
})();

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();

  const dryRun = !EXECUTE;
  let client: OktaAdminClient;
  if (dryRun && !process.env.OKTA_API_TOKEN) {
    // dry-run without a token: report from DB state alone, treating Okta
    // lookup as "unknown/not found" — flagged in the report header.
    console.warn("OKTA_API_TOKEN not set: dry-run reports DB state only (oktaExists always false).");
    client = {
      findByEmail: async () => [],
      createUser: async () => {
        throw new Error("dry-run stub: createUser must never be called");
      },
    };
  } else {
    const issuerUrl = getActiveOktaIssuerUrl();
    client = {
      findByEmail: (email) => findOktaUsersByEmail(issuerUrl, email),
      createUser: ({ email, firstName, lastName }) =>
        createOktaUserAndSendActivation({ issuerUrl, persona: "member", email, firstName, lastName }),
    };
  }

  if (!dryRun && !ONLY) {
    console.warn(
      "WARNING: full --execute run creates Okta accounts (activation emails!) for ALL migrated active users. " +
        "This is the CUTOVER activation wave — confirm you are following the RUNBOOK.",
    );
  }

  const report = await provisionMigratedUsers({
    dryRun,
    onlyEmails: ONLY,
    client,
    log: (m) => console.log(m),
  });

  const summary = {
    script: "t27-provision-okta-users",
    dryRun,
    onlyFilter: ONLY ? ONLY.length : 0,
    ...report,
    // never print emails; dryRunWouldCreate already carries opaque ids only
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!dryRun) await recordRun(startedAt, { script: "t27-provision-okta-users", only: ONLY?.length ?? 0 }, summary);

  await pgPool.end();
  process.exit(report.failures.length > 0 || report.ambiguousOkta.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
