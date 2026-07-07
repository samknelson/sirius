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
import { GrievanceLayout, useGrievanceLayout } from "@/components/layouts/GrievanceLayout";
import type { GrievanceTimelineTemplateStep, OptionsGrievanceStep } from "@shared/schema";
import {
  type GrievanceTimelineStepItem,
  type DeadlineThresholds,
  useDeadlineThresholds,
  deadlineColorClass,
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
}

function buildRows(
  computed: GrievanceTimelineStepItem[],
  templateSteps: GrievanceTimelineTemplateStep[],
  stepOptions: OptionsGrievanceStep[],
): TimelineRow[] {
  const optionById = new Map(stepOptions.map((o) => [o.id, o]));
  const remaining = [...computed];

  const takeComputed = (stepId: string): GrievanceTimelineStepItem | undefined => {
    const idx = remaining.findIndex((c) => c.stepId === stepId);
    if (idx === -1) return undefined;
    return remaining.splice(idx, 1)[0];
  };

  const rows: TimelineRow[] = [];
  const ordered = [...templateSteps].sort(
    (a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id),
  );

  for (const ts of ordered) {
    const match = takeComputed(ts.stepId);
    if (match) {
      rows.push({
        key: match.id,
        stepName: match.stepName,
        stepActor: match.stepActor,
        startedYmd: match.startedYmd,
        dueYmd: match.dueYmd,
        completedYmd: match.completedYmd,
        isCurrent: match.isCurrent,
        pending: false,
      });
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
      });
    }
  }

  // Any computed rows not matched to a template step (e.g. the template was
  // edited after the steps were computed) still get shown, at the end.
  for (const c of remaining) {
    rows.push({
      key: c.id,
      stepName: c.stepName,
      stepActor: c.stepActor,
      startedYmd: c.startedYmd,
      dueYmd: c.dueYmd,
      completedYmd: c.completedYmd,
      isCurrent: c.isCurrent,
      pending: false,
    });
  }

  return rows;
}

function rowStatus(row: TimelineRow): { label: string; variant: "default" | "secondary" | "outline" } {
  if (row.pending) return { label: "Not yet started", variant: "outline" };
  if (row.completedYmd) return { label: "Completed", variant: "secondary" };
  if (row.isCurrent) return { label: "Current", variant: "default" };
  if (row.startedYmd) return { label: "In progress", variant: "secondary" };
  return { label: "Not yet started", variant: "outline" };
}

function DeadlineCell({ row, thresholds }: { row: TimelineRow; thresholds: DeadlineThresholds }) {
  if (!row.dueYmd) return <span className="text-muted-foreground">—</span>;
  // Completed steps get no urgency coloring — the deadline no longer matters.
  if (row.completedYmd) return <span>{formatYmd(row.dueYmd)}</span>;
  return <span className={deadlineColorClass(row.dueYmd, thresholds)}>{formatYmd(row.dueYmd)}</span>;
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
  const thresholds = useDeadlineThresholds();

  if (stepsLoading || (!!timelineTemplateId && templateLoading)) {
    return <Skeleton className="h-24 w-full" data-testid="skeleton-timeline-steps" />;
  }

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
          <TableHead>Step</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Deadline</TableHead>
          <TableHead>Completed</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const status = rowStatus(row);
          return (
            <TableRow
              key={row.key}
              className={row.pending ? "text-muted-foreground" : undefined}
              data-testid={`row-timeline-step-${row.key}`}
            >
              <TableCell className="font-medium" data-testid={`text-step-name-${row.key}`}>
                {row.stepName ?? "Unknown step"}
              </TableCell>
              <TableCell>{row.stepActor ?? "—"}</TableCell>
              <TableCell>{formatYmd(row.startedYmd)}</TableCell>
              <TableCell data-testid={`text-step-deadline-${row.key}`}>
                <DeadlineCell row={row} thresholds={thresholds} />
              </TableCell>
              <TableCell>{formatYmd(row.completedYmd)}</TableCell>
              <TableCell>
                <Badge variant={status.variant} data-testid={`badge-step-status-${row.key}`}>
                  {status.label}
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
    <GrievanceLayout activeTab="timeline">
      <GrievanceTimelineContent />
    </GrievanceLayout>
  );
}
