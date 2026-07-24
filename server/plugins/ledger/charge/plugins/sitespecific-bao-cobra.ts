import { ChargePlugin } from "../base";
import {
  TriggerType,
  PluginContext,
  PluginExecutionResult,
  CronContext,
  LedgerTransaction,
  LedgerEntryVerification,
  LedgerNotification,
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
  type BaoCobraCase,
} from "@shared/schema/sitespecific/bao/schema";
import type { Ledger, ChargePluginConfig } from "@shared/schema";
import type { WorkerTrustElection } from "@shared/schema/trust/elections-schema";

/**
 * COBRA monthly premium charge plugin.
 *
 * Runs on the CRON trigger. For every COBRA case with an election made whose
 * status is not closed, it bills the covered person's COBRA ledger account
 * (this config's account) one entry per coverage month, from the COBRA
 * effective month through the current month, capped at the earlier of the
 * case's maximum coverage period and the COBRA election's end date.
 *
 * Pricing always comes from the COBRA rate table at billing time: the sum of
 * the effective rate for each continued benefit at the case's covered-lives
 * tier (1 / 2 / 3+ — the subscriber plus any covered dependents recorded on
 * the election) as of the first day of the billed month. Months whose rates
 * are not configured are skipped (billed on a later run once rates exist)
 * rather than billed at a guessed price.
 *
 * Statement date: every entry's `statementYmd` is the first day of the
 * coverage month it pays for — NOT the date the charge was created — so
 * statements group COBRA premiums under the correct month.
 *
 * Offsetting adjustments: the same run also sweeps every case that has
 * previously been billed by this config (even when the case is now closed or
 * its election was canceled/shortened). Any billed month that is no longer
 * inside the covered period gets one offsetting `cobra_case_adjustment`
 * entry that zeroes the month's NET total (base + prior adjustments), so
 * repeated runs never over-reverse. If a month becomes covered again (end
 * date moved back out), a reinstating adjustment restores the premium.
 *
 * Idempotency: each billed month posts exactly one base entry, keyed
 * `<configId>:<eaId>:<caseId>:<YYYY-MM>` with the month recorded in the
 * entry metadata (`billingMonth`). Reconciliation always works against the
 * month's net posted total, so re-running the cron never double-charges and
 * never double-reverses.
 */

class BaoCobraChargePlugin extends ChargePlugin {
  readonly metadata: ChargePluginMetadata = {
    id: "sitespecific-bao-cobra",
    name: "BAO - COBRA Monthly Premium",
    description:
      "Bills the monthly COBRA premium for every elected, open COBRA case to the covered person's COBRA ledger account. The premium is the sum of the rate-table rates for the continued benefits at the case's covered-lives tier, as of the first day of each billed month, plus the 2% COBRA administration fee computed once on the summed package total. One entry per coverage month (statement-dated to that month), from the COBRA effective month through the current month, capped at the case's maximum coverage period and election end date. Months no longer covered (canceled election or shortened end date) receive offsetting adjustments that zero the month out.",
    triggers: [TriggerType.CRON],
    defaultScope: "global" as const,
    configSchema: {
      type: "object",
      properties: {},
    },
    requiredComponent: "sitespecific.bao",
  };

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

  /** Resolve the covered-lives tier for a case's election. */
  private resolveTier(election: WorkerTrustElection): BaoCobraCoveredLivesTier {
    const electionData = election.data as {
      coveredLivesTier?: string;
    } | null;
    const coveredLives = 1 + (election.relationshipIds?.length ?? 0);
    return electionData?.coveredLivesTier &&
      (BAO_COBRA_COVERED_LIVES_TIERS as readonly string[]).includes(
        electionData.coveredLivesTier,
      )
      ? (electionData.coveredLivesTier as BaoCobraCoveredLivesTier)
      : coveredLives <= 1
        ? "1"
        : coveredLives === 2
          ? "2"
          : "3+";
  }

