import { ChargePlugin } from "../base";
import {
  TriggerType,
  type ChargePluginMetadata,
  type CronContext,
  type LedgerEntryVerification,
  type PluginContext,
  type PluginExecutionResult,
  type WmbSavedContext,
} from "../types";
import { registerChargePlugin } from "../registry";
import { storage } from "../../../../storage/database";
import type { ChargePluginConfig, Ledger } from "@shared/schema";
import {
  createPolicyResolutionCache,
  resolveGrantingWorkerPolicyAsOf,
} from "../../../../services/policy-resolution";
import type { WmbEeContributionCoverage } from "../../../../storage/trust/wmb";
import { logger } from "../../../../logger";

const PLUGIN_ID = "sitespecific-bao-ee-contribution";
const SERVICE = "charge-plugin-bao-ee-contribution";
const REFERENCE_TYPE = "bao_ee_contribution";
const ADJUSTMENT_REFERENCE_TYPE = "bao_ee_contribution_adjustment";

type ContributionRate = {
  id: string;
  policyId: string;
  benefitId: string;
  rate: string;
  effectiveYmd: string;
};

type ContributionMetadata = {
  subscriberWorkerId?: string;
  policyId?: string;
  benefitId?: string;
  billingMonth?: string;
  coverageWmbIds?: string[];
  coverageEmployerIds?: string[];
  rate?: string;
  rateId?: string;
  rateEffectiveYmd?: string;
  policySource?: string;
  originalAmount?: string;
  newAmount?: string;
};

type Subject = {
  subscriberWorkerId: string;
  benefitId: string;
  month: number;
  year: number;
};

function monthYmd(subject: Subject): string {
  return `${subject.year}-${String(subject.month).padStart(2, "0")}-01`;
}

function subjectKey(subject: Subject): string {
  return `${subject.subscriberWorkerId}:${subject.benefitId}:${subject.year}:${subject.month}`;
}

function attributionKey(subject: Subject, policyId: string): string {
  return `${subjectKey(subject)}:${policyId}`;
}

function parseMetadata(entry: Ledger): ContributionMetadata | null {
  const data = entry.data as ContributionMetadata | null;
  if (
    !data?.subscriberWorkerId ||
    !data.policyId ||
    !data.benefitId ||
    !data.billingMonth
  ) {
    return null;
  }
  return data;
}

function groupEntriesByEa(entries: Ledger[]): Map<string, Ledger[]> {
  const groups = new Map<string, Ledger[]>();
  for (const entry of entries) {
    const group = groups.get(entry.eaId) ?? [];
    group.push(entry);
    groups.set(entry.eaId, group);
  }
  return groups;
}

/**
 * BAO employee contribution charges.
 *
 * Coverage is grouped once per granting subscriber, historically resolved
 * policy, benefit, and month.  Thus dependent-only coverage and any number of
 * dependent WMB rows create one flat subscriber charge.  Reconciliation is
 * deliberately append-only: it compares the desired amount against the NET of
 * this plugin's base and adjustment entries only, never payments, so payment
 * allocations remain untouched.
 */
class BaoEeContributionChargePlugin extends ChargePlugin {
  readonly metadata: ChargePluginMetadata = {
    id: PLUGIN_ID,
    name: "BAO EE Contribution Charges",
    description:
      "Bills one flat monthly employee contribution to the granting subscriber for each policy/benefit/coverage month. Dependent-only coverage is included once; effective-dated policy rates are selected on the first day of the coverage month and corrections reconcile with append-only adjustments.",
    triggers: [TriggerType.WMB_SAVED, TriggerType.CRON],
    defaultScope: "global",
    configSchema: { type: "object", properties: {} },
    requiredComponent: "sitespecific.bao",
  };

