import { createContext, useContext, ReactNode } from "react";
import { MessageSquare, Phone, Mail, Mailbox, Bell, AlertCircle } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "@/lib/date-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { CommWithDetails } from "@/lib/comm-types";
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils";
import {
  RecordTitleBar,
  RecordTitleBarLoading,
  RecordTitleBarNotFound,
} from "@/components/shared/RecordTitleBar";

interface CommLayoutContextValue {
  comm: CommWithDetails;
}

const CommLayoutContext = createContext<CommLayoutContextValue | null>(null);

export function useCommLayout() {
  const context = useContext(CommLayoutContext);
  if (!context) {
    throw new Error("useCommLayout must be used within CommLayout");
  }
  return context;
}

function mediumIcon(medium: string | undefined) {
  switch (medium) {
    case "sms":
      return <Phone className="text-primary-foreground" size={16} />;
    case "email":
      return <Mail className="text-primary-foreground" size={16} />;
    case "postal":
      return <Mailbox className="text-primary-foreground" size={16} />;
    case "inapp":
      return <Bell className="text-primary-foreground" size={16} />;
    default:
      return <MessageSquare className="text-primary-foreground" size={16} />;
  }
}

function mediumLabel(medium: string | undefined): string {
  switch (medium) {
    case "sms":
      return "SMS";
    case "email":
      return "Email";
    case "postal":
      return "Postal";
    case "inapp":
      return "In-app";
    default:
      return "Communication";
  }
}

interface CommLayoutProps {
  activeTab: string;
  children: ReactNode;
}

function recipientFor(comm: CommWithDetails): string | null {
  if (comm.medium === "sms" && comm.smsDetails?.to) {
    return formatPhoneNumberForDisplay(comm.smsDetails.to);
  }
  if (comm.medium === "email" && comm.emailDetails?.to) {
    return comm.emailDetails.to;
  }
  if (comm.medium === "postal" && comm.postalDetails) {
    return comm.postalDetails.toName || comm.postalDetails.toAddressLine1 || null;
  }
  return null;
}

export function CommLayout({ activeTab, children }: CommLayoutProps) {
  const { commId } = useParams<{ commId: string }>();

  const { data: comm, isLoading, error } = useQuery<CommWithDetails>({
    queryKey: ["/api/comm", commId],
    enabled: !!commId,
  });

  const { tabs } = useCommTabAccess(commId);

  const title = comm ? `${mediumLabel(comm.medium)} Communication` : undefined;
  usePageTitle(title);

  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarNotFound
          icon={<MessageSquare className="text-primary-foreground" size={16} />}
          label="Communication Not Found"
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <AlertCircle className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">
                Communication Not Found
              </h3>
              <p className="text-muted-foreground text-center">
                The communication record you're looking for doesn't exist or has been removed.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading || !comm) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarLoading icon={<MessageSquare className="text-primary-foreground" size={16} />} />
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

  const recipient = recipientFor(comm);
  const sentLabel = comm.sent ? format(new Date(comm.sent), "MMM dd, yyyy HH:mm") : null;

  return (
    <CommLayoutContext.Provider value={{ comm }}>
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBar
          icon={mediumIcon(comm.medium)}
          title={
            <>
              {mediumLabel(comm.medium)} Communication
              {recipient ? <span className="text-muted-foreground font-normal"> · {recipient}</span> : null}
            </>
          }
          titleTestId={`text-comm-title-${comm.id}`}
          subtitle={
            sentLabel && (
              <p
                className="text-xs text-muted-foreground font-mono"
                data-testid={`text-comm-sent-${comm.id}`}
              >
                Sent {sentLabel}
              </p>
            )
          }
          backLink={
            comm.contactMainLink
              ? {
                  href: comm.contactMainLink.url,
                  label: `Back to ${comm.contactMainLink.label}`,
                  testId: "button-comm-back",
                  placement: "leading",
                }
              : undefined
          }
          recordId={comm.id}
        />

        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center gap-2 py-3">
              {tabs.map((tab) =>
                tab.id === activeTab ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-comm-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-comm-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                ),
              )}
            </div>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
      </div>
    </CommLayoutContext.Provider>
  );
}
