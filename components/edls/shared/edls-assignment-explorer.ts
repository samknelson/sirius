import { z } from "zod";
import { getCommStatusBucket } from "../../../shared/commStatus";
import { calendarDateSchema } from "../../../shared/calendar-date";
export { calendarDateSchema } from "../../../shared/calendar-date";

export const acceptedOptions = { all: "All", yes: "Yes", no: "No", unanswered: "No Answer" } as const;
export const notifiedOptions = {
  all: "All", sent: "Sent", failed: "Failed", pending: "Pending/unconfirmed", none: "Not Notified",
} as const;
export const populationOptions = { all: "All", yes: "Yes", no: "No" } as const;
export const assignmentSheetStatusLabels: Record<string, string> = {
  draft: "Draft", request: "Requested", lock: "Scheduled", reserved: "Reserved", trash: "Trash",
};

export const assignmentExplorerQuerySchema = z.object({
  ymd: calendarDateSchema,
  accepted: z.enum(["all", "yes", "no", "unanswered"]).default("all"),
  notified: z.enum(["all", "sent", "failed", "pending", "none"]).default("all"),
  population: z.enum(["all", "yes", "no"]).default("all"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type AssignmentExplorerQuery = z.infer<typeof assignmentExplorerQuerySchema>;
export type AssignmentNotification = Exclude<keyof typeof notifiedOptions, "all">;

export function assignmentNotification(commId: string | null, status: string | null): AssignmentNotification {
  if (!commId) return "none";
  const bucket = getCommStatusBucket(status);
  return bucket === "success" ? "sent" : bucket === "error" ? "failed" : "pending";
}

export interface AssignmentExplorerRow {
  id: string;
  ymd: string;
  workerId: string;
  workerName: string;
  workerIdentifier: number | null;
  sheetId: string;
  sheetTitle: string;
  sheetStatus: string;
  crewTitle: string;
  taskName: string | null;
  startTime: string;
  accepted: boolean | null;
  commId: string | null;
  commStatus: string | null;
  notified: AssignmentNotification;
  inPopulation: boolean;
}
export interface AssignmentExplorerResult {
  rows: AssignmentExplorerRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface AssignmentStatusCounts {
  total: number;
  accepted: Record<"yes" | "no" | "unanswered", number>;
  notified: Record<AssignmentNotification, number>;
  population: Record<"yes" | "no", number>;
}

export function assignmentExplorerUrl(ymd: string, filters: Partial<AssignmentExplorerQuery> = {}): string {
  const params = new URLSearchParams({ ymd });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "all" && key !== "ymd") params.set(key, String(value));
  }
  return `/edls/assignments?${params}`;
}
