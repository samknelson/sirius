import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { EntityTabNavigation } from "@/components/shared/EntityTabNavigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type { TrustProvider } from "@shared/schema";
import { createContext, useContext, useMemo } from "react";
import { useProviderTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  RecordTitleBar,
  RecordTitleBarLoading,
  RecordTitleBarNotFound,
} from "@/components/shared/RecordTitleBar";

const TRUST_PROVIDER_BACK_LINK = {
  href: "/trust/providers",
  label: "Back to Providers",
  testId: "button-back-to-providers",
};

interface TrustProviderLayoutContextValue {
  provider: TrustProvider | undefined;
  isLoading: boolean;
  isError: boolean;
}

const TrustProviderLayoutContext = createContext<TrustProviderLayoutContextValue | undefined>(undefined);

export function useTrustProviderLayout() {
  const context = useContext(TrustProviderLayoutContext);
  if (!context) {
    throw new Error("useTrustProviderLayout must be used within TrustProviderLayout");
  }
  return context;
}

interface TrustProviderLayoutProps {
  children: React.ReactNode;
  activeTab: string;
}

export default function TrustProviderLayout({ children, activeTab }: TrustProviderLayoutProps) {
  const { id } = useParams<{ id: string }>();
  const { data: provider, isLoading: providerLoading, error } = useQuery<TrustProvider>({
    queryKey: ["/api/trust/provider", id],
    queryFn: async () => {
      const response = await fetch(`/api/trust/provider/${id}`);
      if (!response.ok) {
        throw new Error("Trust provider not found");
      }
      return response.json();
    },
  });

  const { 
    tabs,
    getActiveRoot,
    isLoading: tabAccessLoading 
  } = useProviderTabAccess(id || '');
  
  const isLoading = providerLoading || tabAccessLoading;

  const mainTabs = tabs;
  
  const activeRoot = useMemo(() => {
    return getActiveRoot(activeTab);
  }, [activeTab, getActiveRoot]);

  const subTabs = activeRoot?.children;

  // Set page title based on provider name
  usePageTitle(provider?.name);

  if (isLoading || !provider) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarLoading
          icon={<Shield className="text-primary-foreground" size={16} />}
          backLink={TRUST_PROVIDER_BACK_LINK}
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

  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarNotFound
          icon={<Shield className="text-primary-foreground" size={16} />}
          label="Trust Provider Not Found"
          backLink={TRUST_PROVIDER_BACK_LINK}
        />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-muted-foreground">
                The trust provider you're looking for doesn't exist or has been removed.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const contextValue: TrustProviderLayoutContextValue = {
    provider,
    isLoading: false,
    isError: false,
  };

  return (
    <TrustProviderLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <RecordTitleBar
          icon={<Shield className="text-primary-foreground" size={16} />}
          title={provider.name}
          titleTestId={`text-provider-name-${provider.id}`}
          backLink={TRUST_PROVIDER_BACK_LINK}
          recordId={provider.id}
        />

        <EntityTabNavigation
          tabs={mainTabs}
          activeTab={activeTab}
          activeRootId={activeRoot?.id}
          subTabs={subTabs}
          testIdPrefix="button-provider-"
        />

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </TrustProviderLayoutContext.Provider>
  );
}
