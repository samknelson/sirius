import { createContext, useContext, ReactNode } from "react";
import { Link, ArrowLeft } from "lucide-react";
import { Link as RouterLink, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface LedgerEa {
  id: string;
  entityType: string;
  entityId: string;
  accountId: string;
}

interface LedgerAccount {
  id: string;
  name: string;
  currencyCode: string;
}

interface LedgerEaLayoutContextValue {
  ea: LedgerEa;
  account: LedgerAccount | null;
  currencyCode: string;
  isLoading: boolean;
  isError: boolean;
}

const LedgerEaLayoutContext = createContext<LedgerEaLayoutContextValue | null>(null);

export function useLedgerEaLayout() {
  const context = useContext(LedgerEaLayoutContext);
  if (!context) {
    throw new Error("useLedgerEaLayout must be used within LedgerEaLayout");
  }
  return context;
}

interface LedgerEaLayoutProps {
  activeTab: "view" | "edit" | "transactions";
  children: ReactNode;
}

export function LedgerEaLayout({ activeTab, children }: LedgerEaLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: ea, isLoading: eaLoading, error: eaError } = useQuery<LedgerEa>({
    queryKey: ["/api/ledger/ea", id],
    queryFn: async () => {
      const response = await fetch(`/api/ledger/ea/${id}`);
      if (!response.ok) {
        throw new Error("EA entry not found");
      }
      return response.json();
    },
  });

  const { data: account, isLoading: accountLoading } = useQuery<LedgerAccount>({
    queryKey: ["/api/ledger/accounts", ea?.accountId],
    queryFn: async () => {
      const response = await fetch(`/api/ledger/accounts/${ea!.accountId}`);
      if (!response.ok) {
        throw new Error("Account not found");
      }
      return response.json();
    },
    enabled: !!ea?.accountId,
  });

  const isLoading = eaLoading || accountLoading;
  const isError = !!eaError;

  // Error/Not found state
  if (eaError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Link className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Entity-Account Entry Not Found</h1>
              </div>
              <div className="flex items-center space-x-4">
                <RouterLink href="/ledger/ea">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-ea">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to EA Entries
                  </Button>
                </RouterLink>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Link className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Entry Not Found</h3>
              <p className="text-muted-foreground text-center">
                The entity-account entry you're looking for doesn't exist or has been removed.
              </p>
              <RouterLink href="/ledger/ea">
                <Button className="mt-4" data-testid="button-return-to-ea">
                  Return to EA Entries
                </Button>
              </RouterLink>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Loading state
  if (isLoading || !ea) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Link className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <RouterLink href="/ledger/ea">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-ea">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to EA Entries
                  </Button>
                </RouterLink>
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
    { id: "view", label: "View", href: `/ledger/ea/${ea.id}` },
    { id: "edit", label: "Edit", href: `/ledger/ea/${ea.id}/edit` },
    { id: "transactions", label: "Transactions", href: `/ledger/ea/${ea.id}/transactions` },
  ];

  const contextValue: LedgerEaLayoutContextValue = {
    ea,
    account: account || null,
    currencyCode: account?.currencyCode || "USD",
    isLoading: false,
    isError: false,
  };

  return (
    <LedgerEaLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Link className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-ea-id-${ea.id}`}>
                  EA: {ea.entityType} ({ea.id.substring(0, 8)})
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <RouterLink href="/ledger/ea">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-ea">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to EA Entries
                  </Button>
                </RouterLink>
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
                    data-testid={`button-ea-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <RouterLink key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-ea-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </RouterLink>
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
    </LedgerEaLayoutContext.Provider>
  );
}
