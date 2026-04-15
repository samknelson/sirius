import { ReactNode, createContext, useContext } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Layers } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useDispatchJobGroupTabAccess } from "@/hooks/useTabAccess";
import type { DispatchJobGroup } from "@shared/schema";

interface DispatchJobGroupLayoutProps {
  activeTab: string;
  children: ReactNode;
}

interface DispatchJobGroupLayoutContextValue {
  group: DispatchJobGroup;
}

const DispatchJobGroupLayoutContext = createContext<DispatchJobGroupLayoutContextValue | null>(null);

export function useDispatchJobGroupLayout() {
  const context = useContext(DispatchJobGroupLayoutContext);
  if (!context) {
    throw new Error("useDispatchJobGroupLayout must be used within DispatchJobGroupLayout");
  }
  return context;
}

function isActive(startYmd: string, endYmd: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return startYmd <= today && endYmd >= today;
}

export function DispatchJobGroupLayout({ activeTab, children }: DispatchJobGroupLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: group, isLoading, error } = useQuery<DispatchJobGroup>({
    queryKey: ["/api/dispatch-job-groups", id],
    enabled: !!id,
  });

  const { tabs: mainTabs } = useDispatchJobGroupTabAccess(id);

  usePageTitle(group?.name || "Job Group Details");

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-job-group" />
        </div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="text-center py-12">
          <p className="text-destructive mb-4">Job group not found or failed to load.</p>
          <Link href="/dispatch/job_groups">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Job Groups
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const active = isActive(group.startYmd, group.endYmd);

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="breadcrumb">
          <Link href="/dispatch/job_groups" className="hover:text-foreground transition-colors">
            Job Groups
          </Link>
          <ChevronRight size={16} />
          <span className="text-foreground font-medium">
            {group.name}
          </span>
        </nav>
        <Link href="/dispatch/job_groups">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft size={16} className="mr-2" />
            Back to Job Groups
          </Button>
        </Link>
      </div>

      <div className="flex items-start gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10">
          <Layers className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-foreground" data-testid="heading-group-name">
              {group.name}
            </h1>
            <Badge variant={active ? "default" : "secondary"} data-testid="badge-status">
              {active ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            {group.startYmd} to {group.endYmd}
          </p>
        </div>
      </div>

      <div className="border-b border-border mb-6">
        <nav className="flex gap-6" data-testid="nav-tabs">
          {mainTabs.map((tab) => {
            const isTabActive = tab.id === activeTab;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
                  isTabActive
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-${tab.id}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <DispatchJobGroupLayoutContext.Provider value={{ group }}>
        {children}
      </DispatchJobGroupLayoutContext.Provider>
    </div>
  );
}
