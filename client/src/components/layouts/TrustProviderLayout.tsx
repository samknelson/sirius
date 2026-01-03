import { useParams, Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type { TrustProvider } from "@shared/schema";
import { createContext, useContext, useMemo } from "react";
import { useProviderTabAccess, ResolvedTab } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

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
  const [location] = useLocation();

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
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Shield className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/trust/providers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-providers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Providers
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

  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Shield className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Trust Provider Not Found</h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/trust/providers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-providers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Providers
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

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
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Shield className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-provider-name-${provider.id}`}>
                  {provider.name}
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/trust/providers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-providers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Providers
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Main Tab Navigation - rendered dynamically from registry */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-3">
              {mainTabs.map((tab) => {
                const isActive = tab.id === activeRoot?.id;
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-provider-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-provider-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sub-Tab Navigation - rendered dynamically when parent has children */}
        {subTabs && subTabs.length > 0 && (
          <div className="bg-muted/30 border-b border-border">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center space-x-2 py-2 pl-4">
                {subTabs.map((tab) => (
                  tab.id === activeTab ? (
                    <Button
                      key={tab.id}
                      variant="secondary"
                      size="sm"
                      data-testid={`button-provider-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  ) : (
                    <Link key={tab.id} href={tab.href}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-provider-${tab.id}`}
                      >
                        {tab.label}
                      </Button>
                    </Link>
                  )
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </TrustProviderLayoutContext.Provider>
  );
}
