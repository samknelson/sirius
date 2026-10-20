import { Link, useParams } from "wouter";
import { ArrowLeft, Braces, ExternalLink, PlugZap } from "lucide-react";
import type { ResolvedCatalogEntry } from "@shared/catalog";
import type { PluginDefinitionCatalog } from "@shared/plugin-definition-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useCatalogQuery } from "@/hooks/useCatalogQuery";

function formatScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value || "(empty string)";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function JsonValue({ value }: { value: unknown }) {
  if (value === null || typeof value !== "object") {
    return <span className="font-mono text-sm break-words">{formatScalar(value)}</span>;
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) {
    return <span className="font-mono text-sm text-muted-foreground">{Array.isArray(value) ? "[]" : "{}"}</span>;
  }

  return (
    <dl className="space-y-2 border-l border-border/70 pl-3">
      {entries.map(([key, child]) => (
        <div key={key} className="space-y-1">
          <dt className="font-mono text-xs text-muted-foreground break-all">{key}</dt>
          <dd className="min-w-0"><JsonValue value={child} /></dd>
        </div>
      ))}
    </dl>
  );
}

function DefinitionAttributes({ payload }: { payload: Record<string, unknown> }) {
  const attributes = Object.entries(payload);
  if (!attributes.length) return null;

  return (
    <div className="space-y-4" data-testid="definition-attributes">
      {attributes.map(([key, value]) => (
        <section key={key} className="rounded-md border bg-muted/20 p-3 sm:p-4">
          <h3 className="mb-3 font-mono text-sm font-medium break-all">{key}</h3>
          <JsonValue value={value} />
        </section>
      ))}
    </div>
  );
}

function DefinitionEntry({ entry }: { entry: ResolvedCatalogEntry }) {
  const detail = entry.detail;

  return (
    <Card data-testid={`card-definition-${entry.id}`}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{entry.name}</span>
              <code className="text-sm font-normal text-muted-foreground">{entry.id}</code>
            </CardTitle>
            {entry.description && <CardDescription className="mt-1">{entry.description}</CardDescription>}
          </div>
          <div className="flex flex-wrap gap-2">
            {entry.component && <Badge variant="outline">{entry.component}</Badge>}
            {detail?.singleton === true && <Badge variant="secondary">Singleton</Badge>}
            {(detail?.readOnly === true || detail?.readonly === true) && <Badge variant="secondary">Read-only</Badge>}
          </div>
        </div>
      </CardHeader>
      {detail && (
        <CardContent className="space-y-5">
          {detail && (
            <section className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Braces className="h-4 w-4 text-muted-foreground" />
                Declared definition
              </h3>
              <DefinitionAttributes payload={detail} />
            </section>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function PluginKindDefinitionPage() {
  const { kind = "" } = useParams<{ kind: string }>();
  const path = `/api/plugins/${encodeURIComponent(kind)}/catalog`;
  const { data, isLoading, isError, error } = useCatalogQuery<{ catalog: PluginDefinitionCatalog }>(path);
  const catalog = data?.catalog;
  usePageTitle(catalog?.label ?? "Plugin definition");

  return (
    <div className="space-y-6">
      <Link
        href="/config/catalogs/plugin-kinds"
        className="inline-flex items-center"
        data-testid="link-back-plugin-kinds"
      >
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Plugin kinds
        </Button>
      </Link>

      {isLoading && (
        <div className="space-y-3" data-testid="loading-plugin-definition">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      )}

      {isError && (
        <Card data-testid="error-plugin-definition">
          <CardHeader>
            <CardTitle className="text-destructive">Couldn’t load this plugin definition</CardTitle>
            <CardDescription>{error instanceof Error ? error.message : "The request failed."}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!isLoading && !isError && catalog && (
        <>
          <header className="space-y-3">
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold md:text-3xl" data-testid="heading-plugin-definition">
                <PlugZap className="h-7 w-7 shrink-0" />
                {catalog.label}
              </h1>
              {catalog.description && <p className="mt-2 text-muted-foreground">{catalog.description}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono">{catalog.kind}</Badge>
              <Badge variant="secondary">Code-supplied definition</Badge>
              {catalog.configurationPath && (
                <Link href={catalog.configurationPath} className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" data-testid="link-plugin-configuration">
                  Open configuration
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </header>

          <aside className="rounded-md border-l-4 border-primary/50 bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
            This page describes what the plugin kind declares in code. It does not show saved or effective configuration.
          </aside>

          {catalog.entries.length === 0 ? (
            <Card data-testid="empty-plugin-definition">
              <CardHeader>
                <CardTitle>No definitions available</CardTitle>
                <CardDescription>This plugin kind has no active definitions to display.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="space-y-4">
              {catalog.entries.map((entry) => <DefinitionEntry key={entry.id} entry={entry} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
