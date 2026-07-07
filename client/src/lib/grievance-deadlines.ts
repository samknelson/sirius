import { ymdToDateForPicker } from "@shared/utils/date";
import type { GrievanceStepsDenorm } from "@shared/schema";
import { useVariableValue } from "@/lib/use-variable";

/** One computed timeline step as returned by GET /api/grievances/:id/timeline-steps. */
export interface GrievanceTimelineStepItem extends GrievanceStepsDenorm {
  stepName: string | null;
  stepActor: string | null;
  stepDescription: string | null;
}

export interface DeadlineThresholds {
  /** More than this many days out → green. */
  green: number;
  /** Fewer than this many days out (or overdue) → red. */
  red: number;
}

export const DEFAULT_DEADLINE_THRESHOLDS: DeadlineThresholds = { green: 20, red: 5 };

function isValidThresholds(value: unknown): value is DeadlineThresholds {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.green === "number" &&
    Number.isInteger(v.green) &&
    v.green >= 0 &&
    typeof v.red === "number" &&
    Number.isInteger(v.red) &&
    v.red >= 0 &&
    v.green >= v.red
  );
}

export function useDeadlineThresholds(): DeadlineThresholds {
  // Staff-readable variable (grievance component); 401/403/404 or invalid
  // values all fall back to the defaults.
  const { data } = useVariableValue("grievance.deadline_thresholds");
  return isValidThresholds(data) ? data : DEFAULT_DEADLINE_THRESHOLDS;
}

/** Whole days from today (local midnight) until the given YMD date; negative when overdue. */
export function daysUntilYmd(ymd: string): number {
  const due = ymdToDateForPicker(ymd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** Tailwind text-color classes for a deadline based on how close it is. */
export function deadlineColorClass(ymd: string, thresholds: DeadlineThresholds): string {
  const days = daysUntilYmd(ymd);
  if (days > thresholds.green) return "text-green-600 dark:text-green-500 font-medium";
  if (days < thresholds.red) return "text-red-600 dark:text-red-500 font-medium";
  return "text-yellow-600 dark:text-yellow-500 font-medium";
}

export function formatYmd(ymd: string | null): string {
  if (!ymd) return "—";
  return ymdToDateForPicker(ymd).toLocaleDateString();
}
