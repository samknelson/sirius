import { createContext, useContext, ReactNode, useMemo } from "react";
import { Building, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Company } from "@shared/schema/employer/company-schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookmarkButton } from "@/components/ui/bookmark-button";
import { DebugRecordViewer } from "@/components/debug/DebugRecordViewer";
import { useCompanyTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface CompanyLayoutContextValue {
  company: Company;
  isLoading: boolean;
  isError: boolean;
}

const CompanyLayoutContext = createContext<CompanyLayoutContextValue | null>(null);

export function useCompanyLayout() {
  const context = useContext(CompanyLayoutContext);
  if (!context) {
    throw new Error("useCompanyLayout must be used within CompanyLayout");
  }
  return context;
}

interface CompanyLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function CompanyLayout({ activeTab, children }: CompanyLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: company, isLoading: companyLoading, error: companyError } = useQuery<Company>({
    queryKey: ["/api/companies", id],
    queryFn: async () => {
      const response = await fetch(`/api/companies/${id}`);
      if (!response.ok) {
        throw new Error("Company not found");
      }
      return response.json();
    },
  });

  const {
    tabs,
    getActiveRoot,
    isLoading: tabAccessLoading
  } = useCompanyTabAccess(id || '');

  const isLoading = companyLoading || tabAccessLoading;

  usePageTitle(company?.name);

  const mainTabs = tabs;

  const activeRoot = useMemo(() => {
    return getActiveRoot(activeTab);
  }, [activeTab, getActiveRoot]);

  const subTabs = activeRoot?.children;

  if (companyError) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Building className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">Company Not Found</h3>
            <p className="text-muted-foreground text-center">
              The company you're looking for doesn't exist or has been removed.
            </p>
            <Link href="/companies">
              <Button className="mt-4" data-testid="button-return-to-companies">
                Return to Companies
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !company) {
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

  const contextValue: CompanyLayoutContextValue = {
    company,
    isLoading: false,
    isError: false,
  };

  return (
    <CompanyLayoutContext.Provider value={contextValue}>
      <section className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Building className="text-primary-foreground" size={16} />
              </div>
              <h1 className="text-xl font-semibold text-foreground" data-testid={`text-company-name-${company.id}`}>
                {company.name}
              </h1>
              <BookmarkButton entityType="company" entityId={company.id} entityName={company.name} />
            </div>
            <div className="flex items-center space-x-4">
              <DebugRecordViewer record={company} entityLabel="Company" />
              <Link href="/companies">
                <Button variant="ghost" size="sm" data-testid="button-back-to-companies">
                  <ArrowLeft size={16} className="mr-2" />
                  Back to Companies
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {mainTabs.map((tab) => {
              const isActive = tab.id === activeRoot?.id;
              return isActive ? (
                <Button
                  key={tab.id}
                  variant="default"
                  size="sm"
                  data-testid={`button-company-${tab.id}`}
                >
                  {tab.label}
                </Button>
              ) : (
                <Link key={tab.id} href={tab.href}>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`button-company-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {subTabs && subTabs.length > 0 && (
        <section className="bg-muted/30 border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-2 pl-4">
              {subTabs.map((tab) => (
                tab.id === activeTab ? (
                  <Button
                    key={tab.id}
                    variant="secondary"
                    size="sm"
                    data-testid={`button-company-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-company-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                )
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </div>
    </CompanyLayoutContext.Provider>
  );
}
