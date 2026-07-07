import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GrievanceLayout, useGrievanceLayout } from "@/components/layouts/GrievanceLayout";
import type { GrievanceStepsDenorm } from "@shared/schema";
import { ymdToDateForPicker } from "@shared/utils/date";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";

interface TimelineStepItem extends GrievanceStepsDenorm {
  stepName: string | null;
  stepActor: string | null;
}

function formatYmd(ymd: string | null): string {
  if (!ymd) return "—";
  return ymdToDateForPicker(ymd).toLocaleDateString();
}

function TimelineSteps({ grievanceId }: { grievanceId: string }) {
  const { data: steps, isLoading } = useQuery<TimelineStepItem[]>({
    queryKey: ["/api/grievances", grievanceId, "timeline-steps"],
  });

  if (isLoading) {
    return <Skeleton className="h-24 w-full" data-testid="skeleton-timeline-steps" />;
  }

  if (!steps || steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-no-timeline-steps">
        No timeline steps yet. Steps appear automatically as the grievance moves
        through statuses on its timeline template. The template can be chosen on
        the Status History tab.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {steps.map((step) => {
        const completed = !!step.completedYmd;
        const Icon = completed ? CheckCircle2 : step.isCurrent ? CircleDot : Circle;
        return (
          <div
            key={step.id}
            className="flex items-start gap-3 rounded-md border p-3"
            data-testid={`row-timeline-step-${step.id}`}
          >
            <Icon
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                completed
                  ? "text-green-600 dark:text-green-500"
                  : step.isCurrent
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-muted-foreground"
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium" data-testid={`text-step-name-${step.id}`}>
                  {step.stepName ?? "Unknown step"}
                </span>
                {step.stepActor && (
                  <span className="text-sm text-muted-foreground">{step.stepActor}</span>
                )}
                {step.isCurrent && (
                  <Badge data-testid={`badge-current-step-${step.id}`}>Current</Badge>
                )}
              </div>
              <div
                className="mt-1 flex flex-wrap gap-x-4 text-sm text-muted-foreground"
                data-testid={`text-step-dates-${step.id}`}
              >
                <span>Started: {formatYmd(step.startedYmd)}</span>
                <span>Due: {formatYmd(step.dueYmd)}</span>
                <span>Completed: {formatYmd(step.completedYmd)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
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
        <TimelineSteps grievanceId={grievance.id} />
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
