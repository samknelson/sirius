import { createContext, useContext, ReactNode } from "react";
import { Award } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  RecordTitleBar,
  RecordTitleBarLoading,
  RecordTitleBarNotFound,
} from "@/components/shared/RecordTitleBar";
import type { WorkerCertification, OptionsCertification, Worker, Contact } from "@shared/schema";

const WORKERS_BACK_LINK = {
  href: "/workers",
  label: "Back to Workers",
  testId: "button-back-to-workers",
};

interface WorkerCertificationWithDetails extends WorkerCertification {
  certification?: OptionsCertification | null;
}

interface WorkerCertificationLayoutContextValue {
  certification: WorkerCertificationWithDetails;
  worker: Worker | undefined;
  contact: Contact | undefined;
  isLoading: boolean;
  isError: boolean;
}

const WorkerCertificationLayoutContext = createContext<WorkerCertificationLayoutContextValue | null>(null);

export function useWorkerCertificationLayout() {
  const context = useContext(WorkerCertificationLayoutContext);
  if (!context) {
    throw new Error("useWorkerCertificationLayout must be used within WorkerCertificationLayout");
  }
  return context;
}

interface WorkerCertificationLayoutProps {
  activeTab: "view" | "edit";
  children: ReactNode;
}

export function WorkerCertificationLayout({ activeTab, children }: WorkerCertificationLayoutProps) {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('staff');

  const { data: certification, isLoading: certLoading, error: certError } = useQuery<WorkerCertificationWithDetails>({
    queryKey: ["/api/worker-certifications", id],
    enabled: !!id,
  });

  const { data: worker } = useQuery<Worker>({
    queryKey: ["/api/workers", certification?.workerId],
    enabled: !!certification?.workerId,
  });

  const { data: contact } = useQuery<Contact>({
    queryKey: ["/api/contacts", worker?.contactId],
    enabled: !!worker?.contactId,
  });

  const certificationName = certification?.certification?.name || "Certification";
  const workerName = contact?.displayName || `Worker ${certification?.workerId?.slice(0, 8) || ""}`;

  usePageTitle(certificationName);

  const isLoading = certLoading;
  const isError = !!certError;

  const tabs = [
    { id: "view" as const, label: "View", href: `/worker-certification/${id}` },
    ...(canEdit ? [{ id: "edit" as const, label: "Edit", href: `/worker-certification/${id}/edit` }] : []),
  ];

  if (certError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarNotFound
          icon={<Award className="text-primary-foreground" size={16} />}
          label="Certification Not Found"
          backLink={WORKERS_BACK_LINK}
        />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Award className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Certification Not Found</h3>
              <p className="text-muted-foreground text-center">
                The certification you're looking for doesn't exist or has been removed.
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

  if (isLoading || !certification) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBarLoading
          icon={<Award className="text-primary-foreground" size={16} />}
          backLink={WORKERS_BACK_LINK}
        />

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

  const contextValue: WorkerCertificationLayoutContextValue = {
    certification,
    worker,
    contact,
    isLoading: false,
    isError: false,
  };

  const backUrl = certification?.workerId ? `/workers/${certification.workerId}/certifications` : "/workers";

  return (
    <WorkerCertificationLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        <RecordTitleBar
          icon={<Award className="text-primary-foreground" size={16} />}
          title={certificationName}
          titleTestId={`text-certification-name-${certification.id}`}
          subtitle={<p className="text-sm text-muted-foreground">{workerName}</p>}
          backLink={{
            href: backUrl,
            label: "Back to Certifications",
            testId: "button-back-to-certifications",
          }}
          recordId={certification.id}
        />

        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center gap-2 py-3">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-certification-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-certification-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </WorkerCertificationLayoutContext.Provider>
  );
}
