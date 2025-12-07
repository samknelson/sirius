import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PolicyLayout, usePolicyLayout } from "@/components/layouts/PolicyLayout";

function PolicyDetailsContent() {
  const { policy } = usePolicyLayout();

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Basic Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Sirius ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-policy-sirius-id">
                {policy.siriusId}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Record ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-policy-id">
                {policy.id}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Name</label>
              <p className="text-foreground" data-testid="text-policy-name">
                {policy.name || <span className="text-muted-foreground italic">Not set</span>}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Has Data</label>
              <div>
                <Badge variant={policy.data ? "default" : "secondary"} data-testid="badge-policy-has-data">
                  {policy.data ? "Yes" : "No"}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {policy.data !== null && policy.data !== undefined && (
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">Data</h3>
            <pre className="bg-muted p-4 rounded-md overflow-auto text-sm" data-testid="text-policy-data">
              {JSON.stringify(policy.data, null, 2)}
            </pre>
          </div>
        )}

        <div className="pt-4 border-t border-border">
          <div className="flex items-center space-x-3 flex-wrap gap-2">
            <Link href="/config/policies">
              <Button variant="outline" data-testid="button-back-to-list">
                Back to List
              </Button>
            </Link>
            <Link href={`/policies/${policy.id}/edit`}>
              <Button data-testid="button-edit-policy">
                Edit Policy
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PolicyView() {
  return (
    <PolicyLayout activeTab="details">
      <PolicyDetailsContent />
    </PolicyLayout>
  );
}
