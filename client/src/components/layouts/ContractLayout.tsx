import { createContext, useContext, ReactNode, useMemo } from "react";
import { FileText, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Contract } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useContractTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

export interface ContractWithCounts extends Contract {
  articleCount?: number;
  sectionCount?: number;
}

interface ContractLayoutContextValue {
  contract: ContractWithCounts;
  isLoading: boolean;
  isError: boolean;
}

const ContractLayoutContext = createContext<ContractLayoutContextValue | null>(null);

export function useContractLayout() {
  const context = useContext(ContractLayoutContext);
  if (!context) {
    throw new Error("useContractLayout must be used within ContractLayout");
  }
  return context;
}

interface ContractLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function ContractLayout({ activeTab, children }: ContractLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { tabs, getActiveRoot, isLoading: tabsLoading } = useContractTabAccess(id);

  const {
    data: contract,
    isLoading: contractLoading,
    error: contractError,
  } = useQuery<ContractWithCounts>({
    queryKey: ["/api/contracts", id],
    queryFn: async () => {
      const response = await fetch(`/api/contracts/${id}`);
      if (!response.ok) {
        throw new Error("Contract not found");
      }
      return response.json();
    },
  });

  usePageTitle(contract?.name);

  const activeRoot = useMemo(() => getActiveRoot(activeTab), [activeTab, getActiveRoot]);
  const subTabs = activeRoot?.children;

  const isLoading = contractLoading || tabsLoading;

  if (contractError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileText className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Contract Not Found</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/contracts">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-contracts">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Contracts
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
                <FileText className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Contract Not Found</h3>
              <p className="text-muted-foreground text-center">
                The contract you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/contracts">
                <Button className="mt-4" data-testid="button-return-to-contracts">
                  Return to Contracts
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading || !contract) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileText className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/contracts">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-contracts">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Contracts
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

  const contextValue: ContractLayoutContextValue = {
    contract,
    isLoading: false,
    isError: false,
  };

  return (
    <ContractLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileText className="text-primary-foreground" size={16} />
                </div>
                <h1
                  className="text-xl font-semibold text-foreground"
                  data-testid={`text-contract-name-${contract.id}`}
                >
                  {contract.name}
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/contracts">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-contracts">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Contracts
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Main Tab Navigation */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center gap-2 py-3">
              {tabs.map((tab) => {
                const isActive = tab.id === activeRoot?.id;
                return isActive ? (
                  <Button key={tab.id} variant="default" size="sm" data-testid={`button-contract-${tab.id}`}>
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button variant="outline" size="sm" data-testid={`button-contract-${tab.id}`}>
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sub-Tab Navigation */}
        {subTabs && subTabs.length > 0 && (
          <div className="bg-muted/30 border-b border-border">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex flex-wrap items-center gap-2 py-2 pl-4">
                {subTabs.map((tab) =>
                  tab.id === activeTab ? (
                    <Button key={tab.id} variant="secondary" size="sm" data-testid={`button-contract-${tab.id}`}>
                      {tab.label}
                    </Button>
                  ) : (
                    <Link key={tab.id} href={tab.href}>
                      <Button variant="ghost" size="sm" data-testid={`button-contract-${tab.id}`}>
                        {tab.label}
                      </Button>
                    </Link>
                  ),
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
      </div>
    </ContractLayoutContext.Provider>
  );
}
