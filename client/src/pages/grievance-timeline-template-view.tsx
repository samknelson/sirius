import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  GrievanceTimelineTemplateLayout,
  useGrievanceTimelineTemplateLayout,
} from "@/components/layouts/GrievanceTimelineTemplateLayout";

function DetailsContent() {
  const { template } = useGrievanceTimelineTemplateLayout();

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-6 pt-6">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Basic Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Title</label>
                <p className="text-foreground" data-testid="text-template-title">
                  {template.title}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Record ID</label>
                <p className="text-foreground font-mono text-sm" data-testid="text-template-id">
                  {template.id}
                </p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Description</h3>
            <p
              className="text-foreground whitespace-pre-wrap"
              data-testid="text-template-description"
            >
              {template.description || "—"}
            </p>
          </div>

          <div className="pt-4 border-t border-border">
            <div className="flex items-center space-x-3">
              <Link href="/grievance-timeline-templates">
                <Button variant="outline" data-testid="button-back-to-list">
                  Back to List
                </Button>
              </Link>
              <Link href={`/grievance-timeline-template/${template.id}/items`}>
                <Button variant="outline" data-testid="button-manage-steps">
                  Manage Steps
                </Button>
              </Link>
              <Link href={`/grievance-timeline-template/${template.id}/edit`}>
                <Button data-testid="button-edit-template">Edit</Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GrievanceTimelineTemplateView() {
  return (
    <GrievanceTimelineTemplateLayout activeTab="details">
      <DetailsContent />
    </GrievanceTimelineTemplateLayout>
  );
}
