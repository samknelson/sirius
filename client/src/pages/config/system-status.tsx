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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  XCircle,
} from "lucide-react";

type StatusPriority = "info" | "notice" | "warning" | "error";

interface StatusMessage {
  priority: StatusPriority;
  title: string;
  details?: string;
}

interface SystemStatusEntry {
  id: string;
  name: string;
  description: string;
  canRescan: boolean;
  worstPriority: StatusPriority;
  result: {
    pluginId: string;
    messages: StatusMessage[];
    scannedAt: string;
    durationMs: number;
  };
}

function PriorityIcon({ priority }: { priority: StatusPriority }) {
  switch (priority) {
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />;
    case "notice":
      return <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />;
    default:
      return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />;
  }
}

function PriorityBadge({ priority }: { priority: StatusPriority }) {
  switch (priority) {
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    case "warning":
      return (
        <Badge className="bg-yellow-500 hover:bg-yellow-500/90 text-white">Warning</Badge>
      );
    case "notice":
      return <Badge variant="secondary">Notice</Badge>;
    default:
      return <Badge variant="outline">Info</Badge>;
  }
}

const CARD_PRIORITY_CLASSES: Record<StatusPriority, string> = {
  info: "border-green-500/50 bg-green-50/50 dark:bg-green-950/20",
  notice: "border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20",
  warning: "border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20",
  error: "border-red-500/50 bg-red-50/50 dark:bg-red-950/20",
};

export default function SystemStatusPage() {
  usePageTitle("System Status");
  const { toast } = useToast();
  const [rescanningId, setRescanningId] = useState<string | null>(null);

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
            <ul className="space-y-2">
              {entry.result.messages.map((message, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2"
                  data-testid={`row-status-message-${entry.id}-${i}`}
                >
                  <PriorityBadge priority={message.priority} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{message.title}</div>
                    {message.details && (
                      <div className="text-sm text-muted-foreground break-words">
                        {message.details}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

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
