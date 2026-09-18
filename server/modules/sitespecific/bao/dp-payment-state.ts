import { storage } from "../../../storage/database";
import {
  toChargeConfig,
  pickFirstByAccountOrder,
} from "../../../plugins/ledger/charge/charge-config-resolution";
import type { Ledger, WorkerTrustElection } from "@shared/schema";

export const DP_CHARGE_PLUGIN_ID = "sitespecific-bao-dp";

/**
 * Resolve the ledger account DP member charges are billed to (the "Health Fund -
 * DP" account in production): the account on the first enabled global config
 * of the DP charge plugin (legacy account-nulls-last/id ordering). Never
 * hardcoded. Null when the plugin has no enabled global config or the config
 * has no account.
 */
export async function resolveDpAccountId(): Promise<string | null> {
  const config = await resolveDpChargeConfig();
  return config?.account ?? null;
}

/** The first enabled global DP charge plugin config, or null. */
export async function resolveDpChargeConfig(): Promise<{
  id: string;
  account: string | null;
} | null> {
  const configs = (
    await storage.pluginConfigs.search("charge", {
      pluginId: DP_CHARGE_PLUGIN_ID,
      enabled: true,
      scope: "global",
    })
  ).map(toChargeConfig);
  const config = pickFirstByAccountOrder(configs);
  return config ? { id: config.id, account: config.account ?? null } : null;
}

export type DpMonthPaymentStatus = "paid" | "partial" | "unpaid";

export interface DpChargeMonthStatus {
  /** Coverage month, YYYY-MM. */
  month: string;
  electionId: string;
  dpRelationshipId: string;
  /** The DP dependent's worker id, when recorded on the entry. */
  dpWorkerId: string | null;
  /** Net posted member charge for this (DP, month): base + adjustments. */
  netCharge: string;
  /** Portion of the net charge covered by payments (FIFO by month). */
  paidAmount: string;
  status: DpMonthPaymentStatus;
}

export interface DpPaymentStateResult {
  accountId: string;
  configId: string;
  /** Signed balance on the DP account (positive = owed). */
  balance: string;
  /** Total of all net posted DP charges. */
  totalCharges: string;
  /** Total credited against charges (totalCharges - balance, floored at 0). */
  totalPaid: string;
  /** Per (DP, month) charge rows in chronological order. */
  months: DpChargeMonthStatus[];
}

/** True only when charge entries survive reversal for a DP coverage month. */
export function hasPostedDpCharge(
  month: DpChargeMonthStatus | undefined,
): boolean {
  return month !== undefined
    && Number.isFinite(Number(month.netCharge))
    && Number(month.netCharge) >= 0.005;
}

interface DpPaymentCalculationInput {
  accountId: string;
  configId: string;
  balance: number;
  elections: WorkerTrustElection[];
  entriesByElection: ReadonlyMap<string, readonly Ledger[]>;
}

/**
 * Pure FIFO calculation shared by the single and batch loaders. Elections
 * and each election's entries are consumed in loader order, preserving the
 * existing tie order when multiple rows have the same billing month.
 */
function calculateDpPaymentState({
  accountId,
  configId,
  balance,
  elections,
  entriesByElection,
}: DpPaymentCalculationInput): DpPaymentStateResult {
  const byKey = new Map<
    string,
    {
      month: string;
      electionId: string;
      dpRelationshipId: string;
      dpWorkerId: string | null;
      net: number;
    }
  >();
  for (const election of elections) {
    for (const entry of entriesByElection.get(election.id) ?? []) {
      const meta = entry.data as {
        billingMonth?: string;
        dpRelationshipId?: string;
        dpWorkerId?: string;
      } | null;
      if (!meta?.billingMonth || !meta.dpRelationshipId) continue;
      const key = `${election.id}:${meta.dpRelationshipId}:${meta.billingMonth}`;
      const row = byKey.get(key) ?? {
        month: meta.billingMonth,
        electionId: election.id,
        dpRelationshipId: meta.dpRelationshipId,
        dpWorkerId: meta.dpWorkerId ?? null,
        net: 0,
      };
      row.net += parseFloat(entry.amount);
      if (!row.dpWorkerId && meta.dpWorkerId) row.dpWorkerId = meta.dpWorkerId;
      byKey.set(key, row);
    }
  }

  const rows = Array.from(byKey.values())
    .map((r) => ({ ...r, net: Number(r.net.toFixed(2)) }))
    .filter((r) => Math.abs(r.net) >= 0.005)
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  const totalCharges = rows.reduce((sum, r) => sum + r.net, 0);
  const totalPaid = Math.max(0, Number((totalCharges - balance).toFixed(2)));

  let remainingPaid = totalPaid;
  const months: DpChargeMonthStatus[] = rows.map((r) => {
    const applied = Math.min(Math.max(remainingPaid, 0), r.net);
    remainingPaid = Number((remainingPaid - applied).toFixed(2));
    const status: DpMonthPaymentStatus =
      applied >= r.net - 0.005 ? "paid" : applied > 0.005 ? "partial" : "unpaid";
    return {
      month: r.month,
      electionId: r.electionId,
      dpRelationshipId: r.dpRelationshipId,
      dpWorkerId: r.dpWorkerId,
      netCharge: r.net.toFixed(2),
      paidAmount: applied.toFixed(2),
      status,
    };
  });

  return {
    accountId,
    configId,
    balance: balance.toFixed(2),
    totalCharges: totalCharges.toFixed(2),
    totalPaid: totalPaid.toFixed(2),
    months,
  };
}

