import { useState } from "react";
import { Building2, Pencil } from "lucide-react";
import { EmployersTable } from "@/components/employers/employers-table";
import { BulkUpdateEmployersDialog } from "@/components/employers/bulk-update-employers-dialog";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Employer, TrustBenefit } from "@shared/schema";
import { Company } from "@shared/schema/employer/company-schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAuth } from "@/contexts/AuthContext";

type EmployerWithCompany = Employer & { companyId?: string | null; companyName?: string | null };

interface EmployerCountsResponse {
  workerCounts: Record<string, number>;
  benefitCounts?: Record<string, Record<string, number>>;
}

export interface EmployerContactIndicator {
  contactId: string;
  contactName: string | null;
  contactTypeName: string | null;
  icon: string | null;
  hasActiveUser: boolean;
}

type EmployerContactIndicatorsResponse = Record<string, EmployerContactIndicator[]>;

export default function Employers() {
  const [location] = useLocation();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const { hasComponent, hasPermission } = useAuth();
  const showCompany = hasComponent("employer.company");
  const showBenefits = hasComponent("trust.benefits");
  const canBulkUpdate = hasPermission("staff");
  
  const { data: employers = [], isLoading } = useQuery<EmployerWithCompany[]>({
    queryKey: ["/api/employers", includeInactive],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeInactive) {
        params.append('includeInactive', 'true');
      }
      const response = await fetch(`/api/employers?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch employers');
      }
      return response.json();
    },
  });

  const { data: companiesList = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: showCompany,
  });

  const { data: counts, isLoading: countsLoading } = useQuery<EmployerCountsResponse>({
    queryKey: ["/api/employers/counts"],
  });

  const { data: contactIndicators } = useQuery<EmployerContactIndicatorsResponse>({
    queryKey: ["/api/employers/contact-indicators"],
  });

  const { data: benefits = [] } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
    enabled: showBenefits,
  });

  const activeBenefits = benefits.filter((b) => b.isActive);

  const tabs = [
    { id: "list", label: "List", href: "/employers" },
    { id: "add", label: "Add", href: "/employers/add" },
    { id: "onboarding", label: "Onboarding", href: "/employers/onboarding" },
  ];

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Employers" 
        icon={<Building2 className="text-primary-foreground" size={16} />}
        actions={
          <div className="flex items-center gap-3">
            {canBulkUpdate && selectedIds.size > 0 && (
              <Button
                size="sm"
                onClick={() => setBulkDialogOpen(true)}
                data-testid="button-bulk-update-employers"
              >
                <Pencil className="mr-2" size={14} />
                Bulk Update ({selectedIds.size})
              </Button>
            )}
            <span className="text-sm text-muted-foreground" data-testid="text-employer-count">
              {employers.length} Employers
            </span>
          </div>
        }
      />

      {/* Tab Navigation */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {tabs.map((tab) => (
              <Link key={tab.id} href={tab.href}>
                <Button
                  variant={location === tab.href ? "default" : "outline"}
                  size="sm"
                  data-testid={`button-employers-${tab.id}`}
                >
                  {tab.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <EmployersTable 
          employers={employers} 
          isLoading={isLoading} 
          includeInactive={includeInactive}
          onToggleInactive={() => setIncludeInactive(!includeInactive)}
          showCompany={showCompany}
          companies={companiesList}
          selectable={canBulkUpdate}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          workerCounts={counts?.workerCounts}
          benefitCounts={counts?.benefitCounts}
          contactIndicators={contactIndicators}
          countsLoading={countsLoading}
          showBenefits={showBenefits}
          benefits={activeBenefits}
        />
      </main>

      {canBulkUpdate && (
        <BulkUpdateEmployersDialog
          open={bulkDialogOpen}
          onOpenChange={setBulkDialogOpen}
          selectedIds={Array.from(selectedIds)}
          showCompany={showCompany}
          companies={companiesList}
          onComplete={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
}
