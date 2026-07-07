import { pushComponentSchema } from "../../server/services/component-schema-push";

/**
 * Create the bulk component's tables in the DEV database even though the
 * component is not enabled here.
 *
 * Why: Replit's Publish flow diffs the dev database schema against prod and
 * applies the difference. Prod has the bulk component enabled (its tables must
 * exist), but dev does not — so every Publish saw "tables in prod that dev
 * lacks" and DROPPED the bulk tables from prod, crash-looping the deployment
 * on the startup drift gate. Keeping the (empty) tables present in dev makes
 * the publish diff stop dropping them.
 *
 * Safe: pushComponentSchema only creates missing tables from the Drizzle
 * manifest; it never alters or drops. The dev drift gate skips disabled
 * components' tables in the core sweep and counts them as "known" in the
 * extra-table sweep, so dev boots unaffected.
 */
async function main() {
  await pushComponentSchema("bulk");
  console.log("Done — bulk component tables ensured in dev.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
