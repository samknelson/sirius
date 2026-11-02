import { useEffect, useRef, useState } from "react";
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
  return <DeliverStepContent key={`${wizardId}:${step.id}`} wizardId={wizardId} step={step} />;
}

function DeliverStepContent({ wizardId, step }: Pick<WizardStepComponentProps, "wizardId" | "step">) {
  const { toast } = useToast();
  const [format, setFormat] = useState("provider");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const queryClient = useQueryClient();
  const dataUrl = `/api/wizards/${wizardId}/dispatch/${step.id}/data`;
  const { data, isLoading, isError, refetch } = useQuery<DeliverStepData>({ queryKey: [dataUrl] });

  const downloadMutation = useMutation({
    mutationFn: async (selectedFormat: string) => {
      const response = await fetch(
        `/api/wizards/${wizardId}/dispatch/${step.id}/export?format=${selectedFormat}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        throw new Error(problem?.message || "Could not export the EDI file. Retry the download.");
      }
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const filename = encodedName ? decodeURIComponent(encodedName) : /filename="([^"]+)"/i.exec(disposition)?.[1];
      if (!filename) throw new Error("The export did not include a filename");
      const blob = await response.blob();
      if (!active.current) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (error) => {
      if (active.current) toast({
        title: "Download failed",
        description: getApiErrorMessage(error, "Could not export the EDI file"),
        variant: "destructive",
      });
    },
  });

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

  if (isError) {
    return <Card><CardContent className="pt-6 space-y-3">
      <p role="alert">Could not load delivery information. No file was downloaded or delivered.</p>
      <Button variant="outline" onClick={() => refetch()}>Retry</Button>
    </CardContent></Card>;
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
        <p className="text-sm text-muted-foreground">
          Downloads contain sensitive personal and coverage data. Store and share them securely.
          Carrier-layout CSV is for QA, not provider submission; unlike Results CSV, it shows
          serialized carrier fields, including spaces and fillers. QA-only labels identify
          field names and record kinds, including file headers and trailers. Import spreadsheet
          columns as text to preserve leading zeros and codes.
        </p>
        {data.rowCount === 0 && <p role="status">No detail records matched. Downloads may contain only headings or file headers/trailers. Nothing can be sent via SFTP.</p>}
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
        <div className="space-y-2">
          <label htmlFor="edi-download-format" className="text-sm font-medium">Download format</label>
          <select
            id="edi-download-format"
            value={format}
            onChange={event => { setFormat(event.target.value); downloadMutation.reset(); }}
            disabled={downloadMutation.isPending}
            className="block rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="provider">Provider file</option>
            <option value="carrier-csv">Carrier-layout CSV</option>
          </select>
          <p className="text-sm text-muted-foreground">Downloading uses saved rows. It does not regenerate records, mark delivery complete, or contact the provider. SFTP always sends the Provider file, regardless of this choice.</p>
        </div>
        {downloadMutation.isError && <p role="alert" className="text-sm text-destructive">{getApiErrorMessage(downloadMutation.error, "Download failed")}</p>}
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => downloadMutation.mutate(format)} disabled={downloadMutation.isPending} data-testid="button-download">
            <Download className="h-4 w-4 mr-2" />
            {downloadMutation.isPending ? "Preparing download..." : format === "provider" ? "Download Provider file" : "Download Carrier-layout CSV"}
          </Button>
          {data.destinationId ? (
            <Button
              onClick={() => deliverMutation.mutate()}
              disabled={deliverMutation.isPending || data.rowCount === 0}
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
