import { createContext, useContext, ReactNode } from "react";
import { FileText, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Policy } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePolicyTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface PolicyLayoutContextValue {
  policy: Policy;
  isLoading: boolean;
  isError: boolean;
}

const PolicyLayoutContext = createContext<PolicyLayoutContextValue | null>(null);

export function usePolicyLayout() {
  const context = useContext(PolicyLayoutContext);
  if (!context) {
    throw new Error("usePolicyLayout must be used within PolicyLayout");
  }
  return context;
}

interface PolicyLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function PolicyLayout({ activeTab, children }: PolicyLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: policy, isLoading: policyLoading, error: policyError } = useQuery<Policy>({
    queryKey: ["/api/policies", id],
    queryFn: async () => {
      const response = await fetch(`/api/policies/${id}`);
      if (!response.ok) {
        throw new Error("Policy not found");
      }
      return response.json();
    },
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs } = usePolicyTabAccess(id || "");

  // Set page title based on policy name
  usePageTitle(policy?.name);

  const isLoading = policyLoading;
  const isError = !!policyError;

  if (policyError) {
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
                <span className="text-muted-foreground text-sm font-medium">Policy Not Found</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/config/policies">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-policies">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Policies
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
              <h3 className="text-lg font-medium text-foreground mb-2">Policy Not Found</h3>
              <p className="text-muted-foreground text-center">
                The policy you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/config/policies">
                <Button className="mt-4" data-testid="button-return-to-policies">
                  Return to Policies
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading || !policy) {
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
                <Link href="/config/policies">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-policies">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Policies
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

  const contextValue: PolicyLayoutContextValue = {
    policy,
    isLoading: false,
    isError: false,
  };

  return (
    <PolicyLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileText className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-policy-name-${policy.id}`}>
                  {policy.name || policy.siriusId}
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/config/policies">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-policies">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Policies
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

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
                    data-testid={`button-policy-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-policy-${tab.id}`}
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
    </PolicyLayoutContext.Provider>
  );
}
