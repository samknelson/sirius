import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Briefcase, Truck, HardHat, Wrench, Clock, Calendar, ClipboardList, Package, MapPin, Users, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type { DispatchJobType, JobTypeData } from "@shared/schema";
import { createContext, useContext } from "react";
import { useDispatchJobTypeTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

const iconMap: Record<string, LucideIcon> = {
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar, ClipboardList, Package, MapPin, Users,
};

interface DispatchJobTypeLayoutContextValue {
  jobType: DispatchJobType;
  isLoading: boolean;
  isError: boolean;
}

const DispatchJobTypeLayoutContext = createContext<DispatchJobTypeLayoutContextValue | undefined>(undefined);

export function useDispatchJobTypeLayout() {
  const context = useContext(DispatchJobTypeLayoutContext);
  if (!context) {
    throw new Error("useDispatchJobTypeLayout must be used within DispatchJobTypeLayout");
  }
  return context;
}

interface DispatchJobTypeLayoutProps {
  children: React.ReactNode;
  activeTab: string;
}

export default function DispatchJobTypeLayout({ children, activeTab }: DispatchJobTypeLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: jobType, isLoading, error } = useQuery<DispatchJobType>({
    queryKey: ["/api/options/dispatch-job-type", id],
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs: mainTabs } = useDispatchJobTypeTabAccess(id || "");

  // Set page title based on job type name
  usePageTitle(jobType?.name);

  const jobTypeData = jobType?.data as JobTypeData | undefined;
  const IconComponent = jobTypeData?.icon ? iconMap[jobTypeData.icon] || Briefcase : Briefcase;

  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Briefcase className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Job Type Not Found</h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/config/dispatch-job-types">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-job-types">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Job Types
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-muted-foreground">
                The job type you're looking for doesn't exist or has been removed.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading || !jobType) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Briefcase className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/config/dispatch-job-types">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-job-types">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Job Types
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

  const contextValue: DispatchJobTypeLayoutContextValue = {
    jobType,
    isLoading: false,
    isError: false,
  };

  return (
    <DispatchJobTypeLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <IconComponent className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-job-type-name-${jobType.id}`}>
                  {jobType.name}
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/config/dispatch-job-types">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-job-types">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Job Types
                  </Button>
                </Link>
              </div>
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
                    data-testid={`button-job-type-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-job-type-${tab.id}`}
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
    </DispatchJobTypeLayoutContext.Provider>
  );
}

export { DispatchJobTypeLayout };
