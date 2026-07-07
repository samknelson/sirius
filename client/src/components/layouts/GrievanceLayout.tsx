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
import {
  type GrievanceTimelineStepItem,
  useDeadlineThresholds,
  deadlineColorClass,
  formatYmd,
} from "@/lib/grievance-deadlines";

export interface GrievanceLinkedWorker {
  workerId: string;
  siriusId: number | null;
  displayName: string | null;
  primary: boolean;
}

export interface GrievanceLinkedEmployer {
  employerId: string;
  name: string;
}

export interface GrievanceLinkedUser {
  id: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roleId: string;
  roleName: string | null;
}

export interface GrievanceComplaintLine {
  id: string;
  grievanceId: string;
  complaintId: string | null;
  description: string;
  sequence: number;
  complaintName: string | null;
}

export interface GrievanceRemedyLine {
  id: string;
  grievanceId: string;
  remedyId: string | null;
  description: string;
  sequence: number;
  remedyName: string | null;
}

export interface GrievanceWithDetails {
  id: string;
  siriusId: string | null;
  classDescription: string | null;
  cardinality: GrievanceCardinality;
  /** Derived from the current status-history entry; null when there is no history. */
  statusId: string | null;
  categoryId: string;
  data: unknown;
  timelineTemplateId: string | null;
  bargainingUnitId: string | null;
  employerContactId: string | null;
  statusName: string | null;
  categoryName: string | null;
  bargainingUnitName: string | null;
  name: string | null;
  workers: GrievanceLinkedWorker[];
  employers: GrievanceLinkedEmployer[];
  users: GrievanceLinkedUser[];
  complaints: GrievanceComplaintLine[];
  remedies: GrievanceRemedyLine[];
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
  if (grievance.name && grievance.name.trim()) return grievance.name;
  if (grievance.categoryName) return `${grievance.categoryName} Grievance`;
  return `Grievance ${grievance.id.slice(0, 8)}`;
}

/**
 * At-a-glance summary shown on every grievance tab: current status, current
 * timeline step (from the computed steps), its description, and its deadline
 * (color-coded by proximity via the configurable thresholds).
 */
function GrievanceSummaryBox({ grievance }: { grievance: GrievanceWithDetails }) {
  const { data: steps } = useQuery<GrievanceTimelineStepItem[]>({
    queryKey: ["/api/grievances", grievance.id, "timeline-steps"],
  });
  const thresholds = useDeadlineThresholds();

  const currentStep = steps?.find((s) => s.isCurrent) ?? null;
  const deadline = currentStep?.dueYmd ?? null;

  return (
    <Card data-testid="card-grievance-summary">
      <CardContent className="pt-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-muted-foreground">Current Status</p>
            <p className="font-medium" data-testid="text-summary-status">
              {grievance.statusName ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Current Step</p>
            <p className="font-medium" data-testid="text-summary-step">
              {currentStep?.stepName ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Step Description</p>
            <p className="text-sm" data-testid="text-summary-step-description">
              {currentStep?.stepDescription ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Deadline</p>
            <p
              className={deadline ? deadlineColorClass(deadline, thresholds) : "font-medium"}
              data-testid="text-summary-deadline"
            >
              {formatYmd(deadline)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
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

  const { tabs, getActiveRoot } = useGrievanceTabAccess(id || "");

  const activeRoot = getActiveRoot(activeTab);
  const subTabs = activeRoot?.children;

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
                const isActive = tab.id === (activeRoot?.id ?? activeTab);
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

        {/* Sub-Tab Navigation - rendered when the active root tab has children */}
        {subTabs && subTabs.length > 0 && (
          <div className="bg-muted/30 border-b border-border">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex flex-wrap items-center gap-2 py-2 pl-4">
                {subTabs.map((tab) =>
                  tab.id === activeTab ? (
                    <Button
                      key={tab.id}
                      variant="secondary"
                      size="sm"
                      data-testid={`button-grievance-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  ) : (
                    <Link key={tab.id} href={tab.href}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-grievance-${tab.id}`}
                      >
                        {tab.label}
                      </Button>
                    </Link>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <GrievanceSummaryBox grievance={grievance} />
          {children}
        </main>
      </div>
    </GrievanceLayoutContext.Provider>
  );
}
