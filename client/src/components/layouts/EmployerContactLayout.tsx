import { createContext, useContext, ReactNode } from "react";
import { Users, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useEmployerContactTabAccess } from "@/hooks/useTabAccess";

interface EmployerContactDetail {
  id: string;
  employerId: string;
  contactId: string;
  contactTypeId: string | null;
  contact: {
    id: string;
    displayName: string;
    email: string | null;
    title: string | null;
    given: string | null;
    middle: string | null;
    family: string | null;
    generational: string | null;
    credentials: string | null;
  };
  contactType?: {
    id: string;
    name: string;
    description: string | null;
  } | null;
}

interface EmployerContactLayoutContextValue {
  employerContact: EmployerContactDetail;
  isLoading: boolean;
  isError: boolean;
}

const EmployerContactLayoutContext = createContext<EmployerContactLayoutContextValue | null>(null);

export function useEmployerContactLayout() {
  const context = useContext(EmployerContactLayoutContext);
  if (!context) {
    throw new Error("useEmployerContactLayout must be used within EmployerContactLayout");
  }
  return context;
}

interface EmployerContactLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function EmployerContactLayout({ activeTab, children }: EmployerContactLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: employerContact, isLoading, error } = useQuery<EmployerContactDetail>({
    queryKey: ["/api/employer-contacts", id],
    enabled: !!id,
  });

  // Fetch employer data to show employer name in title
  const { data: employer } = useQuery<{ id: string; name: string }>({
    queryKey: ["/api/employers", employerContact?.employerId],
    enabled: !!employerContact?.employerId,
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs: mainTabs, subTabs: tabSubTabs } = useEmployerContactTabAccess(id || "");

  // Error/Not found state
  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Users className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">Employer Contact Not Found</h3>
            <p className="text-muted-foreground text-center">
              The employer contact you're looking for doesn't exist or has been removed.
            </p>
            <Link href="/employers">
              <Button className="mt-4" data-testid="button-return-to-employers">
                Return to Employers
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading state
  if (isLoading || !employerContact) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Skeleton className="h-16 w-16 rounded-full mb-4" />
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get comm sub-tabs from the hierarchical structure
  const commSubTabs = tabSubTabs['comm'] || [];
  
  const isCommSubTab = ["comm-history", "send-sms", "send-email", "send-postal", "send-inapp"].includes(activeTab);
  const showCommSubTabs = isCommSubTab;

  const contextValue: EmployerContactLayoutContextValue = {
    employerContact,
    isLoading: false,
    isError: false,
  };

  return (
    <EmployerContactLayoutContext.Provider value={contextValue}>
      {/* Entity Header */}
      <section className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Users className="text-primary-foreground" size={16} />
              </div>
              <h1 className="text-xl font-semibold text-foreground" data-testid={`text-contact-name-${employerContact.id}`}>
                {employer?.name ? `${employer.name} :: ${employerContact.contact.displayName}` : employerContact.contact.displayName}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <Link href={`/employers/${employerContact.employerId}`}>
                <Button variant="ghost" size="sm" data-testid="button-back-to-employer">
                  <ArrowLeft size={16} className="mr-2" />
                  Back to Employer
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
    </EmployerContactLayoutContext.Provider>
  );
}
