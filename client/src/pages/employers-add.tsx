import { Building2 } from "lucide-react";
import { AddEmployerForm } from "@/components/employers/add-employer-form";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";

export default function EmployersAdd() {
  const [location] = useLocation();

  const tabs = [
    { id: "list", label: "List", href: "/employers" },
    { id: "add", label: "Add", href: "/employers/add" },
    { id: "onboarding", label: "Onboarding", href: "/employers/onboarding" },
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
        <AddEmployerForm />
      </main>
    </div>
  );
}
