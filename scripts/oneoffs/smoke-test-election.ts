#!/usr/bin/env npx tsx
/**
 * Smoke test for the "Election" eligibility plugin
 * (server/plugins/trust/eligibility/plugins/election.ts).
 *
 * The rule: a worker is eligible when their active trust election (as of the
 * evaluation month) covers the benefit being evaluated AND, when evaluating a
 * dependent, the election also includes the subscriber<->dependent relationship.
 *
 * The plugin reads three storage methods. This test stubs them in-memory so it
 * runs without a database:
 *   - storage.workerTrustElections.getActiveByWorkerAsOf
 *   - storage.workerRelations.get
 *   - storage.trustBenefits.getTrustBenefit
 *
 * Run: npx tsx scripts/oneoffs/smoke-test-election.ts
 */
// Import storage/database FIRST so its (circular) module graph initializes in
// the same order the app boots in. Importing the plugin first triggers a
// "Cannot access 'PluginRegistry' before initialization" load-order error.
import { storage } from "../../server/storage/database";
import { ElectionPlugin } from "../../server/plugins/trust/eligibility/plugins/election";
import type { EligibilityContext } from "../../server/plugins/trust/eligibility/types";

const plugin = new ElectionPlugin();

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

// ---------------------------------------------------------------------------
// In-memory fixtures the stubs read from. Each test sets these before running.
// ---------------------------------------------------------------------------
const SUB = "worker-subscriber";
const DEP = "worker-dependent";
const OTHER = "worker-unrelated";
const BENEFIT = "benefit-medical";

type MockElection = {
  benefitIds: string[];
  relationshipIds: string[];
} | null;

let mockElection: MockElection = null;
let mockRelations: Record<string, { worker1: string; worker2: string }> = {};

// Captures the args of the most recent getActiveByWorkerAsOf call so tests can
// assert the plugin queries with the right subscriber and as-of date.
let lastElectionQuery: { workerId: string; asOfYmd: string } | null = null;

// Stub storage so no real query runs.
(storage.workerTrustElections as unknown as Record<string, unknown>).getActiveByWorkerAsOf =
  async (workerId: string, asOfYmd: string) => {
    lastElectionQuery = { workerId, asOfYmd };
    return mockElection as never;
  };
(storage.workerRelations as unknown as Record<string, unknown>).get = async (id: string) =>
  (mockRelations[id] as never) ?? undefined;
(storage.trustBenefits as unknown as Record<string, unknown>).getTrustBenefit = async (
  id: string,
) => ({ id, name: "Medical" }) as never;

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------
function subscriberCtx(benefitId: string | undefined): EligibilityContext {
  const sub = { id: SUB } as never;
  return {
    scanType: "start",
    asOfYear: 2026,
    asOfMonth: 6,
    benefitId,
    subscriberWorker: sub,
    subscriberContact: { given: "Sam", family: "Subscriber" } as never,
    // No relationship => dependent fields mirror the subscriber.
    dependentWorker: sub,
    dependentContact: { given: "Sam", family: "Subscriber" } as never,
  } as EligibilityContext;
}

function dependentCtx(benefitId: string | undefined): EligibilityContext {
  return {
    scanType: "start",
    asOfYear: 2026,
    asOfMonth: 6,
    benefitId,
    subscriberWorker: { id: SUB } as never,
    subscriberContact: { given: "Sam", family: "Subscriber" } as never,
    dependentWorker: { id: DEP } as never,
    dependentContact: { given: "Dana", family: "Dependent" } as never,
    relationship: {
      subscriberWorkerId: SUB,
      dependentWorkerId: DEP,
      relationType: "spouse",
    },
  } as EligibilityContext;
}

const cfg = { appliesTo: ["start"] } as never;

