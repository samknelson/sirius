import { createContext, useContext, ReactNode } from "react";
import { Ban, HelpCircle, Loader2 } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOptionsTabAccess } from "@/hooks/useTabAccess";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { BackToOptions, optionsPageTitle } from "@/components/shared/BackToOptions";

export { OPTIONS_INDEX_PATH, optionsPageTitle } from "@/components/shared/BackToOptions";

export interface OptionsDefinitionSummary {
  type: string;
  displayName: string;
  description?: string;
  singularName: string;
  pluralName: string;
  requiredComponent?: string;
  supportsSequencing?: boolean;
  supportsParent?: boolean;
}

interface OptionsLayoutContextValue {
  optionsType: string;
  definition: OptionsDefinitionSummary;
}

const OptionsLayoutContext = createContext<OptionsLayoutContextValue | null>(null);

export function useOptionsLayout() {
  const context = useContext(OptionsLayoutContext);
  if (!context) {
    throw new Error("useOptionsLayout must be used within OptionsLayout");
  }
  return context;
}

interface OptionsLayoutProps {
  activeTab: string;
  children: ReactNode;
}

/**
 * Shell shared by the three tabs of an options page (List / Export / Import).
 * Owns the type lookup, the "type not found" and "feature not available"
 * states, and the tab strip.
 */
export function OptionsLayout({ activeTab, children }: OptionsLayoutProps) {
  const params = useParams<{ type: string }>();
  const optionsType = params.type || "";
  const auth = useAuth();

  const { data: definition, isLoading, isError } = useQuery<OptionsDefinitionSummary>({
    queryKey: ["/api/options", optionsType, "definition"],
    enabled: !!optionsType,
  });

  const { tabs } = useOptionsTabAccess(optionsType);

  usePageTitle(definition ? optionsPageTitle(definition.displayName) : "Options");

  if (!auth || isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (isError || !definition) {
    return (
      <div className="p-6 space-y-4">
        <BackToOptions />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted-foreground">
              <HelpCircle className="h-5 w-5" />
              Options Type Not Found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              The options type "{optionsType}" does not exist or is not available.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (definition.requiredComponent && !auth.hasComponent(definition.requiredComponent)) {
    return (
      <div className="p-6 space-y-4">
        <BackToOptions />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted-foreground">
              <Ban className="h-5 w-5" />
              Feature Not Available
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Access to {definition.displayName} requires the "{definition.requiredComponent}" feature to be enabled.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <OptionsLayoutContext.Provider value={{ optionsType, definition }}>
      <div className="p-6 space-y-6">
        <div>
          <BackToOptions />
          <h1 className="text-xl md:text-2xl font-bold text-foreground mt-2" data-testid="heading-options-type">
            {optionsPageTitle(definition.displayName)}
          </h1>
          {definition.description && (
            <p className="text-sm text-muted-foreground mt-1">{definition.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return isActive ? (
              <Button
                key={tab.id}
                variant="default"
                size="sm"
                data-testid={`button-options-tab-${tab.id}`}
              >
                {tab.label}
              </Button>
            ) : (
              <Link key={tab.id} href={tab.href}>
                <Button variant="outline" size="sm" data-testid={`button-options-tab-${tab.id}`}>
                  {tab.label}
                </Button>
              </Link>
            );
          })}
        </div>

        {children}
      </div>
    </OptionsLayoutContext.Provider>
  );
}
