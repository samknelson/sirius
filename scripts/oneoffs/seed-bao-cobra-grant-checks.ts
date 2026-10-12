/**
 * Idempotent development fixtures for manually checking the October 2026
 * BAO COBRA benefit grant rule. Creates four isolated workers, each with an
 * elected open case and a matching COBRA trust election for the benefit
 * configured on the COBRA employer's October policy.
 *
 * The script never changes shared configuration and never calls a payment
 * provider. Its payment example is a clearly marked ledger allocation row.
 *
 * Run only in a development workspace:
 *   npm run seed:bao-cobra-grant-checks
 *
 * The npm command passes the required --dev-seed opt-in. The script also
 * rejects deployment mode and database hosts outside the local development
 * allowlist before making any writes.
 */

import { storage } from "../../server/storage/database";
import { getEnvironmentVariable } from "../../server/config/env-registry";
import { resolveDatabaseUrl } from "../../shared/database-url";
import { computeCobraDeadlines } from "../../shared/schema/sitespecific/bao/cobra";
import { resolveEmployerPolicyAsOf } from "../../server/services/policy-resolution";
import { getEnabledComponentIds } from "../../server/modules/components";
import { resolveCobraAccountId } from "../../server/modules/sitespecific/bao/cobra-payment-state";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
import { runInTransaction } from "../../server/storage/transaction-context";
import type { BaoCobraCase, InsertBaoCobraCase } from "../../shared/schema/sitespecific/bao/schema";
import type { Ledger } from "../../shared/schema";

const MARKER = "dev-seed:bao-cobra-grant-checks:v1";
const COBRA_SIRIUS_ID = "COBRA";
const COBRA_ELIGIBILITY_PLUGIN = "sitespecific-bao-cobra";
const TARGET_MONTH = "2026-10";
const TARGET_MONTH_START = `${TARGET_MONTH}-01`;
const PREVIOUS_MONTH = { year: 2026, month: 9 };
const CASE_EFFECTIVE_YMD = "2026-01-01";
const CASE_ELECTION_YMD = "2026-01-15";
const PREMIUM_AMOUNT = "100.00";
const ALLOWED_DATABASE_HOSTS = new Set(["helium", "localhost", "127.0.0.1", "::1"]);

type EvidenceKind = "none" | "charge" | "allocation" | "charge-and-allocation";

interface Scenario {
  slug: string;
  label: string;
  evidence: EvidenceKind;
  expectedEligible: boolean;
}

const scenarios: Scenario[] = [
  {
    slug: "no-charge-no-payment",
    label: "No October charge and no payment (reported bug)",
    evidence: "none",
    expectedEligible: false,
  },
  {
    slug: "charge-without-payment",
    label: "Posted case charge without an allocated payment",
    evidence: "charge",
    expectedEligible: false,
  },
  {
    slug: "payment-without-case-charge",
    label: "Payment allocation without a posted case charge",
    evidence: "allocation",
    expectedEligible: false,
  },
  {
    slug: "paid-zero-balance-control",
    label: "Case-specific charge and same-month allocation net to zero",
    evidence: "charge-and-allocation",
    expectedEligible: true,
  },
];

interface Prerequisites {
  employerId: string;
  benefitId: string;
  benefitName: string;
  benefitLostKind: "medical" | "dental";
  accountId: string;
  statusId: string;
}

interface Fixture {
  workerId: string;
  caseId: string;
  electionId: string;
  scenario: Scenario;
}

