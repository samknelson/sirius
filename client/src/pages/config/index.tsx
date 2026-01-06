import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  getAllPoliciesNeeded,
  getAccessibleSections,
  type AccessContext,
} from "@/config/navigation-registry";

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

export default function ConfigurationLandingPage() {
  usePageTitle("Configuration");
  const { hasPermission } = useAuth();

  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });

  const isComponentEnabled = (componentId: string) => {
    const config = componentConfig.find(c => c.componentId === componentId);
    return config?.enabled ?? false;
  };

  const policiesNeeded = useMemo(() => getAllPoliciesNeeded(), []);

  const { data: policyResults = {} } = useQuery<Record<string, { allowed: boolean }>>({
    queryKey: ["/api/access/policies/batch", ...policiesNeeded],
    queryFn: async () => {
      if (policiesNeeded.length === 0) return {};
      
      const results: Record<string, { allowed: boolean }> = {};
      await Promise.all(
        policiesNeeded.map(async (policy) => {
          try {
            const response = await fetch(`/api/access/policies/${policy}`);
            if (response.ok) {
              const data = await response.json();
              results[policy] = { allowed: data.allowed };
            } else {
              results[policy] = { allowed: false };
            }
          } catch {
            results[policy] = { allowed: false };
          }
        })
      );
      return results;
    },
    staleTime: 30000,
    enabled: policiesNeeded.length > 0,
  });

  const accessContext: AccessContext = useMemo(() => ({
    hasPermission,
    policyResults,
    isComponentEnabled,
  }), [hasPermission, policyResults, componentConfig]);

  const accessibleSections = useMemo(
    () => getAccessibleSections(accessContext),
    [accessContext]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="heading-configuration">
          Configuration
        </h1>
        <p className="text-muted-foreground mt-2">
          System settings and administrative options
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {accessibleSections.map((section) => (
          <Card key={section.id} data-testid={`card-section-${section.id}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <section.icon className="h-5 w-5 text-muted-foreground" />
                {section.title}
              </CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <Link key={item.path} href={item.path}>
                    <div
                      className="flex items-center gap-2 px-3 py-2 rounded-md hover-elevate cursor-pointer text-sm"
                      data-testid={item.testId}
                    >
                      <item.icon className="h-4 w-4 text-muted-foreground" />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                ))}
                {section.subsections?.map((sub) => (
                  <div key={sub.id} className="mt-3 pt-3 border-t">
                    <div className="flex items-center gap-2 px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      <sub.icon className="h-3 w-3" />
                      {sub.title}
                    </div>
                    {sub.items.map((item) => (
                      <Link key={item.path} href={item.path}>
                        <div
                          className="flex items-center gap-2 px-3 py-2 rounded-md hover-elevate cursor-pointer text-sm ml-2"
                          data-testid={item.testId}
                        >
                          <item.icon className="h-4 w-4 text-muted-foreground" />
                          <span>{item.label}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
