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
import type { BaoDpTierTransition } from "@shared/schema/sitespecific/bao/schema";
import type { Ledger, ChargePluginConfig } from "@shared/schema";
import type { WorkerTrustElection } from "@shared/schema/trust/elections-schema";
import type { WorkerRelationWithTypeName } from "../../../../storage/workers/relations";

/**
 * Domestic Partner (DP) monthly premium charge plugin.
 *
 * Runs on the CRON trigger. For every active election that covers a
 * domestic-partner dependent, it bills the SUBSCRIBER's DP ledger account
 * (this config's account — the "Health Fund - DP" account in production,
 * resolved via plugin config, never hardcoded) one entry per (DP dependent,
 * coverage month).
 *
 * Coverage window per (election, DP relationship): from the later of the
 * election start month and the DP relationship start month, through the
 * EARLIEST of: one month after the current month (never bill more than one
 * coverage month in advance), the election end month, and the relationship
 * end month. A month inside that window is billable ONLY when the subscriber
 * actually has at least one of the election's benefits recorded for that
 * month (trust WMB presence) — months without subscriber coverage are
 * skipped and surfaced, never guessed.
 *
 * Pricing comes from the DP rate sheet (sitespecific_bao_dp_rates) at
 * billing time: for each elected benefit the subscriber has that month, the
 * effective (non-provisional) rate for the applicable coverage-tier
 * transition as of the first of the month, summed. Months with a missing or
 * provisional rate are skipped (billed on a later run once real rates
 * exist) and surfaced in the run summary rather than billed at a guessed
 * price.
 *
 * Tier transition: derived from the election's covered lives EXCLUDING all
 * DP dependents — 1 non-DP life (subscriber only) → single_to_2party,
 * 2 → 2party_to_family, 3+ → family_to_family_dp. The single_to_family
 * transition is never auto-selected (no confirmed business rule maps an
 * election shape to it). NOTE (unconfirmed business rule): when a worker
 * has multiple DPs, each DP is billed independently using the SAME base
 * transition; whether the second DP should instead price at the next tier
 * up has not been confirmed.
 *
 * Statement date: every entry's `statementYmd` is the first day of the
 * coverage month it pays for, so statements group DP premiums under the
 * correct month.
 *
 * Offsetting adjustments: the same run sweeps every election this config
 * has ever billed (even when the election has since ended, been canceled,
 * or the DP was removed). Any billed (DP, month) that is no longer covered
 * — election ended, DP relationship ended or removed, or the subscriber no
 * longer has a benefit for the month — gets one offsetting
 * `dp_election_adjustment` entry that zeroes the month's NET total (base +
 * prior adjustments), so repeated runs never over-reverse. If a month
 * becomes covered again, a reinstating adjustment restores the premium.
 *
 * Idempotency: each billed (DP, month) posts exactly one base entry, keyed
 * `<configId>:<eaId>:<electionId>:<dpRelationshipId>:<YYYY-MM>` with the
 * month and DP recorded in the entry metadata (`billingMonth`,
 * `dpRelationshipId`). Reconciliation always works against the (DP,
 * month)'s net posted total, so re-running the cron never double-charges
 * and never double-reverses.
 *
 * Unconfirmed business rules deliberately NOT implemented here: payment due
 * dates, grace periods, overpayment/refund treatment, and proration for
 * partial months (a covered month is always billed at the full monthly
 * rate).
 */

/** Relation-type name pattern that identifies a domestic-partner relation. */
export const DP_RELATION_TYPE_NAME_PATTERN = "%domestic partner%";

function isDpRelationTypeName(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase().includes("domestic partner");
}

