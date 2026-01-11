import { useState } from "react";
import { Heart } from "lucide-react";
import { TrustBenefitsTable } from "@/components/trust-benefits/trust-benefits-table";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { TrustBenefit, TrustBenefitType } from "@shared/schema";
import { PageHeader } from "@/components/layout/PageHeader";

export default function TrustBenefits() {
  const [location] = useLocation();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  
  const { data: benefits = [], isLoading } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits", includeInactive],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeInactive) {
        params.append('includeInactive', 'true');
      }
      const response = await fetch(`/api/trust-benefits?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch trust benefits');
      }
      return response.json();
    },
  });

  const { data: benefitTypes = [] } = useQuery<TrustBenefitType[]>({
    queryKey: ["/api/options/trust-benefit-type"],
  });

  const tabs = [
    { id: "list", label: "List", href: "/trust-benefits" },
    { id: "add", label: "Add", href: "/trust-benefits/add" },
  ];

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Trust Benefits" 
        icon={<Heart className="text-primary-foreground" size={16} />}
        actions={
          <span className="text-sm text-muted-foreground" data-testid="text-benefit-count">
            {benefits.length} Trust Benefits
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
                  data-testid={`button-trust-benefits-${tab.id}`}
                >
                  {tab.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <TrustBenefitsTable 
          benefits={benefits} 
          isLoading={isLoading} 
          includeInactive={includeInactive}
          onToggleInactive={() => setIncludeInactive(!includeInactive)}
          benefitTypes={benefitTypes}
          selectedTypeId={selectedTypeId}
          onTypeChange={setSelectedTypeId}
        />
      </main>
    </div>
  );
}
