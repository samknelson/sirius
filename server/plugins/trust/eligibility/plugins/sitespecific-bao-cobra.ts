import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";
import {
  resolveCobraAccountId,
} from "../../../../modules/sitespecific/bao/cobra-payment-state";
import type { WorkerTrustElection } from "@shared/schema/trust/elections-schema";
import type { BaoCobraCase } from "@shared/schema/sitespecific/bao/schema";

type BaoCobraConfig = BaseEligibilityConfig;

/**
 * "BAO - COBRA" continues coverage only for paid statement months.
 *
 * The worker under evaluation is the COVERED PERSON: COBRA elections are
 * recorded on the covered person's own worker record, so this plugin reads
 * `subscriberWorker` (the worker whose benefits are being scanned) and ignores
 * the dependent-relationship machinery.
 *
 * Eligible when ALL of:
 * - The worker has an elected, open COBRA case whose COBRA election covers the
 *   evaluated benefit.
 * - The as-of month is inside the coverage window (COBRA effective month
 *   through the maximum-period month).
 * - A net positive premium for this case and a posted allocation exist on the
 *   COBRA account in the requested statement month, whose net balance is zero.
 *   Grace controls case lifecycle, not benefit eligibility.
 */
class BaoCobraPlugin extends EligibilityPlugin<BaoCobraConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-cobra",
    name: "BAO - COBRA",
    description:
      "Continues COBRA coverage for an elected, open case covering this benefit only when the requested statement month has a posted case premium and allocated payment and is fully paid.",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      properties: {},
    },
  };

  private findCobraElection(
    elections: WorkerTrustElection[],
    caseId: string,
  ): WorkerTrustElection | undefined {
    return elections.find(
      (e) =>
        e.enrollmentType === "cobra" &&
        (e.data as { cobraCaseId?: string } | null)?.cobraCaseId === caseId,
    );
  }

  async evaluate(
    context: EligibilityContext,
    _config: BaoCobraConfig,
  ): Promise<EligibilityResult> {
    if (!context.benefitId) {
      return {
        eligible: false,
        reason: "COBRA plugin requires benefitId in context",
      };
    }

    const workerId = context.subscriberWorker.id;
    const monthLabel = `${new Date(
      context.asOfYear,
      context.asOfMonth - 1,
      1,
    ).toLocaleString("default", { month: "long" })} ${context.asOfYear}`;
    // Last day of the as-of month, as YMD — the evaluation date.
    const asOfDate = new Date(context.asOfYear, context.asOfMonth, 0);
    const asOfYmd = `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, "0")}-${String(asOfDate.getDate()).padStart(2, "0")}`;
    const asOfYm = asOfYmd.slice(0, 7);

    let cases: BaoCobraCase[];
    try {
      cases =
        await storage.baoCobraCases.listElectedActiveCasesForCoveredPerson(
          workerId,
        );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "COMPONENT_TABLE_NOT_FOUND"
      ) {
        return {
          eligible: false,
          reason: "COBRA tables are not provisioned",
        };
      }
      throw error;
    }
    if (cases.length === 0) {
      return {
        eligible: false,
        reason: "Worker has no elected, open COBRA case",
      };
    }

    const elections = await storage.workerTrustElections.listByWorker(workerId);
    const accountId = await resolveCobraAccountId();

    let sawCoveringCase = false;
    let denialReason: string | null = null;
    for (const theCase of cases) {
      const election = this.findCobraElection(elections, theCase.id);
      if (!election?.benefitIds?.includes(context.benefitId)) continue;
      sawCoveringCase = true;

      // Coverage window check.
      const startYm = theCase.cobraEffectiveYmd.slice(0, 7);
      const endYm = theCase.maxPeriodYmd?.slice(0, 7) ?? null;
      if (asOfYm < startYm) {
        denialReason ??= `COBRA coverage does not begin until ${theCase.cobraEffectiveYmd}`;
        continue;
      }
      if (endYm && asOfYm > endYm) {
        denialReason ??= `COBRA maximum coverage period ended ${theCase.maxPeriodYmd}`;
        continue;
      }

      if (!accountId) {
        denialReason = "No COBRA billing account configured";
        continue;
      }

      const evidence = await storage.ledger.entries.getCobraStatementMonthEvidence(
        workerId, accountId, theCase.id, asOfYm,
      );
      if (!evidence || evidence.caseChargeCents <= 0) {
        denialReason = `No posted COBRA charge for this case in ${monthLabel}`;
        continue;
      }
      if (!evidence.hasAllocation) {
        denialReason = `No payment allocated to the COBRA statement month ${monthLabel}`;
        continue;
      }
      if (evidence.balanceCents !== 0) {
        denialReason = `COBRA statement month ${monthLabel} has a nonzero balance (${(evidence.balanceCents / 100).toFixed(2)})`;
        continue;
      }
      return {
        eligible: true,
        reason: `COBRA election covers this benefit for ${monthLabel}; statement month paid`,
      };
    }

    return {
      eligible: false,
      reason: sawCoveringCase
        ? denialReason ?? "COBRA coverage is not active for this month"
        : "No COBRA election covers this benefit",
    };
  }
}

const plugin = new BaoCobraPlugin();
registerEligibilityPlugin(plugin);

export { BaoCobraPlugin };
