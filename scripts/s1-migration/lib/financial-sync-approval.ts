import { inventoryFinancialLinks, type FinancialRebind } from "./financial-link-inventory";
import type { FinancialEntity } from "./financial-identity-plan";

/** Approval is stream-specific so payments advancing fingerprints cannot
 * invalidate the separately reviewed AR evidence in the same ordered fleet. */
export async function authorizeFinancialSyncLinks(
  stream: "ar" | "payment", argv: string[] = process.argv,
): Promise<Map<string, FinancialRebind>> {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] ?? "" : "";
  };
  const hash = value("--approve-financial-links");
  if (!argv.includes("--approve-financial-links")) return new Map();
  const checkpoint = value("--financial-links-checkpoint");
  if (!checkpoint || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error("Financial-link sync approval requires a checkpoint and reviewed stream-specific evidenceHash");
  }
  const inventory = await inventoryFinancialLinks(checkpoint, { streams: [stream] });
  if (inventory.evidenceHash !== hash || inventory.blocked) {
    throw new Error("Financial-link sync evidence changed or is unsafe; review a fresh stream-specific dry run");
  }
  return new Map(inventory.rebinds.map((r) => [r.id, r]));
}

export function isApprovedFinancialRebind(
  approved: Map<string, FinancialRebind>, id: string, oldEaId: string,
  expected: FinancialEntity, accountId: string,
) {
  const plan = approved.get(id);
  return !!plan && plan.oldEaId === oldEaId && plan.accountId === accountId &&
    plan.entity.entityType === expected.entityType && plan.entity.entityId === expected.entityId;
}
