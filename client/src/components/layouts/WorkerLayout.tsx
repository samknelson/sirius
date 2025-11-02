import { createContext, useContext, ReactNode } from "react";
import { Star, User, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Worker, Contact } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
  activeTab: "details" | "name" | "email" | "ids" | "addresses" | "phone-numbers";
  children: ReactNode;
}

export function WorkerLayout({ activeTab, children }: WorkerLayoutProps) {
  const { id } = useParams<{ id: string }>();

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
  const isError = !!workerError || !worker;

  // Loading state
  if (isLoading || !worker) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Star className="text-primary-foreground" size={16} />
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

  // Error/Not found state
  if (isError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Star className="text-primary-foreground" size={16} />
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

  // Success state - render layout with tabs
  const tabs = [
    { id: "details", label: "Details", href: `/workers/${worker.id}` },
    { id: "name", label: "Name", href: `/workers/${worker.id}/name` },
    { id: "email", label: "Email", href: `/workers/${worker.id}/email` },
    { id: "ids", label: "IDs", href: `/workers/${worker.id}/ids` },
    { id: "addresses", label: "Addresses", href: `/workers/${worker.id}/addresses` },
    { id: "phone-numbers", label: "Phone Numbers", href: `/workers/${worker.id}/phone-numbers` },
  ];

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
                  <Star className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-worker-name-${worker.id}`}>
                  {contact?.displayName || 'Loading...'}
                </h1>
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

        {/* Tab Navigation */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-3">
              {tabs.map((tab) => (
                tab.id === activeTab ? (
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
                )
              ))}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </WorkerLayoutContext.Provider>
  );
}
