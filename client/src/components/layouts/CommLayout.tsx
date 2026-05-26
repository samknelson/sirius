import { createContext, useContext, ReactNode } from "react";
import { ArrowLeft, MessageSquare, Phone, Mail, Mailbox, Bell, AlertCircle } from "lucide-react";
import { Link, useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { CommWithDetails } from "@/lib/comm-types";
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils";

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
  const [, navigate] = useLocation();

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
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <MessageSquare className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">
                  Communication Not Found
                </span>
              </div>
            </div>
          </div>
        </header>
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
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <MessageSquare className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
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

  const recipient = recipientFor(comm);
  const sentLabel = comm.sent ? format(new Date(comm.sent), "MMM dd, yyyy HH:mm") : null;

  return (
    <CommLayoutContext.Provider value={{ comm }}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16 gap-3">
              <div className="flex items-center space-x-3 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate(comm.contactId ? `/contacts/${comm.contactId}` : "/")}
                  data-testid="button-comm-back"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0">
                  {mediumIcon(comm.medium)}
                </div>
                <div className="min-w-0">
                  <h1
                    className="text-xl font-semibold text-foreground truncate"
                    data-testid={`text-comm-title-${comm.id}`}
                  >
                    {mediumLabel(comm.medium)} Communication
                    {recipient ? <span className="text-muted-foreground font-normal"> · {recipient}</span> : null}
                  </h1>
                  {sentLabel && (
                    <p
                      className="text-xs text-muted-foreground font-mono"
                      data-testid={`text-comm-sent-${comm.id}`}
                    >
                      Sent {sentLabel}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>

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
