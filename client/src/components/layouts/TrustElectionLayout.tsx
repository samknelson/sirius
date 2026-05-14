import { createContext, useContext, ReactNode } from "react";
import { Vote, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { WorkerTrustElectionView } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useTrustElectionTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface TrustElectionLayoutContextValue {
  election: WorkerTrustElectionView;
  isLoading: boolean;
  isError: boolean;
}

const TrustElectionLayoutContext = createContext<TrustElectionLayoutContextValue | null>(null);

export function useTrustElectionLayout() {
  const context = useContext(TrustElectionLayoutContext);
  if (!context) {
    throw new Error("useTrustElectionLayout must be used within TrustElectionLayout");
  }
  return context;
}

interface TrustElectionLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function TrustElectionLayout({ activeTab, children }: TrustElectionLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: election, isLoading: electionLoading, error: electionError } = useQuery<WorkerTrustElectionView>({
    queryKey: ["/api/trust-elections", id],
    queryFn: async () => {
      const response = await fetch(`/api/trust-elections/${id}`);
      if (!response.ok) {
        throw new Error("Trust election not found");
      }
      return response.json();
    },
  });

  const { tabs } = useTrustElectionTabAccess(id || "");

  usePageTitle(election ? `Trust Election` : undefined);

  const backHref = election
    ? `/workers/${election.workerId}/elections/list`
    : "/workers";

  if (electionError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Vote className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Trust Election Not Found</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href={backHref}>
                  <Button variant="ghost" size="sm" data-testid="button-back-to-elections">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to worker elections
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
                <Vote className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Trust Election Not Found</h3>
              <p className="text-muted-foreground text-center">
                The trust election you're looking for doesn't exist or has been removed.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (electionLoading || !election) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Vote className="text-primary-foreground" size={16} />
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

  const contextValue: TrustElectionLayoutContextValue = {
    election,
    isLoading: false,
    isError: false,
  };

  return (
    <TrustElectionLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Vote className="text-primary-foreground" size={16} />
                </div>
                <h1
                  className="text-xl font-semibold text-foreground"
                  data-testid={`text-election-title-${election.id}`}
                >
                  Trust Election
                </h1>
                <Badge
                  variant={election.endYmd ? "secondary" : "default"}
                  data-testid="badge-election-status"
                >
                  {election.endYmd ? "Ended" : "Active"}
                </Badge>
              </div>
              <div className="flex items-center space-x-4">
                <Link href={backHref}>
                  <Button variant="ghost" size="sm" data-testid="button-back-to-elections">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to worker elections
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
                    data-testid={`button-election-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-election-${tab.id}`}
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
    </TrustElectionLayoutContext.Provider>
  );
}
