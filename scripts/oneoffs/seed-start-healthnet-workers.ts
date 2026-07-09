/**
 * One-off: seed real workers + supporting data to exercise EVERY criterion of
 * the "BAO - Start Healthnet" trust-eligibility plugin
 * (server/plugins/trust/eligibility/plugins/sitespecific-bao-start-healthnet.ts)
 * so it can be tested manually in the live app.
 *
 * Plugin recap — a subscriber is eligible if they meet ANY ONE of:
 *   1. Geographic — primary address is MORE than the chosen distance from every
 *      selected site (only checked when a distance + at least one site is set).
 *   2. Continuous medical — the subscriber held a benefit of the chosen Medical
 *      type for N consecutive months at ANY point in history (only checked when
 *      a medical type + months are set).
 *   3. Employer immediate-eligibility (ALWAYS checked) — the subscriber's
 *      employer is inside an immediate-eligibility window covering the as-of date.
 *
 * The saved rule (plugin_configs 7c25e64a, EVENT CENTER Plan + Health Net
 * benefit, appliesTo "start") only had criterion 2 (medical, 24 months) + the
 * always-on criterion 3 active. To make all three testable, this script (all via
 * the storage layer, per project rules):
 *   - creates a geocoded "site" facility and turns ON the geographic criterion
 *     (distance 15 mi) in the rule config;
 *   - keeps the medical criterion (Medical type, 24 consecutive months);
 *   - creates an employer immediate-eligibility window on "TEST IE EMPLOYER"
 *     covering 2026 so criterion 3 can pass.
 *
 * Then it seeds one worker per criterion (plus a control that meets none). Each
 * worker is isolated so it passes via exactly ONE criterion:
 *   - geographic worker has a geocoded address far from the site, no benefits;
 *   - medical worker has 24 consecutive months of MLK (Medical type), no
 *     address;
 *   - employer-window worker belongs to TEST IE EMPLOYER (the one with a
 *     window), everyone else belongs to TEST HOTEL (no window);
 *   - control worker has nothing.
 *
 * As-of month under test = June 2026 (the eligibility page default).
 *
 * Idempotent: workers/facility are looked up by name; addresses, benefit months,
 * the immediate-eligibility window, and the rule-config edit are all guarded /
 * re-applied harmlessly.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/seed-start-healthnet-workers.ts
 */

import { storage } from "../../server/storage/database";

// ---- Known fixtures in this database -------------------------------------
const POLICY_ID = "a5b9e6dd-c9ce-47bb-b7cf-7370e160b227"; // EVENT CENTER Plan (carries the rule)
const RULE_CONFIG_ID = "7c25e64a-a56c-4bbe-94f4-171015c6211c"; // the Start HealthNet plugin_configs row
const HEALTHNET_BENEFIT_ID = "1f4b013d-12bc-4960-9f69-a3d738b6fd91"; // Health Net (the evaluated benefit)
const MEDICAL_TYPE_ID = "c756263a-aa63-4bab-bbda-7d77b9527a49"; // "Medical" benefit type
const MLK_BENEFIT_ID = "10e16e6e-1ce8-4068-a55a-6351e72be9f5"; // MLK (Medical type) — for the medical criterion

const EMP_NO_WINDOW = "9a80c1c5-7d46-4124-adc4-4be57375c5ee"; // TEST HOTEL (no immediate-eligibility window)
const EMP_WITH_WINDOW = "93064023-1f33-4f69-963f-4c16b52db647"; // TEST IE EMPLOYER (gets the window)

const MEDICAL_MONTHS = 24;
const DISTANCE_MILES = 15;
const AS_OF = { year: 2026, month: 6 };

// Coordinates chosen so the worker is thousands of miles from the site
// (well over the 15-mile threshold). Site = Los Angeles, worker = New York.
const SITE_COORDS = { latitude: 34.0522, longitude: -118.2437 };
const FAR_WORKER_COORDS = { latitude: 40.7128, longitude: -74.006 };
const SITE_FACILITY_NAME = "[HN TEST] Distant Site (Los Angeles)";

