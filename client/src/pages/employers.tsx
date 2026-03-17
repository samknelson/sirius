import { useState } from "react";
import { Building2 } from "lucide-react";
import { EmployersTable } from "@/components/employers/employers-table";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Employers() {
  const [location, setLocation] = useLocation();
  const [includeInactive, setIncludeInactive] = useState(false);
  const { toast } = useToast();
  
  const { data: employers = [], isLoading } = useQuery<Employer[]>({
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

  const onboardMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/wizards", {
        type: "employer_onboarding",
        status: "draft",
        data: {},
      });
    },
    onSuccess: (wizard: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards"] });
      toast({ title: "Onboarding wizard created" });
      setLocation(`/wizards/${wizard.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const tabs = [
    { id: "list", label: "List", href: "/employers" },
    { id: "add", label: "Add", href: "/employers/add" },
    { id: "onboard", label: "Onboard", onClick: () => onboardMutation.mutate() },
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
              'onClick' in tab && tab.onClick ? (
                <Button
                  key={tab.id}
                  variant="outline"
                  size="sm"
                  onClick={tab.onClick}
                  disabled={onboardMutation.isPending}
                  data-testid={`button-employers-${tab.id}`}
                >
                  {onboardMutation.isPending && tab.id === 'onboard' ? 'Creating...' : tab.label}
                </Button>
              ) : (
                <Link key={tab.id} href={(tab as any).href}>
                  <Button
                    variant={location === (tab as any).href ? "default" : "outline"}
                    size="sm"
                    data-testid={`button-employers-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                </Link>
              )
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
        />
      </main>
    </div>
  );
}
