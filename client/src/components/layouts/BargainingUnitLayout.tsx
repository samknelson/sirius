import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type { BargainingUnit } from "@shared/schema";
import { createContext, useContext } from "react";
import { useBargainingUnitTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface BargainingUnitLayoutContextValue {
  bargainingUnit: BargainingUnit;
  isLoading: boolean;
  isError: boolean;
}

const BargainingUnitLayoutContext = createContext<BargainingUnitLayoutContextValue | undefined>(undefined);

export function useBargainingUnitLayout() {
  const context = useContext(BargainingUnitLayoutContext);
  if (!context) {
    throw new Error("useBargainingUnitLayout must be used within BargainingUnitLayout");
  }
  return context;
}

interface BargainingUnitLayoutProps {
  children: React.ReactNode;
  activeTab: string;
}

export default function BargainingUnitLayout({ children, activeTab }: BargainingUnitLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: bargainingUnit, isLoading, error } = useQuery<BargainingUnit>({
    queryKey: ["/api/bargaining-units", id],
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs: mainTabs } = useBargainingUnitTabAccess(id || "");

  // Set page title based on bargaining unit name
  usePageTitle(bargainingUnit?.name);

  if (isLoading || !bargainingUnit) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Users className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/bargaining-units">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-bargaining-units">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Bargaining Units
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

  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Users className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Bargaining Unit Not Found</h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/bargaining-units">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-bargaining-units">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Bargaining Units
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
                The bargaining unit you're looking for doesn't exist or has been removed.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const contextValue: BargainingUnitLayoutContextValue = {
    bargainingUnit,
    isLoading: false,
    isError: false,
  };

  return (
    <BargainingUnitLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Users className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-bargaining-unit-name-${bargainingUnit.id}`}>
                  {bargainingUnit.name}
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/bargaining-units">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-bargaining-units">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Bargaining Units
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
                    data-testid={`button-bargaining-unit-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-bargaining-unit-${tab.id}`}
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
    </BargainingUnitLayoutContext.Provider>
  );
}

export { BargainingUnitLayout };
