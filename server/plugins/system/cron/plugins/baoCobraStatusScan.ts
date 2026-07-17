import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { storage } from "../../../../storage/database";
import {
  computeCobraCasePaymentState,
  resolveCobraAccountId,
  todayYmdLocal,
} from "../../../../modules/sitespecific/bao/cobra-payment-state";
import { logger } from "../../../../logger";
import { createUnifiedOptionsStorage } from "../../../../storage/unified-options";

/**
 * Nightly COBRA payment-status / case-status scan.
 *
 * For every elected, open COBRA case:
 * - Recomputes `paymentStatus` (paid / grace / delinquent) from the covered
 *   person's balance on the COBRA billing account.
 * - Transitions the case status by option NAME, only when the target option
 *   exists in the `bao-cobra-status` option set:
 *   - past the maximum coverage period → "Closed"
 *   - paid while in "Pending First Payment" or "Delinquent" → "Enrolled"
 *   - delinquent → "Delinquent"
 * - When no COBRA billing account is configured, payment status and
 *   payment-driven transitions are left untouched (only max-period closure
 *   still applies).
 *
 * Test mode reports what would change without writing.
 */
registerCronPlugin({
  metadata: {
    id: "bao-cobra-status-scan",
    name: "BAO - COBRA Status Scan",
    description:
      "Updates COBRA case payment status (paid / grace / delinquent) from the COBRA ledger account and transitions case statuses (Enrolled, Delinquent, Closed) accordingly.",
    requiredComponent: "sitespecific.bao",
    singleton: true,
  },
  defaultSchedule: "30 4 * * *", // Daily at 4:30 AM, after the billing run
  defaultEnabled: false,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    let cases;
    try {
      cases = await storage.baoCobraCases.listElectedActiveCases();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "COMPONENT_TABLE_NOT_FOUND"
      ) {
        return { message: "COBRA tables are not provisioned; nothing to scan" };
      }
      throw error;
    }

    const unifiedOptions = createUnifiedOptionsStorage();
    const statuses = await unifiedOptions.list("bao-cobra-status");
    const statusByName = new Map<string, { id: string; name: string; closed?: boolean }>(
      statuses.map((s: { id: string; name: string; closed?: boolean }) => [
        s.name.toLowerCase(),
        s,
      ]),
    );
    const statusById = new Map<string, { id: string; name: string; closed?: boolean }>(
      statuses.map((s: { id: string; name: string; closed?: boolean }) => [s.id, s]),
    );

    const accountId = await resolveCobraAccountId();
    const todayYmd = todayYmdLocal();

    let paymentUpdates = 0;
    let statusTransitions = 0;
    let closed = 0;
    let errors = 0;

    for (const theCase of cases) {
      try {
        const changes: { paymentStatus?: string; statusId?: string } = {};
        let becomingClosed = false;

        // Max-period closure applies regardless of billing configuration.
        if (theCase.maxPeriodYmd && todayYmd > theCase.maxPeriodYmd) {
          const target = statusByName.get("closed");
          if (target && theCase.statusId !== target.id) {
            changes.statusId = target.id;
            becomingClosed = true;
          }
        } else if (accountId) {
          const payment = await computeCobraCasePaymentState(
            theCase,
            todayYmd,
            accountId,
          );
          if (payment) {
            if (theCase.paymentStatus !== payment.state) {
              changes.paymentStatus = payment.state;
            }
            const current = statusById.get(theCase.statusId ?? "");
            const currentName = current?.name.toLowerCase();
            if (payment.state === "delinquent") {
              const target = statusByName.get("delinquent");
              if (target && theCase.statusId !== target.id) {
                changes.statusId = target.id;
              }
            } else if (
              currentName === "pending first payment" ||
              currentName === "delinquent"
            ) {
              // Paid or in grace: a paid-up account returns the case to
              // Enrolled. Grace alone does not advance Pending First Payment.
              if (payment.state === "paid") {
                const target = statusByName.get("enrolled");
                if (target && theCase.statusId !== target.id) {
                  changes.statusId = target.id;
                }
              }
            }
          }
        }

        if (Object.keys(changes).length === 0) continue;

        if (changes.paymentStatus) paymentUpdates++;
        if (changes.statusId) {
          statusTransitions++;
          if (becomingClosed) closed++;
        }

        if (context.mode === "live") {
          await storage.baoCobraCases.update(theCase.id, changes);
        }
      } catch (error) {
        errors++;
        logger.error("COBRA status scan failed for case", {
          service: "cron-bao-cobra-status-scan",
          caseId: theCase.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const verb = context.mode === "live" ? "Updated" : "[TEST] Would update";
    return {
      message: `${verb} ${paymentUpdates} payment status(es) and ${statusTransitions} case status(es) (${closed} closed) across ${cases.length} elected case(s)${errors ? `, ${errors} error(s)` : ""}${accountId ? "" : " — no COBRA billing account configured, payment checks skipped"}`,
      metadata: { cases: cases.length, paymentUpdates, statusTransitions, closed, errors },
    };
  },
});
