import { Users } from "lucide-react";
import { WorkersTable } from "@/components/workers/workers-table";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Worker } from "@shared/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAuth } from "@/contexts/AuthContext";

export default function Workers() {
  const [location] = useLocation();
  const { hasPermission } = useAuth();
  const { data: workers = [], isLoading } = useQuery<Worker[]>({
    queryKey: ["/api/workers/with-details"],
  });

  const tabs = [
    { id: "list", label: "List", href: "/workers" },
    ...(hasPermission("staff") ? [{ id: "add", label: "Add", href: "/workers/add" }] : []),
  ];

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Workers" 
        icon={<Users className="text-primary-foreground" size={16} />}
        actions={
          <span className="text-sm text-muted-foreground" data-testid="text-worker-count">
            {workers.length} Workers
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
                  data-testid={`button-workers-${tab.id}`}
                >
                  {tab.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <WorkersTable workers={workers} isLoading={isLoading} />
      </main>
    </div>
  );
}
