import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Download, Send, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface DeliverStepData {
  ready: boolean;
  filename?: string;
  rowCount?: number;
  content?: string;
  destinationId?: string | null;
  destinationName?: string | null;
  delivery?: {
    deliveredAt: string;
    filename: string;
    rowCount: number;
    destinationName: string | null;
  } | null;
}

/**
 * Final step of the trust-provider EDI wizard: download the encoded file
 * and/or deliver it to the configuration's SFTP destination.
 */
export function DeliverStep({ wizardId, step }: WizardStepComponentProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dataUrl = `/api/wizards/${wizardId}/dispatch/${step.id}/data`;
  const { data, isLoading } = useQuery<DeliverStepData>({ queryKey: [dataUrl] });

  const deliverMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      queryClient.invalidateQueries({ queryKey: [dataUrl] });
      toast({ title: "File delivered", description: "The EDI file was uploaded via SFTP." });
    },
    onError: (error) => {
      toast({
        title: "Delivery failed",
        description: getApiErrorMessage(error, "SFTP delivery failed"),
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-6 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (!data?.ready) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-muted-foreground p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <span data-testid="text-not-ready">
              Generate the file before delivering it.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const download = () => {
    const blob = new Blob([data.content ?? ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename || "edi-file.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deliver EDI File</CardTitle>
        <CardDescription>
          {data.rowCount} record{data.rowCount === 1 ? "" : "s"} encoded as{" "}
          <span className="font-mono">{data.filename}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.delivery?.deliveredAt && (
          <div
            className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-3"
            data-testid="text-delivered"
          >
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span>
              Delivered {data.delivery.filename} ({data.delivery.rowCount}{" "}
              records) to {data.delivery.destinationName || "SFTP destination"}{" "}
              on {new Date(data.delivery.deliveredAt).toLocaleString()}
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={download} data-testid="button-download">
            <Download className="h-4 w-4 mr-2" />
            Download File
          </Button>
          {data.destinationId ? (
            <Button
              onClick={() => deliverMutation.mutate()}
              disabled={deliverMutation.isPending}
              data-testid="button-deliver"
            >
              <Send className="h-4 w-4 mr-2" />
              {deliverMutation.isPending
                ? "Delivering..."
                : data.delivery
                  ? `Re-deliver to ${data.destinationName ?? "SFTP"}`
                  : `Deliver to ${data.destinationName ?? "SFTP"}`}
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span data-testid="text-no-destination">
                This configuration has no SFTP destination — download only.
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
