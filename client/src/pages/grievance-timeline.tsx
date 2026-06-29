import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import type { GrievanceTimelineTemplate } from "@shared/schema";

const NONE_VALUE = "__none__";

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
  );
}

export default function GrievanceTimeline() {
  return (
    <GrievanceLayout activeTab="timeline">
      <GrievanceTimelineContent />
    </GrievanceLayout>
  );
}
