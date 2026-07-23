import {
  eventBus,
  EventType,
  type PaymentSavedPayload,
  type TrustElectionSavedPayload,
} from "./event-bus";
import { onAfterCommit } from "../storage/transaction-context";
import { storage } from "../storage";
import { logger } from "../logger";
import { isComponentEnabledSync, isCacheInitialized } from "./component-cache";
import { enqueueWorkerMonths } from "./wmb-auto-rescan";
import {
  resolveDpAccountId,
  DP_CHARGE_PLUGIN_ID,
} from "../modules/sitespecific/bao/dp-payment-state";
import { DP_RELATION_TYPE_NAME_PATTERN } from "../plugins/ledger/charge/plugins/sitespecific-bao-dp";

/**
 * BAO Domestic Partner auto-rescan.
 *
 * The generic WMB auto-rescan already enqueues a worker's benefit rescan for
 * the payment month + current month on every payment, and for the election
 * span on every trust-election change — and event-driven (worker_update)
 * queue jobs re-evaluate covered dependents. That covers most DP payment
 * gating.
 *
 * What it does NOT cover is the month AFTER the current one: DP premiums are
 * billed up to one coverage month in advance, so paying (or reversing a
 * payment against) next month's charge must re-gate next month's DP benefit.
 * This service adds exactly that: when a payment lands on the subscriber's DP
 * ledger account, or a DP-covering election changes, it additionally enqueues
 * NEXT month for the subscriber — one coverage month ahead, never more.
 */

const SERVICE_NAME = "bao-dp-auto-rescan";
const handlerIds: string[] = [];

function componentsActive(): boolean {
  return (
    isCacheInitialized() &&
    isComponentEnabledSync("trust.benefits") &&
    isComponentEnabledSync("sitespecific.bao")
  );
}

function nextMonth(): { month: number; year: number } {
  const now = new Date();
  const m = now.getMonth() + 2;
  return m > 12
    ? { month: 1, year: now.getFullYear() + 1 }
    : { month: m, year: now.getFullYear() };
}

async function handlePaymentSaved(payload: PaymentSavedPayload): Promise<void> {
  if (!componentsActive()) return;
  if (payload.entityType !== "worker") return;
  const workerId = payload.entityId;
  onAfterCommit(() => {
    void (async () => {
      try {
        const dpAccountId = await resolveDpAccountId();
        if (!dpAccountId || payload.accountId !== dpAccountId) return;
        await enqueueWorkerMonths(workerId, [nextMonth()], "dp_payment_saved");
      } catch (err) {
        logger.error("Failed to enqueue DP next-month rescan after payment", {
          service: SERVICE_NAME,
          workerId,
          paymentId: payload.paymentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });
}

async function handleElectionSaved(
  payload: TrustElectionSavedPayload,
): Promise<void> {
  if (!componentsActive()) return;
  const workerId = payload.workerId;
  onAfterCommit(() => {
    void (async () => {
      try {
        // Only elections that (can) cover a domestic partner need the
        // one-month-ahead rescan.
        const dpRels = await storage.workerRelations.searchWorkerRelations({
          workerId,
          role: "worker_1",
          relationTypeNameILike: DP_RELATION_TYPE_NAME_PATTERN,
        });
        if (dpRels.length === 0) return;
        await enqueueWorkerMonths(workerId, [nextMonth()], "dp_election_saved");
      } catch (err) {
        logger.error(
          "Failed to enqueue DP next-month rescan after election change",
          {
            service: SERVICE_NAME,
            workerId,
            electionId: payload.electionId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    })();
  });
}

export function initBaoDpAutoRescan(): void {
  if (handlerIds.length > 0) {
    logger.warn("BAO DP auto-rescan already initialized", {
      service: SERVICE_NAME,
    });
    return;
  }
  handlerIds.push(
    eventBus.on({
      name: "bao-dp-auto-rescan-payment",
      description: `Re-scans next month's benefits when a payment lands on the subscriber's DP ledger account (the ${DP_CHARGE_PLUGIN_ID} charge account), since DP premiums bill one coverage month in advance.`,
      event: EventType.PAYMENT_SAVED,
      handler: handlePaymentSaved,
    }),
    eventBus.on({
      name: "bao-dp-auto-rescan-election",
      description:
        "Re-scans next month's benefits when a DP-covering trust election changes, since DP coverage extends one month ahead of the current month.",
      event: EventType.TRUST_ELECTION_SAVED,
      handler: handleElectionSaved,
    }),
  );
  logger.info("BAO DP auto-rescan initialized", { service: SERVICE_NAME });
}

export function shutdownBaoDpAutoRescan(): void {
  for (const id of handlerIds) {
    eventBus.off(id);
  }
  handlerIds.length = 0;
}
