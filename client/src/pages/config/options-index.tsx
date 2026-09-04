import { Link } from "wouter";
import { AlertCircle, ChevronRight, List, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useOptionsCatalog, useReachableConfigPaths } from "@/hooks/useConfigNavigation";
import { optionsListPath, type OptionsCatalogEntry } from "@/config/navigation-registry";

/**
 * The home page of the dropdown lists: every list the options registry knows
 * about, by the name the registry gives it. Each list's own page links back
 * here.
 */
export default function OptionsIndexPage() {
  usePageTitle("Options");

  const { entries, isLoading: catalogLoading, isError: catalogError } = useOptionsCatalog();
  const { paths, isLoading: navLoading, isError: navError } = useReachableConfigPaths();

  const isLoading = catalogLoading || navLoading;
  const isError = catalogError || navError;

  // A list administered on its own page is still one of the site's dropdown
  // lists, so it is listed here — pointing at the page that administers it,
  // not at a second, lesser door to the same data.
  const listHref = (entry: OptionsCatalogEntry) => entry.bespokePath ?? optionsListPath(entry.type);

  // Offer exactly what the config navigation may lead this user to: the same
  // permission, policy and component gates, decided in one place, so the index
  // never advertises a page that would refuse them. A bespoke page can be
  // gated more tightly than the list itself, which is why the gate is read off
  // the destination rather than off the list.
  const lists = entries.filter((entry) => paths.has(listHref(entry)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="heading-options-index">
          Options
        </h1>
        <p className="text-muted-foreground mt-2">
          The dropdown lists used throughout the site. Each list is named by the options registry.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground" data-testid="text-options-index-loading">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading the dropdown lists…
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-destructive" data-testid="text-options-index-error">
          <AlertCircle className="h-4 w-4" />
          Couldn't load the dropdown lists.
        </div>
      )}

      {!isLoading && !isError && lists.length === 0 && (
        <p className="text-muted-foreground" data-testid="text-options-index-empty">
          No dropdown lists are available.
        </p>
      )}

      {lists.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {lists.map((entry) => (
            <Link key={entry.type} href={listHref(entry)}>
              <Card className="h-full cursor-pointer hover-elevate" data-testid={`link-options-${entry.type}`}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <List className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">{entry.name}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardTitle>
                  {entry.description && <CardDescription>{entry.description}</CardDescription>}
                </CardHeader>
                <CardContent className="pt-0">
                  {entry.bespokePath && (
                    <p className="text-xs text-muted-foreground" data-testid={`text-options-bespoke-${entry.type}`}>
                      Administered on its own page
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
