import { useQuery } from "@tanstack/react-query";
import { ymdToDateForPicker } from "@shared/utils/date";
import type { GrievanceStepsDenorm } from "@shared/schema";

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

export function useDeadlineThresholds(): DeadlineThresholds {
  const { data } = useQuery<DeadlineThresholds>({
    queryKey: ["/api/config/grievances/deadline-thresholds"],
    staleTime: 5 * 60 * 1000,
  });
  return data ?? DEFAULT_DEADLINE_THRESHOLDS;
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
