import { useQuery } from "@tanstack/react-query";
import {
  Card as UICard,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";

interface GenericCardProps {
  title?: string;
  description?: string;
  /**
   * Preferred: pull data from another plugin's /content endpoint. Honors
   * server-side component + access-policy gating automatically.
   */
  pluginId?: string;
  action?: string;
  /**
   * Legacy escape hatch — direct URL fetch. Avoid for dashboard data; use
   * `pluginId` instead so the framework's /content gate is enforced.
   */
  contentUrl?: string;
  emptyMessage?: string;
}

function PluginCardBody({
  pluginId,
  action,
  emptyMessage,
}: {
  pluginId: string;
  action?: string;
  emptyMessage?: string;
}) {
  const { data, isLoading, error } = useDashboardContent<unknown>(pluginId, { action });

  return (
    <>
      {isLoading && <p>Loading…</p>}
      {error && <p className="text-destructive">Failed to load content.</p>}
      {!isLoading && !error && data === undefined && <p>{emptyMessage ?? "No content available."}</p>}
      {!isLoading && !error && data !== undefined && (
        <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(data, null, 2)}</pre>
      )}
    </>
  );
}

function UrlCardBody({
  contentUrl,
  emptyMessage,
}: {
  contentUrl: string;
  emptyMessage?: string;
}) {
  const { data, isLoading, error } = useQuery<unknown>({ queryKey: [contentUrl] });
  return (
    <>
      {isLoading && <p>Loading…</p>}
      {error && <p className="text-destructive">Failed to load content.</p>}
      {!isLoading && !error && data === undefined && <p>{emptyMessage ?? "No content available."}</p>}
      {!isLoading && !error && data !== undefined && (
        <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(data, null, 2)}</pre>
      )}
    </>
  );
}

export function Card({ componentProps }: DashboardPluginProps) {
  const props = (componentProps ?? {}) as GenericCardProps;
  const { title, description, pluginId, action, contentUrl, emptyMessage } = props;

  return (
    <UICard data-testid={`card-generic-${title ?? "untitled"}`}>
      <CardHeader>
        <CardTitle>{title ?? "Untitled"}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-2">
        {description && <p>{description}</p>}
        {pluginId ? (
          <PluginCardBody pluginId={pluginId} action={action} emptyMessage={emptyMessage} />
        ) : contentUrl ? (
          <UrlCardBody contentUrl={contentUrl} emptyMessage={emptyMessage} />
        ) : null}
      </CardContent>
    </UICard>
  );
}
