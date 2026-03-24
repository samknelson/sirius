import { useState } from "react";
import { Building2 } from "lucide-react";
import { EmployersTable } from "@/components/employers/employers-table";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { Company } from "@shared/schema/employer/company-schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAuth } from "@/contexts/AuthContext";

type EmployerWithCompany = Employer & { companyName?: string | null };

export default function Employers() {
  const [location] = useLocation();
  const [includeInactive, setIncludeInactive] = useState(false);
  const { hasComponent } = useAuth();
  const showCompany = hasComponent("employer.company");
  
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

  const tabs = [
    { id: "list", label: "List", href: "/employers" },
    { id: "add", label: "Add", href: "/employers/add" },
  ];

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Employers" 
        icon={<Building2 className="text-primary-foreground" size={16} />}
        actions={
          <span className="text-sm text-muted-foreground" data-testid="text-employer-count">
            {employers.length} Employers
          </span>
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
        />
      </main>
    </div>
  );
}
