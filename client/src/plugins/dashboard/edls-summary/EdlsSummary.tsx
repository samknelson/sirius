import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EditableDate } from "@/components/ui/editable-date";
import {
  BellOff,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CircleX,
  Clock3,
  Loader2,
  Send,
  ThumbsDown,
  ThumbsUp,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { Link } from "wouter";
import type { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";
import { getTodayYmd, addDaysYmd } from "@shared/utils/date";
import { assignmentExplorerUrl, type AssignmentStatusCounts } from "@shared/edls-assignment-explorer";

interface EdlsSummaryData {
  memberStatuses: string[];
  grid: Record<string, Record<string, number>>;
  demand: Record<string, number>;
  unassigned: Record<string, number>;
  unassignedTotal: number;
  assignmentStatus: AssignmentStatusCounts;
}

// Non-reserved statuses render before the Total column; Reserved is
// informational only, rendered after Total and excluded from all totals.
const mainStatusColumns = [
  { key: "draft", label: "Draft" },
  { key: "request", label: "Requested" },
  { key: "lock", label: "Scheduled" },
];
const reservedColumn = { key: "reserved", label: "Reserved" };

const statusHeaderColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  request: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  reserved: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  lock: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

export function EdlsSummary(_props: DashboardPluginProps) {
  const [selectedDate, setSelectedDate] = useState(getTodayYmd());

  const { data, isLoading, isError } = useDashboardContent<EdlsSummaryData>(
    "edls-summary",
    { params: { ymd: selectedDate } },
  );

  const hasDemand = !!data && Object.keys(data.demand ?? {}).length > 0;
  const hasUnassigned = !!data && Object.keys(data.unassigned ?? {}).length > 0;
  const hasData = (data && data.memberStatuses.length > 0) || hasDemand || hasUnassigned;
  const isToday = selectedDate === getTodayYmd();

  const columnTotals: Record<string, number> = {};
  if (hasData) {
    for (const col of [...mainStatusColumns, reservedColumn]) {
      columnTotals[col.key] = data.memberStatuses.reduce(
        (sum, ms) => sum + (data.grid[ms]?.[col.key] || 0),
        0,
      );
    }
  }
  // Grand total excludes reserved: Draft + Requested + Scheduled only.
  const grandTotal = mainStatusColumns.reduce(
    (sum, col) => sum + (columnTotals[col.key] || 0),
    0,
  );

  // Total Demand: slot counts per sheet status; reserved is always N/A and
  // excluded from the demand total.
  const demandTotal = mainStatusColumns.reduce(
    (sum, col) => sum + (data?.demand?.[col.key] || 0),
    0,
  );

  // Variance: non-reserved demand minus non-reserved assigned total.
  const variance = demandTotal - grandTotal;

  return (
    <Card className="min-w-0" data-testid="card-edls-summary">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2" data-testid="title-edls-summary">
            <CalendarDays className="h-5 w-5" />
            EDLS Daily Summary
          </CardTitle>
          <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setSelectedDate(addDaysYmd(selectedDate, -1))}
              data-testid="button-edls-prev-day"
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <EditableDate
              value={selectedDate}
              onChange={setSelectedDate}
              compact
              testId="input-edls-date"
              label="Select summary date"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setSelectedDate(addDaysYmd(selectedDate, 1))}
              data-testid="button-edls-next-day"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant={isToday ? "default" : "outline"}
              size="sm"
              className="h-8 w-16 shrink-0 px-0 text-xs"
              onClick={() => setSelectedDate(getTodayYmd())}
              data-testid="button-edls-today"
              aria-label={isToday ? "Today, current date selected" : "Go to today"}
              aria-pressed={isToday}
            >
              Today
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-6">
        <section className="min-w-0" aria-label="Sheets">
          <h2 className="mb-3 text-base font-semibold" data-testid="title-edls-sheets">Sheets</h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-8" data-testid="loading-edls-summary">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError && !data ? (
          <p className="text-sm text-destructive py-4" data-testid="error-edls-summary">
            Unable to load EDLS summary data.
          </p>
        ) : !hasData ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="empty-edls-summary">
            <p className="text-sm">No assignments found for this date.</p>
          </div>
        ) : (
          <div className="overflow-x-auto" data-testid="table-edls-summary">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-sm border-b bg-muted/50">
                    Member Status
                  </th>
                  {mainStatusColumns.map((col) => (
                    <th
                      key={col.key}
                      className={`text-center px-4 py-2 font-medium text-sm border-b ${statusHeaderColors[col.key]}`}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="text-center px-4 py-2 font-semibold text-sm border-b">
                    Total
                  </th>
                  <th
                    className={`text-center px-4 py-2 font-medium text-sm border-b ${statusHeaderColors[reservedColumn.key]}`}
                  >
                    {reservedColumn.label}
                  </th>
                  <th className="text-center px-4 py-2 font-medium text-sm border-b bg-muted text-muted-foreground">
                    Unassigned
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.memberStatuses.map((ms, idx) => {
                  const rowTotal = mainStatusColumns.reduce(
                    (sum, col) => sum + (data.grid[ms]?.[col.key] || 0),
                    0,
                  );
                  const reservedVal = data.grid[ms]?.[reservedColumn.key] || 0;
                  return (
                    <tr
                      key={ms}
                      className={idx % 2 === 0 ? "bg-background" : "bg-muted/30"}
                      data-testid={`row-edls-ms-${ms.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <td className="px-4 py-2 text-sm font-medium border-b">{ms}</td>
                      {mainStatusColumns.map((col) => {
                        const val = data.grid[ms]?.[col.key] || 0;
                        return (
                          <td
                            key={col.key}
                            className="text-center px-4 py-2 text-sm tabular-nums border-b"
                          >
                            {val > 0 ? val : <span className="text-muted-foreground">—</span>}
                          </td>
                        );
                      })}
                      <td className="text-center px-4 py-2 text-sm font-semibold tabular-nums border-b bg-muted/50">
                        {rowTotal}
                      </td>
                      <td className="text-center px-4 py-2 text-sm tabular-nums border-b">
                        {reservedVal > 0 ? reservedVal : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td
                        className="text-center px-4 py-2 text-sm tabular-nums border-b"
                        data-testid={`cell-edls-unassigned-${ms.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {(data.unassigned?.[ms] || 0) > 0 ? (
                          data.unassigned[ms]
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/70 font-semibold">
                  <td className="px-4 py-2 text-sm border-t">Total</td>
                  {mainStatusColumns.map((col) => (
                    <td key={col.key} className="text-center px-4 py-2 text-sm tabular-nums border-t">
                      {columnTotals[col.key] || 0}
                    </td>
                  ))}
                  <td className="text-center px-4 py-2 text-sm tabular-nums border-t font-bold">
                    {grandTotal}
                  </td>
                  <td
                    className="text-center px-4 py-2 text-sm tabular-nums border-t"
                    data-testid="cell-edls-total-reserved"
                  >
                    {columnTotals[reservedColumn.key] || 0}
                  </td>
                  <td
                    className="text-center px-4 py-2 text-sm tabular-nums border-t"
                    data-testid="cell-edls-unassigned-total"
                  >
                    {data?.unassignedTotal ?? 0}
                  </td>
                </tr>
                <tr className="bg-muted/40 font-medium" data-testid="row-edls-total-demand">
                  <td className="px-4 py-2 text-sm border-t">Total Demand</td>
                  {mainStatusColumns.map((col) => (
                    <td
                      key={col.key}
                      className="text-center px-4 py-2 text-sm tabular-nums border-t"
                      data-testid={`cell-edls-demand-${col.key}`}
                    >
                      {data?.demand?.[col.key] || 0}
                    </td>
                  ))}
                  <td
                    className="text-center px-4 py-2 text-sm tabular-nums border-t font-semibold"
                    data-testid="cell-edls-demand-total"
                  >
                    {demandTotal}
                  </td>
                  <td
                    className="text-center px-4 py-2 text-sm border-t"
                    data-testid="cell-edls-demand-reserved"
                  >
                    <span className="text-muted-foreground">N/A</span>
                  </td>
                  <td
                    className="text-center px-4 py-2 text-sm border-t"
                    data-testid="cell-edls-demand-unassigned"
                  >
                    <span className="text-muted-foreground">N/A</span>
                  </td>
                </tr>
                <tr className="bg-muted/40 font-medium" data-testid="row-edls-variance">
                  <td className="px-4 py-2 text-sm border-t">Variance</td>
                  {mainStatusColumns.map((col) => (
                    <td key={col.key} className="px-4 py-2 border-t" />
                  ))}
                  <td
                    className="text-center px-4 py-2 text-sm tabular-nums border-t font-semibold"
                    data-testid="cell-edls-variance-total"
                  >
                    {variance}
                  </td>
                  <td className="px-4 py-2 border-t" />
                  <td className="px-4 py-2 border-t" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        </section>
        <section className="min-w-0 border-t pt-6" aria-label="Assignments" data-testid="card-edls-assignment-status">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold" data-testid="title-edls-assignment-status">Assignments</h2>
            {data?.assignmentStatus && (
              <Link href={assignmentExplorerUrl(selectedDate)} className="inline-flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium hover:bg-muted">
                <span className="text-muted-foreground">All assignments</span>
                <span className="tabular-nums">{data.assignmentStatus.total}</span>
              </Link>
            )}
          </div>
          {!data?.assignmentStatus ? (
            isLoading ? <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
              : isError && !data ? <p className="text-sm text-destructive">Assignment status counts are unavailable.</p>
              : <p className="text-sm text-muted-foreground">No assignment status counts returned for this date.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              <AssignmentCountGroup title="Accepted?" rows={[
                ["Yes", data.assignmentStatus.accepted.yes, { accepted: "yes" }],
                ["No", data.assignmentStatus.accepted.no, { accepted: "no" }],
                ["No answer", data.assignmentStatus.accepted.unanswered, { accepted: "unanswered" }],
              ]} date={selectedDate} />
              <AssignmentCountGroup title="Notified?" rows={[
                ["Sent", data.assignmentStatus.notified.sent, { notified: "sent" }],
                ["Failed", data.assignmentStatus.notified.failed, { notified: "failed" }],
                ["Pending / unconfirmed", data.assignmentStatus.notified.pending, { notified: "pending" }],
                ["Not notified", data.assignmentStatus.notified.none, { notified: "none" }],
              ]} date={selectedDate} />
              <AssignmentCountGroup title="In population?" rows={[
                ["Yes", data.assignmentStatus.population.yes, { population: "yes" }],
                ["No", data.assignmentStatus.population.no, { population: "no" }],
              ]} date={selectedDate} />
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function AssignmentCountGroup({ title, rows, date }: {
  title: string;
  rows: [string, number, { accepted?: "yes" | "no" | "unanswered"; notified?: "sent" | "failed" | "pending" | "none"; population?: "yes" | "no" }][];
  date: string;
}) {
  const statusIcons = {
    accepted: {
      yes: ThumbsUp,
      no: ThumbsDown,
      unanswered: CircleHelp,
    },
    notified: {
      sent: Send,
      failed: CircleX,
      pending: Clock3,
      none: BellOff,
    },
    population: {
      yes: UserRoundCheck,
      no: UserRoundX,
    },
  };

  const getStatusIcon = (filter: (typeof rows)[number][2]) => {
    if (filter.accepted) return statusIcons.accepted[filter.accepted];
    if (filter.notified) return statusIcons.notified[filter.notified];
    if (filter.population) return statusIcons.population[filter.population];
    return CircleHelp;
  };

  return <section className="rounded-md border bg-muted/20 p-3" aria-label={title}>
    <h3 className="mb-2 text-sm font-semibold">{title}</h3>
    <div className="space-y-1">
      {rows.map(([label, count, filter]) => (
        <Link key={label} href={assignmentExplorerUrl(date, filter)} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-background">
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            {(() => {
              const StatusIcon = getStatusIcon(filter);
              return <StatusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />;
            })()}
            <span>{label}</span>
          </span>
          <span className="font-semibold tabular-nums">{count}</span>
        </Link>
      ))}
    </div>
  </section>;
}