  /**
   * The set of months (YYYY-MM) the case's election currently covers, capped
   * at the current month: COBRA effective month through the earliest of the
   * current month, the max coverage period, and the election's end date
   * (inclusive — the month containing the end date is still covered).
   * Empty when the case has no matching election / no benefits / no election
   * made.
   */
  private coveredMonths(
    theCase: BaoCobraCase,
    election: WorkerTrustElection | undefined,
    currentYm: string,
  ): Set<string> {
    const covered = new Set<string>();
    if (!theCase.electionMadeYmd || !election || !election.benefitIds?.length) {
      return covered;
    }
    const startYm = this.ymOf(theCase.cobraEffectiveYmd);
    let endYm = currentYm;
    if (theCase.maxPeriodYmd && this.ymOf(theCase.maxPeriodYmd) < endYm) {
      endYm = this.ymOf(theCase.maxPeriodYmd);
    }
    if (election.endYmd && this.ymOf(election.endYmd) < endYm) {
      endYm = this.ymOf(election.endYmd);
    }
    for (let ym = startYm; ym <= endYm; ym = this.nextYm(ym)) {
      covered.add(ym);
    }
    return covered;
  }

  /**
   * Price a coverage month from the rate table: the effective rate for each
   * elected benefit at the tier as of the first of the month, summed, plus
   * the 2% admin fee. Null when any benefit is missing a rate.
   */
  private async priceMonth(
    benefitIds: string[],
    tier: BaoCobraCoveredLivesTier,
    ym: string,
  ): Promise<{
    amount: string;
    preFeeTotal: string;
    adminFee: string;
    lineRates: Record<string, string>;
  } | null> {
    const asOfYmd = `${ym}-01`;
    let total = 0;
    const lineRates: Record<string, string> = {};
    for (const benefitId of benefitIds) {
      const rate = await storage.baoCobraRates.getEffectiveRate(
        benefitId,
        tier,
        asOfYmd,
      );
      if (!rate) return null;
      lineRates[benefitId] = rate.rate;
      total += Number(rate.rate);
    }
    if (total <= 0) return null;
    const fee = applyBaoCobraAdminFee(total);
    return {
      amount: fee.total.toFixed(2),
      preFeeTotal: fee.preFeeTotal.toFixed(2),
      adminFee: fee.adminFee.toFixed(2),
      lineRates,
    };
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
      let activeCases = await storage.baoCobraCases.listElectedActiveCases();
      // Scoped run (election-saved fast path): only this worker's cases.
      const scopeWorkerId = cron.workerId;
      if (scopeWorkerId) {
        activeCases = activeCases.filter(
          (c) => c.coveredPersonWorkerId === scopeWorkerId,
        );
      }
      const today = new Date();
      const currentYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

      // Sweep set: every elected active case, PLUS every case this config has
      // ever billed (so canceled/closed/shortened cases still get their
      // orphaned months reversed).
      const casesById = new Map<string, BaoCobraCase>();
      for (const c of activeCases) casesById.set(c.id, c);
      const billedCaseIds = await storage.ledger.entries.listReferenceIdsByConfigAndType(
        config.id,
        "cobra_case",
      );
      for (const caseId of billedCaseIds) {
        if (casesById.has(caseId)) continue;
        const raw = await storage.baoCobraCases.getRaw(caseId);
        if (!raw) continue;
        if (scopeWorkerId && raw.coveredPersonWorkerId !== scopeWorkerId) {
          continue;
        }
        casesById.set(caseId, raw);
      }

      const transactions: LedgerTransaction[] = [];
      const notifications: LedgerNotification[] = [];
      let skippedMissingRate = 0;
      let charged = 0;
      let reversed = 0;

      for (const theCase of casesById.values()) {
        const isActiveElected = activeCases.some((c) => c.id === theCase.id);
        const elections = await storage.workerTrustElections.listByWorker(
          theCase.coveredPersonWorkerId,
        );
        const election = this.findCobraElection(elections, theCase.id);

        // Existing entries for this case + config, grouped by billing month.
        // The month's running balance is the NET of base + adjustments.
        const existing = await storage.ledger.entries.getByReferenceAndConfig(
          theCase.id,
          config.id,
        );
        const netByMonth = new Map<string, number>();
        for (const e of existing) {
          const bm = (e.data as { billingMonth?: string } | null)?.billingMonth;
          if (!bm) continue;
          netByMonth.set(bm, (netByMonth.get(bm) ?? 0) + parseFloat(e.amount));
        }

        if (isActiveElected && (!election || !election.benefitIds?.length)) {
          // An active elected case SHOULD have a matching election — treat a
          // missing one as data inconsistency: warn and leave its charges
          // alone rather than reversing a live case.
          logger.warn("Elected COBRA case has no matching COBRA election", {
            service: "charge-plugin-bao-cobra",
            caseId: theCase.id,
            workerId: theCase.coveredPersonWorkerId,
          });
          continue;
        }

        const covered = this.coveredMonths(theCase, election, currentYm);
        if (covered.size === 0 && netByMonth.size === 0) continue;

        const tier = election ? this.resolveTier(election) : null;
        const ea = await storage.ledger.ea.getOrCreate(
          "worker",
          theCase.coveredPersonWorkerId,
          config.account,
        );

        // Every month that is covered or has posted entries needs a look.
        const monthsToCheck = new Set<string>([
          ...covered,
          ...netByMonth.keys(),
        ]);

        for (const ym of Array.from(monthsToCheck).sort()) {
          const netTotal = Number((netByMonth.get(ym) ?? 0).toFixed(2));
          const isCovered = covered.has(ym);
          const hasEntries = netByMonth.has(ym);
          const statementYmd = `${ym}-01`;
          const [y, m] = ym.split("-").map(Number);
          const transactionDate = new Date(y, m - 1, 1);

          if (isCovered) {
            if (!election || !tier) continue; // unreachable when covered
            const price = await this.priceMonth(
              election.benefitIds!,
              tier,
              ym,
            );
            if (!price) {
              if (!hasEntries) {
                skippedMissingRate++;
                logger.warn("Skipping COBRA billing month - missing rate", {
                  service: "charge-plugin-bao-cobra",
                  caseId: theCase.id,
                  month: ym,
                  tier,
                });
              }
              continue;
            }

            const baseMetadata = {
              pluginId: this.metadata.id,
              pluginConfigId: config.id,
              cobraCaseId: theCase.id,
              workerId: theCase.coveredPersonWorkerId,
              electionId: election.id,
              billingMonth: ym,
              coveredLivesTier: tier,
              benefitRates: price.lineRates,
              preFeeTotal: price.preFeeTotal,
              adminFee: price.adminFee,
              adminFeeRate: BAO_COBRA_ADMIN_FEE_RATE,
            };

            if (!hasEntries) {
              // Never billed — create the base premium entry.
              transactions.push({
                chargePlugin: this.metadata.id,
                chargePluginKey: `${config.id}:${ea.id}:${theCase.id}:${ym}`,
                chargePluginConfigId: config.id,
                accountId: config.account,
                entityType: "worker",
                entityId: theCase.coveredPersonWorkerId,
                amount: price.amount,
                description: `COBRA Premium: ${this.monthLabel(ym)} ($${price.amount})`,
                transactionDate,
                statementYmd,
                referenceType: "cobra_case",
                referenceId: theCase.id,
                metadata: baseMetadata,
              });
              charged++;
            } else if (Math.abs(netTotal) < 0.005) {
              // Previously billed and fully reversed, but the month is
              // covered again (end date moved back out): reinstate.
              const netStr = netTotal.toFixed(2);
              transactions.push({
                chargePlugin: this.metadata.id,
                chargePluginKey: `${config.id}:${ea.id}:${theCase.id}:${ym}:adj:${Date.now()}`,
                chargePluginConfigId: config.id,
                accountId: config.account,
                entityType: "worker",
                entityId: theCase.coveredPersonWorkerId,
                amount: price.amount,
                description: `COBRA Premium Reinstated: ${this.monthLabel(ym)} ($${netStr} → $${price.amount})`,
                transactionDate,
                statementYmd,
                referenceType: "cobra_case_adjustment",
                referenceId: theCase.id,
                metadata: {
                  ...baseMetadata,
                  adjustmentType: "reinstatement",
                  originalAmount: netStr,
                  newAmount: price.amount,
                },
              });
              charged++;
            }
            // Covered month with a nonzero net total: already billed. Rate
            // drift on already-billed months is surfaced by verifyEntry, not
            // silently rebilled.
          } else if (hasEntries && Math.abs(netTotal) >= 0.005) {
            // Month no longer covered (canceled election / shortened end
            // date / effective date moved later): zero out the month's net.
            const netStr = netTotal.toFixed(2);
            const offset = (-netTotal).toFixed(2);
            transactions.push({
              chargePlugin: this.metadata.id,
              chargePluginKey: `${config.id}:${ea.id}:${theCase.id}:${ym}:adj:${Date.now()}`,
              chargePluginConfigId: config.id,
              accountId: config.account,
              entityType: "worker",
              entityId: theCase.coveredPersonWorkerId,
              amount: offset,
              description: `COBRA Premium Reversal: ${this.monthLabel(ym)} ($${netStr} → $0.00)`,
              transactionDate,
              statementYmd,
              referenceType: "cobra_case_adjustment",
              referenceId: theCase.id,
              metadata: {
                pluginId: this.metadata.id,
                pluginConfigId: config.id,
                cobraCaseId: theCase.id,
                workerId: theCase.coveredPersonWorkerId,
                billingMonth: ym,
                adjustmentType: "coverage_reversal",
                originalAmount: netStr,
                newAmount: "0.00",
              },
            });
            reversed++;
          }
        }
      }

      const summary = `${charged} premium entr${charged === 1 ? "y" : "ies"} and ${reversed} offsetting adjustment(s) across ${casesById.size} case(s)${skippedMissingRate ? ` (${skippedMissingRate} month(s) skipped for missing rates)` : ""}`;

      if (cron.mode === "test") {
        return {
          success: true,
          transactions: [],
          message: `[TEST] Would create ${summary}`,
        };
      }

      for (const t of transactions) {
        notifications.push({
          type: "created" as const,
          amount: t.amount,
          description: t.description,
        });
      }

      return {
        success: true,
        transactions,
        notifications,
        message: `Created ${summary}`,
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
      // Adjustment entries are self-describing: verify the delta matches the
      // recorded original/new amounts rather than re-pricing.
      if (entry.referenceType === "cobra_case_adjustment") {
        const data = entry.data as {
          originalAmount?: string;
          newAmount?: string;
        } | null;
        if (data?.originalAmount == null || data?.newAmount == null) {
          return {
            ...baseResult,
            isValid: false,
            discrepancies: [
              "Adjustment entry missing required metadata (originalAmount, newAmount)",
            ],
          };
        }
        const expectedAdjustment = (
          parseFloat(data.newAmount) - parseFloat(data.originalAmount)
        ).toFixed(2);
        const discrepancies: string[] = [];
        if (entry.amount !== expectedAdjustment) {
          discrepancies.push(
            `Adjustment amount mismatch: expected ${expectedAdjustment}, found ${entry.amount}`,
          );
        }
        return {
          ...baseResult,
          isValid: discrepancies.length === 0,
          expectedAmount: expectedAdjustment,
          discrepancies,
        };
      }

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
      // Statement date must be the coverage month.
      if (entry.statementYmd && entry.statementYmd.slice(0, 7) !== data.billingMonth) {
        discrepancies.push(
          `Statement date mismatch: expected month ${data.billingMonth}, found ${entry.statementYmd}`,
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
