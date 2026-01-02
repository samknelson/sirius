import { createContext, useContext, ReactNode } from "react";
import { Briefcase, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { DispatchJobWithRelations } from "../../../../server/storage/dispatch-jobs";
import { useDispatchJobTabAccess } from "@/hooks/useTabAccess";

interface DispatchJobLayoutContextValue {
  job: DispatchJobWithRelations;
  isLoading: boolean;
  isError: boolean;
}

const DispatchJobLayoutContext = createContext<DispatchJobLayoutContextValue | null>(null);

export function useDispatchJobLayout() {
  const context = useContext(DispatchJobLayoutContext);
  if (!context) {
    throw new Error("useDispatchJobLayout must be used within DispatchJobLayout");
  }
  return context;
}

interface DispatchJobLayoutProps {
  activeTab: "details" | "edit" | "dispatches" | "eligible-workers";
  children: ReactNode;
}

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  running: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  closed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  archived: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
};

export function DispatchJobLayout({ activeTab, children }: DispatchJobLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: job, isLoading: jobLoading, error: jobError } = useQuery<DispatchJobWithRelations>({
    queryKey: ["/api/dispatch-jobs", id],
    queryFn: async () => {
      const response = await fetch(`/api/dispatch-jobs/${id}`);
      if (!response.ok) {
        throw new Error("Dispatch job not found");
      }
      return response.json();
    },
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs: mainTabs } = useDispatchJobTabAccess(id || "");

  const isLoading = jobLoading;
  const isError = !!jobError;

  if (jobError) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Briefcase className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">Dispatch Job Not Found</h3>
            <p className="text-muted-foreground text-center">
              The dispatch job you're looking for doesn't exist or has been removed.
            </p>
            <Link href="/dispatch/jobs">
              <Button className="mt-4" data-testid="button-return-to-jobs">
                Return to Jobs
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !job) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Skeleton className="h-16 w-16 rounded-full mb-4" />
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <DispatchJobLayoutContext.Provider value={{ job, isLoading, isError }}>
      <section className="bg-background border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-start gap-4">
            <Link href="/dispatch/jobs">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground" data-testid="title-job">
                  {job.title}
                </h1>
                <Badge className={statusColors[job.status]} data-testid="badge-status">
                  {job.status}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1">
                {job.employer?.name}
                {job.jobType && ` - ${job.jobType.name}`}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {mainTabs.map((tab) => {
              const isActive = tab.id === activeTab;
              return isActive ? (
                <Button
                  key={tab.id}
                  variant="default"
                  size="sm"
                  data-testid={`button-job-${tab.id}`}
                >
                  {tab.label}
                </Button>
              ) : (
                <Link key={tab.id} href={tab.href}>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`button-job-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </DispatchJobLayoutContext.Provider>
  );
}
