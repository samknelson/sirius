import { ReactNode, createContext, useContext, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Megaphone } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useBulkMessageTabAccess } from "@/hooks/useTabAccess";
import { RecordTitleBar } from "@/components/shared/RecordTitleBar";
import { EntityTabNavigation } from "@/components/shared/EntityTabNavigation";
import type { BulkMessage } from "@shared/schema/bulk/schema";

interface BulkMessageLayoutProps {
  activeTab: string;
  children: ReactNode;
}

interface BulkMessageLayoutContextValue {
  bulkMessage: BulkMessage;
}

const BulkMessageLayoutContext = createContext<BulkMessageLayoutContextValue | null>(null);

export function useBulkMessageLayout() {
  const context = useContext(BulkMessageLayoutContext);
  if (!context) {
    throw new Error("useBulkMessageLayout must be used within BulkMessageLayout");
  }
  return context;
}

const mediumLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  postal: "Postal",
  inapp: "In-App",
};

const statusVariants: Record<string, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  queued: "outline",
  sent: "default",
};

export function BulkMessageLayout({ activeTab, children }: BulkMessageLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: bulkMessage, isLoading, error } = useQuery<BulkMessage>({
    queryKey: ["/api/bulk-messages", id],
    enabled: !!id,
    refetchOnMount: "always",
  });

  const { tabs: mainTabs, getActiveRoot } = useBulkMessageTabAccess(id);

  const activeRoot = useMemo(() => {
    return getActiveRoot(activeTab);
  }, [activeTab, getActiveRoot]);

  const subTabs = activeRoot?.children;

  usePageTitle(bulkMessage?.name || "Bulk Message");

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-bulk-message" />
        </div>
      </div>
    );
  }

  if (error || !bulkMessage) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="text-center py-12">
          <p className="text-destructive mb-4" data-testid="text-bulk-message-not-found">Bulk message not found or failed to load.</p>
          <Link href="/bulk/list">
            <Button variant="outline" data-testid="button-back-bulk-error">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to List
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
        icon={<Megaphone className="h-6 w-6 text-primary" />}
        title={bulkMessage.name}
        titleTestId="heading-bulk-message-name"
        badges={
          <>
            <Badge variant={statusVariants[bulkMessage.status] || "secondary"} data-testid="badge-bulk-status">
              {bulkMessage.status}
            </Badge>
            {(Array.isArray(bulkMessage.medium) ? bulkMessage.medium : [bulkMessage.medium]).map((m) => (
              <Badge key={m} variant="outline" data-testid={`badge-bulk-medium-${m}`}>
                {mediumLabels[m] || m}
              </Badge>
            ))}
            {((bulkMessage.data as { offline?: boolean } | null)?.offline === true) && (
              <Badge variant="destructive" data-testid="badge-bulk-offline">
                Offline
              </Badge>
            )}
          </>
        }
        breadcrumb={
          <nav className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="breadcrumb-bulk-message">
            <Link href="/bulk/list" className="hover:text-foreground transition-colors">
              Bulk Messages
            </Link>
            <ChevronRight size={16} />
            <span className="text-foreground font-medium">
              {bulkMessage.name}
            </span>
          </nav>
        }
        backLink={{ href: "/bulk/list", label: "Back to List", testId: "button-back-to-bulk-list" }}
        recordId={bulkMessage.id}
      />

      <EntityTabNavigation
        tabs={mainTabs}
        activeTab={activeTab}
        activeRootId={activeRoot?.id}
        subTabs={subTabs}
        testIdPrefix="tab-bulk-"
        secondaryTestIdPrefix="button-bulk-"
        primaryTestId="nav-bulk-message-tabs"
      />

      <BulkMessageLayoutContext.Provider value={{ bulkMessage }}>
        {children}
      </BulkMessageLayoutContext.Provider>
    </div>
  );
}
