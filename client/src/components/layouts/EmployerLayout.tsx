import { createContext, useContext, ReactNode, useMemo } from "react";
import { Building2, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookmarkButton } from "@/components/ui/bookmark-button";
import { useAuth } from "@/contexts/AuthContext";
import { useTerm } from "@/contexts/TerminologyContext";

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
  activeTab: "details" | "edit" | "workers" | "contacts" | "wizards" | "accounting" | "accounts" | "payment-methods" | "customer" | "logs" | "policy-history" | "union" | "stewards" | "dispatch";
  children: ReactNode;
}

export function EmployerLayout({ activeTab, children }: EmployerLayoutProps) {
  const { id } = useParams<{ id: string }>();
  const { hasPermission, hasComponent } = useAuth();
  const term = useTerm();

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

  // Loading state - check this AFTER error handling
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

  // Success state - render layout with tabs
  const mainTabs = [
    { id: "details", label: "Details", href: `/employers/${employer.id}` },
    { id: "edit", label: "Edit", href: `/employers/${employer.id}/edit` },
    { id: "workers", label: "Workers", href: `/employers/${employer.id}/workers` },
    { id: "contacts", label: "Contacts", href: `/employers/${employer.id}/contacts` },
    { id: "policy-history", label: "Policy History", href: `/employers/${employer.id}/policy-history` },
    { id: "wizards", label: "Wizards", href: `/employers/${employer.id}/wizards` },
    { id: "logs", label: "Logs", href: `/employers/${employer.id}/logs` },
  ];

  // Add accounting tab if user has permission
  const hasAccountingAccess = hasPermission('admin') || hasPermission('ledger.staff') || hasPermission('ledger.employer');
  if (hasAccountingAccess) {
    mainTabs.push(
      { id: "accounting", label: "Accounting", href: `/employers/${employer.id}/ledger/accounts` }
    );
  }

  // Add Union tab if worker.steward component is enabled
  const hasUnionAccess = hasComponent('worker.steward');
  if (hasUnionAccess) {
    mainTabs.push(
      { id: "union", label: "Union", href: `/employers/${employer.id}/union/stewards` }
    );
  }

  // Add Dispatch tab if dispatch component is enabled
  const hasDispatchAccess = hasComponent('dispatch');
  if (hasDispatchAccess) {
    mainTabs.push(
      { id: "dispatch", label: "Dispatch", href: `/employers/${employer.id}/dispatch` }
    );
  }

  const accountingSubTabs = [
    { id: "accounts", label: "Accounts", href: `/employers/${employer.id}/ledger/accounts` },
    { id: "payment-methods", label: "Payment Methods", href: `/employers/${employer.id}/ledger/stripe/payment_methods` },
    { id: "customer", label: "Customer", href: `/employers/${employer.id}/ledger/stripe/customer` },
  ];

  const unionSubTabs = [
    { id: "stewards", label: term("steward", { plural: true }), href: `/employers/${employer.id}/union/stewards` },
  ];

  // Determine if we're in a sub-tab
  const isAccountingSubTab = ["accounts", "payment-methods", "customer"].includes(activeTab);
  const showAccountingSubTabs = isAccountingSubTab;
  
  const isUnionSubTab = ["stewards"].includes(activeTab);
  const showUnionSubTabs = isUnionSubTab;

  const contextValue: EmployerLayoutContextValue = {
    employer,
    isLoading: false,
    isError: false,
  };

  return (
    <EmployerLayoutContext.Provider value={contextValue}>
      {/* Entity Header */}
      <section className="bg-card border-b border-border">
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
      </section>

      {/* Main Tab Navigation */}
      <section className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {mainTabs.map((tab) => {
              const isActive = tab.id === activeTab || (tab.id === "accounting" && isAccountingSubTab) || (tab.id === "union" && isUnionSubTab);
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
      </section>

      {/* Accounting Sub-Tab Navigation */}
      {showAccountingSubTabs && (
        <section className="bg-muted/30 border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-2 pl-4">
              {accountingSubTabs.map((tab) => (
                tab.id === activeTab ? (
                  <Button
                    key={tab.id}
                    variant="secondary"
                    size="sm"
                    data-testid={`button-employer-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-employer-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                )
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Union Sub-Tab Navigation */}
      {showUnionSubTabs && (
        <section className="bg-muted/30 border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-2 pl-4">
              {unionSubTabs.map((tab) => (
                tab.id === activeTab ? (
                  <Button
                    key={tab.id}
                    variant="secondary"
                    size="sm"
                    data-testid={`button-employer-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-employer-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                )
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </div>
    </EmployerLayoutContext.Provider>
  );
}
