import { ReactNode, createContext, useContext } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Server } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useSftpClientDestinationTabAccess } from "@/hooks/useTabAccess";
import type { SftpClientDestination } from "@shared/schema/system/sftp-client-schema";

interface SftpClientLayoutProps {
  activeTab: string;
  children: ReactNode;
}

interface SftpClientLayoutContextValue {
  destination: SftpClientDestination;
}

const SftpClientLayoutContext = createContext<SftpClientLayoutContextValue | null>(null);

export function useSftpClientLayout() {
  const context = useContext(SftpClientLayoutContext);
  if (!context) {
    throw new Error("useSftpClientLayout must be used within SftpClientLayout");
  }
  return context;
}

export function SftpClientLayout({ activeTab, children }: SftpClientLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: destination, isLoading, error } = useQuery<SftpClientDestination>({
    queryKey: ["/api/sftp/client-destinations", id],
    enabled: !!id,
  });

  const { tabs: mainTabs } = useSftpClientDestinationTabAccess(id);

  usePageTitle(destination?.name || "Destination Details");

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-destination" />
        </div>
      </div>
    );
  }

  if (error || !destination) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="text-center py-12">
          <p className="text-destructive mb-4">Destination not found or failed to load.</p>
          <Link href="/config/sftp/clients">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to SFTP Clients
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
          <Link href="/config/sftp/clients" className="hover:text-foreground transition-colors">
            SFTP Clients
          </Link>
          <ChevronRight size={16} />
          <span className="text-foreground font-medium">
            {destination.name}
          </span>
        </nav>
        <Link href="/config/sftp/clients">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft size={16} className="mr-2" />
            Back to SFTP Clients
          </Button>
        </Link>
      </div>

      <div className="flex items-start gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10">
          <Server className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-foreground" data-testid="heading-destination-name">
              {destination.name}
            </h1>
            <Badge variant={destination.active ? "default" : "secondary"} data-testid="badge-status">
              {destination.active ? "Active" : "Inactive"}
            </Badge>
          </div>
          {destination.description && (
            <p className="text-muted-foreground mt-1" data-testid="text-description">
              {destination.description}
            </p>
          )}
          {destination.siriusId && (
            <p className="text-sm text-muted-foreground mt-1">
              Sirius ID: <span className="font-medium">{destination.siriusId}</span>
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

      <SftpClientLayoutContext.Provider value={{ destination }}>
        {children}
      </SftpClientLayoutContext.Provider>
    </div>
  );
}
