import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GrievanceLayout,
  useGrievanceLayout,
} from "@/components/layouts/GrievanceLayout";
import { GRIEVANCE_CARDINALITY_LABELS } from "@/components/grievances/grievance-form";

function GrievanceDetailsContent() {
  const { grievance } = useGrievanceLayout();

  const showLead = grievance.cardinality === "multiple-with-lead";
  const isSingleWorker = grievance.cardinality === "individual";
  const employerName = grievance.employers[0]?.name ?? null;

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
        <Card>
          <CardHeader>
            <CardTitle>{isSingleWorker ? "Worker" : "Workers"}</CardTitle>
          </CardHeader>
          <CardContent>
            {grievance.workers.length === 0 ? (
              <p className="text-muted-foreground text-sm" data-testid="text-no-workers">
                No workers linked.
              </p>
            ) : (
              <div className="space-y-2">
                {grievance.workers.map((w) => (
                  <div
                    key={w.workerId}
                    className="flex items-center gap-2 border rounded-lg px-3 py-2"
                    data-testid={`row-worker-${w.workerId}`}
                  >
                    <Link
                      href={`/workers/${w.workerId}`}
                      className="hover:underline truncate"
                      data-testid={`link-worker-${w.workerId}`}
                    >
                      {w.displayName || "Unknown"}
                      {w.siriusId != null ? ` #${w.siriusId}` : ""}
                    </Link>
                    {w.primary && showLead && (
                      <Badge variant="default" data-testid={`badge-lead-${w.workerId}`}>
                        Lead
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Employer</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-foreground" data-testid="text-grievance-employer">
            {employerName || "No employer"}
          </p>
        </CardContent>
      </Card>
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
