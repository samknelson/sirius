import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GrievanceLayout,
  useGrievanceLayout,
} from "@/components/layouts/GrievanceLayout";
import { GRIEVANCE_CARDINALITY_LABELS } from "@/components/grievances/grievance-form";
import { GrievanceWorkerManager } from "@/components/grievances/grievance-worker-section";
import { GrievanceEmployerManager } from "@/components/grievances/grievance-employer-section";

function GrievanceDetailsContent() {
  const { grievance } = useGrievanceLayout();

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-6 pt-6">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">Basic Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Category</label>
                <p className="text-foreground" data-testid="text-grievance-category">
                  {grievance.categoryName || "—"}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <div>
                  <Badge variant="secondary" data-testid="badge-grievance-status">
                    {grievance.statusName || "—"}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Cardinality</label>
                <p className="text-foreground" data-testid="text-grievance-cardinality">
                  {GRIEVANCE_CARDINALITY_LABELS[grievance.cardinality] ?? grievance.cardinality}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Record ID</label>
                <p className="text-foreground font-mono text-sm" data-testid="text-grievance-id">
                  {grievance.id}
                </p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Complaint</h3>
            <p className="text-foreground whitespace-pre-wrap" data-testid="text-grievance-complaint">
              {grievance.complaint || "—"}
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Remedy</h3>
            <p className="text-foreground whitespace-pre-wrap" data-testid="text-grievance-remedy">
              {grievance.remedy || "—"}
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Class Description</h3>
            <p
              className="text-foreground whitespace-pre-wrap"
              data-testid="text-grievance-class-description"
            >
              {grievance.classDescription || "—"}
            </p>
          </div>

          <div className="pt-4 border-t border-border">
            <div className="flex items-center space-x-3">
              <Link href="/grievances">
                <Button variant="outline" data-testid="button-back-to-list">
                  Back to List
                </Button>
              </Link>
              <Link href={`/grievance/${grievance.id}/edit`}>
                <Button data-testid="button-edit-grievance">Edit</Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {grievance.cardinality !== "class" && (
        <GrievanceWorkerManager
          grievanceId={grievance.id}
          cardinality={grievance.cardinality}
          workers={grievance.workers}
        />
      )}
      <GrievanceEmployerManager
        grievanceId={grievance.id}
        employers={grievance.employers}
      />
    </div>
  );
}

export default function GrievanceView() {
  return (
    <GrievanceLayout activeTab="details">
      <GrievanceDetailsContent />
    </GrievanceLayout>
  );
}