function assertDevelopmentTarget(): void {
  if (process.argv.includes("--dev-seed") !== true) {
    throw new Error(
      "Development-only opt-in missing. Run `npm run seed:bao-cobra-grant-checks` from a development workspace.",
    );
  }
  if (
    getEnvironmentVariable("REPLIT_DEPLOYMENT") === "1" ||
    getEnvironmentVariable("NODE_ENV") === "production"
  ) {
    throw new Error("Refusing to seed COBRA grant fixtures in a deployment or production runtime.");
  }

  const hostname = new URL(resolveDatabaseUrl().url).hostname;
  if (!ALLOWED_DATABASE_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing to seed database host "${hostname}". Only the local Replit development database is allowed.`,
    );
  }
}

function markerFor(slug: string): string {
  return `${MARKER}:${slug}`;
}

function getDataMarker(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const marker = (data as { seedMarker?: unknown }).seedMarker;
  return typeof marker === "string" ? marker : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function validatePrerequisites(): Promise<Prerequisites> {
  const enabledComponents = await getEnabledComponentIds();
  if (!enabledComponents.includes("sitespecific.bao")) {
    throw new Error(
      'BAO is not enabled. Enable the existing "sitespecific.bao" component in this development database, then rerun; this seed will not change component configuration.',
    );
  }
  if (!(await storage.baoCobraCases.tableExists())) {
    throw new Error("The BAO COBRA cases table is missing. Provision the BAO component schema, then rerun.");
  }
  if (!(await storage.baoCobraRates.tableExists())) {
    throw new Error("The BAO COBRA rates table is missing. Provision the BAO component schema, then rerun.");
  }

  const employer = await storage.employers.getBySiriusId(COBRA_SIRIUS_ID);
  if (!employer) {
    throw new Error(
      'The dedicated COBRA employer (Sirius ID "COBRA") is missing. Configure the existing COBRA employer and policy before seeding.',
    );
  }

  const { policy, policySource } = await resolveEmployerPolicyAsOf(
    storage,
    employer.id,
    `${TARGET_MONTH}-01`,
  );
  if (!policy || policySource === "System default policy") {
    throw new Error(
      `The COBRA employer has no policy assigned for ${TARGET_MONTH}. Configure its existing policy assignment before seeding.`,
    );
  }
  const benefitIds = ((policy.data as { benefitIds?: unknown } | null)?.benefitIds ?? [])
    .filter((id): id is string => typeof id === "string");
  if (benefitIds.length === 0) {
    throw new Error(`The COBRA employer's ${TARGET_MONTH} policy has no benefits.`);
  }

  // The scan executor currently evaluates every configured row, even rows
  // marked disabled. Inspect the full set so a disabled duplicate or another
  // failing start rule cannot make the printed control outcome misleading.
  const rules = await storage.pluginConfigs.search("trust-eligibility", {
    policy: policy.id,
  });
  const startRulesByBenefit = new Map<string, Array<{
    pluginId: string;
    enabled: boolean;
  }>>();
  for (const row of rules) {
    const subsidiary = row.subsidiary as { benefit?: string | null } | null;
    const benefitId = subsidiary?.benefit;
    if (!benefitId || !benefitIds.includes(benefitId)) continue;
    const data = row.config.data as { appliesTo?: unknown } | null;
    if (!Array.isArray(data?.appliesTo) || !data.appliesTo.includes("start")) continue;
    const list = startRulesByBenefit.get(benefitId) ?? [];
    list.push({ pluginId: row.config.pluginId, enabled: row.config.enabled });
    startRulesByBenefit.set(benefitId, list);
  }
  const configuredBenefitId = benefitIds.find((id) =>
    startRulesByBenefit.get(id)?.some(
      (config) => config.pluginId === COBRA_ELIGIBILITY_PLUGIN && config.enabled,
    ),
  );
  if (!configuredBenefitId) {
    throw new Error(
      `No enabled ${COBRA_ELIGIBILITY_PLUGIN} rule applies to a start scan for a benefit on the COBRA employer's ${TARGET_MONTH} policy. Add/enable that rule in the existing policy configuration; this seed will not change shared eligibility configuration.`,
    );
  }
  const selectedStartRules = startRulesByBenefit.get(configuredBenefitId) ?? [];
  const cobraStartRules = selectedStartRules.filter(
    (rule) => rule.pluginId === COBRA_ELIGIBILITY_PLUGIN,
  );
  if (cobraStartRules.length !== 1 || cobraStartRules[0]?.enabled !== true) {
    throw new Error(
      `Benefit ${configuredBenefitId} must have exactly one enabled COBRA start rule; the scan evaluates disabled rows too. Review its existing policy rules before seeding.`,
    );
  }
  const unsupportedRules = selectedStartRules
    .map((rule) => rule.pluginId)
    .filter((pluginId) => pluginId !== COBRA_ELIGIBILITY_PLUGIN && pluginId !== "election");
  if (unsupportedRules.length > 0) {
    throw new Error(
      `Benefit ${configuredBenefitId} also has start rules (${[...new Set(unsupportedRules)].join(", ")}) whose outcomes this fixture cannot guarantee. Use a COBRA policy benefit with only the COBRA rule and optional election rule.`,
    );
  }

  const benefit = await storage.trustBenefits.getTrustBenefit(configuredBenefitId);
  if (!benefit || benefit.isActive !== true) {
    throw new Error(
      `The COBRA eligibility rule references missing or inactive benefit ${configuredBenefitId}. Correct the existing policy/configuration before seeding.`,
    );
  }
  const benefitLostKind = await storage.baoCobraCases.classifyMedicalDentalBenefit(benefit.id);
  if (!benefitLostKind) {
    throw new Error(
      `Benefit "${benefit.name}" is not classified as medical or dental, so it cannot be recorded as the benefit lost on a COBRA case.`,
    );
  }

  const accountId = await resolveCobraAccountId();
  if (!accountId) {
    throw new Error(
      "No COBRA billing account is configured on an enabled global BAO COBRA charge config. Configure the existing account before seeding.",
    );
  }
  const account = await storage.ledger.accounts.get(accountId);
  if (!account || account.isActive !== true) {
    throw new Error(`The configured COBRA ledger account ${accountId} is missing or inactive.`);
  }

  const options = createUnifiedOptionsStorage();
  const openStatuses = (await options.list("bao-cobra-status")).filter(
    (status: { closed?: boolean | null }) => status.closed !== true,
  );
  const preferredStatusNames = ["elected", "election made", "enrolled", "active"];
  const status =
    preferredStatusNames
      .map((name) => openStatuses.find(
        (candidate: { name?: string }) => candidate.name?.trim().toLowerCase() === name,
      ))
      .find(Boolean) ?? openStatuses[0];
  if (!status) {
    throw new Error(
      "No open COBRA case status is configured. Add an open status in the BAO COBRA options before seeding.",
    );
  }

  return {
    employerId: employer.id,
    benefitId: benefit.id,
    benefitName: benefit.name,
    benefitLostKind,
    accountId,
    statusId: status.id,
  };
}

