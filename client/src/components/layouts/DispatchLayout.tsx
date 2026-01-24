import { createContext, useContext, ReactNode } from "react";
import { Send, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { DispatchWithRelations } from "../../../../server/storage/dispatches";
import { useDispatchTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface DispatchLayoutContextValue {
  dispatch: DispatchWithRelations;
  isLoading: boolean;
  isError: boolean;
}

const DispatchLayoutContext = createContext<DispatchLayoutContextValue | null>(null);

export function useDispatchLayout() {
  const context = useContext(DispatchLayoutContext);
  if (!context) {
    throw new Error("useDispatchLayout must be used within DispatchLayout");
  }
  return context;
}

interface DispatchLayoutProps {
  activeTab: string;
  children: ReactNode;
}

const statusColors: Record<string, string> = {
  requested: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  pending: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  notified: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  accepted_primary: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  accepted_secondary: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  layoff: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  resigned: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  declined: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function getWorkerName(dispatch: DispatchWithRelations): string {
  if (!dispatch.worker) return 'Unknown Worker';
  const contact = dispatch.worker.contact;
  if (contact) {
    const name = `${contact.given || ''} ${contact.family || ''}`.trim();
    return name || contact.displayName || `Worker #${dispatch.worker.siriusId}`;
  }
  return `Worker #${dispatch.worker.siriusId}`;
}

export function DispatchLayout({ activeTab, children }: DispatchLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: dispatch, isLoading: dispatchLoading, error: dispatchError } = useQuery<DispatchWithRelations>({
    queryKey: ["/api/dispatches", id],
  });

  const { tabs } = useDispatchTabAccess(id || "");

  usePageTitle(dispatch ? `Dispatch - ${getWorkerName(dispatch)}` : "Dispatch");

  const isLoading = dispatchLoading;
  const isError = !!dispatchError;

  if (dispatchError) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Send className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2" data-testid="text-error-title">Dispatch Not Found</h3>
            <p className="text-muted-foreground text-center" data-testid="text-error-message">
              The dispatch you're looking for doesn't exist or has been removed.
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

  if (isLoading || !dispatch) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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

  const backUrl = dispatch.jobId ? `/dispatch/job/${dispatch.jobId}/dispatches/list` : '/dispatch/jobs';

  return (
    <DispatchLayoutContext.Provider value={{ dispatch, isLoading, isError }}>
      <section className="bg-background border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-start gap-4">
            <Link href={backUrl}>
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground" data-testid="title-dispatch">
                  {getWorkerName(dispatch)}
                </h1>
                <Badge className={statusColors[dispatch.status] || statusColors.pending} data-testid="badge-status">
                  {formatStatus(dispatch.status)}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1" data-testid="text-job-title">
                {dispatch.job?.title || 'Unknown Job'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;
              return isActive ? (
                <Button
                  key={tab.id}
                  variant="default"
                  size="sm"
                  data-testid={`button-tab-${tab.id}`}
                >
                  {tab.label}
                </Button>
              ) : (
                <Link key={tab.id} href={tab.href}>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`button-tab-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </DispatchLayoutContext.Provider>
  );
}
