/**
 * Smoke test for the sitespecific-bao-dp eligibility plugin.
 * Stubs the storage singleton + DP payment state; no database needed.
 * Run: npx tsx scripts/oneoffs/smoke-bao-dp-eligibility.ts
 */
import { storage } from "../../server/storage/database";
import { BaoDpPlugin } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-dp";
import type { EligibilityContext } from "../../server/plugins/trust/eligibility/types";

const SUB = "sub-1";
const DP = "dp-1";
const CHILD = "child-1";
const REL_DP = "rel-dp";
const REL_CHILD = "rel-child";
const BENEFIT = "benefit-med";
const ELECTION = "elec-1";

const worker = (id: string) => ({ id }) as any;

function ctx(overrides: Partial<EligibilityContext> = {}): EligibilityContext {
  return {
    scanType: "continue",
    asOfMonth: 7,
    asOfYear: 2026,
    benefitId: BENEFIT,
    subscriberWorker: worker(SUB),
    subscriberContact: null,
    dependentWorker: worker(DP),
    dependentContact: { given: "Pat", family: "Partner" } as any,
    relationship: {
      subscriberWorkerId: SUB,
      dependentWorkerId: DP,
      relationType: "type-dp",
    },
    ...overrides,
  };
}

// ---- stubs ----
const relRows: Record<string, any> = {
  [REL_DP]: { id: REL_DP, worker1: SUB, worker2: DP, relationTypeName: "Domestic Partner" },
  [REL_CHILD]: { id: REL_CHILD, worker1: SUB, worker2: CHILD, relationTypeName: "Child" },
};
let activeRel: any = relRows[REL_DP];
(storage as any).workerRelations = {
  findActiveBetween: async () => activeRel,
  listByIdsWithType: async (ids: string[]) => ids.map((i) => relRows[i]).filter(Boolean),
};

let elections: any[] = [];
(storage as any).workerTrustElections = {
  listByWorker: async () => elections,
};

// Payment-state control knobs: computeDpPaymentState is driven through the
// storage layer (pluginConfigs + ledger entries + balance).
let dpConfigured = true;
let dpEntries: any[] = []; // entries on ELECTION for the DP charge config
let dpBalance = "0"; // positive = owed

const DP_CONFIG_ID = "cfg-dp";
const DP_ACCOUNT_ID = "acct-dp";