class BaoDpChargePlugin extends ChargePlugin {
  readonly metadata: ChargePluginMetadata = {
    id: "sitespecific-bao-dp",
    name: "BAO - Domestic Partner Monthly Premium",
    description:
      "Bills the monthly Domestic Partner premium for every active election that covers a DP dependent, to the subscriber's DP ledger account. One entry per DP dependent per coverage month (statement-dated to that month), priced from the DP rate sheet by coverage-tier transition, at most one month in advance, and only for months the subscriber has a benefit. Months with missing/provisional rates or no subscriber coverage are skipped and surfaced. (DP, month)s no longer covered receive offsetting adjustments that zero the month out.",
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
   * Coverage-tier transition for one DP on an election, derived from the
   * covered lives EXCLUDING all DP dependents. single_to_family is never
   * auto-selected (no confirmed rule maps to it).
   */
  private resolveTierTransition(
    relationsById: Map<string, WorkerRelationWithTypeName>,
    election: WorkerTrustElection,
  ): BaoDpTierTransition {
    let nonDpDependents = 0;
    for (const relId of election.relationshipIds ?? []) {
      const rel = relationsById.get(relId);
      if (!rel) continue; // missing relation row: not countable
      if (!isDpRelationTypeName(rel.relationTypeName)) nonDpDependents++;
    }
    const nonDpLives = 1 + nonDpDependents; // subscriber + non-DP dependents
    return nonDpLives <= 1
      ? "single_to_2party"
      : nonDpLives === 2
        ? "2party_to_family"
        : "family_to_family_dp";
  }

  /**
   * The months (YYYY-MM) a (election, DP relationship) is covered for,
   * capped at one month past the current month. Excludes the subscriber
   * benefit-presence gate (applied per month by the caller). Empty when the
   * DP is no longer on the election or the relation row is gone.
   */
  private coverageWindow(
    election: WorkerTrustElection | undefined,
    rel: WorkerRelationWithTypeName | undefined,
    currentYm: string,
  ): Set<string> {
    const window = new Set<string>();
    if (!election || !rel) return window;
    if (!(election.relationshipIds ?? []).includes(rel.id)) return window;
    if (!election.benefitIds?.length) return window;

    let startYm = this.ymOf(election.startYmd);
    if (rel.startYmd && this.ymOf(rel.startYmd) > startYm) {
      startYm = this.ymOf(rel.startYmd);
    }
    // Never bill more than one coverage month in advance.
    let endYm = this.nextYm(currentYm);
    if (election.endYmd && this.ymOf(election.endYmd) < endYm) {
      endYm = this.ymOf(election.endYmd);
    }
    if (rel.endYmd && this.ymOf(rel.endYmd) < endYm) {
      endYm = this.ymOf(rel.endYmd);
    }
    for (let ym = startYm; ym <= endYm; ym = this.nextYm(ym)) {
      window.add(ym);
    }
    return window;
  }

  /**
   * Price a coverage month from the DP rate sheet: the effective,
   * NON-PROVISIONAL rate for each present benefit at the tier transition as
   * of the first of the month, summed. Null when any present benefit is
   * missing a usable rate (missing row, provisional placeholder, or
   * zero/negative total).
   */
  private async priceMonth(
    presentBenefitIds: string[],
    transition: BaoDpTierTransition,
    ym: string,
  ): Promise<{ amount: string; lineRates: Record<string, string> } | null> {
    const asOfYmd = `${ym}-01`;
    let total = 0;
    const lineRates: Record<string, string> = {};
    for (const benefitId of presentBenefitIds) {
      const rate = await storage.baoDpRates.getEffectiveRate(
        benefitId,
        transition,
        asOfYmd,
      );
      if (!rate || rate.provisional) return null;
      lineRates[benefitId] = rate.rate;
      total += Number(rate.rate);
    }
    if (total <= 0) return null;
    return { amount: total.toFixed(2), lineRates };
  }

  async execute(
    context: PluginContext,
    config: ChargePluginConfig,
  ): Promise<PluginExecutionResult> {
    if (context.trigger !== TriggerType.CRON) {
      return {
        success: false,
        transactions: [],
        error: `BAO DP charge plugin only handles CRON trigger, got ${context.trigger}`,
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
      const today = new Date();
      const currentYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

      // ---- Discover billing targets: (election, DP relationship) pairs ----
      // 1) Every current DP relation whose election covers it.
      const dpRels = await storage.workerRelations.searchWorkerRelations({
        relationTypeNameILike: DP_RELATION_TYPE_NAME_PATTERN,
      });
      const relCache = new Map<string, WorkerRelationWithTypeName>();
      for (const r of dpRels) {
        relCache.set(r.id, {
          ...r,
          relationTypeName: r.relationTypeName ?? null,
        });
      }

      interface Target {
        electionId: string;
        dpRelId: string;
        election: WorkerTrustElection | undefined;
        /** Subscriber worker id (from the election, or entry metadata for orphans). */
        workerId: string | null;
      }
      const targets = new Map<string, Target>();
      const electionsById = new Map<string, WorkerTrustElection>();
      const electionsByWorker = new Map<string, WorkerTrustElection[]>();

      const listElectionsOf = async (workerId: string) => {
        if (!electionsByWorker.has(workerId)) {
          const rows = await storage.workerTrustElections.listByWorker(workerId);
          electionsByWorker.set(workerId, rows);
          for (const e of rows) electionsById.set(e.id, e);
        }
        return electionsByWorker.get(workerId)!;
      };

      for (const rel of dpRels) {
        // The subscriber is whichever side owns an election that lists this
        // relationship as a covered dependent.
        for (const side of [rel.worker1, rel.worker2]) {
          const elections = await listElectionsOf(side);
          for (const e of elections) {
            if (!(e.relationshipIds ?? []).includes(rel.id)) continue;
            targets.set(`${e.id}:${rel.id}`, {
              electionId: e.id,
              dpRelId: rel.id,
              election: e,
              workerId: e.workerId,
            });
          }
        }
      }

      // 2) Every election this config has ever billed (sweep set), so ended
      //    / canceled elections and removed DPs still get reversed.
      const entriesByElection = new Map<string, Ledger[]>();
      const loadEntries = async (electionId: string) => {
        if (!entriesByElection.has(electionId)) {
          entriesByElection.set(
            electionId,
            await storage.ledger.entries.getByReferenceAndConfig(
              electionId,
              config.id,
            ),
          );
        }
        return entriesByElection.get(electionId)!;
      };

      const billedElectionIds =
        await storage.ledger.entries.listReferenceIdsByConfigAndType(
          config.id,
          "dp_election",
        );
      for (const electionId of billedElectionIds) {
        const entries = await loadEntries(electionId);
        let election = electionsById.get(electionId);
        if (!election) {
          election = await storage.workerTrustElections.getById(electionId);
          if (election) electionsById.set(election.id, election);
        }
        for (const entry of entries) {
          const meta = entry.data as {
            dpRelationshipId?: string;
            workerId?: string;
          } | null;
          if (!meta?.dpRelationshipId) continue;
          const key = `${electionId}:${meta.dpRelationshipId}`;
          if (targets.has(key)) continue;
          targets.set(key, {
            electionId,
            dpRelId: meta.dpRelationshipId,
            election,
            workerId: election?.workerId ?? meta.workerId ?? null,
          });
        }
      }

      // Resolve relation rows referenced by targets or elections' dependents
      // (for tier derivation) that we have not loaded yet.
      const relIdsNeeded = new Set<string>();
      for (const t of targets.values()) {
        if (!relCache.has(t.dpRelId)) relIdsNeeded.add(t.dpRelId);
        for (const relId of t.election?.relationshipIds ?? []) {
          if (!relCache.has(relId)) relIdsNeeded.add(relId);
        }
      }
      if (relIdsNeeded.size > 0) {
        const rows = await storage.workerRelations.listByIdsWithType(
          Array.from(relIdsNeeded),
        );
        for (const r of rows) relCache.set(r.id, r);
      }

      // Subscriber benefit presence, cached per worker:
      // set of "benefitId|YYYY-MM".
      const presenceByWorker = new Map<string, Set<string>>();
      const loadPresence = async (workerId: string) => {
        if (!presenceByWorker.has(workerId)) {
          const rows = await storage.trust.wmb.getWorkerBenefitPresence(workerId);
          const set = new Set<string>();
          for (const row of rows) {
            const ym = `${row.year}-${String(row.month).padStart(2, "0")}`;
            set.add(`${row.benefitId}|${ym}`);
          }
          presenceByWorker.set(workerId, set);
        }
        return presenceByWorker.get(workerId)!;
      };

      const transactions: LedgerTransaction[] = [];
      const notifications: LedgerNotification[] = [];
      let charged = 0;
      let reversed = 0;
      let skippedMissingRate = 0;
      let skippedNoCoverage = 0;

      for (const target of targets.values()) {
        const { election, dpRelId } = target;
        const rel = relCache.get(dpRelId);
        const workerId = target.workerId;
        if (!workerId) {
          logger.warn("DP billing target has no resolvable subscriber", {
            service: "charge-plugin-bao-dp",
            electionId: target.electionId,
            dpRelationshipId: dpRelId,
          });
          continue;
        }

        const entries = await loadEntries(target.electionId);
        // Net posted total per billing month FOR THIS DP.
        const netByMonth = new Map<string, number>();
        for (const e of entries) {
          const meta = e.data as {
            billingMonth?: string;
            dpRelationshipId?: string;
          } | null;
          if (!meta?.billingMonth || meta.dpRelationshipId !== dpRelId) continue;
          netByMonth.set(
            meta.billingMonth,
            (netByMonth.get(meta.billingMonth) ?? 0) + parseFloat(e.amount),
          );
        }

        const window = this.coverageWindow(election, rel, currentYm);
        if (window.size === 0 && netByMonth.size === 0) continue;

        const presence =
          window.size > 0 ? await loadPresence(workerId) : new Set<string>();
        const transition = election
          ? this.resolveTierTransition(relCache, election)
          : null;
        const dpWorkerId = rel
          ? rel.worker1 === workerId
            ? rel.worker2
            : rel.worker1
          : null;

        const ea = await storage.ledger.ea.getOrCreate(
          "worker",
          workerId,
          config.account,
        );

        const monthsToCheck = new Set<string>([
          ...window,
          ...netByMonth.keys(),
        ]);

        for (const ym of Array.from(monthsToCheck).sort()) {
          const netTotal = Number((netByMonth.get(ym) ?? 0).toFixed(2));
          const hasEntries = netByMonth.has(ym);
          const statementYmd = `${ym}-01`;
          const [y, m] = ym.split("-").map(Number);
          const transactionDate = new Date(y, m - 1, 1);

          // Benefits the subscriber actually has for this month, out of the
          // election's benefit set.
          const presentBenefitIds =
            election && window.has(ym)
              ? (election.benefitIds ?? []).filter((b) =>
                  presence.has(`${b}|${ym}`),
                )
              : [];
          const isCovered = window.has(ym) && presentBenefitIds.length > 0;

          if (isCovered) {
            if (!election || !transition) continue; // unreachable when covered
            const price = await this.priceMonth(
              presentBenefitIds,
              transition,
              ym,
            );
            if (!price) {
              if (!hasEntries) {
                skippedMissingRate++;
                logger.warn(
                  "Skipping DP billing month - missing/provisional rate",
                  {
                    service: "charge-plugin-bao-dp",
                    electionId: election.id,
                    dpRelationshipId: dpRelId,
                    month: ym,
                    transition,
                  },
                );
              }
              continue;
            }

            const baseMetadata = {
              pluginId: this.metadata.id,
              pluginConfigId: config.id,
              electionId: election.id,
              workerId,
              dpRelationshipId: dpRelId,
              dpWorkerId,
              billingMonth: ym,
              dpTierTransition: transition,
              benefitRates: price.lineRates,
            };

            if (!hasEntries) {
              transactions.push({
                chargePlugin: this.metadata.id,
                chargePluginKey: `${config.id}:${ea.id}:${election.id}:${dpRelId}:${ym}`,
                chargePluginConfigId: config.id,
                accountId: config.account,
                entityType: "worker",
                entityId: workerId,
                amount: price.amount,
                description: `DP Premium: ${this.monthLabel(ym)} ($${price.amount})`,
                transactionDate,
                statementYmd,
                referenceType: "dp_election",
                referenceId: election.id,
                metadata: baseMetadata,
              });
              charged++;
            } else if (Math.abs(netTotal) < 0.005) {
              // Previously billed and fully reversed, but covered again:
              // reinstate at the current price.
              const netStr = netTotal.toFixed(2);
              transactions.push({
                chargePlugin: this.metadata.id,
                chargePluginKey: `${config.id}:${ea.id}:${election.id}:${dpRelId}:${ym}:adj:${Date.now()}`,
                chargePluginConfigId: config.id,
                accountId: config.account,
                entityType: "worker",
                entityId: workerId,
                amount: price.amount,
                description: `DP Premium Reinstated: ${this.monthLabel(ym)} ($${netStr} → $${price.amount})`,
                transactionDate,
                statementYmd,
                referenceType: "dp_election_adjustment",
                referenceId: election.id,
                metadata: {
                  ...baseMetadata,
                  adjustmentType: "reinstatement",
                  originalAmount: netStr,
                  newAmount: price.amount,
                },
              });
              charged++;
            }
            // Covered month with a nonzero net: already billed. Rate drift
            // on already-billed months is surfaced by verifyEntry, not
            // silently rebilled.
          } else if (hasEntries && Math.abs(netTotal) >= 0.005) {
            // (DP, month) no longer covered — election ended/canceled, DP
            // removed, relationship ended, or subscriber lost the benefit:
            // zero out the month's net.
            const netStr = netTotal.toFixed(2);
            const offset = (-netTotal).toFixed(2);
            transactions.push({
              chargePlugin: this.metadata.id,
              chargePluginKey: `${config.id}:${ea.id}:${target.electionId}:${dpRelId}:${ym}:adj:${Date.now()}`,
              chargePluginConfigId: config.id,
              accountId: config.account,
              entityType: "worker",
              entityId: workerId,
              amount: offset,
              description: `DP Premium Reversal: ${this.monthLabel(ym)} ($${netStr} → $0.00)`,
              transactionDate,
              statementYmd,
              referenceType: "dp_election_adjustment",
              referenceId: target.electionId,
              metadata: {
                pluginId: this.metadata.id,
                pluginConfigId: config.id,
                electionId: target.electionId,
                workerId,
                dpRelationshipId: dpRelId,
                dpWorkerId,
                billingMonth: ym,
                adjustmentType: "coverage_reversal",
                originalAmount: netStr,
                newAmount: "0.00",
              },
            });
            reversed++;
          } else if (window.has(ym) && !isCovered && !hasEntries) {
            // In the coverage window but the subscriber has no benefit for
            // the month yet — surfaced, never billed.
            skippedNoCoverage++;
          }
        }
      }

      const skippedBits = [
        skippedMissingRate
          ? `${skippedMissingRate} month(s) skipped for missing/provisional rates`
          : null,
        skippedNoCoverage
          ? `${skippedNoCoverage} month(s) skipped for missing subscriber coverage`
          : null,
      ].filter(Boolean);
      const summary = `${charged} premium entr${charged === 1 ? "y" : "ies"} and ${reversed} offsetting adjustment(s) across ${targets.size} DP enrollment(s)${skippedBits.length ? ` (${skippedBits.join(", ")})` : ""}`;

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
      if (
        error instanceof Error &&
        error.message === "COMPONENT_TABLE_NOT_FOUND"
      ) {
        return {
          success: true,
          transactions: [],
          message: "DP rate tables are not provisioned; nothing to bill",
        };
      }
      logger.error("BAO DP charge plugin execution failed", {
        service: "charge-plugin-bao-dp",
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
    _config: ChargePluginConfig,
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
      // Adjustment entries are self-describing: verify the delta matches
      // the recorded original/new amounts rather than re-pricing.
      if (entry.referenceType === "dp_election_adjustment") {
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
        dpTierTransition?: BaoDpTierTransition;
        benefitRates?: Record<string, string>;
      } | null;

      if (!data?.billingMonth || !data?.dpTierTransition) {
        return {
          ...baseResult,
          isValid: false,
          discrepancies: [
            "Entry missing required metadata (billingMonth, dpTierTransition)",
          ],
        };
      }

      // Re-price the billed month from the DP rate sheet.
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
        const rate = await storage.baoDpRates.getEffectiveRate(
          benefitId,
          data.dpTierTransition,
          asOfYmd,
        );
        if (!rate) {
          discrepancies.push(
            `No rate currently configured for benefit ${benefitId} transition ${data.dpTierTransition} as of ${asOfYmd}`,
          );
          continue;
        }
        if (rate.provisional) {
          discrepancies.push(
            `Rate for benefit ${benefitId} transition ${data.dpTierTransition} is provisional (placeholder)`,
          );
        }
        expected += Number(rate.rate);
      }
      const expectedAmount = expected.toFixed(2);
      if (discrepancies.length === 0 && entry.amount !== expectedAmount) {
        discrepancies.push(
          `Amount mismatch: expected ${expectedAmount}, found ${entry.amount}`,
        );
      }
      // Statement date must be the coverage month.
      if (
        entry.statementYmd &&
        entry.statementYmd.slice(0, 7) !== data.billingMonth
      ) {
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

registerChargePlugin(new BaoDpChargePlugin());
