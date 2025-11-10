import { createContext, useContext, ReactNode } from "react";
import { Users, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface EmployerContactDetail {
  id: string;
  employerId: string;
  contactId: string;
  contactTypeId: string | null;
  contact: {
    id: string;
    displayName: string;
    email: string | null;
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
  activeTab: "view" | "edit";
  children: ReactNode;
}

export function EmployerContactLayout({ activeTab, children }: EmployerContactLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: employerContact, isLoading, error } = useQuery<EmployerContactDetail>({
    queryKey: ["/api/employer-contacts", id],
    enabled: !!id,
  });

  // Error/Not found state
  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Users className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Contact Not Found</span>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
        </main>
      </div>
    );
  }

  // Loading state
  if (isLoading || !employerContact) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Users className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/employers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-employer">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Employer
                  </Button>
                </Link>
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

  // Success state - render layout with tabs
  const tabs = [
    { id: "view", label: "View", href: `/employer-contacts/${employerContact.id}` },
    { id: "edit", label: "Edit", href: `/employer-contacts/${employerContact.id}/edit` },
  ];

  const contextValue: EmployerContactLayoutContextValue = {
    employerContact,
    isLoading: false,
    isError: false,
  };

  return (
    <EmployerContactLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Users className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-contact-name-${employerContact.id}`}>
                  {employerContact.contact.displayName}
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
        </header>

        {/* Tab Navigation */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-3">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
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
        </div>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </EmployerContactLayoutContext.Provider>
  );
}
