import { ReactNode, createContext, useContext } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RecordTitleBar,
  RecordTitleBarLoading,
  RecordTitleBarNotFound,
} from "@/components/shared/RecordTitleBar";
import { EntityTabNavigation } from "@/components/shared/EntityTabNavigation";
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

const SFTP_CLIENTS_BACK_LINK = {
  href: "/config/sftp/clients",
  label: "Back to SFTP Clients",
};

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
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarLoading
          icon={<Server className="text-primary-foreground" size={16} />}
          backLink={SFTP_CLIENTS_BACK_LINK}
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent
              className="flex flex-col items-center justify-center py-12"
              data-testid="loader-destination"
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

  if (error || !destination) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarNotFound
          icon={<Server className="text-primary-foreground" size={16} />}
          label="SFTP Client Not Found"
          backLink={SFTP_CLIENTS_BACK_LINK}
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Server className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">SFTP Client Not Found</h3>
              <p className="text-muted-foreground text-center">
                The SFTP client you're looking for doesn't exist or could not be loaded.
              </p>
              <Link href={SFTP_CLIENTS_BACK_LINK.href}>
                <Button className="mt-4">Return to SFTP Clients</Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <SftpClientLayoutContext.Provider value={{ destination }}>
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBar
          icon={<Server className="text-primary-foreground" size={16} />}
          title={destination.name}
          titleTestId="heading-destination-name"
          badges={
            <Badge variant={destination.active ? "default" : "secondary"} data-testid="badge-status">
              {destination.active ? "Active" : "Inactive"}
            </Badge>
          }
          subtitle={
            <>
              {destination.description && (
                <p className="text-sm text-muted-foreground" data-testid="text-description">
                  {destination.description}
                </p>
              )}
              {destination.siriusId && (
                <p className="text-sm text-muted-foreground">
                  Sirius ID: <span className="font-medium">{destination.siriusId}</span>
                </p>
              )}
            </>
          }
          backLink={SFTP_CLIENTS_BACK_LINK}
          recordId={destination.id}
        />

        <EntityTabNavigation
          tabs={mainTabs}
          activeTab={activeTab}
          testIdPrefix="tab-"
          primaryTestId="nav-tabs"
        />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </SftpClientLayoutContext.Provider>
  );
}
