import type { Request } from "express";
import { alterHooks } from "@shared/alter";

export interface EchpDate {
  asOf: { year: number; month: number; day: number };
  asOfApplied: boolean;
}
export const echpDateHook = alterHooks.declare<EchpDate, { request: Request }>({
  id: "bao.echp.effective-date",
  description: "Resolve the effective ECHP evaluation date",
  semantics: "Default is the process-local current date. Optional inputs never grant purchase or worker access.",
});
export async function resolveAsOf(request: Request): Promise<EchpDate> {
  const now = new Date();
  return alterHooks.run(echpDateHook, {
    asOf: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
    asOfApplied: false,
  }, { request });
}
