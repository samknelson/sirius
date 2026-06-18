import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { pluginKindsQueryKey, type PluginKindSummary } from "@/plugins/_core";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { ChevronRight, Loader2, Puzzle } from "lucide-react";

/**
 * Navigation-only index for the generic plugin-config admin pages. It
 * lists every configurable plugin kind (sourced from the server via
 * `GET /api/plugins/kinds`) and links to each kind's config page at
 * `/admin/plugin-configs/:kind`. The set of kinds is owned by the
 * server so it is never duplicated here.
 */
export default function PluginConfigsIndexPage() {
  usePageTitle("Plugin Configs");

  const {
    data: kinds = [],
    isLoading,
    isError,
  } = useQuery<PluginKindSummary[]>({
    queryKey: pluginKindsQueryKey(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-plugin-configs-title">
          Plugin Configs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a plugin kind to manage its configurations.
        </p>
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-16 text-muted-foreground"
          data-testid="status-loading-kinds"
        >
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading plugin kinds…
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="status-kinds-error">
            Couldn’t load plugin kinds. Please try again.
          </CardContent>
        </Card>
      ) : kinds.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="status-kinds-empty">
            There are no configurable plugin kinds available.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {kinds.map((k) => (
            <Link
              key={k.kind}
              href={`/admin/plugin-configs/${k.kind}`}
              data-testid={`link-plugin-kind-${k.kind}`}
            >
              <Card className="cursor-pointer hover-elevate active-elevate-2">
                <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                  <Puzzle className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base" data-testid={`text-plugin-kind-label-${k.kind}`}>
                      {k.label}
                    </CardTitle>
                    <CardDescription className="truncate">{k.kind}</CardDescription>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
