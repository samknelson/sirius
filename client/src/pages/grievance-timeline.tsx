import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { GrievanceLayout, useGrievanceLayout } from "@/components/layouts/GrievanceLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GrievanceTimelineTemplate, GrievanceStepsDenorm } from "@shared/schema";
import { ymdToDateForPicker } from "@shared/utils/date";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";

const NONE_VALUE = "__none__";

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
        through statuses on its timeline template.
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
  const { toast } = useToast();
  const currentValue = grievance.timelineTemplateId ?? NONE_VALUE;
  const [selected, setSelected] = useState<string>(currentValue);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSelected(grievance.timelineTemplateId ?? NONE_VALUE);
  }, [grievance.timelineTemplateId]);

  const { data: templates, isLoading } = useQuery<GrievanceTimelineTemplate[]>({
    queryKey: ["/api/grievance-timeline-templates"],
    queryFn: async () =>
      apiRequest("GET", "/api/grievance-timeline-templates") as Promise<
        GrievanceTimelineTemplate[]
      >,
  });

  const isDirty = selected !== currentValue;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiRequest("PATCH", `/api/grievances/${grievance.id}`, {
        timelineTemplateId: selected === NONE_VALUE ? null : selected,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievance.id] });
      // The timeline denorm plugin recomputes steps right after the save
      // commits; refetch so the steps card above reflects the new template.
      await queryClient.invalidateQueries({
        queryKey: ["/api/grievances", grievance.id, "timeline-steps"],
      });
      toast({ title: "Timeline template updated" });
    } catch (error: any) {
      toast({
        title: "Failed to update timeline template",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <TimelineSteps grievanceId={grievance.id} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6 max-w-2xl space-y-4">
        <div className="space-y-2">
          <Label htmlFor="timeline-template">Timeline Template</Label>
          {isLoading ? (
            <Skeleton className="h-10 w-full" data-testid="skeleton-timeline-template" />
          ) : (
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger id="timeline-template" data-testid="select-timeline-template">
                <SelectValue placeholder="Select a timeline template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE} data-testid="option-timeline-template-none">
                  None
                </SelectItem>
                {(templates ?? []).map((t) => (
                  <SelectItem
                    key={t.id}
                    value={t.id}
                    data-testid={`option-timeline-template-${t.id}`}
                  >
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-sm text-muted-foreground">
            Associate a timeline template with this grievance, or choose None to clear it.
          </p>
        </div>
          <Button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            data-testid="button-save-timeline-template"
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GrievanceTimeline() {
  return (
    <GrievanceLayout activeTab="timeline">
      <GrievanceTimelineContent />
    </GrievanceLayout>
  );
}
