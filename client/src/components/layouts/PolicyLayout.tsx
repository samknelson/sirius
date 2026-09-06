import { createContext, useContext, ReactNode } from "react";
import { FileText } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Policy } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RecordTitleBar,
  RecordTitleBarLoading,
  RecordTitleBarNotFound,
} from "@/components/shared/RecordTitleBar";
import { usePolicyTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

const POLICY_BACK_LINK = {
  href: "/config/policies",
  label: "Back to Policies",
  testId: "button-back-to-policies",
};

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
        <RecordTitleBarNotFound
          icon={<FileText className="text-primary-foreground" size={16} />}
          label="Policy Not Found"
          backLink={POLICY_BACK_LINK}
        />

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
        <RecordTitleBarLoading
          icon={<FileText className="text-primary-foreground" size={16} />}
          backLink={POLICY_BACK_LINK}
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

  const contextValue: PolicyLayoutContextValue = {
    policy,
    isLoading: false,
    isError: false,
  };

  return (
    <PolicyLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBar
          icon={<FileText className="text-primary-foreground" size={16} />}
          title={policy.name || policy.siriusId}
          titleTestId={`text-policy-name-${policy.id}`}
          backLink={POLICY_BACK_LINK}
          recordId={policy.id}
        />

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
