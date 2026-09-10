import { createContext, useContext, ReactNode, useMemo } from "react";
import { Building2 } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookmarkButton } from "@/components/ui/bookmark-button";
import { DebugRecordViewer } from "@/components/debug/DebugRecordViewer";
import { useEmployerTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { RecordTitleBar } from "@/components/shared/RecordTitleBar";
import { EntityTabNavigation } from "@/components/shared/EntityTabNavigation";

const EMPLOYER_BACK_LINK = {
  href: "/employers",
  label: "Back to Employers",
  testId: "button-back-to-employers",
};

interface EmployerLayoutContextValue {
  employer: Employer;
  isLoading: boolean;
  isError: boolean;
}

const EmployerLayoutContext = createContext<EmployerLayoutContextValue | null>(null);

export function useEmployerLayout() {
  const context = useContext(EmployerLayoutContext);
  if (!context) {
    throw new Error("useEmployerLayout must be used within EmployerLayout");
  }
  return context;
}

interface EmployerLayoutProps {
  activeTab: string;
  children: ReactNode;
}


export function EmployerLayout({ activeTab, children }: EmployerLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: employer, isLoading: employerLoading, error: employerError } = useQuery<Employer>({
    queryKey: ["/api/employers", id],
    queryFn: async () => {
      const response = await fetch(`/api/employers/${id}`);
      if (!response.ok) {
        throw new Error("Employer not found");
      }
      return response.json();
    },
  });

  const { 
    tabs,
    getActiveRoot,
    isLoading: tabAccessLoading 
  } = useEmployerTabAccess(id || '');

  const isLoading = employerLoading || tabAccessLoading;

  // Set page title based on employer name
  usePageTitle(employer?.name);

  // Terminology is now applied centrally in useTabAccess hook
  const mainTabs = tabs;
  
  const activeRoot = useMemo(() => {
    return getActiveRoot(activeTab);
  }, [activeTab, getActiveRoot]);

  const subTabs = activeRoot?.children;

  if (employerError) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Building2 className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">Employer Not Found</h3>
            <p className="text-muted-foreground text-center">
              The employer you're looking for doesn't exist or has been removed.
            </p>
            <Link href="/employers">
              <Button className="mt-4" data-testid="button-return-to-employers">
                Return to Employers
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !employer) {
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

  const contextValue: EmployerLayoutContextValue = {
    employer,
    isLoading: false,
    isError: false,
  };

  return (
    <EmployerLayoutContext.Provider value={contextValue}>
      {/* Entity Header */}
      <RecordTitleBar
        icon={<Building2 className="text-primary-foreground" size={16} />}
        title={employer.name}
        titleTestId={`text-employer-name-${employer.id}`}
        badges={<BookmarkButton entityType="employer" entityId={employer.id} entityName={employer.name} />}
        actions={<DebugRecordViewer record={employer} entityLabel="Employer" />}
        backLink={EMPLOYER_BACK_LINK}
        recordId={employer.id}
      />

      <EntityTabNavigation
        tabs={mainTabs}
        activeTab={activeTab}
        activeRootId={activeRoot?.id}
        subTabs={subTabs}
        testIdPrefix="button-employer-"
      />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </div>
    </EmployerLayoutContext.Provider>
  );
}
