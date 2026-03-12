import { ReactNode, createContext, useContext } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Server } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useWsClientTabAccess } from "@/hooks/useTabAccess";
import type { WsClient, WsBundle } from "@shared/schema";

interface WsClientLayoutProps {
  activeTab: string;
  children: ReactNode;
}

interface WsClientLayoutContextValue {
  client: WsClient;
  bundle: WsBundle | undefined;
}

const WsClientLayoutContext = createContext<WsClientLayoutContextValue | null>(null);

export function useWsClientLayout() {
  const context = useContext(WsClientLayoutContext);
  if (!context) {
    throw new Error("useWsClientLayout must be used within WsClientLayout");
  }
  return context;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    active: "default",
    suspended: "secondary",
    revoked: "destructive",
  };
  return (
    <Badge variant={variants[status] || "outline"} data-testid={`badge-status-${status}`}>
      {status}
    </Badge>
  );
}

export function WsClientLayout({ activeTab, children }: WsClientLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: client, isLoading: clientLoading, error: clientError } = useQuery<WsClient>({
    queryKey: ["/api/admin/ws-clients", id],
    enabled: !!id,
  });

  const { data: bundles = [] } = useQuery<WsBundle[]>({
    queryKey: ["/api/admin/ws-bundles"],
  });

  const bundle = bundles.find((b) => b.id === client?.bundleId);

  const { tabs: mainTabs } = useWsClientTabAccess(id);

  usePageTitle(client?.name || "Client Details");

  if (clientLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-client" />
        </div>
      </div>
    );
  }

  if (clientError || !client) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="text-center py-12">
          <p className="text-destructive mb-4">Client not found or failed to load.</p>
          <Link href="/config/ws/clients">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Clients
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="breadcrumb">
          <Link href="/config/ws/clients" className="hover:text-foreground transition-colors">
            WS Clients
          </Link>
          <ChevronRight size={16} />
          <span className="text-foreground font-medium">
            {client.name}
          </span>
        </nav>
        <Link href="/config/ws/clients">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft size={16} className="mr-2" />
            Back to Clients
          </Button>
        </Link>
      </div>

      <div className="flex items-start gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10">
          <Server className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-foreground" data-testid="heading-client-name">
              {client.name}
            </h1>
            <StatusBadge status={client.status} />
          </div>
          {client.description && (
            <p className="text-muted-foreground mt-1" data-testid="text-description">
              {client.description}
            </p>
          )}
          {bundle && (
            <p className="text-sm text-muted-foreground mt-1">
              Bundle: <span className="font-medium">{bundle.name}</span>
            </p>
          )}
        </div>
      </div>

      <div className="border-b border-border mb-6">
        <nav className="flex gap-6" data-testid="nav-tabs">
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
                data-testid={`tab-${tab.id}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <WsClientLayoutContext.Provider value={{ client, bundle }}>
        {children}
      </WsClientLayoutContext.Provider>
    </div>
  );
}