async function run() {
  console.log("Guard: missing benefitId");
  {
    mockElection = { benefitIds: [BENEFIT], relationshipIds: [] };
    const r = await plugin.evaluate(subscriberCtx(undefined), cfg);
    check("no benefitId in context is NOT eligible", r.eligible === false, r);
    check(
      "reason mentions benefitId requirement",
      typeof r.reason === "string" && r.reason.includes("benefitId"),
      r,
    );
  }

  console.log("Subscriber: no active election");
  {
    mockElection = null;
    const r = await plugin.evaluate(subscriberCtx(BENEFIT), cfg);
    check("no active election is NOT eligible", r.eligible === false, r);
    check(
      "reason mentions no active trust election",
      typeof r.reason === "string" && r.reason.includes("no active trust election"),
      r,
    );
  }

  console.log("Subscriber: election does not cover this benefit");
  {
    mockElection = { benefitIds: ["benefit-dental"], relationshipIds: [] };
    const r = await plugin.evaluate(subscriberCtx(BENEFIT), cfg);
    check("benefit not in election is NOT eligible", r.eligible === false, r);
    check(
      'reason mentions "does not cover benefit"',
      typeof r.reason === "string" && r.reason.includes("does not cover benefit"),
      r,
    );
  }

  console.log("Subscriber: active election covers benefit");
  {
    mockElection = { benefitIds: [BENEFIT], relationshipIds: [] };
    lastElectionQuery = null;
    const r = await plugin.evaluate(subscriberCtx(BENEFIT), cfg);
    check("subscriber with covered benefit is eligible", r.eligible === true, r);
    check(
      "election queried with subscriber id",
      lastElectionQuery?.workerId === SUB,
      lastElectionQuery,
    );
    check(
      "election queried as of end of June 2026 (2026-06-30)",
      lastElectionQuery?.asOfYmd === "2026-06-30",
      lastElectionQuery,
    );
  }

  console.log("Dependent: relationship NOT included in election");
  {
    // Election covers the benefit and references a relationship, but that
    // relationship row links the subscriber to someone else (OTHER), not DEP.
    mockRelations = { "rel-other": { worker1: SUB, worker2: OTHER } };
    mockElection = { benefitIds: [BENEFIT], relationshipIds: ["rel-other"] };
    const r = await plugin.evaluate(dependentCtx(BENEFIT), cfg);
    check("dependent not in election is NOT eligible", r.eligible === false, r);
    check(
      'reason mentions "does not cover dependent"',
      typeof r.reason === "string" && r.reason.includes("does not cover dependent"),
      r,
    );
    check(
      "reason names the dependent",
      typeof r.reason === "string" && r.reason.includes("Dana Dependent"),
      r,
    );
  }

  console.log("Dependent: relationship included in election");
  {
    // Relationship row links SUB <-> DEP (order should not matter).
    mockRelations = { "rel-spouse": { worker1: DEP, worker2: SUB } };
    mockElection = { benefitIds: [BENEFIT], relationshipIds: ["rel-spouse"] };
    const r = await plugin.evaluate(dependentCtx(BENEFIT), cfg);
    check("dependent covered by election is eligible", r.eligible === true, r);
    check(
      "reason confirms benefit and dependent covered",
      typeof r.reason === "string" && r.reason.includes("Dana Dependent"),
      r,
    );
  }

  console.log("Dependent: benefit covered but election has no relationships");
  {
    mockRelations = {};
    mockElection = { benefitIds: [BENEFIT], relationshipIds: [] };
    const r = await plugin.evaluate(dependentCtx(BENEFIT), cfg);
    check(
      "dependent with empty relationshipIds is NOT eligible",
      r.eligible === false,
      r,
    );
  }

  console.log("Dependent: relationshipIds reference rows that no longer exist");
  {
    // relationshipIds is non-empty but every id resolves to undefined (e.g. the
    // relation row was deleted). Exercises the `if (!rel) continue` path.
    mockRelations = {};
    mockElection = { benefitIds: [BENEFIT], relationshipIds: ["rel-missing-1", "rel-missing-2"] };
    const r = await plugin.evaluate(dependentCtx(BENEFIT), cfg);
    check(
      "dependent with only unresolved relations is NOT eligible",
      r.eligible === false,
      r,
    );
    check(
      'reason mentions "does not cover dependent"',
      typeof r.reason === "string" && r.reason.includes("does not cover dependent"),
      r,
    );
  }

  console.log("Edge: relationship present but dependent IS the subscriber");
  {
    // dependentWorker.id === subscriberWorker.id => treated as subscriber path,
    // so the relationship check is skipped even though relationship is set.
    mockElection = { benefitIds: [BENEFIT], relationshipIds: [] };
    const ctx = dependentCtx(BENEFIT);
    (ctx.dependentWorker as { id: string }).id = SUB;
    const r = await plugin.evaluate(ctx, cfg);
    check(
      "self-as-dependent uses subscriber path and is eligible",
      r.eligible === true,
      r,
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll election smoke checks passed.");
}

run().catch((err) => {
  console.error("Smoke test threw:", err);
  process.exit(1);
});
