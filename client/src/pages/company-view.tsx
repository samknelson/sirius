import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CompanyLayout, useCompanyLayout } from "@/components/layouts/CompanyLayout";

function CompanyDetailsContent() {
  const { company } = useCompanyLayout();

  return (
    <Card>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Basic Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Company Name</label>
              <p className="text-foreground" data-testid="text-company-name-field">
                {company.name}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Sirius ID / Record ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-company-ids">
                {company.siriusId} / {company.id}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <p className="text-foreground" data-testid="text-company-description">
                {company.description || "No description provided."}
              </p>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-border">
          <div className="flex items-center space-x-3">
            <Link href="/companies">
              <Button variant="outline" data-testid="button-back-to-list">
                Back to List
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CompanyView() {
  return (
    <CompanyLayout activeTab="details">
      <CompanyDetailsContent />
    </CompanyLayout>
  );
}
