import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, X, Star } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GrievanceCardinality } from "@shared/schema";

export interface SectionWorker {
  workerId: string;
  siriusId: number | null;
  displayName: string | null;
  primary: boolean;
}

export interface WorkerSearchHit {
  id: string;
  siriusId: number | null;
  displayName: string | null;
}

interface GrievanceWorkerSectionProps {
  cardinality: GrievanceCardinality;
  workers: SectionWorker[];
  onAdd: (worker: WorkerSearchHit) => void | Promise<void>;
  onRemove: (workerId: string) => void | Promise<void>;
  onSetPrimary: (workerId: string, primary: boolean) => void | Promise<void>;
  busy?: boolean;
}

/**
 * Cardinality-aware worker picker shared by the grievance create and edit
 * surfaces. Rendering adapts to the grievance cardinality:
 *
 * - `class`         → nothing (the class description replaces the worker list).
 * - `individual`    → at most one worker; the worker is implicitly the lead.
 * - `multiple`      → many workers, no lead control.
 * - `multiple-with-lead` → many workers with a lead toggle.
 *
 * The component is fully controlled: parents wire `onAdd`/`onRemove`/
 * `onSetPrimary` to either local staged state (create) or live API calls
 * (edit).
 */
export function GrievanceWorkerSection({
  cardinality,
  workers,
  onAdd,
  onRemove,
  onSetPrimary,
  busy,
}: GrievanceWorkerSectionProps) {
  const [query, setQuery] = useState("");

  const { data: searchData } = useQuery<{ workers: WorkerSearchHit[]; total: number }>({
    queryKey: ["/api/workers/search", query],
    queryFn: async () => {
      const response = await fetch(`/api/workers/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("Search failed");
      return response.json();
    },
    enabled: query.trim().length >= 2,
  });

  if (cardinality === "class") return null;

  const isSingle = cardinality === "individual";
  const showLead = cardinality === "multiple-with-lead";
  const canAddMore = isSingle ? workers.length === 0 : true;

  const selectedIds = new Set(workers.map((w) => w.workerId));
  const results = (searchData?.workers ?? []).filter((w) => !selectedIds.has(w.id));

  const handleAdd = async (worker: WorkerSearchHit) => {
    await onAdd(worker);
    setQuery("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isSingle ? "Worker" : "Workers"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canAddMore && (
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={16}
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workers by name, ID, or SSN"
              className="pl-9"
              data-testid="input-worker-search"
            />
            {query.trim().length >= 2 && results.length > 0 && (
              <div className="mt-2 border rounded-lg divide-y max-h-60 overflow-y-auto">
                {results.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleAdd(w)}
                    className="w-full text-left px-3 py-2 hover:bg-muted disabled:opacity-50"
                    data-testid={`button-add-worker-${w.id}`}
                  >
                    {w.displayName || "Unknown"}{" "}
                    <span className="text-muted-foreground text-sm">
                      {w.siriusId != null ? `#${w.siriusId}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {workers.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="text-no-workers">
            No workers selected.
          </p>
        ) : (
          <div className="space-y-2">
            {workers.map((w) => (
              <div
                key={w.workerId}
                className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2"
                data-testid={`row-worker-${w.workerId}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Link
                    href={`/workers/${w.workerId}`}
                    className="hover:underline truncate"
                    data-testid={`link-worker-${w.workerId}`}
                  >
                    {w.displayName || "Unknown"}
                    {w.siriusId != null ? ` #${w.siriusId}` : ""}
                  </Link>
                  {w.primary && showLead && (
                    <Badge variant="default" data-testid={`badge-lead-${w.workerId}`}>
                      Lead
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {showLead && (
                    <Button
                      type="button"
                      variant={w.primary ? "secondary" : "outline"}
                      size="sm"
                      disabled={busy}
                      onClick={() => onSetPrimary(w.workerId, !w.primary)}
                      data-testid={`button-toggle-lead-${w.workerId}`}
                    >
                      <Star size={14} className="mr-1" />
                      {w.primary ? "Unset lead" : "Set as lead"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() => onRemove(w.workerId)}
                    data-testid={`button-remove-worker-${w.workerId}`}
                  >
                    <X size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface GrievanceWorkerManagerProps {
  grievanceId: string;
  cardinality: GrievanceCardinality;
  workers: SectionWorker[];
}

/**
 * Live (edit) worker manager. Each action issues an immediate API
 * request against the persisted grievance and refreshes the cache.
 */
export function GrievanceWorkerManager({
  grievanceId,
  cardinality,
  workers,
}: GrievanceWorkerManagerProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievanceId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
  };

  const onAdd = async (worker: WorkerSearchHit) => {
    setBusy(true);
    try {
      await apiRequest("POST", `/api/grievances/${grievanceId}/workers`, {
        workerId: worker.id,
      });
      await refresh();
      toast({ title: "Worker added" });
    } catch (error: any) {
      toast({
        title: "Failed to add worker",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (workerId: string) => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/grievances/${grievanceId}/workers/${workerId}`);
      await refresh();
      toast({ title: "Worker removed" });
    } catch (error: any) {
      toast({
        title: "Failed to remove worker",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onSetPrimary = async (workerId: string, primary: boolean) => {
    setBusy(true);
    try {
      await apiRequest("PATCH", `/api/grievances/${grievanceId}/workers/${workerId}`, {
        primary,
      });
      await refresh();
    } catch (error: any) {
      toast({
        title: "Failed to update lead",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GrievanceWorkerSection
      cardinality={cardinality}
      workers={workers}
      onAdd={onAdd}
      onRemove={onRemove}
      onSetPrimary={onSetPrimary}
      busy={busy}
    />
  );
}
