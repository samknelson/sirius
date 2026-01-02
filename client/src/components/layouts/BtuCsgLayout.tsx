import { createContext, useContext, ReactNode } from "react";
import { FileWarning, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useBtuCsgTabAccess } from "@/hooks/useTabAccess";

interface BtuCsgRecord {
  id: string;
  bpsId: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  nonBpsEmail: string | null;
  school: string | null;
  principalHeadmaster: string | null;
  role: string | null;
  typeOfClass: string | null;
  course: string | null;
  section: string | null;
  numberOfStudents: string | null;
  comments: string | null;
  status: string;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BtuCsgLayoutContextValue {
  record: BtuCsgRecord;
  isLoading: boolean;
  isError: boolean;
}

const BtuCsgLayoutContext = createContext<BtuCsgLayoutContextValue | null>(null);

export function useBtuCsgLayout() {
  const context = useContext(BtuCsgLayoutContext);
  if (!context) {
    throw new Error("useBtuCsgLayout must be used within BtuCsgLayout");
  }
  return context;
}

interface BtuCsgLayoutProps {
  activeTab: "view" | "edit";
  children: ReactNode;
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  in_progress: "default",
  resolved: "outline",
  closed: "outline",
};

export function BtuCsgLayout({ activeTab, children }: BtuCsgLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: record, isLoading: recordLoading, error: recordError } = useQuery<BtuCsgRecord>({
    queryKey: ["/api/sitespecific/btu/csg", id],
    queryFn: async () => {
      const response = await fetch(`/api/sitespecific/btu/csg/${id}`);
      if (!response.ok) {
        throw new Error("Record not found");
      }
      return response.json();
    },
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs } = useBtuCsgTabAccess(id || "");

  const isLoading = recordLoading;
  const isError = !!recordError;

  if (recordError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16 gap-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileWarning className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Record Not Found</h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/sitespecific/btu/csgs">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-list">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to List
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
                <FileWarning className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Record Not Found</h3>
              <p className="text-muted-foreground text-center">
                The grievance record you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/sitespecific/btu/csgs">
                <Button className="mt-4" data-testid="button-return-to-list">
                  Return to List
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading || !record) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16 gap-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileWarning className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/sitespecific/btu/csgs">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-list">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to List
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

  const contextValue: BtuCsgLayoutContextValue = {
    record,
    isLoading: false,
    isError: false,
  };

  const displayName = [record.firstName, record.lastName].filter(Boolean).join(" ") || "Unnamed";

  return (
    <BtuCsgLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16 gap-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileWarning className="text-primary-foreground" size={16} />
                </div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-semibold text-foreground" data-testid={`text-csg-name-${record.id}`}>
                    {displayName}
                  </h1>
                  <Badge variant={STATUS_COLORS[record.status] || "secondary"}>
                    {record.status.replace("_", " ")}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/sitespecific/btu/csgs">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-list">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to List
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

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
                    data-testid={`button-csg-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-csg-${tab.id}`}
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
    </BtuCsgLayoutContext.Provider>
  );
}
