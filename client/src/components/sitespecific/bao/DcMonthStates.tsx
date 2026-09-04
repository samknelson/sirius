import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DcCaseMonthState, DcMonthHistoryEntry } from "@shared/sitespecific/bao/dc-reporting";
import {
  DcMonthLabel,
  DcMonthStatusBadge,
  formatDcHoursLabel,
  formatYmdMonthShort,
} from "./dc-shared";

/**
 * Per-month state for a case after (and before) approval: coverage month
 * first, the work month that receives the hours second, then what the
 * month is doing now — granted with its hours, queued for a coverage month
 * still ahead of the release window, or removed with the reason and the
 * hours it previously carried.
 */
export function DcMonthStatesTable({
  states,
  emptyText = "No months on this case.",
  testIdPrefix = "dc-month-state",
}: {
  states: DcCaseMonthState[];
  emptyText?: string;
  testIdPrefix?: string;
}) {
  if (states.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={`text-${testIdPrefix}-empty`}>
        {emptyText}
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Coverage month</TableHead>
          <TableHead>Hours credited to</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {states.map((m) => (
          <TableRow key={m.id} data-testid={`row-${testIdPrefix}-${m.workMonthYmd.slice(0, 7)}`}>
            <TableCell className="font-medium">
              {m.coverageMonthYmd ? formatYmdMonthShort(m.coverageMonthYmd) : "Unresolved"}
            </TableCell>
            <TableCell>{formatYmdMonthShort(m.workMonthYmd)}</TableCell>
            <TableCell>
              <DcMonthStatusBadge status={m.status} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              <DcMonthStateDetail state={m} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DcMonthStateDetail({ state: m }: { state: DcCaseMonthState }) {
  switch (m.status) {
    case "granted":
      return (
        <span data-testid={`text-dc-month-detail-${m.workMonthYmd.slice(0, 7)}`}>
          {formatDcHoursLabel(m.grantedHours)} Disability Credit hours
          {m.threshold !== null && m.qualifyingHoursAtGrant !== null
            ? ` (${formatDcHoursLabel(m.qualifyingHoursAtGrant)} reported of the ${formatDcHoursLabel(m.threshold)} minimum)`
            : ""}
          {m.via === "release" ? " — released from the queue" : ""}
        </span>
      );
    case "queued":
      return (
        <span data-testid={`text-dc-month-detail-${m.workMonthYmd.slice(0, 7)}`}>
          Waiting for {m.coverageMonthYmd ? formatYmdMonthShort(m.coverageMonthYmd) : "its coverage month"} to
          enter the release window
          {m.threshold !== null ? ` (minimum ${formatDcHoursLabel(m.threshold)})` : ""}
        </span>
      );
    case "removed":
      return (
        <span data-testid={`text-dc-month-detail-${m.workMonthYmd.slice(0, 7)}`}>
          {m.voidReason ?? "Removed"}
          {m.previousHours !== null && m.previousHours > 0
            ? ` — previously carried ${formatDcHoursLabel(m.previousHours)}`
            : ""}
          {" — no annual month consumed"}
        </span>
      );
    default:
      return (
        <span data-testid={`text-dc-month-detail-${m.workMonthYmd.slice(0, 7)}`}>
          Selected — granted or queued at approval
        </span>
      );
  }
}

const HISTORY_LABELS: Record<string, string> = {
  case_month_added: "Selected",
  case_month_queued: "Queued",
  case_month_granted: "Granted",
  case_month_released: "Released from queue",
  case_month_reconciled: "Reconciled",
  case_month_voided: "Voided",
};

function historyLabel(entry: DcMonthHistoryEntry): string {
  if (entry.eventType === "case_month_reconciled" && entry.removed) return "Reconciled away";
  if (entry.eventType === "case_month_voided" && entry.reason === "no_shortfall") {
    return "Voided — no shortfall";
  }
  if (entry.eventType === "case_month_voided") return "Deselected";
  return HISTORY_LABELS[entry.eventType] ?? entry.eventType;
}

function formatAt(at: string | Date): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? String(at) : d.toLocaleString();
}

/**
 * The immutable auto-generated month log: every grant / queue / release /
 * reconcile / void event in order, with the DC hours before and after,
 * the reason and the actor where one was recorded.
 */
export function DcMonthHistoryList({
  history,
  actorNames,
}: {
  history: DcMonthHistoryEntry[];
  actorNames: Record<string, string>;
}) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-dc-month-history-empty">
        No month activity yet.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Month</TableHead>
          <TableHead>Hours before → after</TableHead>
          <TableHead>Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.map((e) => (
          <TableRow key={e.id} data-testid={`row-dc-month-history-${e.eventType}`}>
            <TableCell className="whitespace-nowrap text-sm">{formatAt(e.at)}</TableCell>
            <TableCell className="text-sm font-medium">{historyLabel(e)}</TableCell>
            <TableCell className="text-sm">
              {e.workMonthYmd ? (
                <>
                  <DcMonthLabel workMonthYmd={e.workMonthYmd} coverageMonthYmd={e.coverageMonthYmd} />
                  {e.coverageSource === "live" ? (
                    // Only entries written before snapshots existed are
                    // derived from the CURRENT plan lag — say so.
                    <span
                      className="block text-xs text-muted-foreground"
                      data-testid={`text-dc-month-history-derived-${e.id}`}
                    >
                      coverage month derived from the current plan lag (entry predates snapshots)
                    </span>
                  ) : null}
                </>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="text-sm whitespace-nowrap">
              {e.hoursBefore === null && e.hoursAfter === null
                ? "—"
                : `${formatDcHoursLabel(e.hoursBefore)} → ${formatDcHoursLabel(e.hoursAfter)}`}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {[
                e.reason && e.reason !== "no_shortfall" ? `Reason: ${e.reason}` : null,
                e.reason === "no_shortfall"
                  ? "Qualifying hours already met the minimum — no annual month consumed"
                  : null,
                e.eventType === "case_month_reconciled"
                  ? e.removed
                    ? "Later employer hours reached the minimum — month restored, no annual month consumed"
                    : "Later employer hours reduced the credit"
                  : null,
                e.actorUserId ? `by ${actorNames[e.actorUserId] ?? e.actorUserId}` : "automatic",
              ]
                .filter(Boolean)
                .join(" · ")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
