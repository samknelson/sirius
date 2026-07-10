import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalendarClock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GrievanceLayout, useGrievanceLayout } from "@/components/layouts/GrievanceLayout";
import type {
  GrievanceTimelineAdjustment,
  GrievanceTimelineTemplateStep,
  OptionsGrievanceStep,
  OptionsGrievanceStatus,
} from "@shared/schema";
import { grievanceTimelineAdjustmentSchema } from "@shared/schema";
import {
  type GrievanceTimelineStepItem,
  type DeadlineThresholds,
  useDeadlineThresholds,
  deadlineColorClass,
  daysUntilYmd,
  daysBetweenYmd,
  formatYmd,
} from "@/lib/grievance-deadlines";

/** One display row: either a computed denorm step or a not-yet-started template step. */
interface TimelineRow {
  key: string;
  stepName: string | null;
  stepActor: string | null;
  startedYmd: string | null;
  dueYmd: string | null;
  completedYmd: string | null;
  isCurrent: boolean;
  pending: boolean;
  adjustment: GrievanceTimelineAdjustment | null;
  originalDueYmd: string | null;
  startStatusId: string | null;
  completeStatusId: string | null;
}

/** Read the adjustment info the denorm plugin recorded in the row's `data` json. */
function readRowAdjustment(data: unknown): {
  adjustment: GrievanceTimelineAdjustment | null;
  originalDueYmd: string | null;
} {
  if (!data || typeof data !== "object") return { adjustment: null, originalDueYmd: null };
  const d = data as Record<string, unknown>;
  const parsed = grievanceTimelineAdjustmentSchema.safeParse(d.adjustment);
  if (!parsed.success) return { adjustment: null, originalDueYmd: null };
  return {
    adjustment: parsed.data,
    originalDueYmd: typeof d.originalDueYmd === "string" ? d.originalDueYmd : null,
  };
}

/** Read the start/complete status ids the denorm plugin recorded in `data`. */
function readRowStatusIds(data: unknown): {
  startStatusId: string | null;
  completeStatusId: string | null;
} {
  if (!data || typeof data !== "object") {
    return { startStatusId: null, completeStatusId: null };
  }
  const d = data as Record<string, unknown>;
  return {
    startStatusId: typeof d.startStatusId === "string" ? d.startStatusId : null,
    completeStatusId: typeof d.completeStatusId === "string" ? d.completeStatusId : null,
  };
}

/** Human-readable description of a timeline adjustment. */
function describeAdjustment(adj: GrievanceTimelineAdjustment): string {
  if (adj.kind === "relative") {
    const abs = Math.abs(adj.days);
    return `Deadline ${adj.days > 0 ? "extended" : "shortened"} by ${abs} day${abs === 1 ? "" : "s"}`;
  }
  return `Deadline set to ${formatYmd(adj.date)}`;
}

function buildRows(
  computed: GrievanceTimelineStepItem[],
  templateSteps: GrievanceTimelineTemplateStep[],
  stepOptions: OptionsGrievanceStep[],
): TimelineRow[] {
  const optionById = new Map(stepOptions.map((o) => [o.id, o]));

  const toRow = (c: GrievanceTimelineStepItem): TimelineRow => {
    const adj = readRowAdjustment(c.data);
    const statusIds = readRowStatusIds(c.data);
    return {
      key: c.id,
      stepName: c.stepName,
      stepActor: c.stepActor,
      startedYmd: c.startedYmd,
      dueYmd: c.dueYmd,
      completedYmd: c.completedYmd,
      isCurrent: c.isCurrent,
      pending: false,
      adjustment: adj.adjustment,
      originalDueYmd: adj.originalDueYmd,
      startStatusId: statusIds.startStatusId,
      completeStatusId: statusIds.completeStatusId,
    };
  };

  // A step can occur more than once (started, completed, started again), so
  // group every computed row by its step and render each occurrence.
  const byStep = new Map<string, GrievanceTimelineStepItem[]>();
  for (const c of computed) {
    const list = byStep.get(c.stepId);
    if (list) list.push(c);
    else byStep.set(c.stepId, [c]);
  }

  // Occurrences of the same step are shown in chronological (start-date) order.
  const byStart = (a: GrievanceTimelineStepItem, b: GrievanceTimelineStepItem) => {
    const sa = a.startedYmd ?? "";
    const sb = b.startedYmd ?? "";
    return sa < sb ? -1 : sa > sb ? 1 : a.id.localeCompare(b.id);
  };

  const rows: TimelineRow[] = [];
  const usedStepIds = new Set<string>();
  const ordered = [...templateSteps].sort(
    (a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id),
  );

  for (const ts of ordered) {
    const matches = byStep.get(ts.stepId);
    if (matches && matches.length > 0) {
      usedStepIds.add(ts.stepId);
      for (const m of [...matches].sort(byStart)) rows.push(toRow(m));
    } else {
      const option = optionById.get(ts.stepId);
      rows.push({
        key: `template-${ts.id}`,
        stepName: option?.name ?? "Unknown step",
        stepActor: option?.actor ?? null,
        startedYmd: null,
        dueYmd: null,
        completedYmd: null,
        isCurrent: false,
        pending: true,
        adjustment: null,
        originalDueYmd: null,
        startStatusId: null,
        completeStatusId: null,
      });
    }
  }

  // Any computed rows whose step is not in the template (e.g. the template was
  // edited after the steps were computed) still get shown, at the end.
  for (const c of computed) {
    if (usedStepIds.has(c.stepId)) continue;
    rows.push(toRow(c));
  }

  return rows;
}

const RESULT_BADGE_CLASS = {
  ok: "border-transparent bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  red: "border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  pending:
    "border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
} as const;

function daysLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * The step's outcome for the "Result" column:
 *  - Ok      (green)  — completed on or before its deadline.
 *  - Late    (red)    — completed after its deadline; how many calendar days late.
 *  - Overdue (red)    — not completed and today is past its deadline; how many days over.
 *  - Pending (yellow) — not completed and not past its deadline (incl. not-yet-started).
 */
function rowResult(row: TimelineRow): { label: string; className: string } {
  if (row.completedYmd) {
    const late = row.dueYmd ? daysBetweenYmd(row.dueYmd, row.completedYmd) : 0;
    if (late > 0) {
      return { label: `Late (${daysLabel(late)})`, className: RESULT_BADGE_CLASS.red };
    }
    return { label: "Ok", className: RESULT_BADGE_CLASS.ok };
  }
  if (row.dueYmd) {
    const untilDue = daysUntilYmd(row.dueYmd);
    if (untilDue < 0) {
      return { label: `Overdue (${daysLabel(-untilDue)})`, className: RESULT_BADGE_CLASS.red };
    }
  }
  return { label: "Pending", className: RESULT_BADGE_CLASS.pending };
}

function DeadlineCell({ row, thresholds }: { row: TimelineRow; thresholds: DeadlineThresholds }) {
  if (!row.dueYmd) return <span className="text-muted-foreground">—</span>;
  // Urgency coloring keys to the ADJUSTED due date; completed steps get none.
  const adjustedEl = row.completedYmd ? (
    <span>{formatYmd(row.dueYmd)}</span>
  ) : (
    <span className={deadlineColorClass(row.dueYmd, thresholds)}>{formatYmd(row.dueYmd)}</span>
  );
  if (!row.adjustment) return adjustedEl;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5" data-testid={`deadline-adjusted-${row.key}`}>
          {row.originalDueYmd && row.originalDueYmd !== row.dueYmd && (
            <span className="text-muted-foreground line-through">
              {formatYmd(row.originalDueYmd)}
            </span>
          )}
          {adjustedEl}
          <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{describeAdjustment(row.adjustment)}</TooltipContent>
    </Tooltip>
  );
}

function TimelineTable({
  grievanceId,
  timelineTemplateId,
}: {
  grievanceId: string;
  timelineTemplateId: string | null;
}) {
  const { data: steps, isLoading: stepsLoading } = useQuery<GrievanceTimelineStepItem[]>({
    queryKey: ["/api/grievances", grievanceId, "timeline-steps"],
  });
  const { data: templateSteps, isLoading: templateLoading } = useQuery<
    GrievanceTimelineTemplateStep[]
  >({
    queryKey: ["/api/grievance-timeline-templates", timelineTemplateId, "steps"],
    enabled: !!timelineTemplateId,
  });
  const { data: stepOptions } = useQuery<OptionsGrievanceStep[]>({
    queryKey: ["/api/options/grievance-step"],
    enabled: !!timelineTemplateId,
  });
  const { data: statusOptions } = useQuery<OptionsGrievanceStatus[]>({
    queryKey: ["/api/options/grievance-status"],
  });
  const thresholds = useDeadlineThresholds();

  if (stepsLoading || (!!timelineTemplateId && templateLoading)) {
    return <Skeleton className="h-24 w-full" data-testid="skeleton-timeline-steps" />;
  }

  const statusNameById = new Map(
    (statusOptions ?? []).map((s) => [s.id, s.name]),
  );
  const rows = buildRows(steps ?? [], templateSteps ?? [], stepOptions ?? []);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-no-timeline-steps">
        No timeline steps yet. Steps appear automatically as the grievance moves
        through statuses on its timeline template. The template can be chosen on
        the Status History tab.
      </p>
    );
  }

  return (
    <Table data-testid="table-timeline-steps">
      <TableHeader>
        <TableRow>
          <TableHead>Actor</TableHead>
          <TableHead>Step</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Deadline</TableHead>
          <TableHead>Completed</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const result = rowResult(row);
          return (
            <TableRow
              key={row.key}
              className={row.pending ? "text-muted-foreground" : undefined}
              data-testid={`row-timeline-step-${row.key}`}
            >
              <TableCell>{row.stepActor ?? "—"}</TableCell>
              <TableCell className="font-medium" data-testid={`text-step-name-${row.key}`}>
                {row.stepName ?? "Unknown step"}
              </TableCell>
              <TableCell>
                <div>{formatYmd(row.startedYmd)}</div>
                {row.startStatusId && (
                  <div
                    className="text-xs text-muted-foreground"
                    data-testid={`text-start-status-${row.key}`}
                  >
                    {statusNameById.get(row.startStatusId) ?? "Unknown status"}
                  </div>
                )}
              </TableCell>
              <TableCell data-testid={`text-step-deadline-${row.key}`}>
                <DeadlineCell row={row} thresholds={thresholds} />
              </TableCell>
              <TableCell>
                <div>{formatYmd(row.completedYmd)}</div>
                {row.completeStatusId && (
                  <div
                    className="text-xs text-muted-foreground"
                    data-testid={`text-complete-status-${row.key}`}
                  >
                    {statusNameById.get(row.completeStatusId) ?? "Unknown status"}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Badge className={result.className} data-testid={`badge-step-result-${row.key}`}>
                  {result.label}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function GrievanceTimelineContent() {
  const { grievance } = useGrievanceLayout();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Timeline Steps</CardTitle>
      </CardHeader>
      <CardContent>
        <TimelineTable
          grievanceId={grievance.id}
          timelineTemplateId={grievance.timelineTemplateId ?? null}
        />
      </CardContent>
    </Card>
  );
}

export default function GrievanceTimeline() {
  return (
    <GrievanceLayout activeTab="timeline-view">
      <GrievanceTimelineContent />
    </GrievanceLayout>
  );
}
