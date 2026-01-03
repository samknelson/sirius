import { createContext, useContext, ReactNode } from "react";
import { Heart, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { TrustBenefit } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTrustBenefitTabAccess } from "@/hooks/useTabAccess";

interface TrustBenefitLayoutContextValue {
  benefit: TrustBenefit;
  isLoading: boolean;
  isError: boolean;
}

const TrustBenefitLayoutContext = createContext<TrustBenefitLayoutContextValue | null>(null);

export function useTrustBenefitLayout() {
  const context = useContext(TrustBenefitLayoutContext);
  if (!context) {
    throw new Error("useTrustBenefitLayout must be used within TrustBenefitLayout");
  }
  return context;
}

interface TrustBenefitLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function TrustBenefitLayout({ activeTab, children }: TrustBenefitLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: benefit, isLoading: benefitLoading, error: benefitError } = useQuery<TrustBenefit>({
    queryKey: ["/api/trust-benefits", id],
    queryFn: async () => {
      const response = await fetch(`/api/trust-benefits/${id}`);
      if (!response.ok) {
        throw new Error("Trust benefit not found");
      }
      return response.json();
    },
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs } = useTrustBenefitTabAccess(id || "");

  const isLoading = benefitLoading;
  const isError = !!benefitError;

  // Error/Not found state
  if (benefitError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Heart className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Trust Benefit Not Found</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/trust-benefits">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-benefits">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Trust Benefits
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
                <Heart className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Trust Benefit Not Found</h3>
              <p className="text-muted-foreground text-center">
                The trust benefit you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/trust-benefits">
                <Button className="mt-4" data-testid="button-return-to-benefits">
                  Return to Trust Benefits
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Loading state
  if (isLoading || !benefit) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Heart className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/trust-benefits">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-benefits">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Trust Benefits
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

  const contextValue: TrustBenefitLayoutContextValue = {
    benefit,
    isLoading: false,
    isError: false,
  };

  return (
    <TrustBenefitLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Heart className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-benefit-name-${benefit.id}`}>
                  {benefit.name}
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/trust-benefits">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-benefits">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Trust Benefits
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Tab Navigation */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-3">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-benefit-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-benefit-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </TrustBenefitLayoutContext.Provider>
  );
}
