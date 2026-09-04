import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { storage } from "../../../../storage";
import { todayYmdLocal } from "../../../../modules/sitespecific/bao/cobra-payment-state";
import { createUnifiedOptionsStorage } from "../../../../storage/unified-options";

registerCronPlugin({
  metadata: {
    id: "bao-case-deadline-lapse",
    name: "BAO - Close Lapsed Cases",
    description: "Moves overdue BAO cases to their configured lapse status.",
    requiredComponent: "sitespecific.bao",
    singleton: true,
  },
  defaultSchedule: "0 3 * * *",
  defaultEnabled: true,
  async execute(context: CronJobContext): Promise<CronJobResult> {
    const today = todayYmdLocal();
    const candidates = await storage.baoCases.listLapsedOpenCases(today);
    const statuses = await createUnifiedOptionsStorage().list("bao-case-status") as any[];
    const byId = new Map(statuses.map((s) => [s.id, s]));
    let closed = 0;
    const skipped: Array<{ caseId: string; reason: string }> = [];
    for (const candidate of candidates) {
      const target = byId.get(candidate.lapseStatusId);
      if (!target || target.caseTypeId !== byId.get(candidate.statusId)?.caseTypeId) {
        skipped.push({ caseId: candidate.id, reason: "lapse target is missing or has a different case type" });
        continue;
      }
      if (target.closed && !target.defaultResolutionId) {
        skipped.push({ caseId: candidate.id, reason: "closed lapse target has no default resolution" });
        continue;
      }
      if (context.mode === "live") {
        try {
          await storage.baoCases.updateLifecycle(
            candidate.id,
            { statusId: candidate.lapseStatusId },
            undefined,
            { systemClose: true },
          );
          closed++;
        } catch (error) {
          skipped.push({ caseId: candidate.id, reason: error instanceof Error ? error.message : String(error) });
        }
      } else {
        closed++;
      }
    }
    const verb = context.mode === "live" ? "Closed" : "Would close";
    return {
      message: `${verb} ${closed} lapsed BAO case(s)${skipped.length ? `; skipped ${skipped.length}: ${skipped.map((s) => `${s.caseId} (${s.reason})`).join(", ")}` : ""}`,
      metadata: { candidates: candidates.length, closed, skipped },
    };
  },
});