function buildCase(workerId: string, prereqs: Prerequisites, scenario: Scenario): InsertBaoCobraCase {
  const deadlines = computeCobraDeadlines("manual", CASE_EFFECTIVE_YMD, CASE_ELECTION_YMD);
  return {
    source: "manual",
    statusId: prereqs.statusId,
    qualifyingEventId: null,
    coveredPersonWorkerId: workerId,
    subscriberWorkerId: workerId,
    relationship: "self",
    cobraEffectiveYmd: CASE_EFFECTIVE_YMD,
    offerYmd: deadlines.offerYmd,
    lastDayToElectYmd: deadlines.lastDayToElectYmd,
    electionMadeYmd: CASE_ELECTION_YMD,
    initialPaymentDeadlineYmd: deadlines.initialPaymentDeadlineYmd,
    paymentStatus: null,
    medicalBenefitLostId: prereqs.benefitLostKind === "medical" ? prereqs.benefitId : null,
    dentalBenefitLostId: prereqs.benefitLostKind === "dental" ? prereqs.benefitId : null,
    maxPeriodYmd: deadlines.maxPeriodYmd,
    data: { seedMarker: markerFor(scenario.slug), scenario: scenario.slug },
  };
}

function assertCaseIsFixture(theCase: BaoCobraCase, workerId: string, prereqs: Prerequisites, scenario: Scenario): void {
  const marker = markerFor(scenario.slug);
  if (getDataMarker(theCase.data) !== marker) {
    throw new Error(`Worker ${workerId} has an unmarked COBRA case; refusing to reuse or modify it.`);
  }
  if (
    theCase.source !== "manual" ||
    theCase.statusId !== prereqs.statusId ||
    theCase.coveredPersonWorkerId !== workerId ||
    theCase.subscriberWorkerId !== workerId ||
    theCase.cobraEffectiveYmd !== CASE_EFFECTIVE_YMD ||
    theCase.electionMadeYmd !== CASE_ELECTION_YMD ||
    theCase.maxPeriodYmd !== buildCase(workerId, prereqs, scenario).maxPeriodYmd
  ) {
    throw new Error(
      `Seeded COBRA case ${theCase.id} for ${workerId} was manually changed. It is preserved; review it before rerunning.`,
    );
  }
}

