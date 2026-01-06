import { createContext, useContext, ReactNode } from "react";
import { Clock, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CronJob } from "@/lib/cron-types";
import { useCronJobTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface CronJobLayoutContextValue {
  job: CronJob;
  isLoading: boolean;
  isError: boolean;
}

const CronJobLayoutContext = createContext<CronJobLayoutContextValue | null>(null);

export function useCronJobLayout() {
  const context = useContext(CronJobLayoutContext);
  if (!context) {
    throw new Error("useCronJobLayout must be used within CronJobLayout");
  }
  return context;
}

interface CronJobLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function CronJobLayout({ activeTab, children }: CronJobLayoutProps) {
  const { name } = useParams<{ name: string }>();

  const { data: job, isLoading, error } = useQuery<CronJob>({
    queryKey: ["/api/cron-jobs", name],
    queryFn: async () => {
      const response = await fetch(`/api/cron-jobs/${encodeURIComponent(name!)}`);
      if (!response.ok) {
        throw new Error("Cron job not found");
      }
      return response.json();
    },
    enabled: !!name,
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs } = useCronJobTabAccess(name ? encodeURIComponent(name) : "");

  // Set page title based on cron job name
  usePageTitle(job?.name);

  const isError = !!error;

  // Error/Not found state
  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Clock className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Cron Job Not Found</h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/cron-jobs">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-cron-jobs">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Cron Jobs
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Clock className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Job Not Found</h3>
              <p className="text-muted-foreground text-center">
                The cron job you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/cron-jobs">
                <Button className="mt-4" data-testid="button-return-to-cron-jobs">
                  Return to Cron Jobs
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Loading state
  if (isLoading || !job) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Clock className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/cron-jobs">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-cron-jobs">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Cron Jobs
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Skeleton className="h-16 w-16 rounded-full mb-4" />
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-64" />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const contextValue: CronJobLayoutContextValue = {
    job,
    isLoading: false,
    isError: false,
  };

  return (
    <CronJobLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Clock className="text-primary-foreground" size={16} />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-foreground" data-testid={`text-cron-job-name-${job.name}`}>
                    {job.name}
                  </h1>
                  {job.description && (
                    <p className="text-sm text-muted-foreground">{job.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Badge variant={job.isEnabled ? "default" : "secondary"} data-testid="badge-job-status">
                    {job.isEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <span className="text-sm text-muted-foreground font-mono">{job.schedule}</span>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/cron-jobs">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-cron-jobs">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Cron Jobs
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Tab Navigation */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-3">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-cron-job-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-cron-job-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </CronJobLayoutContext.Provider>
  );
}
