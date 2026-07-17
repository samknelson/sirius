import { createContext, useContext, ReactNode } from "react";
import { ShieldPlus, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBaoCobraCaseTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";
import type { BaoCobraCaseWithDetails } from "@shared/schema/sitespecific/bao/schema";

interface BaoCobraCaseLayoutContextValue {
  cobraCase: BaoCobraCaseWithDetails;
  isLoading: boolean;
  isError: boolean;
}

const BaoCobraCaseLayoutContext = createContext<BaoCobraCaseLayoutContextValue | null>(null);

export function useBaoCobraCaseLayout() {
  const context = useContext(BaoCobraCaseLayoutContext);
  if (!context) {
    throw new Error("useBaoCobraCaseLayout must be used within BaoCobraCaseLayout");
  }
  return context;
}

function caseTitle(cobraCase: BaoCobraCaseWithDetails): string {
  if (cobraCase.coveredPersonName) return `COBRA: ${cobraCase.coveredPersonName}`;
  return `COBRA Case ${cobraCase.id.slice(0, 8)}`;
}

interface BaoCobraCaseLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function BaoCobraCaseLayout({ activeTab, children }: BaoCobraCaseLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const {
    data: cobraCase,
    isLoading,
    error,
  } = useQuery<BaoCobraCaseWithDetails>({
    queryKey: ["/api/sitespecific/bao/cobra/cases", id],
    queryFn: async () => {
      const response = await fetch(`/api/sitespecific/bao/cobra/cases/${id}`);
      if (!response.ok) {
        throw new Error("COBRA case not found");
      }
      return response.json();
    },
  });

  const { tabs, getActiveRoot } = useBaoCobraCaseTabAccess(id || "");
  const activeRoot = getActiveRoot(activeTab);

  usePageTitle(cobraCase ? caseTitle(cobraCase) : undefined);

  const header = (subtitle?: string) => (
    <header className="bg-card border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <ShieldPlus className="text-primary-foreground" size={16} />
            </div>
            {subtitle ? (
              <>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">{subtitle}</span>
              </>
            ) : cobraCase ? (
              <h1
                className="text-xl font-semibold text-foreground"
                data-testid={`text-cobra-case-title-${cobraCase.id}`}
              >
                {caseTitle(cobraCase)}
              </h1>
            ) : (
              <Skeleton className="h-6 w-48" />
            )}
          </div>
          <div className="flex items-center space-x-4">
            <Link href="/cobra/cases">
              <Button variant="ghost" size="sm" data-testid="button-back-to-cobra-cases">
                <ArrowLeft size={16} className="mr-2" />
                Back to COBRA Cases
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );

  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        {header("COBRA Case Not Found")}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <ShieldPlus className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">
                COBRA Case Not Found
              </h3>
              <p className="text-muted-foreground text-center">
                The COBRA case you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/cobra/cases">
                <Button className="mt-4" data-testid="button-return-to-cobra-cases">
                  Return to COBRA Cases
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading || !cobraCase) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        {header()}
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

  return (
    <BaoCobraCaseLayoutContext.Provider
      value={{ cobraCase, isLoading: false, isError: false }}
    >
      <div className="bg-background text-foreground min-h-screen">
        {header()}

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
                    data-testid={`button-cobra-case-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-cobra-case-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          {children}
        </main>
      </div>
    </BaoCobraCaseLayoutContext.Provider>
  );
}
