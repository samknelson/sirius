import { ReactNode, createContext, useContext } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, FileText } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useTrustProviderEdiTabAccess } from "@/hooks/useTabAccess";
import type { TrustProviderEdi } from "@shared/schema/trust/provider-edi-schema";

interface TrustProviderEdiLayoutProps {
  activeTab: string;
  children: ReactNode;
}

interface TrustProviderEdiLayoutContextValue {
  edi: TrustProviderEdi;
}

const TrustProviderEdiLayoutContext = createContext<TrustProviderEdiLayoutContextValue | null>(null);

export function useTrustProviderEdiLayout() {
  const context = useContext(TrustProviderEdiLayoutContext);
  if (!context) {
    throw new Error("useTrustProviderEdiLayout must be used within TrustProviderEdiLayout");
  }
  return context;
}

export function TrustProviderEdiLayout({ activeTab, children }: TrustProviderEdiLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: edi, isLoading, error } = useQuery<TrustProviderEdi>({
    queryKey: ["/api/trust-provider-edi", id],
    enabled: !!id,
  });

  const { tabs: mainTabs } = useTrustProviderEdiTabAccess(id);

  usePageTitle(edi?.name || "EDI Details");

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-edi" />
        </div>
      </div>
    );
  }

  if (error || !edi) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="text-center py-12">
          <p className="text-destructive mb-4" data-testid="text-edi-not-found">EDI record not found or failed to load.</p>
          <Link href={edi?.providerId ? `/trust/provider/${edi.providerId}/edi` : "/trust/providers"}>
            <Button variant="outline" data-testid="button-back-edi-error">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="breadcrumb-edi">
          <Link href="/trust/providers" className="hover:text-foreground transition-colors">
            Providers
          </Link>
          <ChevronRight size={16} />
          <Link href={`/trust/provider/${edi.providerId}/edi`} className="hover:text-foreground transition-colors">
            EDI
          </Link>
          <ChevronRight size={16} />
          <span className="text-foreground font-medium">
            {edi.name}
          </span>
        </nav>
        <Link href={`/trust/provider/${edi.providerId}/edi`}>
          <Button variant="ghost" size="sm" data-testid="button-back-to-edi-list">
            <ArrowLeft size={16} className="mr-2" />
            Back to EDI
          </Button>
        </Link>
      </div>

      <div className="flex items-start gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10">
          <FileText className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-foreground" data-testid="heading-edi-name">
              {edi.name}
            </h1>
            <Badge variant={edi.active ? "default" : "secondary"} data-testid="badge-edi-status">
              {edi.active ? "Active" : "Inactive"}
            </Badge>
          </div>
          {edi.siriusId && (
            <p className="text-sm text-muted-foreground mt-1">
              Sirius ID: <span className="font-medium">{edi.siriusId}</span>
            </p>
          )}
        </div>
      </div>

      <div className="border-b border-border mb-6">
        <nav className="flex gap-6" data-testid="nav-edi-tabs">
          {mainTabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
                  isActive
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-edi-${tab.id}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <TrustProviderEdiLayoutContext.Provider value={{ edi }}>
        {children}
      </TrustProviderEdiLayoutContext.Provider>
    </div>
  );
}