(storage as any).pluginConfigs = {
  search: async (_kind: string, params: any) => {
    if (!dpConfigured || params?.pluginId !== "sitespecific-bao-dp") return [];
    return [
      {
        config: {
          id: DP_CONFIG_ID,
          pluginId: "sitespecific-bao-dp",
          name: "DP",
          enabled: true,
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        subsidiary: { scope: "global", employerId: null, account: DP_ACCOUNT_ID },
      },
    ];
  },
};

// Rate sheet: a CONFIRMED (non-provisional) $0.00 rate under the shared
// pricing rule waives payment for the month; anything else fails closed.
let rates: Record<string, Array<{ effectiveYmd: string; rate: string; provisional?: boolean }>> = {};
(storage as any).baoDpRates = {
  getEffectiveRate: async (benefitId: string, transition: string, asOfYmd: string) =>
    benefitId === BENEFIT
      ? (rates[transition] ?? []).filter((r) => r.effectiveYmd <= asOfYmd)[0]
      : undefined,
};

(storage as any).ledger = {
  entries: {
    getBalancesByEntityAndAccount: async () => [{ total: dpBalance }],
    getByReferenceAndConfig: async (refId: string, cfgId: string) =>
      refId === ELECTION && cfgId === DP_CONFIG_ID ? dpEntries : [],
  },
};

const chargeEntry = (amount: string, month = "2026-07") => ({
  amount,
  data: { billingMonth: month, dpRelationshipId: REL_DP, dpWorkerId: DP },
});

const baseElection = {
  id: ELECTION,
  relationshipIds: [REL_DP, REL_CHILD],
  benefitIds: [BENEFIT],
  startYmd: "2026-01-01",
  endYmd: null,
};

const plugin = new BaoDpPlugin();
let failures = 0;

async function check(name: string, c: EligibilityContext, expectEligible: boolean, reasonPart?: string) {
  const res = await plugin.evaluate(c, { appliesTo: ["start", "continue"] });
  const ok =
    res.eligible === expectEligible &&
    (!reasonPart || (res.reason ?? "").toLowerCase().includes(reasonPart.toLowerCase()));
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: eligible=${res.eligible} reason=${res.reason}`);
}

(async () => {
  // 1. Subscriber self-evaluation always passes
  await check("subscriber pass-through", ctx({ relationship: undefined, dependentWorker: worker(SUB) }), true, "subscriber");

  // 2. Non-DP dependent passes through
  activeRel = relRows[REL_CHILD];
  await check(
    "non-DP dependent pass-through",
    ctx({ dependentWorker: worker(CHILD), relationship: { subscriberWorkerId: SUB, dependentWorkerId: CHILD, relationType: "t" } }),
    true,
    "only to domestic-partner",
  );
  activeRel = relRows[REL_DP];

  // 3. DP with no covering election fails
  elections = [];
  await check("no covering election", ctx(), false, "no active election");

  // 4. DP, election covers, no billing account -> fail
  elections = [baseElection];
  dpConfigured = false;
  await check("no billing account", ctx(), false, "billing account");
  dpConfigured = true;

  // 5. DP, election covers, no charge posted -> fail
  dpEntries = [];
  dpBalance = "0";
  await check("missing charge", ctx(), false, "missing required charge");

  // 6. Partial payment -> fail (charged 100, balance 60 => paid 40)
  dpEntries = [chargeEntry("100.00")];
  dpBalance = "60";
  await check("partial payment", ctx(), false, "not fully paid");

  // 7. Unpaid -> fail (charged 100, balance 100 => paid 0)
  dpBalance = "100";
  await check("unpaid", ctx(), false, "not fully paid");

  // 8. Fully paid -> pass (charged 100, balance 0)
  dpBalance = "0";
  await check("fully paid", ctx(), true, "fully paid");

  // 9. Paid row for a DIFFERENT month -> fail (missing charge for as-of month)
  dpEntries = [chargeEntry("100.00", "2026-06")];
  dpBalance = "0";
  await check("paid other month only", ctx(), false, "no dp charge has been posted");

  // 10. Election window: election ended before month -> no covering election
  elections = [{ ...baseElection, endYmd: "2026-06-30" }];
  dpEntries = [chargeEntry("100.00")];
  await check("election ended", ctx(), false, "no active election");

  // 11. Charge adjusted to zero (base + full reversal) -> no net charge row
  elections = [baseElection];
  dpEntries = [chargeEntry("100.00"), chargeEntry("-100.00")];
  dpBalance = "0";
  await check("fully reversed charge", ctx(), false, "no dp charge has been posted");

  // 12. Confirmed no-charge family → family month (member + 2 children + DP)
  //     -> pass with no charge and no payment
  const REL_CHILD_2 = "rel-child-2";
  relRows[REL_CHILD_2] = { id: REL_CHILD_2, worker1: SUB, worker2: "child-2", relationTypeName: "Child" };
  elections = [{ ...baseElection, relationshipIds: [REL_DP, REL_CHILD, REL_CHILD_2] }];
  dpEntries = [];
  dpBalance = "0";
  rates = { family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: false }] };
  await check("confirmed no-charge month", ctx(), true, "confirmed no-charge month");

  // 13. Provisional $0.00 placeholder -> still fail closed
  rates = { family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: true }] };
  await check("provisional zero placeholder", ctx(), false, "missing required charge");

  // 14. Confirmed positive rate, unbilled -> still fail closed
  rates = { family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "50.00", provisional: false }] };
  await check("unbilled positive rate", ctx(), false, "missing required charge");
  rates = {};

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
