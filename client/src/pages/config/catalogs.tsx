import { Link } from "wouter";
import { BookOpen, ChevronRight } from "lucide-react";
import type { CatalogSummary } from "@shared/catalog";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { AUDIENCE_LABEL, useCatalogQuery } from "@/hooks/useCatalogQuery";

/**
 * Config → Catalogs: what this deployment offers, as declared in code.
 *
 * Read-only, deliberately. Every list reachable from here is code-supplied, so
 * there is nothing on this screen to change — the configured values that go
 * with these lists live on their own screens, and this one would only be a
 * second, misleading door to them.
 */

export default function CatalogsConfigPage() {
  usePageTitle("Catalogs");

  const { data, isLoading, isError, error } = useCatalogQuery<{ catalogs: CatalogSummary[] }>(
    "/api/catalogs",
  );

  const catalogs = data?.catalogs ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-2xl md:text-3xl font-bold flex items-center gap-2"
          data-testid="heading-catalogs"
        >
          <BookOpen className="h-7 w-7" />
          Catalogs
        </h1>
        <p className="text-muted-foreground mt-2">
          The lists this deployment declares in code — what it offers, not what it is set
          to. Entries belonging to a switched-off component are left out, so what you see
          here is what the running site currently offers. Nothing on these pages can be
          changed.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3" data-testid="loading-catalogs">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {isError && (
        <Card data-testid="error-catalogs">
          <CardHeader>
            <CardTitle className="text-destructive">Couldn't load the catalogs</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : "The request failed."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!isLoading && !isError && catalogs.length === 0 && (
        <p className="text-muted-foreground" data-testid="text-no-catalogs">
          No catalogs are registered that you are allowed to see.
        </p>
      )}

      {!isLoading &&
        !isError &&
        catalogs.map((catalog) => (
          <Link
            key={catalog.id}
            href={`/config/catalogs/${catalog.id}`}
            data-testid={`link-catalog-${catalog.id}`}
          >
            <Card className="hover-elevate cursor-pointer">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      {catalog.label}
                      <span className="text-sm font-normal text-muted-foreground">
                        {catalog.id}
                      </span>
                    </CardTitle>
                    {catalog.description && (
                      <CardDescription>{catalog.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline">{AUDIENCE_LABEL[catalog.audience]}</Badge>
                    <Badge variant="secondary" data-testid={`count-${catalog.id}`}>
                      {catalog.entryCount} {catalog.entryCount === 1 ? "entry" : "entries"}
                    </Badge>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
    </div>
  );
}
