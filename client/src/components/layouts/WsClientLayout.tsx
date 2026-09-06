import { ReactNode, createContext, useContext } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Server } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useWsClientTabAccess } from "@/hooks/useTabAccess";
import { RecordTitleBar } from "@/components/shared/RecordTitleBar";
import type { RecordMetadataStamp } from "@/components/shared/RecordHistoryDialog";
import type { WsClient } from "@shared/schema";

/**
 * A web service client as the admin API answers with it: the row, plus when it
 * was created and by whom. The client table keeps no timestamp of its own any
 * more — that is the record's history, which the endpoint reads for us so the
 * settings tab does not have to ask a second time.
 */
export type WsClientRecord = WsClient & { created: RecordMetadataStamp };

interface WsClientLayoutProps {
  activeTab: string;
  children: ReactNode;
}

interface WsClientLayoutContextValue {
  client: WsClientRecord;
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

  const { data: client, isLoading: clientLoading, error: clientError } = useQuery<WsClientRecord>({
    queryKey: ["/api/admin/ws-clients", id],
    enabled: !!id,
  });

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
          <Link href="/admin/ws/clients">
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
      <RecordTitleBar
        variant="page"
        icon={<Server className="h-6 w-6 text-primary" />}
        title={client.name}
        titleTestId="heading-client-name"
        badges={<StatusBadge status={client.status} />}
        subtitle={
          client.description && (
            <p className="text-muted-foreground mt-1" data-testid="text-description">
              {client.description}
            </p>
          )
        }
        breadcrumb={
          <nav className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="breadcrumb">
            <Link href="/admin/ws/clients" className="hover:text-foreground transition-colors">
              Web Services - Incoming
            </Link>
            <ChevronRight size={16} />
            <span className="text-foreground font-medium">
              {client.name}
            </span>
          </nav>
        }
        backLink={{ href: "/admin/ws/clients", label: "Back to Clients" }}
        recordId={client.id}
      />

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

      <WsClientLayoutContext.Provider value={{ client }}>
        {children}
      </WsClientLayoutContext.Provider>
    </div>
  );
}
