import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import type { Employer } from "@shared/schema";
import { ArrowLeft, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmploymentStatus } from "@/lib/entity-types";
import { useWorkerHoursTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface WorkerHoursEntry {
  id: string;
  month: number;
  year: number;
  day: number;
  workerId: string;
  employerId: string;
  employmentStatusId: string;
  hours: number | null;
  home: boolean;
  jobTitle: string | null;
  employer: Employer;
  employmentStatus: EmploymentStatus;
}

interface WorkerHoursLayoutContextValue {
  hoursEntry: WorkerHoursEntry;
  isLoading: boolean;
  isError: boolean;
}

const WorkerHoursLayoutContext = createContext<WorkerHoursLayoutContextValue | null>(null);

export function useWorkerHoursLayout() {
  const context = useContext(WorkerHoursLayoutContext);
  if (!context) {
    throw new Error("useWorkerHoursLayout must be used within WorkerHoursLayout");
  }
  return context;
}

interface WorkerHoursLayoutProps {
  children: ReactNode;
  activeTab: string;
}

function getMonthName(month: number): string {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return monthNames[month - 1];
}

export function WorkerHoursLayout({ children, activeTab }: WorkerHoursLayoutProps) {
  const { hoursId } = useParams<{ hoursId: string }>();

  const { data: hoursEntry, isLoading, error } = useQuery<WorkerHoursEntry>({
    queryKey: ["/api/worker-hours", hoursId],
    queryFn: async () => {
      const response = await fetch(`/api/worker-hours/${hoursId}`);
      if (!response.ok) throw new Error("Failed to fetch hours entry");
      return response.json();
    },
    enabled: !!hoursId,
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs: mainTabs } = useWorkerHoursTabAccess(hoursId || "");

  // Set page title based on hours entry period
  const hoursTitle = hoursEntry 
    ? `${getMonthName(hoursEntry.month)} ${hoursEntry.year}` 
    : undefined;
  usePageTitle(hoursTitle);

  const isError = !!error;

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
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Hours Entry Not Found</span>
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
              <h3 className="text-lg font-medium text-foreground mb-2">Hours Entry Not Found</h3>
              <p className="text-muted-foreground text-center mb-4">
                The hours entry you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/workers">
                <Button variant="outline" data-testid="link-back-hours-list">
                  <ArrowLeft size={16} className="mr-2" />
                  Back to Workers
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading || !hoursEntry) {
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

  const hoursTitle = `${getMonthName(hoursEntry.month)} ${hoursEntry.day}, ${hoursEntry.year} - ${hoursEntry.employer?.name || "Unknown Employer"}`;

  const contextValue: WorkerHoursLayoutContextValue = {
    hoursEntry,
    isLoading: false,
    isError: false,
  };

  return (
    <WorkerHoursLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16 gap-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Clock className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid="text-hours-title">
                  {hoursTitle}
                </h1>
              </div>
              <Link href={`/workers/${hoursEntry.workerId}/employment/daily`}>
                <Button variant="ghost" size="sm" data-testid="link-back-hours-list">
                  <ArrowLeft size={16} className="mr-2" />
                  Back to hours list
                </Button>
              </Link>
            </div>
          </div>
        </header>

        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-3">
              {mainTabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-hours-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-hours-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </WorkerHoursLayoutContext.Provider>
  );
}
