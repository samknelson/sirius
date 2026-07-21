import { ChargePlugin } from "../base";
import {
  TriggerType,
  PluginContext,
  PluginExecutionResult,
  CronContext,
  LedgerTransaction,
  LedgerEntryVerification,
} from "../types";
import { registerChargePlugin } from "../registry";
import type { ChargePluginMetadata } from "../types";
import { logger } from "../../../../logger";
import { storage } from "../../../../storage/database";
import {
  BAO_COBRA_COVERED_LIVES_TIERS,
  BAO_COBRA_ADMIN_FEE_RATE,
  applyBaoCobraAdminFee,
  type BaoCobraCoveredLivesTier,
} from "@shared/schema/sitespecific/bao/schema";
import type { Ledger, ChargePluginConfig } from "@shared/schema";
import type { WorkerTrustElection } from "@shared/schema/trust/elections-schema";

/**
 * COBRA monthly premium charge plugin.
 *
 * Runs on the CRON trigger. For every COBRA case with an election made whose
 * status is not closed, it bills the covered person's COBRA ledger account
 * (this config's account) one entry per coverage month, from the COBRA
 * effective month through the current month, capped at the case's maximum
 * coverage period.
 *
 * Pricing always comes from the COBRA rate table at billing time: the sum of
 * the effective rate for each continued benefit at the case's covered-lives
 * tier (1 / 2 / 3+ — the subscriber plus any covered dependents recorded on
 * the election) as of the first day of the billed month. Months whose rates
 * are not configured are skipped (billed on a later run once rates exist)
 * rather than billed at a guessed price.
 *
 * Idempotency: each billed month posts exactly one entry, keyed
 * `<configId>:<eaId>:<caseId>:<YYYY-MM>` with the month recorded in the
 * entry metadata. A month that already has an entry for this case + config
 * is never billed again.
 */

class BaoCobraChargePlugin extends ChargePlugin {
  readonly metadata: ChargePluginMetadata = {
    id: "sitespecific-bao-cobra",
    name: "BAO - COBRA Monthly Premium",
    description:
      "Bills the monthly COBRA premium for every elected, open COBRA case to the covered person's COBRA ledger account. The premium is the sum of the rate-table rates for the continued benefits at the case's covered-lives tier, as of the first day of each billed month, plus the 2% COBRA administration fee computed once on the summed package total. One entry per coverage month, from the COBRA effective month through the current month, capped at the case's maximum coverage period.",
    triggers: [TriggerType.CRON],
    defaultScope: "global" as const,
    configSchema: {
      type: "object",
      properties: {},
    },
    requiredComponent: "sitespecific.bao",
  };

  /** First day of the month containing the given YMD, as a YMD string. */
  private firstOfMonthYmd(ymd: string): string {
    return `${ymd.slice(0, 7)}-01`;
  }

  /** "YYYY-MM" of a YMD string. */
  private ymOf(ymd: string): string {
    return ymd.slice(0, 7);
  }

  /** Next month of a "YYYY-MM". */
  private nextYm(ym: string): string {
    const [y, m] = ym.split("-").map(Number);
    const next = m === 12 ? [y + 1, 1] : [y, m + 1];
    return `${next[0]}-${String(next[1]).padStart(2, "0")}`;
  }

