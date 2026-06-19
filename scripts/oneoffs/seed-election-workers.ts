/**
 * One-off: seed real workers, worker relationships and active trust elections
 * that exercise the "Election" trust-eligibility plugin
 * (server/plugins/trust/eligibility/plugins/election.ts) so it can be tested
 * manually in the live app.
 *
 * The "election" plugin is already configured on:
 *   - policy  = "EVENT CENTER Plan" (a5b9e6dd...) — eligibility rule 102b4492,
 *     pluginId "election", appliesTo ["start","continue"].
 *   - benefit = "MLK" (10e16e6e...).
 *   - employer used for the elections = "TEST HOTEL" (9a80c1c5...).
 *
 * Election plugin verdict (what each seeded worker demonstrates):
 *   1. No active election as of the as-of month  => not eligible
 *      ("Subscriber has no active trust election ...").
 *   2. Active election that does NOT list the benefit => not eligible
 *      ("Active election does not cover benefit ...").
 *   3. Active election that lists the benefit, evaluated for the SUBSCRIBER
 *      (no dependent) => eligible.
 *   4. Active election that lists the benefit, evaluated for a DEPENDENT whose
 *      subscriber<->dependent relation IS in election.relationshipIds => eligible.
 *   5. Same election, evaluated for a DEPENDENT whose relation is NOT in
 *      election.relationshipIds => not eligible
 *      ("Active election does not cover dependent ...").
 *
 * To verify on the site: open each subscriber worker, go to
 * Benefits -> Eligibility, pick policy "EVENT CENTER Plan", benefit "MLK",
 * as-of June 2026, optionally pick a dependent, and run. Read the per-plugin
 * "Election" row in the results.
 *
 * Everything goes through the storage layer (no raw SQL), per project rules,
 * and the script is idempotent:
 *   - workers are looked up by unique display name and reused;
 *   - relations are looked up with findActiveBetween and reused;
 *   - an election is only created if the worker has no active election.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/seed-election-workers.ts
 */

import { storage } from "../../server/storage/database";

// Known fixtures in this database.
const EMPLOYER_ID = "9a80c1c5-7d46-4124-adc4-4be57375c5ee"; // TEST HOTEL
const POLICY_ID = "a5b9e6dd-c9ce-47bb-b7cf-7370e160b227"; // EVENT CENTER Plan (carries the election rule)
const MLK_BENEFIT_ID = "10e16e6e-1ce8-4068-a55a-6351e72be9f5"; // benefit the election rule is attached to
const SPOUSE_TYPE_ID = "2da0acf8-11ee-4145-98b3-afa340c46961"; // options_worker_relation_type "Spouse"
const PARENT_TYPE_ID = "6c63cfbe-463f-4afe-acce-bab4fb8cc055"; // options_worker_relation_type "Parent"

const START_YMD = "2026-01-01";
// As-of month under test (matches the election page defaults of June 2026). The
// relation "active as of" date used for idempotency lookups.
const AS_OF_DATE = new Date(2026, 5, 30); // June 30, 2026

async function findOrCreateWorker(name: string): Promise<string> {
  const found = await storage.workers.searchWorkers(name, 10);
  const exact = found.workers.find((w) => w.displayName === name);
  if (exact) return exact.id;
  const created = await storage.workers.createWorker(name);
  return created.id;
}

async function findOrCreateRelation(
  subscriberId: string,
  dependentId: string,
  relationType: string,
): Promise<string> {
  const existing = await storage.workerRelations.findActiveBetween(
    subscriberId,
    dependentId,
    AS_OF_DATE,
  );
  if (existing) return existing.id;
  const created = await storage.workerRelations.create({
    worker1: subscriberId,
    worker2: dependentId,
    relationType,
    startYmd: START_YMD,
  });
  return created.id;
}

/**
 * Ensure the subscriber has an active election. If one already exists it is
 * reused (idempotent re-run); otherwise it is created with the given benefit
 * and relationship coverage.
 */
