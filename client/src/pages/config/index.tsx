import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useAccessibleConfigSections } from "@/hooks/useConfigNavigation";
import type { NavSection } from "@/config/navigation-registry";

export function filterConfigSections(sections: NavSection[], query: string): NavSection[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return sections;

  return sections.flatMap((section) => {
    const items = section.items.filter(item =>
      item.label.toLocaleLowerCase().includes(normalizedQuery),
    );
    const subsections = section.subsections
      ?.map(subsection => ({
        ...subsection,
        items: subsection.items.filter(item =>
          item.label.toLocaleLowerCase().includes(normalizedQuery),
        ),
      }))
      .filter(subsection => subsection.items.length > 0);

    const hasMatches = items.length > 0 || (subsections?.length ?? 0) > 0;
    const isStillResolving = section.itemsStatus !== undefined && section.itemsStatus !== "ready";
    return hasMatches || isStillResolving
      ? [{ ...section, items, subsections }]
      : [];
  });
}

export default function ConfigurationLandingPage() {
  usePageTitle("Configuration");
  const [query, setQuery] = useState("");

  // The same resolved, access-filtered navigation the sidebar renders, so the
  // two agree about what exists and what each list is called.
  const {
    sections: accessibleSections,
    isLoading,
    isError,
  } = useAccessibleConfigSections();
  const filteredSections = useMemo(
    () => filterConfigSections(accessibleSections, query),
    [accessibleSections, query],
  );
  const hasVisibleLinks = filteredSections.some(section =>
    section.items.length > 0
    || section.subsections?.some(subsection => subsection.items.length > 0),
  );
  const hasQuery = query.trim().length > 0;

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

      <div className="relative max-w-xl">
        <label htmlFor="configuration-search" className="sr-only">
          Search configuration links
        </label>
        <Search
          aria-hidden="true"
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="configuration-search"
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search configuration links"
          className="pl-9 pr-10"
          data-testid="input-configuration-search"
        />
        {query.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setQuery("")}
            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
            aria-label="Clear configuration search"
            data-testid="button-clear-configuration-search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {hasQuery && !hasVisibleLinks && !isLoading && !isError && (
        <div
          className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
          role="status"
          data-testid="text-configuration-search-empty"
        >
          No accessible configuration links match your search.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredSections.map((section) => (
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
