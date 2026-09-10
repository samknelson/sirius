import { Link, useParams } from "wouter";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { ResolvedCatalog, ResolvedCatalogEntry } from "@shared/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { AUDIENCE_LABEL, useCatalogQuery } from "@/hooks/useCatalogQuery";

/**
 * Config → Catalogs → one catalog.
 *
 * Shows what the code offers for this list. Restricted detail appears only when
 * the server sent it — an unpermitted reader's response does not contain it at
 * all, so there is nothing here to accidentally reveal.
 */

function formatValue(value: unknown): string {
  if (value === null) return "—";
  if (typeof value === "string") return value.length > 0 ? value : "(empty)";
  return JSON.stringify(value);
}

function DetailTable({ payload, testId }: { payload: Record<string, unknown>; testId: string }) {
  const keys = Object.keys(payload);
  if (keys.length === 0) return null;

  return (
    <dl className="grid grid-cols-[minmax(0,12rem)_1fr] gap-x-4 gap-y-1 text-sm" data-testid={testId}>
      {keys.map((key) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground truncate">{key}</dt>
          <dd className="font-mono break-all">{formatValue(payload[key])}</dd>
        </div>
      ))}
    </dl>
  );
}

function EntryCard({ entry }: { entry: ResolvedCatalogEntry }) {
  return (
    <Card data-testid={`card-entry-${entry.id}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {entry.name}
              <span className="text-sm font-normal font-mono text-muted-foreground">
                {entry.id}
              </span>
            </CardTitle>
            {entry.description && <CardDescription>{entry.description}</CardDescription>}
          </div>
          {entry.component && (
            <Badge variant="outline" className="shrink-0" data-testid={`component-${entry.id}`}>
              {entry.component}
            </Badge>
          )}
        </div>
      </CardHeader>

      {(entry.detail || entry.restricted) && (
        <CardContent className="space-y-4">
          {entry.detail && (
            <DetailTable payload={entry.detail} testId={`detail-${entry.id}`} />
          )}

          {entry.restricted && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Code-supplied defaults — not the values in effect
              </p>
              <DetailTable payload={entry.restricted} testId={`restricted-${entry.id}`} />
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function CatalogDetailConfigPage() {
  const { catalogId = "" } = useParams<{ catalogId: string }>();
  const { data, isLoading, isError, error } = useCatalogQuery<{ catalog: ResolvedCatalog }>(
    `/api/catalogs/${encodeURIComponent(catalogId)}`,
  );

  const catalog = data?.catalog;
  usePageTitle(catalog?.label ?? "Catalog");

  return (
    <div className="space-y-6">
      <Link href="/config/catalogs">
        <Button variant="ghost" size="sm" data-testid="link-back-to-catalogs">
          <ArrowLeft className="h-4 w-4 mr-2" />
          All catalogs
        </Button>
      </Link>

      {isLoading && (
        <div className="space-y-3" data-testid="loading-catalog">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {isError && (
        <Card data-testid="error-catalog">
          <CardHeader>
            <CardTitle className="text-destructive">Couldn't load this catalog</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : "The request failed."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!isLoading && !isError && catalog && (
        <>
          <div>
            <h1
              className="text-2xl md:text-3xl font-bold flex items-center gap-2"
              data-testid="heading-catalog"
            >
              <BookOpen className="h-7 w-7" />
              {catalog.label}
            </h1>
            {catalog.description && (
              <p className="text-muted-foreground mt-2">{catalog.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Badge variant="outline" className="font-mono">
                {catalog.id}
              </Badge>
              <Badge variant="outline">{AUDIENCE_LABEL[catalog.audience]}</Badge>
              {catalog.tier === "restricted" && (
                <Badge variant="secondary" data-testid="badge-tier">
                  Including restricted detail
                </Badge>
              )}
            </div>
          </div>

          {catalog.entries.length === 0 ? (
            <p className="text-muted-foreground" data-testid="text-no-entries">
              This catalog offers nothing right now. Every entry it declares belongs to a
              component that is switched off.
            </p>
          ) : (
            <div className="space-y-4">
              {catalog.entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