  private async subjectsForWmbEvent(
    context: WmbSavedContext,
    historicEntries: Ledger[],
  ): Promise<Subject[]> {
    const found = new Map<string, Subject>();
    const add = (subject: Subject) => found.set(subjectKey(subject), subject);

    let subscriberWorkerId: string | null = context.workerId;
    if (context.sourceRelationId) {
      const relation = await storage.workerRelations.get(context.sourceRelationId);
      subscriberWorkerId = relation?.worker1 ?? null;
    }
    if (subscriberWorkerId) {
      add({
        subscriberWorkerId,
        benefitId: context.benefitId,
        month: context.month,
        year: context.year,
      });
    }

    // On deletion a relationship can already be gone. Include every
    // historical attribution for this benefit/month (or just this subscriber
    // when the relation still resolves), not merely entries that happen to
    // retain the source WMB id. This covers relation-first deletion and stale
    // source ids without turning a one-row WMB event into a full-history
    // reconciliation sweep.
    for (const entry of historicEntries) {
      const data = parseMetadata(entry);
      if (
        !data ||
        data.benefitId !== context.benefitId ||
        data.billingMonth !==
          `${context.year}-${String(context.month).padStart(2, "0")}` ||
        (subscriberWorkerId &&
          data.subscriberWorkerId !== subscriberWorkerId &&
          !data.coverageWmbIds?.includes(context.wmbId))
      ) {
        continue;
      }
      const [year, month] = data.billingMonth!.split("-").map(Number);
      if (Number.isInteger(year) && Number.isInteger(month)) {
        add({
          subscriberWorkerId: data.subscriberWorkerId!,
          benefitId: data.benefitId!,
          year,
          month,
        });
      }
    }
    return Array.from(found.values());
  }

  private async resolveDesired(
    coverage: WmbEeContributionCoverage | null,
    policyCache: ReturnType<typeof createPolicyResolutionCache>,
  ): Promise<
    | { kind: "absent" }
    | { kind: "diagnostic"; message: string }
    | {
        kind: "priced";
        subject: Subject;
        policyId: string;
        policySource: string;
        rate: ContributionRate;
        amount: string;
        coverage: WmbEeContributionCoverage;
      }
  > {
    if (!coverage) return { kind: "absent" };
    const subject: Subject = coverage;
    const asOfYmd = monthYmd(subject);
    // Resolve from the subscriber's historical granting election/home
    // assignment, not the materialized WMB's employer.  Election corrections
    // therefore immediately replace the policy attribution on reconciliation.
    const policyResult = await resolveGrantingWorkerPolicyAsOf(
      storage,
      subject.subscriberWorkerId,
      asOfYmd,
      policyCache,
    );
    if (!policyResult.policy) {
      return {
        kind: "diagnostic",
        message:
          policyResult.resolutionStatus === "ambiguous"
            ? `Ambiguous granting policy for ${subjectKey(subject)} as of ${asOfYmd}: ${policyResult.policySource}`
            : `No granting policy resolves for ${subjectKey(subject)} as of ${asOfYmd}`,
      };
    }
    const policyId = policyResult.policy.id;
    const rate = await storage.baoEeContributionRates.getEffectiveRate(
      policyId,
      subject.benefitId,
      asOfYmd,
    );
    const numberRate = rate ? Number(rate.rate) : Number.NaN;
    if (!rate || !Number.isFinite(numberRate) || numberRate < 0) {
      return {
        kind: "diagnostic",
        message: `No valid BAO EE contribution rate for policy ${policyId}, benefit ${subject.benefitId}, as of ${asOfYmd}`,
      };
    }
    return {
      kind: "priced",
      subject,
      policyId,
      policySource: policyResult.policySource,
      rate,
      amount: numberRate.toFixed(2),
      coverage,
    };
  }

