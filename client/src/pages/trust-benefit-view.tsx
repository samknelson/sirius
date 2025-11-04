import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrustBenefitLayout, useTrustBenefitLayout } from "@/components/layouts/TrustBenefitLayout";

function TrustBenefitDetailsContent() {
  const { benefit } = useTrustBenefitLayout();

  return (
    <Card>
      <CardContent className="space-y-6">
        {/* Basic Information */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Basic Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Benefit Name</label>
              <p className="text-foreground" data-testid="text-benefit-name-field">
                {benefit.name}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Record ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-benefit-id">
                {benefit.id}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Benefit Type</label>
              <p className="text-foreground" data-testid="text-benefit-type-field">
                {(benefit as any).benefitTypeName || 'N/A'}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <div>
                <Badge 
                  variant={benefit.isActive ? "default" : "secondary"}
                  data-testid="badge-benefit-status"
                >
                  {benefit.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        {benefit.description && (
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">Description</h3>
            <div 
              className="prose prose-sm max-w-none text-foreground"
              dangerouslySetInnerHTML={{ __html: benefit.description }}
              data-testid="text-benefit-description"
            />
          </div>
        )}

        {/* Actions */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-center space-x-3">
            <Link href="/trust-benefits">
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

export default function TrustBenefitView() {
  return (
    <TrustBenefitLayout activeTab="details">
      <TrustBenefitDetailsContent />
    </TrustBenefitLayout>
  );
}
