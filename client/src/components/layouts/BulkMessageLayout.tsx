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

      <div className="border-b border-border mb-6">
        <nav className="flex gap-6" data-testid="nav-bulk-message-tabs">
          {mainTabs.map((tab) => {
            const isActive = tab.id === activeTab || tab.id === activeRoot?.id;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
                  isActive
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-bulk-${tab.id}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {subTabs && subTabs.length > 0 && (
        <div className="bg-muted/30 border-b border-border rounded-md mb-6">
          <div className="flex flex-wrap items-center gap-2 py-2 px-4">
            {subTabs.map((tab) => (
              tab.id === activeTab ? (
                <Button
                  key={tab.id}
                  variant="secondary"
                  size="sm"
                  data-testid={`button-bulk-${tab.id}`}
                >
                  {tab.label}
                </Button>
              ) : (
                <Link key={tab.id} href={tab.href}>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`button-bulk-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                </Link>
              )
            ))}
          </div>
        </div>
      )}

      <BulkMessageLayoutContext.Provider value={{ bulkMessage }}>
        {children}
      </BulkMessageLayoutContext.Provider>
    </div>
  );
}
