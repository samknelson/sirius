import { createContext, useContext, ReactNode } from "react";
import { BookOpen, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LedgerAccountWithDetails } from "@/lib/ledger-types";
import { useLedgerAccountTabAccess } from "@/hooks/useTabAccess";

interface LedgerAccountLayoutContextValue {
  account: LedgerAccountWithDetails;
  isLoading: boolean;
  isError: boolean;
}

const LedgerAccountLayoutContext = createContext<LedgerAccountLayoutContextValue | null>(null);

export function useLedgerAccountLayout() {
  const context = useContext(LedgerAccountLayoutContext);
  if (!context) {
    throw new Error("useLedgerAccountLayout must be used within LedgerAccountLayout");
  }
  return context;
}

interface LedgerAccountLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function LedgerAccountLayout({ activeTab, children }: LedgerAccountLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: account, isLoading: accountLoading, error: accountError } = useQuery<LedgerAccountWithDetails>({
    queryKey: ["/api/ledger/accounts", id],
    queryFn: async () => {
      const response = await fetch(`/api/ledger/accounts/${id}`);
      if (!response.ok) {
        throw new Error("Account not found");
      }
      return response.json();
    },
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs } = useLedgerAccountTabAccess(id || "");

  const isLoading = accountLoading;
  const isError = !!accountError;

  // Error/Not found state
  if (accountError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <BookOpen className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Ledger Account Not Found</h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/ledger/accounts">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-accounts">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Accounts
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
                <BookOpen className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Account Not Found</h3>
              <p className="text-muted-foreground text-center">
                The ledger account you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/ledger/accounts">
                <Button className="mt-4" data-testid="button-return-to-accounts">
                  Return to Accounts
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Loading state
  if (isLoading || !account) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <BookOpen className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/ledger/accounts">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-accounts">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Accounts
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

  const contextValue: LedgerAccountLayoutContextValue = {
    account,
    isLoading: false,
    isError: false,
  };

  return (
    <LedgerAccountLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <BookOpen className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-account-name-${account.id}`}>
                  {account.name}
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/ledger/accounts">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-accounts">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Accounts
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
                    data-testid={`button-account-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-account-${tab.id}`}
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
    </LedgerAccountLayoutContext.Provider>
  );
}
