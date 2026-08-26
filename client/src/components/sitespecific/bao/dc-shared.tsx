import { Badge } from "@/components/ui/badge";
import type { BaoDcCaseStatus } from "@shared/schema";

export const DC_STATUS_LABELS: Record<BaoDcCaseStatus, string> = {
  draft: "Draft",
  ready_for_review: "Ready for review",
  in_queue: "In queue",
  approved: "Approved",
  denied: "Denied",
  withdrawn: "Withdrawn",
  void: "Void",
};

const STATUS_CLASSES: Record<BaoDcCaseStatus, string> = {
  draft: "bg-muted text-foreground border-transparent",
  ready_for_review:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-transparent",
  in_queue:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-transparent",
  approved:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-transparent",
  denied: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-transparent",
  withdrawn: "bg-muted text-muted-foreground border-transparent",
  void: "bg-muted text-muted-foreground border-transparent",
};

export function DcStatusBadge({ status }: { status: BaoDcCaseStatus }) {
  return (
    <Badge className={STATUS_CLASSES[status]} data-testid={`badge-dc-status-${status}`}>
      {DC_STATUS_LABELS[status]}
    </Badge>
  );
}

export const DC_DOC_TYPE_LABELS: Record<string, string> = {
  dc_form: "DC form",
  doctor_note: "Doctor's note",
  wsr: "WSR",
  employer_accommodation_letter: "Employer accommodation letter",
  denial_letter: "Denial letter",
  other: "Other",
};

export function formatYmd(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${m}/${d}/${y}`;
}
