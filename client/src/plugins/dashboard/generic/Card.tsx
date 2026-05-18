import { useQuery } from "@tanstack/react-query";
import {
  Card as UICard,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DashboardPluginProps } from "../registry";

interface GenericCardProps {
  title?: string;
  description?: string;
  contentUrl?: string;
  emptyMessage?: string;
}

export function Card({ componentProps }: DashboardPluginProps) {
  const props = (componentProps ?? {}) as GenericCardProps;
  const { title, description, contentUrl, emptyMessage } = props;

  const { data, isLoading, error } = useQuery<unknown>({
    queryKey: contentUrl ? [contentUrl] : ["generic:Card:no-url"],
    enabled: !!contentUrl,
  });

  return (
    <UICard data-testid={`card-generic-${title ?? "untitled"}`}>
      <CardHeader>
        <CardTitle>{title ?? "Untitled"}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-2">
        {description && <p>{description}</p>}
        {contentUrl && isLoading && <p>Loading…</p>}
        {contentUrl && error && (
          <p className="text-destructive">Failed to load content.</p>
        )}
        {contentUrl && !isLoading && !error && data === undefined && (
          <p>{emptyMessage ?? "No content available."}</p>
        )}
        {contentUrl && !isLoading && !error && data !== undefined && (
          <pre className="whitespace-pre-wrap text-xs">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </CardContent>
    </UICard>
  );
}
