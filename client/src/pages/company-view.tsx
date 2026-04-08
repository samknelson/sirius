import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CompanyLayout, useCompanyLayout } from "@/components/layouts/CompanyLayout";
import { Loader2 } from "lucide-react";

function CompanyDetailsContent() {
  const { company } = useCompanyLayout();

  const { data: employers, isLoading: employersLoading } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['/api/companies', company.id, 'employers'],
  });

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
          <h3 className="text-lg font-semibold text-foreground mb-3">Associated Employers</h3>
          {employersLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground" data-testid="loading-employers">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading employers...</span>
            </div>
          ) : employers && employers.length > 0 ? (
            <ul className="space-y-2" data-testid="list-employers">
              {employers.map((employer) => (
                <li key={employer.id}>
                  <Link href={`/employers/${employer.id}`}>
                    <span className="text-foreground hover:underline cursor-pointer" data-testid={`link-employer-${employer.id}`}>
                      {employer.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground" data-testid="text-no-employers">No employers associated</p>
          )}
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
