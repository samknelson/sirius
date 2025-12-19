import { createContext, useContext, ReactNode } from "react";
import { User, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Worker, Contact } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookmarkButton } from "@/components/ui/bookmark-button";
import { useAuth } from "@/contexts/AuthContext";

interface WorkerLayoutContextValue {
  worker: Worker;
  contact: Contact | undefined;
  isLoading: boolean;
  isError: boolean;
}

const WorkerLayoutContext = createContext<WorkerLayoutContextValue | null>(null);

export function useWorkerLayout() {
  const context = useContext(WorkerLayoutContext);
  if (!context) {
    throw new Error("useWorkerLayout must be used within WorkerLayout");
  }
  return context;
}

interface WorkerLayoutProps {
  activeTab: "details" | "identity" | "name" | "email" | "ids" | "addresses" | "phone-numbers" | "birth-date" | "gender" | "work-status" | "user" | "employment" | "current" | "history" | "monthly" | "daily" | "comm" | "comm-history" | "send-sms" | "send-email" | "send-postal" | "benefits" | "benefits-history" | "benefits-eligibility" | "benefits-scan" | "union" | "cardchecks" | "bargaining-unit" | "steward" | "representatives" | "accounting" | "logs" | "delete";
  children: ReactNode;
}

export function WorkerLayout({ activeTab, children }: WorkerLayoutProps) {
  const { id } = useParams<{ id: string }>();
  const { hasComponent } = useAuth();

  const { data: worker, isLoading: workerLoading, error: workerError } = useQuery<Worker>({
    queryKey: ["/api/workers", id],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${id}`);
      if (!response.ok) {
        throw new Error("Worker not found");
      }
      return response.json();
    },
  });

  const { data: contact, isLoading: contactLoading } = useQuery<Contact>({
    queryKey: ["/api/contacts", worker?.contactId],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${worker?.contactId}`);
      if (!response.ok) {
        throw new Error("Contact not found");
      }
      return response.json();
    },
    enabled: !!worker?.contactId,
  });

  const isLoading = workerLoading || contactLoading;
  const isError = !!workerError;

  // Error/Not found state - check this BEFORE loading
  if (workerError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <User className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Worker Not Found</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/workers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-workers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Workers
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <User className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Worker Not Found</h3>
              <p className="text-muted-foreground text-center">
                The worker you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/workers">
                <Button className="mt-4" data-testid="button-return-to-workers">
                  Return to Workers
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Loading state - check this AFTER error handling
  if (isLoading || !worker) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <User className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/workers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-workers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Workers
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
  // Check if any union-related components are enabled to show the Union tab
  const hasUnionTab = hasComponent("cardcheck") || hasComponent("bargainingunits") || hasComponent("worker.steward");
  
  const mainTabs = [
    { id: "details", label: "Details", href: `/workers/${worker.id}` },
    { id: "identity", label: "Identity", href: `/workers/${worker.id}/name` },
    { id: "contact", label: "Contact", href: `/workers/${worker.id}/email` },
    { id: "comm", label: "Comm", href: `/workers/${worker.id}/comm/history` },
    { id: "employment", label: "Employment", href: `/workers/${worker.id}/employment/current` },
    { id: "benefits", label: "Benefits", href: `/workers/${worker.id}/benefits/history` },
    ...(hasUnionTab ? [{ id: "union", label: "Union", href: `/workers/${worker.id}/union/cardchecks` }] : []),
    ...(hasComponent("ledger") ? [{ id: "accounting", label: "Accounting", href: `/workers/${worker.id}/ledger/accounts` }] : []),
    { id: "logs", label: "Logs", href: `/workers/${worker.id}/logs` },
    { id: "delete", label: "Delete", href: `/workers/${worker.id}/delete` },
  ];

  const identitySubTabs = [
    { id: "name", label: "Name", href: `/workers/${worker.id}/name` },
    { id: "ids", label: "IDs", href: `/workers/${worker.id}/ids` },
    { id: "birth-date", label: "Birth Date", href: `/workers/${worker.id}/birth-date` },
    { id: "gender", label: "Gender", href: `/workers/${worker.id}/gender` },
    { id: "work-status", label: "Work Status", href: `/workers/${worker.id}/work-status` },
    { id: "user", label: "User", href: `/workers/${worker.id}/user` },
  ];

  const unionSubTabs = [
    ...(hasComponent("cardcheck") ? [{ id: "cardchecks", label: "Cardchecks", href: `/workers/${worker.id}/union/cardchecks` }] : []),
    ...(hasComponent("bargainingunits") ? [{ id: "bargaining-unit", label: "Bargaining Unit", href: `/workers/${worker.id}/union/bargaining-unit` }] : []),
    ...(hasComponent("worker.steward") ? [{ id: "steward", label: "Steward", href: `/workers/${worker.id}/union/steward` }] : []),
    ...(hasComponent("worker.steward") ? [{ id: "representatives", label: "Representatives", href: `/workers/${worker.id}/union/representatives` }] : []),
  ];

  const contactSubTabs = [
    { id: "email", label: "Email", href: `/workers/${worker.id}/email` },
    { id: "addresses", label: "Addresses", href: `/workers/${worker.id}/addresses` },
    { id: "phone-numbers", label: "Phone Numbers", href: `/workers/${worker.id}/phone-numbers` },
  ];

  const commSubTabs = [
    { id: "comm-history", label: "History", href: `/workers/${worker.id}/comm/history` },
    { id: "send-sms", label: "Send SMS", href: `/workers/${worker.id}/comm/send-sms` },
    { id: "send-email", label: "Send Email", href: `/workers/${worker.id}/comm/send-email` },
    { id: "send-postal", label: "Send Postal", href: `/workers/${worker.id}/comm/send-postal` },
  ];

  const employmentSubTabs = [
    { id: "current", label: "Current", href: `/workers/${worker.id}/employment/current` },
    { id: "history", label: "History", href: `/workers/${worker.id}/employment/history` },
    { id: "monthly", label: "Monthly", href: `/workers/${worker.id}/employment/monthly` },
    { id: "daily", label: "Daily", href: `/workers/${worker.id}/employment/daily` },
  ];

  const benefitsSubTabs = [
    { id: "benefits-history", label: "History", href: `/workers/${worker.id}/benefits/history` },
    { id: "benefits-eligibility", label: "Eligibility", href: `/workers/${worker.id}/benefits/eligibility` },
    { id: "benefits-scan", label: "Scan", href: `/workers/${worker.id}/benefits/scan` },
  ];

  // Determine if we're in a sub-tab
  const isIdentitySubTab = ["name", "ids", "birth-date", "gender", "work-status", "user"].includes(activeTab);
  const isContactSubTab = ["email", "addresses", "phone-numbers"].includes(activeTab);
  const isCommSubTab = ["comm-history", "send-sms", "send-email", "send-postal"].includes(activeTab);
  const isEmploymentSubTab = ["current", "history", "monthly", "daily"].includes(activeTab);
  const isBenefitsSubTab = ["benefits-history", "benefits-eligibility", "benefits-scan"].includes(activeTab);
  const isUnionSubTab = ["cardchecks", "bargaining-unit", "steward", "representatives"].includes(activeTab);
  const showIdentitySubTabs = isIdentitySubTab;
  const showContactSubTabs = isContactSubTab;
  const showCommSubTabs = isCommSubTab;
  const showEmploymentSubTabs = isEmploymentSubTab;
  const showBenefitsSubTabs = isBenefitsSubTab;
  const showUnionSubTabs = isUnionSubTab;

  const contextValue: WorkerLayoutContextValue = {
    worker,
    contact,
    isLoading: false,
    isError: false,
  };

  return (
    <WorkerLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <User className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-worker-name-${worker.id}`}>
                  {contact?.displayName || 'Loading...'}
                </h1>
                <BookmarkButton entityType="worker" entityId={worker.id} entityName={contact?.displayName} />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/workers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-workers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Workers
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Main Tab Navigation */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-3">
              {mainTabs.map((tab) => {
                const isActive = tab.id === activeTab || (tab.id === "identity" && isIdentitySubTab) || (tab.id === "contact" && isContactSubTab) || (tab.id === "comm" && isCommSubTab) || (tab.id === "employment" && isEmploymentSubTab) || (tab.id === "benefits" && isBenefitsSubTab) || (tab.id === "union" && isUnionSubTab);
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-worker-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-worker-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Identity Sub-Tab Navigation */}
        {showIdentitySubTabs && (
          <div className="bg-muted/30 border-b border-border">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center space-x-2 py-2 pl-4">
                {identitySubTabs.map((tab) => (
                  tab.id === activeTab ? (
                    <Button
                      key={tab.id}
                      variant="secondary"
                      size="sm"
                      data-testid={`button-worker-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  ) : (
                    <Link key={tab.id} href={tab.href}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-worker-${tab.id}`}
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

        {/* Contact Sub-Tab Navigation */}
        {showContactSubTabs && (
          <div className="bg-muted/30 border-b border-border">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center space-x-2 py-2 pl-4">
                {contactSubTabs.map((tab) => (
                  tab.id === activeTab ? (
                    <Button
                      key={tab.id}
                      variant="secondary"
                      size="sm"
                      data-testid={`button-worker-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  ) : (
                    <Link key={tab.id} href={tab.href}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-worker-${tab.id}`}
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
                      data-testid={`button-worker-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  ) : (
                    <Link key={tab.id} href={tab.href}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-worker-${tab.id}`}
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

        {/* Employment Sub-Tab Navigation */}
        {showEmploymentSubTabs && (
          <div className="bg-muted/30 border-b border-border">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center space-x-2 py-2 pl-4">
                {employmentSubTabs.map((tab) => (
                  tab.id === activeTab ? (
                    <Button
                      key={tab.id}
                      variant="secondary"
                      size="sm"
                      data-testid={`button-worker-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  ) : (
                    <Link key={tab.id} href={tab.href}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-worker-${tab.id}`}
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

        {/* Benefits Sub-Tab Navigation */}
        {showBenefitsSubTabs && (
          <div className="bg-muted/30 border-b border-border">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center space-x-2 py-2 pl-4">
                {benefitsSubTabs.map((tab) => (
                  tab.id === activeTab ? (
                    <Button
                      key={tab.id}
                      variant="secondary"
                      size="sm"
                      data-testid={`button-worker-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  ) : (
                    <Link key={tab.id} href={tab.href}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-worker-${tab.id}`}
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

        {/* Union Sub-Tab Navigation */}
        {showUnionSubTabs && (
          <div className="bg-muted/30 border-b border-border">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center space-x-2 py-2 pl-4">
                {unionSubTabs.map((tab) => (
                  tab.id === activeTab ? (
                    <Button
                      key={tab.id}
                      variant="secondary"
                      size="sm"
                      data-testid={`button-worker-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  ) : (
                    <Link key={tab.id} href={tab.href}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-worker-${tab.id}`}
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
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </WorkerLayoutContext.Provider>
  );
}
