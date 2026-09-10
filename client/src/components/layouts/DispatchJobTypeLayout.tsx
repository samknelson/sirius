import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Truck, HardHat, Wrench, Clock, Calendar, ClipboardList, Package, MapPin, Users, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type { DispatchJobType, JobTypeData } from "@shared/schema";
import { createContext, useContext } from "react";
import { useDispatchJobTypeTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  RecordTitleBar,
  RecordTitleBarLoading,
  RecordTitleBarNotFound,
} from "@/components/shared/RecordTitleBar";

const DISPATCH_JOB_TYPE_BACK_LINK = {
  href: "/config/dispatch-job-types",
  label: "Back to Job Types",
  testId: "button-back-to-job-types",
};

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
        <RecordTitleBarNotFound
          icon={<Briefcase className="text-primary-foreground" size={16} />}
          label="Job Type Not Found"
          backLink={DISPATCH_JOB_TYPE_BACK_LINK}
        />

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
        <RecordTitleBarLoading
          icon={<Briefcase className="text-primary-foreground" size={16} />}
          backLink={DISPATCH_JOB_TYPE_BACK_LINK}
        />

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
        <RecordTitleBar
          icon={<IconComponent className="text-primary-foreground" size={16} />}
          title={jobType.name}
          titleTestId={`text-job-type-name-${jobType.id}`}
          backLink={DISPATCH_JOB_TYPE_BACK_LINK}
          recordId={jobType.id}
        />

        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center gap-2 py-3">
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