type YearMonth = { year: number; month: number };

function toOrdinal(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}
function fromOrdinal(ord: number): YearMonth {
  return { year: Math.floor(ord / 12), month: (ord % 12) + 1 };
}
function monthRange(start: YearMonth, end: YearMonth): YearMonth[] {
  const out: YearMonth[] = [];
  for (let ord = toOrdinal(start); ord <= toOrdinal(end); ord++) out.push(fromOrdinal(ord));
  return out;
}

async function findOrCreateWorker(name: string) {
  const found = await storage.workers.searchWorkers(name, 10);
  const exact = found.workers.find((w) => w.displayName === name);
  if (exact) return exact;
  return storage.workers.createWorker(name);
}

async function ensureElection(workerId: string, employerId: string): Promise<void> {
  const existing = await storage.workerTrustElections.getActiveByWorker(workerId);
  if (existing) return;
  await storage.workerTrustElections.create(workerId, {
    employerId,
    policyId: POLICY_ID,
    startYmd: "2022-01-01",
    benefitIds: [HEALTHNET_BENEFIT_ID],
    relationshipIds: [],
  });
}

async function ensureBenefitMonths(
  workerId: string,
  benefitId: string,
  months: YearMonth[],
  employerId: string,
): Promise<number> {
  let created = 0;
  for (const { year, month } of months) {
    if (await storage.trust.wmb.workerBenefitExists(workerId, benefitId, month, year)) continue;
    await storage.trust.wmb.createWorkerBenefit({ workerId, month, year, employerId, benefitId });
    created++;
  }
  return created;
}

/** Idempotently ensure a contact has a geocoded primary+active postal address. */
async function ensureGeocodedAddress(
  contactId: string,
  coords: { latitude: number; longitude: number },
  city: string,
  state: string,
): Promise<boolean> {
  const existing = await storage.contacts.addresses.getContactPostalByContact(contactId);
  const alreadyGeocoded = existing.some(
    (a) => a.isPrimary && a.isActive && a.latitude != null && a.longitude != null,
  );
  if (alreadyGeocoded) return false;
  await storage.contacts.addresses.createContactPostal({
    contactId,
    street: "1 Test Way",
    city,
    state,
    postalCode: "00000",
    country: "USA",
    isPrimary: true,
    isActive: true,
    latitude: coords.latitude,
    longitude: coords.longitude,
  });
  return true;
}

/** Idempotently create the geocoded "site" facility used by the geographic criterion. */
async function ensureSiteFacility(): Promise<string> {
  const all = await storage.facilities.getAll();
  let facility = all.find((f) => f.name === SITE_FACILITY_NAME);
  if (!facility) {
    facility = await storage.facilities.create({ name: SITE_FACILITY_NAME });
  }
  await ensureGeocodedAddress(facility.contactId, SITE_COORDS, "Los Angeles", "CA");
  return facility.id;
}

/** Idempotently ensure TEST IE EMPLOYER has an immediate-eligibility window covering 2026. */
async function ensureImmediateWindow(): Promise<string> {
  const startYmd = "2026-01-01";
  const endYmd = "2026-12-31";
  const existing = await storage.baoImmediateEligibility.getByEmployerId(EMP_WITH_WINDOW);
  if (!existing) {
    await storage.baoImmediateEligibility.create({ employerId: EMP_WITH_WINDOW, startYmd, endYmd });
    return `created ${startYmd} → ${endYmd}`;
  }
  if (existing.startYmd > startYmd || existing.endYmd < endYmd) {
    await storage.baoImmediateEligibility.update(existing.id, { startYmd, endYmd });
    return `updated to ${startYmd} → ${endYmd}`;
  }
  return `kept ${existing.startYmd} → ${existing.endYmd}`;
}

