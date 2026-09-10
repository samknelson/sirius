import { ReactNode, createContext, useContext } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useWsClientTabAccess } from "@/hooks/useTabAccess";
import {
  RecordTitleBar,
  RecordTitleBarLoading,
  RecordTitleBarNotFound,
} from "@/components/shared/RecordTitleBar";
import type { RecordMetadataStamp } from "@/components/shared/RecordHistoryDialog";
import type { WsClient } from "@shared/schema";

/**
 * A web service client as the admin API answers with it: the row, plus when it
 * was created and by whom. The client table keeps no timestamp of its own any
 * more — that is the record's history, which the endpoint reads for us so the
 * settings tab does not have to ask a second time.
 */
export type WsClientRecord = WsClient & { created: RecordMetadataStamp };

const WS_CLIENTS_BACK_LINK = {
  href: "/admin/ws/clients",
  label: "Back to Clients",
  testId: "button-back-to-clients",
};

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
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarLoading
          icon={<Server className="text-primary-foreground" size={16} />}
          backLink={WS_CLIENTS_BACK_LINK}
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent
              className="flex flex-col items-center justify-center py-12"
              data-testid="loader-client"
            >
              <Skeleton className="h-16 w-16 rounded-full mb-4" />
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-64" />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (clientError || !client) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarNotFound
          icon={<Server className="text-primary-foreground" size={16} />}
          label="Client Not Found"
          backLink={WS_CLIENTS_BACK_LINK}
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Server className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Client Not Found</h3>
              <p className="text-muted-foreground text-center">
                The web service client you're looking for doesn't exist or could not be loaded.
              </p>
              <Link href="/admin/ws/clients">
                <Button className="mt-4" data-testid="button-return-to-clients">
                  Return to Clients
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <WsClientLayoutContext.Provider value={{ client }}>
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBar
          icon={<Server className="text-primary-foreground" size={16} />}
          title={client.name}
          titleTestId="heading-client-name"
          badges={<StatusBadge status={client.status} />}
          subtitle={
            client.description && (
              <p className="text-sm text-muted-foreground" data-testid="text-description">
                {client.description}
              </p>
            )
          }
          backLink={WS_CLIENTS_BACK_LINK}
          recordId={client.id}
        />

        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex flex-wrap items-center gap-2 py-3" data-testid="nav-tabs">
              {mainTabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`tab-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button variant="outline" size="sm" data-testid={`tab-${tab.id}`}>
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </WsClientLayoutContext.Provider>
  );
}
