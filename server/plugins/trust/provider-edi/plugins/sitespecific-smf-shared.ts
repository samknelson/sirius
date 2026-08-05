import { and, eq, inArray } from "drizzle-orm";
import { trustBenefits, trustWmb } from "@shared/schema";
import type { TrustProviderEdiContext } from "../registry";
import type { EdiMemberUnit } from "../base";

/**
 * Shared SMF helpers for the fixed-width EDI plugins (Delta, Express
 * Scripts): the medical-plan-derived "client group ID".
 *
 * Legacy rule:
 *   MedicalPlan MLK ('M')          → 'SMM00'
 *   MedicalPlan HealthNet ('H')    → 'SMH00'
 *   MedicalPlan Kaiser ('K'/'KE')  → 'SMK00'
 *
 * A member's medical plan is read from the subscriber's monthly benefit
 * records (trust_wmb) in the same month as the unit's own record: the
 * first medical benefit (in mapping order) the subscriber holds wins.
 */

export const DEFAULT_MEDICAL_PLAN_GROUP_MAP: Record<string, string> = {
  M: "SMM00",
  H: "SMH00",
  K: "SMK00",
  KE: "SMK00",
};

/**
 * The medical-plan → client-group-ID mapping for a run: the config-level
 * `medicalPlanGroupMap` object override when present, else the default.
 */
export function effectiveMedicalPlanGroupMap(
  ctx: TrustProviderEdiContext,
): Record<string, string> {
  const raw = (ctx.configData ?? {}).medicalPlanGroupMap;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string" && !!e[1],
    );
    if (entries.length) return Object.fromEntries(entries);
  }
  return { ...DEFAULT_MEDICAL_PLAN_GROUP_MAP };
}

/**
 * Resolve each unit's subscriber to a client group ID (medical-plan
 * lookup). Returns a map keyed by subscriber worker id; workers with no
 * medical benefit record map to "" (legacy returned '' too).
 */
export async function clientGroupIdsByWorker(
  ctx: TrustProviderEdiContext,
  units: readonly EdiMemberUnit[],
): Promise<Map<string, string>> {
  const map = effectiveMedicalPlanGroupMap(ctx);
  const medicalSiriusIds = Object.keys(map);
  const result = new Map<string, string>();
  if (!units.length || !medicalSiriusIds.length) return result;
  const workerIds = Array.from(new Set(units.map((u) => u.wmb.workerId)));
  const years = Array.from(new Set(units.map((u) => u.wmb.year)));
  const months = Array.from(new Set(units.map((u) => u.wmb.month)));
  const rows = await ctx.storage.readOnly.query(async (db) =>
    db
      .select({
        workerId: trustWmb.workerId,
        year: trustWmb.year,
        month: trustWmb.month,
        siriusId: trustBenefits.siriusId,
      })
      .from(trustWmb)
      .innerJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
      .where(
        and(
          inArray(trustWmb.workerId, workerIds),
          inArray(trustWmb.year, years),
          inArray(trustWmb.month, months),
          inArray(trustBenefits.siriusId, medicalSiriusIds),
        ),
      ),
  );
  // Exact (worker, year, month) match per unit; first mapping-order hit wins.
  const held = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = `${r.workerId}|${r.year}-${r.month}`;
    let set = held.get(key);
    if (!set) held.set(key, (set = new Set()));
    if (r.siriusId) set.add(r.siriusId);
  }
  for (const unit of units) {
    const key = `${unit.wmb.workerId}|${unit.wmb.year}-${unit.wmb.month}`;
    const set = held.get(key);
    let code = "";
    if (set) {
      for (const siriusId of medicalSiriusIds) {
        if (set.has(siriusId)) {
          code = map[siriusId];
          break;
        }
      }
    }
    result.set(unit.wmb.workerId, code);
  }
  return result;
}

/** The run's production/test mode indicator ("P" | "T", default "P"). */
export function readModeIndicator(ctx: TrustProviderEdiContext): string {
  const mode = (ctx.input ?? {}).mode;
  return mode === "T" ? "T" : "P";
}
