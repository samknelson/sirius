// One-off: run pending core migrations against the DB in EXTERNAL_DATABASE_URL
// and print the result. Used to diagnose/heal the bao-prd counter stall.
import { runMigrations, getMigrationStatus } from "../migrate/index";

async function main() {
  const before = await getMigrationStatus();
  console.log("[migrate-oneoff] current version:", before.currentVersion);
  console.log(
    "[migrate-oneoff] pending:",
    before.pendingMigrations.map(m => `${m.version}:${m.name}`).join(", ") || "(none)",
  );
  const result = await runMigrations();
  console.log("[migrate-oneoff] ran:", result.ran, "errors:", JSON.stringify(result.errors, null, 2));
  const after = await getMigrationStatus();
  console.log("[migrate-oneoff] version now:", after.currentVersion);
  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
