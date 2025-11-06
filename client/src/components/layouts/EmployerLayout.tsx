import { createContext, useContext, ReactNode } from "react";
import { Building2, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookmarkButton } from "@/components/ui/bookmark-button";
import { useAuth } from "@/contexts/AuthContext";

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
  activeTab: "details" | "edit" | "accounting-customer" | "accounting-payment-methods";
  children: ReactNode;
}

export function EmployerLayout({ activeTab, children }: EmployerLayoutProps) {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();

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

  const isLoading = employerLoading;
  const isError = !!employerError;

  // Error/Not found state - check this BEFORE loading
  if (employerError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Building2 className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Employer Not Found</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/employers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-employers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Employers
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
        </main>
      </div>
    );
  }

  // Loading state - check this AFTER error handling
  if (isLoading || !employer) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Building2 className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/employers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-employers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Employers
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

  // Success state - render layout with tabs
  const tabs = [
    { id: "details", label: "Details", href: `/employers/${employer.id}` },
    { id: "edit", label: "Edit", href: `/employers/${employer.id}/edit` },
  ];

  // Add accounting tabs if user has permission
  const hasAccountingAccess = hasPermission('admin') || hasPermission('ledger.staff') || hasPermission('ledger.employer');
  if (hasAccountingAccess) {
    tabs.push(
      { id: "accounting-customer", label: "Accounting: Customer", href: `/employers/${employer.id}/ledger/stripe/customer` },
      { id: "accounting-payment-methods", label: "Accounting: Payment Methods", href: `/employers/${employer.id}/ledger/stripe/payment_methods` }
    );
  }

  const contextValue: EmployerLayoutContextValue = {
    employer,
    isLoading: false,
    isError: false,
  };

  return (
    <EmployerLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Building2 className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-employer-name-${employer.id}`}>
                  {employer.name}
                </h1>
                <BookmarkButton entityType="employer" entityId={employer.id} entityName={employer.name} />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/employers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-employers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Employers
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
                    data-testid={`button-employer-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-employer-${tab.id}`}
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
    </EmployerLayoutContext.Provider>
  );
}