async function findOrCreateCase(
  prereqs: Prerequisites,
  scenario: Scenario,
): Promise<{ workerId: string; theCase: BaoCobraCase }> {
  const name = `[DEV COBRA GRANT] ${scenario.slug}`;
  const found = await storage.workers.searchWorkers(name, 20);
  const exactWorkers = found.workers.filter((worker) => worker.displayName === name);
  if (exactWorkers.length > 1) {
    throw new Error(`More than one worker is named "${name}"; resolve the duplicate before seeding.`);
  }

  if (exactWorkers.length === 0) {
    return runInTransaction(async () => {
      const worker = await storage.workers.createWorker(name);
      const theCase = await storage.baoCobraCases.createEnforcingInvariants(
        buildCase(worker.id, prereqs, scenario),
        false,
      );
      return { workerId: worker.id, theCase };
    });
  }

  const workerId = exactWorkers[0].id;
  const workerCases = await storage.baoCobraCases.search({ workerId });
  const ownedCases = workerCases.filter(
    (theCase) => getDataMarker(theCase.data) === markerFor(scenario.slug),
  );
  if (ownedCases.length !== 1 || workerCases.length !== 1) {
    throw new Error(
      `Worker "${name}" already exists but is not an untouched fixture worker. No records were changed; resolve its COBRA cases before rerunning.`,
    );
  }
  const theCase = await storage.baoCobraCases.getRaw(ownedCases[0].id);
  if (!theCase) throw new Error(`Seeded COBRA case ${ownedCases[0].id} disappeared during validation.`);
  assertCaseIsFixture(theCase, workerId, prereqs, scenario);
  if (ownedCases[0].statusClosed !== false) {
    throw new Error(`Seeded COBRA case ${theCase.id} is closed; it is preserved and cannot be used for this check.`);
  }

  const wmbRows = await storage.trust.wmb.getWorkerBenefits(workerId);
  if (wmbRows.some((row: { benefitId: string; year: number; month: number }) =>
    row.benefitId === prereqs.benefitId &&
    row.year === PREVIOUS_MONTH.year &&
    row.month === PREVIOUS_MONTH.month
  )) {
    throw new Error(
      `Worker ${workerId} has September 2026 coverage for ${prereqs.benefitId}, so October would be a continue scan. Remove or inspect that manual change before rerunning; the seed will not alter coverage.`,
    );
  }
  return { workerId, theCase };
}

async function ensureElection(
  workerId: string,
  theCase: BaoCobraCase,
  prereqs: Prerequisites,
  scenario: Scenario,
): Promise<string> {
  const elections = await storage.workerTrustElections.listByWorker(workerId);
  const matchingCaseElections = elections.filter((election) =>
    election.enrollmentType === "cobra" &&
    (election.data as { cobraCaseId?: string } | null)?.cobraCaseId === theCase.id,
  );
  if (matchingCaseElections.length > 1) {
    throw new Error(`Worker ${workerId} has duplicate COBRA elections for case ${theCase.id}; refusing to change them.`);
  }

  const existing = matchingCaseElections[0];
  if (existing) {
    const data = isObject(existing.data) ? existing.data : {};
    const marker = data.seedMarker;
    if (marker !== undefined && marker !== markerFor(scenario.slug)) {
      throw new Error(`COBRA election ${existing.id} has a different seed marker; refusing to reuse it.`);
    }
    const endDateStillCoversOctober = !existing.endYmd || existing.endYmd >= "2026-10-31";
    if (
      existing.workerId !== workerId ||
      existing.employerId !== prereqs.employerId ||
      existing.startYmd !== CASE_EFFECTIVE_YMD ||
      !endDateStillCoversOctober ||
      JSON.stringify([...(existing.benefitIds ?? [])].sort()) !== JSON.stringify([prereqs.benefitId]) ||
      data.cobraCaseId !== theCase.id
    ) {
      throw new Error(
        `COBRA election ${existing.id} for ${workerId} was manually changed. It is preserved; review it before rerunning.`,
      );
    }
    return existing.id;
  }

  if (elections.length > 0) {
    throw new Error(
      `Worker ${workerId} has another trust election. Refusing to let the seed alter or supersede it.`,
    );
  }

  const created = await storage.workerTrustElections.create(workerId, {
    employerId: prereqs.employerId,
    policyId: null,
    startYmd: CASE_EFFECTIVE_YMD,
    endYmd: null,
    benefitIds: [prereqs.benefitId],
    relationshipIds: [],
    enrollmentType: "cobra",
    data: {
      seedMarker: markerFor(scenario.slug),
      cobraCaseId: theCase.id,
      source: "manual-grant-check-fixture",
    },
  });
  return created.id;
}

