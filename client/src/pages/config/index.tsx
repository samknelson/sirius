import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useAccessibleConfigSections } from "@/hooks/useConfigNavigation";

export default function ConfigurationLandingPage() {
  usePageTitle("Configuration");

  // The same resolved, access-filtered navigation the sidebar renders, so the
  // two agree about what exists and what each list is called.
  const { sections: accessibleSections } = useAccessibleConfigSections();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="heading-configuration">
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
                {section.itemsStatus === "loading" && (
                  <p className="px-3 py-2 text-sm text-muted-foreground" data-testid={`text-${section.id}-loading`}>
                    Loading…
                  </p>
                )}
                {section.itemsStatus === "error" && (
                  <p className="px-3 py-2 text-sm text-destructive" data-testid={`text-${section.id}-error`}>
                    Couldn't load these
                  </p>
                )}
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
