import { ReactNode, createContext, useContext } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Building, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useFacilityTabAccess } from "@/hooks/useTabAccess";
import type { Facility, Contact } from "@shared/schema";

export type FacilityWithContact = Facility & { contact: Contact };

interface FacilityLayoutProps {
  activeTab: string;
  children: ReactNode;
}

interface FacilityLayoutContextValue {
  facility: FacilityWithContact;
}

const FacilityLayoutContext = createContext<FacilityLayoutContextValue | null>(null);

export function useFacilityLayout() {
  const ctx = useContext(FacilityLayoutContext);
  if (!ctx) throw new Error("useFacilityLayout must be used within FacilityLayout");
  return ctx;
}

export function FacilityLayout({ activeTab, children }: FacilityLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: facility, isLoading, error } = useQuery<FacilityWithContact>({
    queryKey: ["/api/facilities", id],
    enabled: !!id,
  });

  const { tabs: mainTabs } = useFacilityTabAccess(id);

  usePageTitle(facility?.name || "Facility Details");

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-facility" />
        </div>
      </div>
    );
  }

  if (error || !facility) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="text-center py-12">
          <p className="text-destructive mb-4">Facility not found or failed to load.</p>
          <Link href="/facilities">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Facilities
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="breadcrumb">
          <Link href="/facilities" className="hover:text-foreground transition-colors">
            Facilities
          </Link>
          <ChevronRight size={16} />
          <span className="text-foreground font-medium">{facility.name}</span>
        </nav>
        <Link href="/facilities">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft size={16} className="mr-2" />
            Back to Facilities
          </Button>
        </Link>
      </div>

      <div className="flex items-start gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10">
          <Building className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-foreground" data-testid="heading-facility-name">
            {facility.name}
          </h1>
          {facility.siriusId && (
            <p className="text-muted-foreground mt-1 text-sm" data-testid="text-sirius-id">
              Sirius ID: {facility.siriusId}
            </p>
          )}
        </div>
      </div>

      <div className="border-b border-border mb-6">
        <nav className="flex gap-6 flex-wrap" data-testid="nav-tabs">
          {mainTabs.map((tab) => {
            const isTabActive = tab.id === activeTab;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
                  isTabActive
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-${tab.id}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <FacilityLayoutContext.Provider value={{ facility }}>
        {children}
      </FacilityLayoutContext.Provider>
    </div>
  );
}