interface ExpectedLedgerEntry {
  kind: "charge" | "allocation";
  key: string;
  amount: string;
  chargePlugin: string;
  referenceType: string;
  referenceId: string;
  allocationId?: string;
}

function expectedLedgerEntries(scenario: Scenario, caseId: string): ExpectedLedgerEntry[] {
  const prefix = markerFor(scenario.slug);
  const rows: ExpectedLedgerEntry[] = [];
  if (scenario.evidence === "charge" || scenario.evidence === "charge-and-allocation") {
    rows.push({
      kind: "charge",
      key: `${prefix}:case-charge`,
      amount: PREMIUM_AMOUNT,
      chargePlugin: COBRA_ELIGIBILITY_PLUGIN,
      referenceType: "cobra_case",
      referenceId: caseId,
    });
  }
  if (scenario.evidence === "allocation" || scenario.evidence === "charge-and-allocation") {
    rows.push({
      kind: "allocation",
      key: `${prefix}:payment-allocation`,
      amount: `-${PREMIUM_AMOUNT}`,
      chargePlugin: "payment-simple-allocation",
      referenceType: "payment",
      referenceId: `${prefix}:synthetic-payment`,
      allocationId: `${prefix}:allocation`,
    });
  }
  return rows;
}

function ledgerEntryMatches(entry: Ledger, expected: ExpectedLedgerEntry, eaId: string): boolean {
  const data = isObject(entry.data) ? entry.data : {};
  return (
    entry.eaId === eaId &&
    entry.chargePlugin === expected.chargePlugin &&
    entry.chargePluginKey === expected.key &&
    entry.amount === expected.amount &&
    entry.referenceType === expected.referenceType &&
    entry.referenceId === expected.referenceId &&
    entry.statementYmd === TARGET_MONTH_START &&
    data.seedMarker === expected.key.slice(0, expected.key.lastIndexOf(":")) &&
    (expected.allocationId === undefined || data.allocationId === expected.allocationId)
  );
}

async function seedLedgerEvidence(workerId: string, caseId: string, prereqs: Prerequisites, scenario: Scenario): Promise<void> {
  const expected = expectedLedgerEntries(scenario, caseId);
  const existingEas = await storage.ledger.ea.getByEntity("worker", workerId);
  let ea = existingEas.find((candidate) => candidate.accountId === prereqs.accountId);
  if (!ea && expected.length > 0) {
    ea = await storage.ledger.ea.getOrCreate("worker", workerId, prereqs.accountId);
  }

  const monthEntries = ea
    ? (await storage.ledger.entries.getByEaId(ea.id)).filter((entry) =>
        entry.statementYmd >= `${TARGET_MONTH}-01` && entry.statementYmd < "2026-11-01",
      )
    : [];
  const expectedKeys = new Set(expected.map((entry) => entry.key));
  const unrelated = monthEntries.filter((entry) => !expectedKeys.has(entry.chargePluginKey));
  if (unrelated.length > 0) {
    throw new Error(
      `Worker ${workerId} has October ledger entries outside this fixture. They are preserved; inspect them before rerunning.`,
    );
  }

  const entriesByKey = new Map(monthEntries.map((entry) => [entry.chargePluginKey, entry]));
  for (const row of expected) {
    const globalEntry = await storage.ledger.entries.getByChargePluginKey(row.chargePlugin, row.key);
    if (globalEntry && (!ea || !ledgerEntryMatches(globalEntry, row, ea.id))) {
      throw new Error(`Ledger evidence ${row.key} exists but does not match this fixture. It is preserved.`);
    }
    const existing = entriesByKey.get(row.key);
    if (existing && (!ea || !ledgerEntryMatches(existing, row, ea.id))) {
      throw new Error(`Ledger evidence ${row.key} was manually changed. It is preserved; review it before rerunning.`);
    }
  }

  if (!ea && expected.length > 0) {
    throw new Error(`Could not create a COBRA ledger account entry for worker ${workerId}.`);
  }
  if (!ea) return;

  for (const row of expected) {
    if (entriesByKey.has(row.key)) continue;
    await storage.ledger.entries.create({
      eaId: ea.id,
      chargePlugin: row.chargePlugin,
      chargePluginKey: row.key,
      amount: row.amount,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      date: new Date(`${TARGET_MONTH_START}T12:00:00.000Z`),
      statementYmd: TARGET_MONTH_START,
      memo: row.kind === "charge"
        ? `Dev COBRA grant-check case premium (${scenario.slug})`
        : `Synthetic dev COBRA grant-check allocation (${scenario.slug}); no external payment`,
      data: {
        seedMarker: markerFor(scenario.slug),
        scenario: scenario.slug,
        ...(row.allocationId ? { allocationId: row.allocationId } : {}),
      },
    });
  }
}

