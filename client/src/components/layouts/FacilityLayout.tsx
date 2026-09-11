import { ReactNode, createContext, useContext, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Building, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useFacilityTabAccess } from "@/hooks/useTabAccess";
import { EntityTabNavigation } from "@/components/shared/EntityTabNavigation";
import { RecordTitleBar } from "@/components/shared/RecordTitleBar";
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

  const { tabs: mainTabs, getActiveRoot } = useFacilityTabAccess(id);
  const activeRoot = useMemo(() => getActiveRoot(activeTab), [activeTab, getActiveRoot]);
  const subTabs = activeRoot?.children;

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
      <RecordTitleBar
        variant="page"
        icon={<Building className="h-6 w-6 text-primary" />}
        title={facility.name}
        titleTestId="heading-facility-name"
        subtitle={
          facility.siriusId && (
            <p className="text-muted-foreground mt-1 text-sm" data-testid="text-sirius-id">
              Sirius ID: {facility.siriusId}
            </p>
          )
        }
        breadcrumb={
          <nav className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="breadcrumb">
            <Link href="/facilities" className="hover:text-foreground transition-colors">
              Facilities
            </Link>
            <ChevronRight size={16} />
            <span className="text-foreground font-medium">{facility.name}</span>
          </nav>
        }
        backLink={{ href: "/facilities", label: "Back to Facilities" }}
        recordId={facility.id}
      />

      <EntityTabNavigation
        tabs={mainTabs}
        activeTab={activeTab}
        activeRootId={activeRoot?.id}
        subTabs={subTabs}
        appearance="underline"
        testIdPrefix="tab-"
        secondaryTestIdPrefix="subtab-"
        primaryTestId="nav-tabs"
        secondaryTestId="nav-subtabs"
      />
      {(!subTabs || subTabs.length === 0) && <div className="mb-6" />}

      <FacilityLayoutContext.Provider value={{ facility }}>
        {children}
      </FacilityLayoutContext.Provider>
    </div>
  );
}
