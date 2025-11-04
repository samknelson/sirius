import { useState } from "react";
import { Star, User, Heart } from "lucide-react";
import { TrustBenefitsTable } from "@/components/trust-benefits/trust-benefits-table";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { TrustBenefit } from "@shared/schema";

export default function TrustBenefits() {
  const [location] = useLocation();
  const [includeInactive, setIncludeInactive] = useState(false);
  
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

  const tabs = [
    { id: "list", label: "List", href: "/trust-benefits" },
    { id: "add", label: "Add", href: "/trust-benefits/add" },
  ];

  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Star className="text-primary-foreground" size={16} />
              </div>
              <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
              <span className="text-muted-foreground text-sm font-medium">Trust Benefit Management</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground" data-testid="text-benefit-count">
                {benefits.length} Trust Benefits
              </span>
              <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                <User className="text-muted-foreground" size={12} />
              </div>
            </div>
          </div>
        </div>
      </header>

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
        />
      </main>
    </div>
  );
}
