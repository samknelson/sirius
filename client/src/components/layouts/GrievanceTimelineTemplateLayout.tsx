import { createContext, useContext, ReactNode } from "react";
import { FileText, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGrievanceTimelineTemplateTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

export interface GrievanceTimelineTemplateStepDetails {
  id: string;
  templateId: string;
  fromStatuses: string[];
  toStatuses: string[];
  stepId: string;
  days: number;
  dayType: "calendar" | "business";
  sequence: number;
  stepName: string | null;
  stepActor: string | null;
}

export interface GrievanceTimelineTemplateWithSteps {
  id: string;
  title: string;
  description: string | null;
  data: unknown;
  steps: GrievanceTimelineTemplateStepDetails[];
}

interface GrievanceTimelineTemplateLayoutContextValue {
  template: GrievanceTimelineTemplateWithSteps;
  isLoading: boolean;
  isError: boolean;
}

const GrievanceTimelineTemplateLayoutContext =
  createContext<GrievanceTimelineTemplateLayoutContextValue | null>(null);

export function useGrievanceTimelineTemplateLayout() {
  const context = useContext(GrievanceTimelineTemplateLayoutContext);
  if (!context) {
    throw new Error(
      "useGrievanceTimelineTemplateLayout must be used within GrievanceTimelineTemplateLayout",
    );
  }
  return context;
}

interface GrievanceTimelineTemplateLayoutProps {
  activeTab: string;
  children: ReactNode;
}

const BACK_HREF = "/grievance-timeline-templates";

export function GrievanceTimelineTemplateLayout({
  activeTab,
  children,
}: GrievanceTimelineTemplateLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const {
    data: template,
    isLoading: templateLoading,
    error: templateError,
  } = useQuery<GrievanceTimelineTemplateWithSteps>({
    queryKey: ["/api/grievance-timeline-templates", id],
    queryFn: async () => {
      const response = await fetch(`/api/grievance-timeline-templates/${id}`);
      if (!response.ok) {
        throw new Error("Timeline template not found");
      }
      return response.json();
    },
  });

  const { tabs } = useGrievanceTimelineTemplateTabAccess(id || "");

  usePageTitle(template ? template.title : undefined);

  if (templateError) {
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
                <span className="text-muted-foreground text-sm font-medium">
                  Timeline Template Not Found
                </span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href={BACK_HREF}>
                  <Button variant="ghost" size="sm" data-testid="button-back-to-timeline-templates">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Timeline Templates
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
              <h3 className="text-lg font-medium text-foreground mb-2">
                Timeline Template Not Found
              </h3>
              <p className="text-muted-foreground text-center">
                The timeline template you're looking for doesn't exist or has been removed.
              </p>
              <Link href={BACK_HREF}>
                <Button className="mt-4" data-testid="button-return-to-timeline-templates">
                  Return to Timeline Templates
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (templateLoading || !template) {
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
                <Link href={BACK_HREF}>
                  <Button variant="ghost" size="sm" data-testid="button-back-to-timeline-templates">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Timeline Templates
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

  const contextValue: GrievanceTimelineTemplateLayoutContextValue = {
    template,
    isLoading: false,
    isError: false,
  };

  return (
    <GrievanceTimelineTemplateLayoutContext.Provider value={contextValue}>
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
                  data-testid={`text-timeline-template-title-${template.id}`}
                >
                  {template.title}
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href={BACK_HREF}>
                  <Button variant="ghost" size="sm" data-testid="button-back-to-timeline-templates">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Timeline Templates
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
                    data-testid={`button-timeline-template-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-timeline-template-${tab.id}`}
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
    </GrievanceTimelineTemplateLayoutContext.Provider>
  );
}
