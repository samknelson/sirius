import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Camera, User } from "lucide-react";
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
 * Generic, type-blind snapshot browser: lists an entity's snapshots
 * (newest first) with next/previous navigation and renders the selected
 * snapshot through the client renderer registry for its entity type.
 */
export function SnapshotBrowser({ entityType, entityId }: SnapshotBrowserProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: snapshots, isLoading: listLoading } = useQuery<SnapshotMeta[]>({
    queryKey: ["/api/snapshots", entityType, entityId],
  });

  // Reset selection when the target entity changes.
  useEffect(() => {
    setSelectedId(null);
  }, [entityType, entityId]);

  // Default to the newest snapshot once the list arrives; also recover if
  // the selected snapshot is no longer present in the loaded list.
  useEffect(() => {
    if (!snapshots || snapshots.length === 0) return;
    if (!selectedId || !snapshots.some((s) => s.id === selectedId)) {
      setSelectedId(snapshots[0].id);
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

  // Snapshots are newest-first: "previous" moves to an older snapshot.
  const hasOlder = selectedIndex >= 0 && selectedIndex < snapshots.length - 1;
  const hasNewer = selectedIndex > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Camera className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium" data-testid="text-snapshot-timestamp">
                {selected ? formatTimestamp(selected.createdAt) : ""}
              </span>
              {selected?.label && (
                <Badge variant="secondary" data-testid="badge-snapshot-label">
                  {selected.label}
                </Badge>
              )}
            </div>
            {selected?.authorName && (
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
