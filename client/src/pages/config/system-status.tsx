import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Activity, List, RefreshCw } from "lucide-react";
import {
  CARD_PRIORITY_CLASSES,
  PriorityIcon,
  StatusDetailsView,
  StatusMessageList,
  type StatusDetails,
  type SystemStatusEntry,
} from "@/components/system-status/status-render";

/**
 * Details drill-down dialog. Fetches fresh on every open (staleTime 0,
 * gcTime 0 — never served from cache, matching the server's no-store).
 */
function DetailsDialog({
  entry,
  onClose,
}: {
  entry: SystemStatusEntry;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery<StatusDetails>({
    queryKey: [`/api/system-status/${entry.id}/details`],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{entry.name} — Details</DialogTitle>
          <DialogDescription>
            Loaded fresh just now; this data is never cached.
          </DialogDescription>
        </DialogHeader>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {error != null && (
          <p className="text-sm text-destructive">
            {getApiErrorMessage(error, "Failed to load details")}
          </p>
        )}
        {data && <StatusDetailsView details={data} />}
      </DialogContent>
    </Dialog>
  );
}

export default function SystemStatusPage() {
  usePageTitle("System Status");
  const { toast } = useToast();
  const [rescanningId, setRescanningId] = useState<string | null>(null);
  const [detailsEntry, setDetailsEntry] = useState<SystemStatusEntry | null>(null);

  const { data: entries, isLoading } = useQuery<SystemStatusEntry[]>({
    queryKey: ["/api/system-status"],
  });

  const rescanAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/system-status/rescan");
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/system-status"], data);
      toast({ title: "Rescan complete", description: "All checks were re-run." });
    },
    onError: (error) => {
      toast({
        title: "Rescan failed",
        description: getApiErrorMessage(error, "Failed to rescan system status"),
        variant: "destructive",
      });
    },
  });

  const rescanOneMutation = useMutation({
    mutationFn: async (id: string) => {
      return (await apiRequest("POST", `/api/system-status/${id}/rescan`)) as SystemStatusEntry;
    },
    onMutate: (id) => setRescanningId(id),
    onSettled: () => setRescanningId(null),
    onSuccess: (entry) => {
      queryClient.setQueryData<SystemStatusEntry[]>(["/api/system-status"], (old) =>
        old ? old.map((e) => (e.id === entry.id ? entry : e)) : old,
      );
    },
    onError: (error) => {
      toast({
        title: "Rescan failed",
        description: getApiErrorMessage(error, "Failed to rescan this check"),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" />
            System Status
          </h1>
          <p className="text-muted-foreground mt-1">
            Health checks across the system. Results are held in memory and reset when the
            server restarts.
          </p>
        </div>
        <Button
          onClick={() => rescanAllMutation.mutate()}
          disabled={rescanAllMutation.isPending}
          data-testid="button-rescan-all"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${rescanAllMutation.isPending ? "animate-spin" : ""}`}
          />
          Rescan All
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {entries && entries.length > 0 && (() => {
        const counts = { healthy: 0, notice: 0, warning: 0, error: 0 };
        for (const e of entries) {
          if (e.worstPriority === "info") counts.healthy++;
          else counts[e.worstPriority]++;
        }
        const parts = [
          `${entries.length} status plugin${entries.length === 1 ? "" : "s"}`,
          `${counts.healthy} healthy`,
          ...(counts.notice > 0 ? [`${counts.notice} notice${counts.notice === 1 ? "" : "s"}`] : []),
          ...(counts.warning > 0 ? [`${counts.warning} warning${counts.warning === 1 ? "" : "s"}`] : []),
          ...(counts.error > 0 ? [`${counts.error} error${counts.error === 1 ? "" : "s"}`] : []),
        ];
        return (
          <p className="text-sm font-medium" data-testid="text-status-summary">
            {parts.join(", ")}
          </p>
        );
      })()}

      {entries?.map((entry) => (
        <Card
          key={entry.id}
          className={CARD_PRIORITY_CLASSES[entry.worstPriority]}
          data-testid={`card-system-status-${entry.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PriorityIcon priority={entry.worstPriority} />
                <CardTitle className="text-base">{entry.name}</CardTitle>
              </div>
              <div className="flex items-center gap-3">
                {entry.canRescan && (
                  <span
                    className="text-xs text-muted-foreground"
                    data-testid={`text-scanned-at-${entry.id}`}
                  >
                    Scanned {new Date(entry.result.scannedAt).toLocaleString()} —{" "}
                    {formatDistanceToNow(new Date(entry.result.scannedAt), { addSuffix: true })} (
                    {entry.result.durationMs}ms)
                  </span>
                )}
                {entry.hasDetails && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDetailsEntry(entry)}
                    data-testid={`button-details-${entry.id}`}
                  >
                    <List className="h-3.5 w-3.5 mr-1.5" />
                    Details
                  </Button>
                )}
                {entry.canRescan && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => rescanOneMutation.mutate(entry.id)}
                    disabled={rescanningId === entry.id || rescanAllMutation.isPending}
                    data-testid={`button-rescan-${entry.id}`}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 mr-1.5 ${rescanningId === entry.id ? "animate-spin" : ""}`}
                    />
                    Rescan
                  </Button>
                )}
              </div>
            </div>
            <CardDescription>{entry.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusMessageList
              messages={entry.result.messages}
              testIdPrefix={`row-status-message-${entry.id}`}
            />
          </CardContent>
        </Card>
      ))}

      {detailsEntry && (
        <DetailsDialog entry={detailsEntry} onClose={() => setDetailsEntry(null)} />
      )}

      {entries && entries.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No status checks are available.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
