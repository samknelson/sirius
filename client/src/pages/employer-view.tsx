import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building, Building2, Factory, Store, Warehouse, Home, Landmark, Hospital } from "lucide-react";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { EmployerType } from "@shared/schema";

const iconMap: Record<string, React.ComponentType<{ className?: string; size?: number }>> = {
  Building,
  Building2,
  Factory,
  Store,
  Warehouse,
  Home,
  Landmark,
  Hospital,
};

function EmployerDetailsContent() {
  const { employer } = useEmployerLayout();

  const { data: employerTypes = [], isLoading: isLoadingTypes } = useQuery<EmployerType[]>({
    queryKey: ["/api/employer-types"],
  });

  const employerType = employer.typeId 
    ? employerTypes.find(t => t.id === employer.typeId) 
    : null;

  const typeIconName = employerType ? (employerType.data as any)?.icon : null;
  const TypeIconComponent = typeIconName ? (iconMap[typeIconName] || Building) : null;

  return (
    <Card>
      <CardContent className="space-y-6">
        {/* Basic Information */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Basic Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Employer Name</label>
              <p className="text-foreground" data-testid="text-employer-name-field">
                {employer.name}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Sirius ID / Record ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-employer-ids">
                {employer.siriusId} / {employer.id}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <div>
                <Badge 
                  variant={employer.isActive ? "default" : "secondary"}
                  data-testid="badge-employer-status"
                >
                  {employer.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Type</label>
              <div className="flex items-center gap-2" data-testid="text-employer-type">
                {isLoadingTypes && employer.typeId ? (
                  <span className="text-muted-foreground">Loading...</span>
                ) : (
                  <>
                    {TypeIconComponent && <TypeIconComponent className="text-muted-foreground" size={16} />}
                    <span className="text-foreground">{employerType?.name || "Not specified"}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-center space-x-3">
            <Link href="/employers">
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

export default function EmployerView() {
  return (
    <EmployerLayout activeTab="details">
      <EmployerDetailsContent />
    </EmployerLayout>
  );
}
