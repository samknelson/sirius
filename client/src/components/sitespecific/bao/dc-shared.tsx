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

// ---------------------------------------------------------------------------
// Presentation order is work month first; eligibility remains coverage-based.
// ---------------------------------------------------------------------------

/** "Oct 2026" — short month label for dense tables/badges. */
export function formatYmdMonthShort(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m] = ymd.split("-").map(Number);
  if (!y || !m) return ymd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${y}`;
}

/** Long month, e.g. "October 2026". */
export function formatYmdMonthLong(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m] = ymd.split("-").map(Number);
  if (!y || !m) return ymd;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[m - 1]} ${y}`;
}

/** Sort a copy: never change the stored keys or eligibility ordering. */
export function sortDcMonths<T extends { workMonthYmd: string }>(months: readonly T[]): T[] {
  return [...months].sort((a, b) => a.workMonthYmd.localeCompare(b.workMonthYmd));
}

/** Pass only the current selection for ONE case, never history or annual usage. */
export function numberDcMonths(workMonths: readonly string[]): Map<string, number> {
  return new Map([...new Set(workMonths)].sort().map((month, index) => [month, index + 1]));
}

/** Identical wording for visible pairs and accessible checkbox names. */
export function describeDcMonth(month: {
  workMonthYmd: string;
  coverageMonthYmd: string | null;
}, monthNumber?: number): string {
  const coverage = month.coverageMonthYmd
    ? `${formatYmdMonthLong(month.coverageMonthYmd)} coverage`
    : "coverage unresolved";
  return `${monthNumber === undefined ? "" : `${monthNumber}. `}${formatYmdMonthLong(month.workMonthYmd)} DC → ${coverage}`;
}

export function DcMonthLabel({
  workMonthYmd,
  coverageMonthYmd,
  className,
  monthNumber,
}: {
  workMonthYmd: string;
  coverageMonthYmd: string | null;
  className?: string;
  monthNumber?: number;
}) {
  return (
    <span className={className} data-testid={`text-dc-month-label-${workMonthYmd.slice(0, 7)}`}>
      {describeDcMonth({ workMonthYmd, coverageMonthYmd }, monthNumber)}
    </span>
  );
}

export const DC_MONTH_STATUS_LABELS: Record<string, string> = {
  selected: "Selected",
  queued: "Queued",
  granted: "Granted",
  removed: "Removed",
};

const MONTH_STATUS_CLASSES: Record<string, string> = {
  selected: "bg-muted text-foreground border-transparent",
  queued:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-transparent",
  granted:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-transparent",
  removed: "bg-muted text-muted-foreground border-transparent line-through",
};

export function DcMonthStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={MONTH_STATUS_CLASSES[status] ?? "bg-muted text-foreground border-transparent"}
      data-testid={`badge-dc-month-status-${status}`}
    >
      {DC_MONTH_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function formatDcHoursLabel(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "—";
  const rounded = Math.round(hours * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)} h`;
}

// ---------------------------------------------------------------------------
// Annual maximum — "maxed out" indicator shared by the worker tab and the
// case detail (same derivation as the dashboard's Annual Maximum Reached).
// ---------------------------------------------------------------------------

export type DcAnnualMaxView = {
  year: number;
  used: number;
  limit: number;
  maxedOut: boolean;
  resetsYmd: string;
};

export function DcAnnualMaxBadge({ annualMax }: { annualMax: DcAnnualMaxView | undefined }) {
  if (!annualMax?.maxedOut) return null;
  return (
    <Badge variant="destructive" data-testid="badge-dc-annual-max">
      Annual maximum reached — {annualMax.used} of {annualMax.limit} months used in {annualMax.year};
      resets {formatYmd(annualMax.resetsYmd)}
    </Badge>
  );
}
