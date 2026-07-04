import { useState } from "react";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  GrievanceTimelineTemplateLayout,
  useGrievanceTimelineTemplateLayout,
} from "@/components/layouts/GrievanceTimelineTemplateLayout";

function EditContent() {
  const { template } = useGrievanceTimelineTemplateLayout();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState(template.title);
  const [description, setDescription] = useState(template.description ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/grievance-timeline-templates/${template.id}`, {
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/grievance-timeline-templates", template.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/grievance-timeline-templates"],
      });
      toast({ title: "Timeline template updated" });
      navigate(`/grievance-timeline-template/${template.id}`);
    } catch (error) {
      toast({
        title: "Could not update timeline template",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-2">
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="input-edit-title"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-description">Description</Label>
          <Textarea
            id="edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="input-edit-description"
          />
        </div>
        <div className="flex items-center space-x-3 pt-2">
          <Button
            variant="outline"
            onClick={() => navigate(`/grievance-timeline-template/${template.id}`)}
            data-testid="button-cancel-edit"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} data-testid="button-save-edit">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function GrievanceTimelineTemplateEdit() {
  return (
    <GrievanceTimelineTemplateLayout activeTab="edit">
      <EditContent />
    </GrievanceTimelineTemplateLayout>
  );
}
