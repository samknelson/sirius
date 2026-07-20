/**
 * BAO COBRA case reconciliation.
 *
 * Rebuilds missing initial COBRA cases from the PERSISTED WMB terminate
 * events (`trust_wmb_events`, maintained by the trust-wmb-terminate denorm
 * plugin) — the self-healing counterpart of the live
 * TRUST_WMB_SCAN_WORKER_COMPLETED listener in bao-cobra-auto-case.ts.
 *
 * For every terminate event on a medical/dental benefit, grouped per
 * (worker, year, month), the shared termination core opens ONE case per
 * covered person carrying both the medical and dental benefits lost —
 * merging a missing benefit onto an existing open un-elected same-month
 * case and skipping months already handled (any case for that person and
 * effective month, open or closed, counts as handled). Idempotent: a
 * second run creates nothing.
 */

import { storage } from "../storage";
import { logger } from "../logger";
import {
  openCobraCasesForTermination,
  type WmbTerminationGroup,
} from "./bao-cobra-auto-case";

const SERVICE_NAME = "bao-cobra-case-reconcile";

export interface CobraReconcileSummary {
  /** Terminate events examined (all benefits). */
  events: number;
  /** (worker, month) groups with at least one med/dental benefit. */
  groups: number;
  /** Groups skipped: no failed plugin configured to trigger COBRA. */
  notQualifying: number;
  created: number;
  merged: number;
  skippedExisting: number;
  skippedInvariant: number;
  errors: number;
}

interface TerminateEventData {
  failedPlugins?: Array<{ pluginKey?: string | null; reason?: string | null }>;
}

/**
 * Reconcile COBRA cases from persisted terminate events.
 * `dryRun` reports what would change without writing.
 */
export async function reconcileCobraCases(
  opts: { dryRun?: boolean } = {},
): Promise<CobraReconcileSummary> {
  const summary: CobraReconcileSummary = {
    events: 0,
    groups: 0,
    notQualifying: 0,
    created: 0,
    merged: 0,
    skippedExisting: 0,
    skippedInvariant: 0,
    errors: 0,
  };

  const events = await storage.trustWmbEvents.listAllByType("terminate");
  summary.events = events.length;
  if (events.length === 0) return summary;

  // Classify each distinct benefit once.
  const kindByBenefit = new Map<string, "medical" | "dental" | null>();
  for (const event of events) {
    if (!kindByBenefit.has(event.benefitId)) {
      kindByBenefit.set(
        event.benefitId,
        await storage.baoCobraCases.classifyMedicalDentalBenefit(event.benefitId),
      );
    }
  }

  // Group med/dental terminate events per (worker, year, month).
  const groups = new Map<string, WmbTerminationGroup>();
  for (const event of events) {
    const kind = kindByBenefit.get(event.benefitId);
    if (!kind) continue; // COBRA only applies to medical/dental coverage.

    const key = `${event.workerId}:${event.year}:${event.month}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        subscriberWorkerId: event.workerId,
        year: event.year,
        month: event.month,
        benefits: [],
        failedPlugins: [],
        trigger: "reconcile",
      };
      groups.set(key, group);
    }
    if (!group.benefits.some((b) => b.benefitId === event.benefitId)) {
      group.benefits.push({ benefitId: event.benefitId, kind });
    }
    const data = (event.data ?? {}) as TerminateEventData;
    for (const fp of data.failedPlugins ?? []) {
      if (!fp?.pluginKey) continue;
      if (!group.failedPlugins.some((existing) => existing.pluginKey === fp.pluginKey)) {
        group.failedPlugins.push({ pluginKey: fp.pluginKey, reason: fp.reason ?? null });
      }
    }
  }
  summary.groups = groups.size;

  for (const group of groups.values()) {
    try {
      const outcome = await openCobraCasesForTermination(group, { dryRun: opts.dryRun });
      if (!outcome.qualified) summary.notQualifying++;
      summary.created += outcome.created;
      summary.merged += outcome.merged;
      summary.skippedExisting += outcome.skippedExisting;
      summary.skippedInvariant += outcome.skippedInvariant;
    } catch (err) {
      summary.errors++;
      logger.error("COBRA reconciliation failed for termination group", {
        service: SERVICE_NAME,
        workerId: group.subscriberWorkerId,
        year: group.year,
        month: group.month,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("COBRA case reconciliation finished", {
    service: SERVICE_NAME,
    dryRun: Boolean(opts.dryRun),
    ...summary,
  });
  return summary;
}
