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
   * Pull data from another plugin's /content endpoint. Honors server-side
   * component + access-policy gating automatically. This is the ONLY
   * supported way for a generic card to fetch data — direct URL fetches
   * are intentionally not supported (see Task #203 / Task #204 and the
   * Dashboard Plugin System entry in replit.md).
   */
  pluginId?: string;
  action?: string;
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

export function Card({ componentProps }: DashboardPluginProps) {
  const props = (componentProps ?? {}) as GenericCardProps & { contentUrl?: unknown };
  const { title, description, pluginId, action, emptyMessage } = props;

  if (import.meta.env.DEV && props.contentUrl !== undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      `[dashboard/generic/Card] "contentUrl" is no longer supported (title="${title ?? "untitled"}"). ` +
        `Move the data behind a dashboard plugin's /content resolver and pass { pluginId, action } instead. ` +
        `See replit.md → Dashboard Plugin System.`,
    );
  }

  return (
    <UICard data-testid={`card-generic-${title ?? "untitled"}`}>
      <CardHeader>
        <CardTitle>{title ?? "Untitled"}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-2">
        {description && <p>{description}</p>}
        {pluginId ? (
          <PluginCardBody pluginId={pluginId} action={action} emptyMessage={emptyMessage} />
        ) : null}
      </CardContent>
    </UICard>
  );
}
