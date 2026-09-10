import { createContext, useContext, ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RecordTitleBar,
  RecordTitleBarLoading,
  RecordTitleBarNotFound,
} from "@/components/shared/RecordTitleBar";
import { LedgerAccountWithDetails } from "@/lib/ledger-types";
import { useLedgerAccountTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

const LEDGER_ACCOUNT_BACK_LINK = {
  href: "/ledger/accounts",
  label: "Back to Accounts",
  testId: "button-back-to-accounts",
};

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

  // Set page title based on account name
  usePageTitle(account?.name);

  const isLoading = accountLoading;
  const isError = !!accountError;

  // Error/Not found state
  if (accountError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarNotFound
          icon={<BookOpen className="text-primary-foreground" size={16} />}
          label="Ledger Account Not Found"
          backLink={LEDGER_ACCOUNT_BACK_LINK}
        />

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
        <RecordTitleBarLoading
          icon={<BookOpen className="text-primary-foreground" size={16} />}
          backLink={LEDGER_ACCOUNT_BACK_LINK}
        />

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
        <RecordTitleBar
          icon={<BookOpen className="text-primary-foreground" size={16} />}
          title={account.name}
          titleTestId={`text-account-name-${account.id}`}
          backLink={LEDGER_ACCOUNT_BACK_LINK}
          recordId={account.id}
        />

        {/* Tab Navigation */}
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