async function verifyLedgerEvidence(fixture: Fixture, prereqs: Prerequisites): Promise<string> {
  const evidence = await storage.ledger.entries.getCobraStatementMonthEvidence(
    fixture.workerId,
    prereqs.accountId,
    fixture.caseId,
    TARGET_MONTH,
  );
  const expected = fixture.scenario.evidence;
  if (expected === "none") {
    if (evidence !== null && (evidence.caseChargeCents !== 0 || evidence.hasAllocation)) {
      throw new Error(`No-charge fixture ${fixture.workerId} unexpectedly has October COBRA evidence.`);
    }
    return "no October COBRA statement entries";
  }
  if (!evidence) throw new Error(`Fixture ${fixture.workerId} is missing its expected October ledger evidence.`);
  const chargeExpected = expected === "charge" || expected === "charge-and-allocation";
  const allocationExpected = expected === "allocation" || expected === "charge-and-allocation";
  const balanceExpected = expected === "charge"
    ? 10000
    : expected === "allocation"
      ? -10000
      : 0;
  if (
    evidence.caseChargeCents !== (chargeExpected ? 10000 : 0) ||
    evidence.hasAllocation !== allocationExpected ||
    evidence.balanceCents !== balanceExpected
  ) {
    throw new Error(
      `Fixture ${fixture.workerId} has unexpected evidence: charge=${evidence.caseChargeCents} cents, allocation=${evidence.hasAllocation}, balance=${evidence.balanceCents} cents.`,
    );
  }
  return `case charge ${evidence.caseChargeCents}¢; allocation ${evidence.hasAllocation}; net ${evidence.balanceCents}¢`;
}

async function main(): Promise<void> {
  assertDevelopmentTarget();
  const prereqs = await validatePrerequisites();
  console.log(
    `Validated BAO COBRA prerequisites: benefit "${prereqs.benefitName}" (${prereqs.benefitId}), account ${prereqs.accountId}.`,
  );

  const fixtures: Fixture[] = [];
  for (const scenario of scenarios) {
    const { workerId, theCase } = await findOrCreateCase(prereqs, scenario);
    const electionId = await ensureElection(workerId, theCase, prereqs, scenario);
    await seedLedgerEvidence(workerId, theCase.id, prereqs, scenario);
    fixtures.push({ workerId, caseId: theCase.id, electionId, scenario });
  }

  console.log("");
  console.log("Manual check: for each worker, open /workers/<worker-id>/benefits/scan.");
  console.log("Select year 2026, month October, leave Mode on Test, choose Run Test Scan,");
  console.log(`then expand "${prereqs.benefitName}" and inspect the ${COBRA_ELIGIBILITY_PLUGIN} plugin result.`);
  console.log("Do not use Live mode for this check.");

  for (const fixture of fixtures) {
    const evidence = await verifyLedgerEvidence(fixture, prereqs);
    const expected = fixture.scenario.expectedEligible ? "GRANT" : "DO NOT GRANT";
    console.log("");
    console.log(fixture.scenario.label);
    console.log(`  worker ID       : ${fixture.workerId}`);
    console.log(`  case ID         : ${fixture.caseId}`);
    console.log(`  COBRA election  : ${fixture.electionId}`);
    console.log(`  expected result : ${expected} the ${prereqs.benefitName} benefit`);
    console.log(`  October evidence: ${evidence}`);
    console.log(`  UI path         : /workers/${fixture.workerId}/benefits/scan`);
    console.log(`  UI step         : scan October 2026 in Test mode; expect ${expected.toLowerCase()}.`);
  }
}

main().catch((error) => {
  console.error("COBRA grant-check seed failed:", error);
  process.exitCode = 1;
});
