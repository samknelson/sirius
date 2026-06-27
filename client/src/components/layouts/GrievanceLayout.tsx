import { createContext, useContext, ReactNode } from "react";
import { FileText, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGrievanceTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { type GrievanceCardinality } from "@shared/schema";

export interface GrievanceLinkedWorker {
  workerId: string;
  siriusId: number | null;
  displayName: string | null;
}

export interface GrievanceLinkedEmployer {
  employerId: string;
  name: string;
}

export interface GrievanceWithDetails {
  id: string;
  complaint: string | null;
  remedy: string | null;
  classDescription: string | null;
  cardinality: GrievanceCardinality;
  statusId: string;
  categoryId: string;
  data: unknown;
  statusName: string | null;
  categoryName: string | null;
  workers: GrievanceLinkedWorker[];
  employers: GrievanceLinkedEmployer[];
}

interface GrievanceLayoutContextValue {
  grievance: GrievanceWithDetails;
  isLoading: boolean;
  isError: boolean;
}

const GrievanceLayoutContext = createContext<GrievanceLayoutContextValue | null>(null);

export function useGrievanceLayout() {
  const context = useContext(GrievanceLayoutContext);
  if (!context) {
    throw new Error("useGrievanceLayout must be used within GrievanceLayout");
  }
  return context;
}

function grievanceTitle(grievance: GrievanceWithDetails): string {
  if (grievance.categoryName) return `${grievance.categoryName} Grievance`;
  return `Grievance ${grievance.id.slice(0, 8)}`;
}

interface GrievanceLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function GrievanceLayout({ activeTab, children }: GrievanceLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: grievance, isLoading: grievanceLoading, error: grievanceError } =
    useQuery<GrievanceWithDetails>({
      queryKey: ["/api/grievances", id],
      queryFn: async () => {
        const response = await fetch(`/api/grievances/${id}`);
        if (!response.ok) {
          throw new Error("Grievance not found");
        }
        return response.json();
      },
    });

  const { tabs } = useGrievanceTabAccess(id || "");

  usePageTitle(grievance ? grievanceTitle(grievance) : undefined);

  const isLoading = grievanceLoading;

  if (grievanceError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileText className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Grievance Not Found</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/grievances">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-grievances">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Grievances
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
                <FileText className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Grievance Not Found</h3>
              <p className="text-muted-foreground text-center">
                The grievance you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/grievances">
                <Button className="mt-4" data-testid="button-return-to-grievances">
                  Return to Grievances
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading || !grievance) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileText className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/grievances">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-grievances">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Grievances
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

  const contextValue: GrievanceLayoutContextValue = {
    grievance,
    isLoading: false,
    isError: false,
  };

  return (
    <GrievanceLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileText className="text-primary-foreground" size={16} />
                </div>
                <h1
                  className="text-xl font-semibold text-foreground"
                  data-testid={`text-grievance-title-${grievance.id}`}
                >
                  {grievanceTitle(grievance)}
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/grievances">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-grievances">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Grievances
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center gap-2 py-3">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-grievance-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-grievance-${tab.id}`}
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
    </GrievanceLayoutContext.Provider>
  );
}
