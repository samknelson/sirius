import { formatYmd } from "../../../shared/utils/date";

export const EDLS_REVIEW_NOTICE =
  "The assignment for this day is being reviewed. This page will be updated when the assignment is final.";

/** Only the fields the worker's schedule publishes, never the full staff row. */
export interface WorkerAssignmentDetails {
  ymd: string;
  sheetTitle: string;
  crewTitle: string;
  startTime: string | null;
  location: string | null;
  jobGroup: { name: string } | null;
  showStatus: { name: string } | null;
  department: { name: string } | null;
  facility: { name: string } | null;
  task: { name: string } | null;
  classification?: { name: string; code: string | null } | null;
  accepted?: boolean | null;
  data: Record<string, unknown> | null;
}

export function workerAssignmentStartTime(assignment: Pick<WorkerAssignmentDetails, "data" | "startTime">): string {
  const override = assignment.data?.startTime;
  const time = (typeof override === "string" ? override : null) || assignment.startTime;
  if (!time) return "";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours, 10);
  if (Number.isNaN(hour)) return "";
  return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? "PM" : "AM"}`;
}

/** Shared with the page so SMS labels, optional fields and overrides stay aligned. */
export function workerAssignmentFields(assignment: WorkerAssignmentDetails) {
  return [
    { label: "Event", value: assignment.jobGroup?.name ?? "", testId: "text-event" },
    { label: "Event Status", value: assignment.showStatus?.name ?? "", testId: "text-event-status" },
    { label: "Department", value: assignment.department?.name ?? "", testId: "text-department" },
    { label: "Job #", value: assignment.sheetTitle ?? "", testId: "text-job-number" },
    { label: "Facility", value: assignment.facility?.name ?? "", testId: "text-facility" },
    { label: "Crew", value: assignment.crewTitle ?? "", testId: "text-crew" },
    { label: "Task", value: assignment.task?.name ?? "", testId: "text-task" },
    ...(assignment.classification ? [{
      label: "Classification",
      value: assignment.classification.code || assignment.classification.name,
      testId: "text-classification",
    }] : []),
    { label: "Start Time", value: workerAssignmentStartTime(assignment), testId: "text-start-time" },
    { label: "Checkin Location", value: assignment.location ?? "", testId: "text-checkin-location" },
  ];
}

type SmsAssignment = { ymd: string; sheetStatus: string } & Partial<WorkerAssignmentDetails> & {
  revision?: number | null; updatedAt?: string | null;
};

export function renderWorkerAssignmentSms(assignment: SmsAssignment): string {
  // The leading line break separates this block from the template's intro.
  // Keep spacing in the token value so delivery and Studio previews agree.
  const date = `\n=== ${formatYmd(assignment.ymd, "full-weekday-short-month").toUpperCase()} ===\n`;
  if (assignment.sheetStatus === "draft" || assignment.sheetStatus === "request") {
    return `${date}\n${EDLS_REVIEW_NOTICE}`;
  }
  if (assignment.sheetStatus !== "lock" && assignment.sheetStatus !== "reserved") {
    return `${date}\nThis assignment is not currently published. Please check your current schedule.`;
  }
  const details = assignment as SmsAssignment & WorkerAssignmentDetails;
  return [
    date,
    ...workerAssignmentFields(details).map(({ label, value }) => `${label}: ${value}`),
  ].join("\n");
}
