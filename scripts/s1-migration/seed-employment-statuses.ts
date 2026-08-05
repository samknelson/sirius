/**
 * Seed options_employment_status for a fresh (schema-only) S2 database.
 *
 * Employment statuses are S2 CONFIGURATION data, not migrated S1 data — the
 * T4 options loader and the T20 hours loader only VERIFY that every status
 * name in the hour-type mapping (06 §4.12) exists. On the long-lived dev
 * database these rows were configured by hand; a fresh schema-only branch has
 * none, so T4 fails its hour-type verify pass. Run this once before T4.
 *
 * Idempotent: matches existing rows by case-insensitive name and never
 * updates them (admin-configured values win). Creates only what is missing.
 *
 * The `employed` flags below are sensible defaults for the BAO derived-status
 * model (statuses whose hour types represent someone actively on payroll).
 * REVIEW THEM WITH THE FUND — they drive eligibility ("actively employed"
 * gate), the member-status scan, and dashboards. Editable afterwards under
 * Admin → Options → Employment Statuses.
 *
 * Usage: npx tsx scripts/s1-migration/seed-employment-statuses.ts [--dry-run]
 */
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";

const DRY_RUN = process.argv.includes("--dry-run");

/** name → { code, employed } — names must match T20's tid→name mapping exactly. */
const STATUSES: Array<{ name: string; code: string; employed: boolean; sequence: number }> = [
  { name: "Active", code: "ACTIVE", employed: true, sequence: 10 },
  { name: "Initial Eligibility", code: "INITELIG", employed: true, sequence: 20 },
  { name: "No Charge", code: "NOCHARGE", employed: true, sequence: 30 },
  { name: "Event Center Hours Purchasing", code: "ECHP", employed: true, sequence: 40 },
  { name: "Disability", code: "DISABILITY", employed: false, sequence: 50 },
  { name: "FMLA", code: "FMLA", employed: false, sequence: 60 },
  { name: "LOA", code: "LOA", employed: false, sequence: 70 },
  { name: "Military Leave", code: "MILITARY", employed: false, sequence: 80 },
  { name: "COBRA", code: "COBRA", employed: false, sequence: 90 },
  { name: "Terminated", code: "TERM", employed: false, sequence: 100 },
  { name: "Deceased", code: "DECEASED", employed: false, sequence: 110 },
];

async function main() {
  const options = createUnifiedOptionsStorage();
  const existing: Array<{ id: string; name: string }> = await options.list("employment-status");
  const byName = new Map(existing.map((r) => [r.name.toLowerCase(), r]));

  let created = 0;
  let present = 0;
  for (const s of STATUSES) {
    if (byName.has(s.name.toLowerCase())) {
      present++;
      continue;
    }
    created++;
    if (!DRY_RUN) {
      await withNotificationsSuppressed(() =>
        options.create("employment-status", {
          name: s.name,
          code: s.code,
          employed: s.employed,
          sequence: s.sequence,
        }),
      );
    }
  }

  console.log(JSON.stringify({ loader: "seed-employment-statuses", dryRun: DRY_RUN, present, created }, null, 2));
  if (created > 0) {
    console.error(
      "NOTE: review the `employed` flag on the seeded statuses with the fund (Admin → Options → Employment Statuses) — it gates eligibility and the member-status scan.",
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
