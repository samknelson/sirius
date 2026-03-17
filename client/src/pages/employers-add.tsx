import { Building2 } from "lucide-react";
import { AddEmployerForm } from "@/components/employers/add-employer-form";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function EmployersAdd() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
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
        title="Add Employer" 
        icon={<Building2 className="text-primary-foreground" size={16} />}
        backLink={{ href: "/employers", label: "Back to Employers" }}
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
        <AddEmployerForm />
      </main>
    </div>
  );
}