  private monthLabel(ym: string): string {
    const [y, m] = ym.split("-").map(Number);
    return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString("default", {
      month: "long",
      timeZone: "UTC",
    })} ${y}`;
  }

  /**
   * Find the COBRA election for a case: the covered person's election tagged
   * `enrollmentType: "cobra"` whose data records this case id.
   */
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

  async execute(
    context: PluginContext,
    config: ChargePluginConfig,
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.CRON) {
      return {
        success: false,
        transactions: [],
        error: `BAO COBRA charge plugin only handles CRON trigger, got ${context.trigger}`,
      };
    }
    const cron = context as CronContext;

    if (!config.account) {
      return {
        success: true,
        transactions: [],
        message: "No ledger account configured for this charge plugin",
      };
    }

    try {
      const cases = await storage.baoCobraCases.listElectedActiveCases();
      const today = new Date();
      const currentYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

      const transactions: LedgerTransaction[] = [];
      let skippedMissingRate = 0;

      for (const theCase of cases) {
        const elections = await storage.workerTrustElections.listByWorker(
          theCase.coveredPersonWorkerId,
        );
        const election = this.findCobraElection(elections, theCase.id);
        if (!election || !election.benefitIds?.length) {
          logger.warn("Elected COBRA case has no matching COBRA election", {
            service: "charge-plugin-bao-cobra",
            caseId: theCase.id,
            workerId: theCase.coveredPersonWorkerId,
          });
          continue;
        }

        const electionData = election.data as {
          coveredLivesTier?: string;
        } | null;
        const coveredLives = 1 + (election.relationshipIds?.length ?? 0);
        const tier: BaoCobraCoveredLivesTier =
          electionData?.coveredLivesTier &&
          (BAO_COBRA_COVERED_LIVES_TIERS as readonly string[]).includes(
            electionData.coveredLivesTier,
          )
            ? (electionData.coveredLivesTier as BaoCobraCoveredLivesTier)
            : coveredLives <= 1
              ? "1"
              : coveredLives === 2
                ? "2"
                : "3+";

        const ea = await storage.ledger.ea.getOrCreate(
          "worker",
          theCase.coveredPersonWorkerId,
          config.account,
        );

        // Months already billed for this case by this config.
        const existing = await storage.ledger.entries.getByReferenceAndConfig(
          theCase.id,
          config.id,
        );
        const billedMonths = new Set(
          existing
            .map((e) => (e.data as { billingMonth?: string } | null)?.billingMonth)
            .filter((m): m is string => !!m),
        );

        // Coverage months: effective month .. min(current month, max-period month).
        const startYm = this.ymOf(theCase.cobraEffectiveYmd);
        const capYm = theCase.maxPeriodYmd
          ? this.ymOf(theCase.maxPeriodYmd)
          : currentYm;
        const endYm = capYm < currentYm ? capYm : currentYm;

        for (let ym = startYm; ym <= endYm; ym = this.nextYm(ym)) {
          if (billedMonths.has(ym)) continue;

          const asOfYmd = `${ym}-01`;
          let total = 0;
          let missingRate = false;
          const lineRates: Record<string, string> = {};
          for (const benefitId of election.benefitIds) {
            const rate = await storage.baoCobraRates.getEffectiveRate(
              benefitId,
              tier,
              asOfYmd,
            );
            if (!rate) {
              missingRate = true;
              break;
            }
            lineRates[benefitId] = rate.rate;
            total += Number(rate.rate);
          }
          if (missingRate) {
            skippedMissingRate++;
            logger.warn("Skipping COBRA billing month - missing rate", {
              service: "charge-plugin-bao-cobra",
              caseId: theCase.id,
              month: ym,
              tier,
            });
            continue;
          }
          if (total <= 0) continue;

          // 2% COBRA administration fee, computed once on the summed
          // pre-fee package total and rounded to cents.
          const fee = applyBaoCobraAdminFee(total);
          const amount = fee.total.toFixed(2);
          const [y, m] = ym.split("-").map(Number);
          transactions.push({
            chargePlugin: this.metadata.id,
            chargePluginKey: `${config.id}:${ea.id}:${theCase.id}:${ym}`,
            chargePluginConfigId: config.id,
            accountId: config.account,
            entityType: "worker",
            entityId: theCase.coveredPersonWorkerId,
            amount,
            description: `COBRA Premium: ${this.monthLabel(ym)} ($${amount})`,
            transactionDate: new Date(y, m - 1, 1),
            referenceType: "cobra_case",
            referenceId: theCase.id,
            metadata: {
              pluginId: this.metadata.id,
              pluginConfigId: config.id,
              cobraCaseId: theCase.id,
              workerId: theCase.coveredPersonWorkerId,
              electionId: election.id,
              billingMonth: ym,
              coveredLivesTier: tier,
              benefitRates: lineRates,
              preFeeTotal: fee.preFeeTotal.toFixed(2),
              adminFee: fee.adminFee.toFixed(2),
              adminFeeRate: BAO_COBRA_ADMIN_FEE_RATE,
            },
          });
        }
      }

      if (cron.mode === "test") {
        return {
          success: true,
          transactions: [],
          message: `[TEST] Would create ${transactions.length} COBRA premium entries (${skippedMissingRate} month(s) skipped for missing rates)`,
        };
      }

      const notifications = transactions.map((t) => ({
        type: "created" as const,
        amount: t.amount,
        description: t.description,
      }));

      return {
        success: true,
        transactions,
        notifications,
        message: `Created ${transactions.length} COBRA premium entries across ${cases.length} elected case(s)${skippedMissingRate ? ` (${skippedMissingRate} month(s) skipped for missing rates)` : ""}`,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "COMPONENT_TABLE_NOT_FOUND") {
        return {
          success: true,
          transactions: [],
          message: "COBRA tables are not provisioned; nothing to bill",
        };
      }
      logger.error("BAO COBRA charge plugin execution failed", {
        service: "charge-plugin-bao-cobra",
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        transactions: [],
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  async verifyEntry(
    entry: Ledger,
    config: ChargePluginConfig,
  ): Promise<LedgerEntryVerification> {
    const baseResult: LedgerEntryVerification = {
      entryId: entry.id,
      chargePlugin: entry.chargePlugin,
      chargePluginKey: entry.chargePluginKey,
      isValid: true,
      discrepancies: [],
      actualAmount: entry.amount,
      expectedAmount: null,
      actualDescription: entry.memo,
      expectedDescription: null,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      transactionDate: entry.date,
    };

    try {
      const data = entry.data as {
        billingMonth?: string;
        coveredLivesTier?: string;
        benefitRates?: Record<string, string>;
      } | null;

      if (!data?.billingMonth || !data?.coveredLivesTier) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [
            "Entry missing required metadata (billingMonth, coveredLivesTier)",
          ],
        };
      }
      if (
        !(BAO_COBRA_COVERED_LIVES_TIERS as readonly string[]).includes(
          data.coveredLivesTier,
        )
      ) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [
            `Unknown covered-lives tier: ${data.coveredLivesTier}`,
          ],
        };
      }

      // Re-price the billed month from the rate table.
      const asOfYmd = `${data.billingMonth}-01`;
      const benefitIds = Object.keys(data.benefitRates ?? {});
      if (benefitIds.length === 0) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: ["Entry metadata records no benefit rates"],
        };
      }
      let expected = 0;
      const discrepancies: string[] = [];
      for (const benefitId of benefitIds) {
        const rate = await storage.baoCobraRates.getEffectiveRate(
          benefitId,
          data.coveredLivesTier as BaoCobraCoveredLivesTier,
          asOfYmd,
        );
        if (!rate) {
          discrepancies.push(
            `No rate currently configured for benefit ${benefitId} tier ${data.coveredLivesTier} as of ${asOfYmd}`,
          );
          continue;
        }
        expected += Number(rate.rate);
      }
      const expectedAmount = applyBaoCobraAdminFee(expected).total.toFixed(2);
      if (discrepancies.length === 0 && entry.amount !== expectedAmount) {
        discrepancies.push(
          `Amount mismatch: expected ${expectedAmount}, found ${entry.amount}`,
        );
      }

      return {
        ...baseResult,
        isValid: discrepancies.length === 0,
        expectedAmount,
        discrepancies,
      };
    } catch (error) {
      return {
        ...baseResult,
        isValid: false,
        discrepancies: [
          `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
}

registerChargePlugin(new BaoCobraChargePlugin());