/**
 * Compute the per-month DP member charge / paid / balance state for a worker
 * from the worker's DP ledger account. Returns null when no DP billing
 * account is configured — callers must treat that as "payment state
 * unknown". Confirmed no-charge months never post an entry, so they do not
 * appear here and contribute nothing to the balance.
 *
 * Payment attribution: payments on the account are not allocated to specific
 * months in the ledger, so months are marked paid FIFO (oldest month first)
 * from the account's total credited amount. NOTE (unconfirmed business
 * rules): payment due dates, grace periods, and overpayment/refund treatment
 * are deliberately not modeled here.
 */
export async function computeDpPaymentState(
  workerId: string,
): Promise<DpPaymentStateResult | null> {
  const config = await resolveDpChargeConfig();
  if (!config?.account) return null;
  const accountId = config.account;

  // Balance on the DP account (positive = owed).
  const balances = await storage.ledger.entries.getBalancesByEntityAndAccount(
    "worker",
    [workerId],
    [accountId],
  );
  const balance = Number(balances[0]?.total ?? "0");

  // Net charge per (election, DP, month) from this config's entries across
  // the worker's elections.
  const elections = await storage.workerTrustElections.listByWorker(workerId);
  const entriesByElection = new Map<string, Ledger[]>();
  for (const election of elections) {
    const entries = await storage.ledger.entries.getByReferenceAndConfig(
      election.id,
      config.id,
    );
    entriesByElection.set(election.id, entries);
  }

  return calculateDpPaymentState({
    accountId,
    configId: config.id,
    balance,
    elections,
    entriesByElection,
  });
}

/**
 * Compute DP payment states with bulk reads, bounded in chunks for very large
 * populations. The result contains each distinct requested worker id. When no DP
 * billing account is configured, each value is null.
 */
export async function computeDpPaymentStates(
  workerIds: string[],
): Promise<Map<string, DpPaymentStateResult | null>> {
  const uniqueWorkerIds = Array.from(new Set(workerIds));
  const result = new Map<string, DpPaymentStateResult | null>();
  if (uniqueWorkerIds.length === 0) return result;

  const config = await resolveDpChargeConfig();
  if (!config?.account) {
    for (const workerId of uniqueWorkerIds) result.set(workerId, null);
    return result;
  }

  const accountId = config.account;
  const balances: Array<{ entityId: string; accountId: string; total: string }> = [];
  const elections: WorkerTrustElection[] = [];
  // These existing storage methods bind one parameter per worker. Bound the
  // input without splitting any worker's history across separate calculations.
  for (let offset = 0; offset < uniqueWorkerIds.length; offset += 5_000) {
    const chunk = uniqueWorkerIds.slice(offset, offset + 5_000);
    const [chunkBalances, chunkElections] = await Promise.all([
      storage.ledger.entries.getBalancesByEntityAndAccount(
        "worker", chunk, [accountId],
      ),
      // listByWorker delegates to this exact sort, preserving per-worker order.
      storage.workerTrustElections.search({ workerIds: chunk, sort: "startDesc" }),
    ]);
    for (const balance of chunkBalances) balances.push(balance);
    for (const election of chunkElections) elections.push(election);
  }

  const electionIds = elections.map((election) => election.id);
  const bulkEntries =
    await storage.ledger.entries.getByReferencesAndConfig(electionIds, config.id);
  const entriesByElection = new Map<string, Ledger[]>(
    electionIds.map((electionId) => [electionId, []]),
  );
  for (const entry of bulkEntries) {
    if (entry.referenceId) entriesByElection.get(entry.referenceId)?.push(entry);
  }

  const balanceByWorker = new Map(
    balances.map((row) => [row.entityId, Number(row.total)]),
  );
  const electionsByWorker = new Map<string, WorkerTrustElection[]>(
    uniqueWorkerIds.map((workerId) => [workerId, []]),
  );
  for (const election of elections) {
    electionsByWorker.get(election.workerId)?.push(election);
  }

  for (const workerId of uniqueWorkerIds) {
    result.set(
      workerId,
      calculateDpPaymentState({
        accountId,
        configId: config.id,
        balance: balanceByWorker.get(workerId) ?? 0,
        elections: electionsByWorker.get(workerId) ?? [],
        entriesByElection,
      }),
    );
  }
  return result;
}