  private async appendAdjustment(
    entries: Ledger[],
    subject: Subject,
    policyId: string,
    desiredAmount: string,
    config: ChargePluginConfig,
    reason: "coverage_reversal" | "rate_correction" | "policy_reassignment",
    pricing?: {
      rate: ContributionRate;
      policySource: string;
      coverage: WmbEeContributionCoverage;
    },
  ): Promise<boolean> {
    const net = entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
    const desired = Number(desiredAmount);
    if (Math.abs(net - desired) < 0.005) return false;

    const metadata = parseMetadata(entries[0]);
    const ea =
      entries[0]?.eaId
        ? { id: entries[0].eaId }
        : await storage.ledger.ea.getOrCreate(
            "worker",
            subject.subscriberWorkerId,
            config.account!,
          );
    const baseKey = `${config.id}:${subject.subscriberWorkerId}:${policyId}:${subject.benefitId}:${subject.year}:${subject.month}:${ea.id}`;
    const adjustmentNumber = entries.filter(
      (entry) => entry.referenceType === ADJUSTMENT_REFERENCE_TYPE,
    ).length + 1;
    const delta = (desired - net).toFixed(2);
    await storage.ledger.entries.create({
      chargePlugin: PLUGIN_ID,
      chargePluginKey: `${baseKey}:adjustment:${adjustmentNumber}`,
      chargePluginConfigId: config.id,
      eaId: ea.id,
      amount: delta,
      statementYmd: monthYmd(subject),
      referenceType: ADJUSTMENT_REFERENCE_TYPE,
      referenceId: attributionKey(subject, policyId),
      memo: `BAO EE Contribution adjustment: ${monthYmd(subject).slice(0, 7)} ($${net.toFixed(2)} → $${desiredAmount})`,
      data: {
        pluginId: PLUGIN_ID,
        pluginConfigId: config.id,
        subscriberWorkerId: subject.subscriberWorkerId,
        policyId,
        benefitId: subject.benefitId,
        billingMonth: monthYmd(subject).slice(0, 7),
        coverageWmbIds: pricing?.coverage.wmbIds ?? metadata?.coverageWmbIds ?? [],
        coverageEmployerIds:
          pricing?.coverage.employerIds ?? metadata?.coverageEmployerIds ?? [],
        rate: pricing?.rate.rate ?? metadata?.rate,
        rateId: pricing?.rate.id ?? metadata?.rateId,
        rateEffectiveYmd:
          pricing?.rate.effectiveYmd ?? metadata?.rateEffectiveYmd,
        policySource: pricing?.policySource ?? metadata?.policySource,
        adjustmentType: reason,
        originalAmount: net.toFixed(2),
        newAmount: desiredAmount,
      },
    });
    return true;
  }

