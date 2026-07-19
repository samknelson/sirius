import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Camera, User, List } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { SnapshotMeta } from "@shared/snapshots";
import { getSnapshotRenderer } from "./renderers";

interface SnapshotDetail extends SnapshotMeta {
  decoded: unknown;
}

interface SnapshotBrowserProps {
  entityType: string;
  entityId: string;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Generic, type-blind snapshot browser. Lands on a clickable list of the
 * entity's snapshots (newest first, showing timestamp / author / label);
 * selecting one opens the detail view with older/newer navigation and a
 * back-to-list link. The selected snapshot renders through the client
 * renderer registry for its entity type.
 */
export function SnapshotBrowser({ entityType, entityId }: SnapshotBrowserProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: snapshots, isLoading: listLoading } = useQuery<SnapshotMeta[]>({
    queryKey: ["/api/snapshots", entityType, entityId],
  });

  // Reset to the list view when the target entity changes.
  useEffect(() => {
    setSelectedId(null);
  }, [entityType, entityId]);

  // If the selected snapshot disappears from the list (e.g. retention
  // cleanup), fall back to the list view rather than a blank detail.
  useEffect(() => {
    if (selectedId && snapshots && !snapshots.some((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
  }, [snapshots, selectedId]);

  const selectedIndex = useMemo(
    () => (snapshots && selectedId ? snapshots.findIndex((s) => s.id === selectedId) : -1),
    [snapshots, selectedId],
  );
  const selected = selectedIndex >= 0 ? snapshots![selectedIndex] : undefined;

  const { data: detail, isLoading: detailLoading } = useQuery<SnapshotDetail>({
    queryKey: ["/api/snapshots", entityType, entityId, selectedId],
    enabled: !!selectedId,
  });

  const Renderer = getSnapshotRenderer(entityType);

  if (listLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!snapshots || snapshots.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Camera className="text-muted-foreground" size={32} />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">No Snapshots</h3>
          <p className="text-muted-foreground text-center" data-testid="text-no-snapshots">
            No snapshots have been captured for this record yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  // List view (landing): clickable rows, newest first.
  if (!selected) {
    return (
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border" data-testid="list-snapshots">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(snapshot.id)}
                  className="w-full flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50 active:bg-muted transition-colors"
                  data-testid={`row-snapshot-${snapshot.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Camera className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium" data-testid={`text-snapshot-timestamp-${snapshot.id}`}>
                          {formatTimestamp(snapshot.createdAt)}
                        </span>
                        {snapshot.label && (
                          <Badge variant="secondary" data-testid={`badge-snapshot-label-${snapshot.id}`}>
                            {snapshot.label}
                          </Badge>
                        )}
                      </div>
                      {snapshot.authorName && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <User className="h-3 w-3" />
                          <span data-testid={`text-snapshot-author-${snapshot.id}`}>
                            {snapshot.authorName}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  // Detail view. Snapshots are newest-first: "older" moves down the list.
  const hasOlder = selectedIndex < snapshots.length - 1;
  const hasNewer = selectedIndex > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedId(null)}
            data-testid="button-snapshot-back-to-list"
          >
            <List className="h-4 w-4 mr-1" />
            List
          </Button>
          <Camera className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium" data-testid="text-snapshot-timestamp">
                {formatTimestamp(selected.createdAt)}
              </span>
              {selected.label && (
                <Badge variant="secondary" data-testid="badge-snapshot-label">
                  {selected.label}
                </Badge>
              )}
            </div>
            {selected.authorName && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <User className="h-3 w-3" />
                <span data-testid="text-snapshot-author">{selected.authorName}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground tabular-nums" data-testid="text-snapshot-position">
            {selectedIndex + 1} of {snapshots.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasOlder}
            onClick={() => setSelectedId(snapshots[selectedIndex + 1].id)}
            data-testid="button-snapshot-older"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Older
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNewer}
            onClick={() => setSelectedId(snapshots[selectedIndex - 1].id)}
            data-testid="button-snapshot-newer"
          >
            Newer
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      {detailLoading || !detail ? (
        <Skeleton className="h-48 w-full" />
      ) : Renderer ? (
        <Renderer decoded={detail.decoded} />
      ) : (
        <Card>
          <CardContent className="py-6">
            <pre className="text-xs overflow-auto" data-testid="text-snapshot-raw">
              {JSON.stringify(detail.decoded, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