/** Turn on the geographic criterion in the saved rule config. */
async function enableAllCriteria(siteFacilityId: string): Promise<void> {
  const config = await storage.pluginConfigs.get(RULE_CONFIG_ID);
  if (!config) throw new Error(`HealthNet rule config not found: ${RULE_CONFIG_ID}`);
  const current = (config.data ?? {}) as Record<string, unknown>;
  delete current.healthnet; // legacy "Ever had HealthNet" criterion — removed from the plugin
  const data = {
    ...current,
    appliesTo: ["start"],
    geographic: { distanceMiles: DISTANCE_MILES, facilityIds: [siteFacilityId] },
    medical: { months: MEDICAL_MONTHS, benefitTypeId: MEDICAL_TYPE_ID },
  };
  await storage.pluginConfigs.update(RULE_CONFIG_ID, { data });
}

async function main(): Promise<void> {
  // 1. Config + supporting data so all three criteria are live.
  const siteFacilityId = await ensureSiteFacility();
  await enableAllCriteria(siteFacilityId);
  const windowMsg = await ensureImmediateWindow();

  // 2. Criterion 1 — Geographic: far-away geocoded address, nothing else.
  const geoWorker = await findOrCreateWorker("[HN] Geographic (far from site)");
  await ensureElection(geoWorker.id, EMP_NO_WINDOW);
  const geoAddr = await ensureGeocodedAddress(geoWorker.contactId, FAR_WORKER_COORDS, "New York", "NY");

  // 3. Criterion 2 — Continuous medical: 24 consecutive months of MLK (Medical type).
  const medWorker = await findOrCreateWorker("[HN] 24mo continuous medical (MLK)");
  await ensureElection(medWorker.id, EMP_NO_WINDOW);
  const medMonths = await ensureBenefitMonths(
    medWorker.id,
    MLK_BENEFIT_ID,
    monthRange({ year: 2023, month: 1 }, { year: 2024, month: 12 }),
    EMP_NO_WINDOW,
  );

  // 4. Criterion 3 — Employer immediate-eligibility: belongs to TEST IE EMPLOYER.
  const empWorker = await findOrCreateWorker("[HN] Employer immediate-eligibility");
  await ensureElection(empWorker.id, EMP_WITH_WINDOW);

  // 5. Control — meets none.
  const noneWorker = await findOrCreateWorker("[HN] Not eligible (no criterion)");
  await ensureElection(noneWorker.id, EMP_NO_WINDOW);

  console.log("Seeded data for the BAO - Start HealthNet plugin (all 3 criteria enabled).\n");
  console.log("Rule config updated (plugin_configs 7c25e64a):");
  console.log(`  geographic: distance ${DISTANCE_MILES} mi, site = ${SITE_FACILITY_NAME} (${siteFacilityId})`);
  console.log(`  medical   : Medical type, ${MEDICAL_MONTHS} consecutive months`);
  console.log(`  employer window (TEST IE EMPLOYER): ${windowMsg}\n`);

  console.log("Page selection to test: EVENT CENTER Plan policy + Health Net benefit, scan type \"start\", as-of June 2026.\n");

  console.log("Criterion 1 — Geographic:");
  console.log(`  worker : ${geoWorker.id} ([HN] Geographic (far from site))`);
  console.log(`  data   : geocoded NY address ~2400 mi from the LA site (${geoAddr ? "added" : "already present"})`);
  console.log("  expect : ELIGIBLE (geographic)\n");

  console.log("Criterion 2 — Continuous medical:");
  console.log(`  worker : ${medWorker.id} ([HN] 24mo continuous medical (MLK))`);
  console.log(`  data   : MLK (Medical type) 2023-01 → 2024-12 (+${medMonths} rows)`);
  console.log("  expect : ELIGIBLE (continuous medical)\n");

  console.log("Criterion 3 — Employer immediate-eligibility:");
  console.log(`  worker : ${empWorker.id} ([HN] Employer immediate-eligibility))`);
  console.log("  data   : employer TEST IE EMPLOYER, window covers June 2026");
  console.log("  expect : ELIGIBLE (employer immediate-eligibility)\n");

  console.log("Control — meets none:");
  console.log(`  worker : ${noneWorker.id} ([HN] Not eligible (no criterion))`);
  console.log("  expect : NOT eligible\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