async function ensureElection(
  workerId: string,
  benefitIds: string[],
  relationshipIds: string[],
): Promise<string> {
  const existing = await storage.workerTrustElections.getActiveByWorker(workerId);
  if (existing) return existing.id;
  const created = await storage.workerTrustElections.create(workerId, {
    employerId: EMPLOYER_ID,
    policyId: POLICY_ID,
    startYmd: START_YMD,
    benefitIds,
    relationshipIds,
  });
  return created.id;
}

async function main(): Promise<void> {
  // --- Subscriber whose active election COVERS the MLK benefit ---
  const coveredSub = await findOrCreateWorker("[ELECTION] Covered Subscriber");

  // Two dependents: a spouse (will be covered by the election) and a parent
  // (deliberately left OUT of the election's relationshipIds).
  const eligibleSpouse = await findOrCreateWorker("[ELECTION] Eligible Spouse");
  const excludedParent = await findOrCreateWorker("[ELECTION] Excluded Parent");

  const spouseRelId = await findOrCreateRelation(
    coveredSub,
    eligibleSpouse,
    SPOUSE_TYPE_ID,
  );
  const parentRelId = await findOrCreateRelation(
    coveredSub,
    excludedParent,
    PARENT_TYPE_ID,
  );

  // Election covers MLK and includes ONLY the spouse relationship.
  const coveredElection = await ensureElection(
    coveredSub,
    [MLK_BENEFIT_ID],
    [spouseRelId],
  );

  // --- Subscriber whose active election does NOT cover the MLK benefit ---
  const notCoveredSub = await findOrCreateWorker(
    "[ELECTION] Benefit Not Covered Subscriber",
  );
  const notCoveredElection = await ensureElection(notCoveredSub, [], []);

  // --- Subscriber with NO election at all ---
  const noElectionSub = await findOrCreateWorker(
    "[ELECTION] No Election Subscriber",
  );

  console.log("Seeded workers, relationships and elections for the Election plugin.\n");
  console.log("Fixtures used:");
  console.log(`  policy   : EVENT CENTER Plan (${POLICY_ID})`);
  console.log(`  benefit  : MLK (${MLK_BENEFIT_ID})`);
  console.log(`  employer : TEST HOTEL (${EMPLOYER_ID})`);
  console.log("  as-of    : June 2026\n");

  console.log("Scenario 1 — eligible subscriber:");
  console.log(`  worker   : ${coveredSub} ([ELECTION] Covered Subscriber)`);
  console.log(`  election : ${coveredElection} (covers MLK)`);
  console.log("  expect   : Election plugin => ELIGIBLE (no dependent selected)\n");

  console.log("Scenario 2 — eligible dependent (spouse in election):");
  console.log(`  subscriber : ${coveredSub} ([ELECTION] Covered Subscriber)`);
  console.log(`  dependent  : ${eligibleSpouse} ([ELECTION] Eligible Spouse)`);
  console.log(`  relation   : ${spouseRelId} (Spouse, included in election)`);
  console.log("  expect     : Election plugin => ELIGIBLE\n");

  console.log("Scenario 3 — ineligible dependent (parent NOT in election):");
  console.log(`  subscriber : ${coveredSub} ([ELECTION] Covered Subscriber)`);
  console.log(`  dependent  : ${excludedParent} ([ELECTION] Excluded Parent)`);
  console.log(`  relation   : ${parentRelId} (Parent, NOT included in election)`);
  console.log("  expect     : Election plugin => NOT eligible (dependent not covered)\n");

  console.log("Scenario 4 — election does not cover the benefit:");
  console.log(`  worker   : ${notCoveredSub} ([ELECTION] Benefit Not Covered Subscriber)`);
  console.log(`  election : ${notCoveredElection} (no benefits listed)`);
  console.log("  expect   : Election plugin => NOT eligible (benefit not covered)\n");

  console.log("Scenario 5 — no active election:");
  console.log(`  worker   : ${noElectionSub} ([ELECTION] No Election Subscriber)`);
  console.log("  expect   : Election plugin => NOT eligible (no active election)\n");

  console.log(
    "Verify in the app: open a subscriber -> Benefits -> Eligibility, choose the\n" +
      "EVENT CENTER Plan policy and MLK benefit (as-of June 2026), optionally pick a\n" +
      "dependent, run the check, and read the per-plugin 'Election' result row.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
