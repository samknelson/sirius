import { Star, User } from "lucide-react";
import { AddWorkerForm } from "@/components/workers/add-worker-form";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Worker } from "@shared/schema";

export default function WorkersAdd() {
  const [location] = useLocation();
  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const tabs = [
    { id: "list", label: "List", href: "/workers" },
    { id: "add", label: "Add", href: "/workers/add" },
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
              <span className="text-muted-foreground text-sm font-medium">Worker Management</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground" data-testid="text-worker-count">
                {workers.length} Workers
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
        <AddWorkerForm />
      </main>
    </div>
  );
}