  async execute(
    context: PluginContext,
    config: ChargePluginConfig,
  ): Promise<PluginExecutionResult> {
    if (
      context.trigger !== TriggerType.WMB_SAVED &&
      context.trigger !== TriggerType.CRON
    ) {
      return {
        success: false,
        transactions: [],
        error: `BAO EE Contribution Charges handles WMB_SAVED or CRON, got ${context.trigger}`,
      };
    }
    if (!config.account) {
      return {
        success: true,
        transactions: [],
        message: "No ledger account configured for this charge plugin",
      };
    }
    const accountId = config.account;

    const isTest = context.trigger === TriggerType.CRON && (context as CronContext).mode === "test";
    try {
      // This lock also opens/binds the transaction.  Every storage read needed
      // for discovery, policy/rate resolution, and net reconciliation occurs
      // inside it.  It is intentionally config-wide: a cron sweep and an
      // immediate WMB event must see one coherent reconciliation set.
      return await storage.advisoryLock.withTransactionLock(
        `bao-ee-contribution:${config.id}`,
        async () => {
          const historicEntries =
            await storage.ledger.entries.listByChargePluginAndConfig(
              PLUGIN_ID,
              config.id,
            );
          const historicByAttribution = new Map<string, Ledger[]>();
          const historicSubjects = new Map<string, Subject>();
          for (const entry of historicEntries) {
            const data = parseMetadata(entry);
            if (!data) continue;
            const [year, month] = data.billingMonth!.split("-").map(Number);
            if (!Number.isInteger(year) || !Number.isInteger(month)) continue;
            const subject = {
              subscriberWorkerId: data.subscriberWorkerId!,
              benefitId: data.benefitId!,
              year,
              month,
            };
            historicSubjects.set(subjectKey(subject), subject);
            const key = attributionKey(subject, data.policyId!);
            const rows = historicByAttribution.get(key) ?? [];
            rows.push(entry);
            historicByAttribution.set(key, rows);
          }

          const liveSubjects =
            context.trigger === TriggerType.CRON
              ? await storage.trust.wmb.listEeContributionCoverage()
              : await this.subjectsForWmbEvent(context as WmbSavedContext, historicEntries);
          // A cron is the recovery mechanism for all historical entries. An
          // immediate WMB event intentionally touches only that event's
          // subscriber/benefit/month identities; otherwise one WMB save
          // would perform a global N+1 coverage sweep while holding the lock.
          const subjects =
            context.trigger === TriggerType.CRON
              ? new Map<string, Subject>(historicSubjects)
              : new Map<string, Subject>();
          for (const subject of liveSubjects) subjects.set(subjectKey(subject), subject);

          let created = 0;
          let adjusted = 0;
          let diagnostics = 0;
          const desiredAttributions = new Set<string>();
          const protectedSubjects = new Set<string>();
          const policyCache = createPolicyResolutionCache();

          for (const subject of subjects.values()) {
            const coverage = await storage.trust.wmb.getEeContributionCoverage(
              subject.subscriberWorkerId,
              subject.benefitId,
              subject.month,
              subject.year,
            );
            const desired = await this.resolveDesired(coverage, policyCache);
            if (desired.kind === "diagnostic") {
              // A missing/ambiguous resolver result is NOT $0.  In particular,
              // leave a previous posted charge intact until staff configure a
              // real policy/rate and a later reconcile can make a sound change.
              protectedSubjects.add(subjectKey(subject));
              diagnostics++;
              logger.warn("BAO EE contribution reconciliation skipped", {
                service: SERVICE,
                configId: config.id,
                reason: desired.message,
              });
              continue;
            }
            if (desired.kind === "absent") continue;
            const key = attributionKey(subject, desired.policyId);
            desiredAttributions.add(key);
            const existingByEa = groupEntriesByEa(
              historicByAttribution.get(key) ?? [],
            );
            // Explicit $0 never needs a new entity-account row. Positive
            // coverage is always billed to the config's current account.
            const desiredEa =
              Number(desired.amount) > 0
                ? await storage.ledger.ea.getOrCreate(
                    "worker",
                    subject.subscriberWorkerId,
                    accountId,
                  )
                : null;
            const existing = desiredEa
              ? existingByEa.get(desiredEa.id) ?? []
              : [];

            // A policy reassignment must clear the old attribution before the
            // replacement can be retained.  Both writes share this config's
            // transaction advisory lock, so a concurrent WMB event cannot
            // briefly leave two positive attributions behind.
            for (const [oldKey, oldEntries] of historicByAttribution) {
              if (oldKey === key) continue;
              const oldData = parseMetadata(oldEntries[0]);
              if (!oldData) continue;
              const [oldYear, oldMonth] = oldData.billingMonth!.split("-").map(Number);
              const oldSubject = {
                subscriberWorkerId: oldData.subscriberWorkerId!,
                benefitId: oldData.benefitId!,
                year: oldYear,
                month: oldMonth,
              };
              if (subjectKey(oldSubject) !== subjectKey(subject)) continue;
              // Mark it handled for this run even when it was already net
              // zero. The historical map predates the appended adjustment, so
              // the final orphan sweep must not calculate the same old net a
              // second time.
              desiredAttributions.add(oldKey);
              if (isTest) {
                const oldNet = oldEntries.reduce(
                  (sum, entry) => sum + Number(entry.amount),
                  0,
                );
                if (Math.abs(oldNet) >= 0.005) adjusted++;
                continue;
              }
              for (const oldEaEntries of groupEntriesByEa(oldEntries).values()) {
                if (
                  await this.appendAdjustment(
                    oldEaEntries,
                    oldSubject,
                    oldData.policyId!,
                    "0.00",
                    config,
                    "policy_reassignment",
                  )
                ) {
                  adjusted++;
                }
              }
            }

            // Account changes do not move/delete charged entries (which
            // could disturb allocations). In live mode zero each old EA
            // before the new/current EA receives a base or reinstatement.
            if (!isTest) {
              for (const [eaId, eaEntries] of existingByEa) {
                if (eaId === desiredEa?.id) continue;
                if (
                  await this.appendAdjustment(
                    eaEntries,
                    subject,
                    desired.policyId,
                    "0.00",
                    config,
                    "policy_reassignment",
                  )
                ) {
                  adjusted++;
                }
              }
            }

            if (isTest) {
              const net = existing.reduce((sum, entry) => sum + Number(entry.amount), 0);
              for (const [eaId, eaEntries] of existingByEa) {
                if (eaId === desiredEa?.id) continue;
                const oldNet = eaEntries.reduce(
                  (sum, entry) => sum + Number(entry.amount),
                  0,
                );
                if (Math.abs(oldNet) >= 0.005) adjusted++;
              }
              if (existing.length === 0 && Number(desired.amount) > 0) {
                created++;
              } else if (
                existing.length > 0 &&
                Math.abs(net - Number(desired.amount)) >= 0.005
              ) {
                adjusted++;
              }
              continue;
            }

            if (existing.length === 0 && Number(desired.amount) > 0) {
              const ea = await storage.ledger.ea.getOrCreate(
                "worker",
                subject.subscriberWorkerId,
                accountId,
              );
              const baseKey = `${config.id}:${subject.subscriberWorkerId}:${desired.policyId}:${subject.benefitId}:${subject.year}:${subject.month}:${ea.id}`;
              await storage.ledger.entries.create({
                chargePlugin: PLUGIN_ID,
                chargePluginKey: baseKey,
                chargePluginConfigId: config.id,
                eaId: ea.id,
                amount: desired.amount,
                statementYmd: monthYmd(subject),
                referenceType: REFERENCE_TYPE,
                referenceId: key,
                memo: `BAO EE Contribution: ${monthYmd(subject).slice(0, 7)} ($${desired.amount})`,
                data: {
                  pluginId: PLUGIN_ID,
                  pluginConfigId: config.id,
                  subscriberWorkerId: subject.subscriberWorkerId,
                  policyId: desired.policyId,
                  policySource: desired.policySource,
                  benefitId: subject.benefitId,
                  billingMonth: monthYmd(subject).slice(0, 7),
                  coverageWmbIds: desired.coverage.wmbIds,
                  coverageEmployerIds: desired.coverage.employerIds,
                  rate: desired.amount,
                  rateId: desired.rate.id,
                  rateEffectiveYmd: desired.rate.effectiveYmd,
                },
              });
              created++;
            } else if (
              existing.length > 0 &&
              (await this.appendAdjustment(
                existing,
                subject,
                desired.policyId,
                desired.amount,
                config,
                "rate_correction",
                {
                  rate: desired.rate,
                  policySource: desired.policySource,
                  coverage: desired.coverage,
                },
              ))
            ) {
              adjusted++;
            }
          }

          // Remove no-longer-covered historical attributions. Policy-switch
          // attributions were already zeroed above, before the replacement,
          // while diagnostics still protect prior debt from being guessed to
          // zero.
          for (const [key, entries] of historicByAttribution) {
            if (desiredAttributions.has(key)) continue;
            const data = parseMetadata(entries[0]);
            if (!data) continue;
            const [year, month] = data.billingMonth!.split("-").map(Number);
            const subject = {
              subscriberWorkerId: data.subscriberWorkerId!,
              benefitId: data.benefitId!,
              year,
              month,
            };
            // WMB execution is intentionally subject-scoped. Entries outside
            // its selected benefit/month/subscriber identities are CRON
            // recovery work, not implicit orphan reversals from this event.
            if (!subjects.has(subjectKey(subject))) continue;
            if (protectedSubjects.has(subjectKey(subject))) continue;
            for (const eaEntries of groupEntriesByEa(entries).values()) {
              if (isTest) {
                const net = eaEntries.reduce(
                  (sum, entry) => sum + Number(entry.amount),
                  0,
                );
                if (Math.abs(net) >= 0.005) adjusted++;
                continue;
              }
              if (
                await this.appendAdjustment(
                  eaEntries,
                  subject,
                  data.policyId!,
                  "0.00",
                  config,
                  "policy_reassignment",
                )
              ) {
                adjusted++;
              }
            }
          }

          const summary = `${created} base charge(s), ${adjusted} adjustment(s), ${diagnostics} configuration diagnostic(s)`;
          return {
            success: true,
            transactions: [],
            message: isTest ? `[TEST] Would reconcile ${summary}` : `Reconciled ${summary}`,
          };
        },
      );
    } catch (error) {
      logger.error("BAO EE contribution charge plugin execution failed", {
        service: SERVICE,
        configId: config.id,
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
    const base: LedgerEntryVerification = {
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
      return await storage.advisoryLock.withTransactionLock(
        `bao-ee-contribution:${config.id}`,
        async () => {
          const data = parseMetadata(entry);
          if (!data) {
            return {
              ...base,
              isValid: false,
              discrepancies: [
                "Entry lacks BAO EE contribution attribution metadata",
              ],
            };
          }
          const [year, month] = data.billingMonth!.split("-").map(Number);
          if (!Number.isInteger(year) || !Number.isInteger(month)) {
            return {
              ...base,
              isValid: false,
              discrepancies: ["Entry has an invalid contribution billing month"],
            };
          }
          const subject: Subject = {
            subscriberWorkerId: data.subscriberWorkerId!,
            benefitId: data.benefitId!,
            year,
            month,
          };
          // The same charge-only discovery used by execution deliberately
          // excludes payment rows and their allocations from the expected
          // coverage debt.
          const allEntries =
            await storage.ledger.entries.listByChargePluginAndConfig(
              PLUGIN_ID,
              config.id,
            );
          const attributedEntries = allEntries.filter((candidate) => {
            const candidateData = parseMetadata(candidate);
            return (
              !!candidateData &&
              candidate.eaId === entry.eaId &&
              attributionKey(subject, candidateData.policyId!) ===
                attributionKey(subject, data.policyId!)
            );
          });
          const coverage = await storage.trust.wmb.getEeContributionCoverage(
            subject.subscriberWorkerId,
            subject.benefitId,
            subject.month,
            subject.year,
          );
          const desired = await this.resolveDesired(
            coverage,
            createPolicyResolutionCache(),
          );
          const discrepancies: string[] = [];
          let expectedAmount: string | null = null;

          if (desired.kind === "diagnostic") {
            discrepancies.push(
              `Cannot verify contribution safely: ${desired.message}`,
            );
          } else {
            // Verification must apply the same account attribution as
            // execution. An old account is expected to net to zero after an
            // account switch; the configured account alone may carry the
            // current positive contribution.
            const configuredEa =
              desired.kind === "priced" && Number(desired.amount) > 0
                ? await storage.ledger.ea.getByEntityAndAccount(
                    "worker",
                    subject.subscriberWorkerId,
                    config.account!,
                  )
                : undefined;
            const desiredForAttribution =
              desired.kind === "priced" &&
              desired.policyId === data.policyId &&
              configuredEa?.id === entry.eaId
                ? desired.amount
                : "0.00";
            expectedAmount = desiredForAttribution;
            const net = attributedEntries.reduce(
              (sum, candidate) => sum + Number(candidate.amount),
              0,
            );
            if (Math.abs(net - Number(desiredForAttribution)) >= 0.005) {
              discrepancies.push(
                `Net contribution mismatch: expected $${desiredForAttribution} across base and adjustments, found $${net.toFixed(2)}`,
              );
            }
          }

          if (
            entry.referenceType !== REFERENCE_TYPE &&
            entry.referenceType !== ADJUSTMENT_REFERENCE_TYPE
          ) {
            discrepancies.push(
              `Unexpected contribution reference type ${entry.referenceType ?? "null"}`,
            );
          }
          if (
            !data.rate ||
            !data.rateId ||
            !data.rateEffectiveYmd
          ) {
            discrepancies.push(
              "Entry lacks selected rate attribution (rate, rateId, rateEffectiveYmd)",
            );
          }
          if (entry.referenceType === ADJUSTMENT_REFERENCE_TYPE) {
            if (data.originalAmount == null || data.newAmount == null) {
              discrepancies.push(
                "Adjustment lacks originalAmount or newAmount metadata",
              );
            } else {
              const delta = (
                Number(data.newAmount) - Number(data.originalAmount)
              ).toFixed(2);
              if (entry.amount !== delta) {
                discrepancies.push(
                  `Adjustment amount mismatch: expected ${delta}, found ${entry.amount}`,
                );
              }
            }
          }

          return {
            ...base,
            isValid: discrepancies.length === 0,
            expectedAmount,
            discrepancies,
          };
        },
      );
    } catch (error) {
      return {
        ...base,
        isValid: false,
        discrepancies: [
          `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
}

registerChargePlugin(new BaoEeContributionChargePlugin());