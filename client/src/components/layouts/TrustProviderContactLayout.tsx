import { useParams, Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users } from "lucide-react";
import { createContext, useContext } from "react";
import { useProviderContactTabAccess } from "@/hooks/useTabAccess";

interface Contact {
  id: string;
  title: string | null;
  given: string | null;
  middle: string | null;
  family: string | null;
  generational: string | null;
  credentials: string | null;
  displayName: string;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  genderNota: string | null;
  genderCalc: string | null;
}

interface ContactType {
  id: string;
  name: string;
  description: string | null;
}

interface TrustProviderContact {
  id: string;
  providerId: string;
  contactId: string;
  contactTypeId: string | null;
  contact: Contact;
  contactType?: ContactType | null;
}

interface TrustProvider {
  id: string;
  name: string;
  data: any;
}

interface TrustProviderContactContextValue {
  trustProviderContact: TrustProviderContact;
  provider: TrustProvider | undefined;
  isLoading: boolean;
}

const TrustProviderContactContext = createContext<TrustProviderContactContextValue | null>(null);

export function useTrustProviderContactLayout() {
  const context = useContext(TrustProviderContactContext);
  if (!context) {
    throw new Error("useTrustProviderContactLayout must be used within TrustProviderContactLayout");
  }
  return context;
}

interface TrustProviderContactLayoutProps {
  children: React.ReactNode;
  activeTab: "view" | "edit" | "name" | "email" | "phone-numbers" | "addresses" | "user" | "comm" | "comm-history" | "send-sms" | "send-email" | "send-postal" | "send-inapp";
}

export function TrustProviderContactLayout({ children, activeTab }: TrustProviderContactLayoutProps) {
  const { id } = useParams<{ id: string }>();
  const [location] = useLocation();

  const { data: trustProviderContact, isLoading } = useQuery<TrustProviderContact>({
    queryKey: ["/api/trust-provider-contacts", id],
  });

  const { data: provider } = useQuery<TrustProvider>({
    queryKey: ["/api/trust/provider", trustProviderContact?.providerId],
    enabled: !!trustProviderContact?.providerId,
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs: mainTabs, subTabs: tabSubTabs } = useProviderContactTabAccess(id || "");

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Skeleton className="h-10 w-64" />
        </div>
        <Card>
          <CardContent className="py-12">
            <div className="space-y-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!trustProviderContact) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="py-12">
            <p className="text-center text-muted-foreground">
              Provider contact not found or you don't have permission to view it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get comm sub-tabs from the hierarchical structure
  const commSubTabs = tabSubTabs['comm'] || [];
  
  const isCommSubTab = ["comm-history", "send-sms", "send-email", "send-postal", "send-inapp"].includes(activeTab);
  const showCommSubTabs = isCommSubTab;

  return (
    <TrustProviderContactContext.Provider value={{ trustProviderContact, provider, isLoading }}>
      {/* Entity Header */}
      <section className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Users className="text-primary-foreground" size={16} />
              </div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground" data-testid="text-contact-name">
                  {provider?.name ? `${provider.name} :: ${trustProviderContact.contact.displayName}` : trustProviderContact.contact.displayName}
                </h1>
                {trustProviderContact.contactType && (
                  <Badge variant="secondary" data-testid="badge-contact-type">
                    {trustProviderContact.contactType.name}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Link href={provider ? `/trust/provider/${provider.id}/contacts` : "/trust/providers"}>
                <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft size={16} className="mr-2" />
                  Back to {provider ? "Provider" : "Providers"}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Tab Navigation */}
      <section className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {mainTabs.map((tab) => {
              const isActive = tab.id === activeTab || (tab.id === "comm" && isCommSubTab);
              return isActive ? (
                <Button
                  key={tab.id}
                  variant="default"
                  size="sm"
                  data-testid={`button-contact-${tab.id}`}
                >
                  {tab.label}
                </Button>
              ) : (
                <Link key={tab.id} href={tab.href}>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`button-contact-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Comm Sub-Tab Navigation */}
      {showCommSubTabs && (
        <div className="bg-muted/30 border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-2 pl-4">
              {commSubTabs.map((tab) => (
                tab.id === activeTab ? (
                  <Button
                    key={tab.id}
                    variant="secondary"
                    size="sm"
                    data-testid={`button-contact-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-contact-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                )
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </div>
    </TrustProviderContactContext.Provider>
  );
}
