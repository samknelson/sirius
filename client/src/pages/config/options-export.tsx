import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import type { OptionsExportEnvelope } from "@shared/optionsTransfer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OptionsLayout, useOptionsLayout } from "@/components/layouts/OptionsLayout";
import { useToast } from "@/hooks/use-toast";

function ExportTab() {
  const { optionsType, definition } = useOptionsLayout();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError } = useQuery<OptionsExportEnvelope>({
    queryKey: ["/api/options", optionsType, "export"],
  });

  const json = useMemo(() => (data ? JSON.stringify(data, null, 2) : ""), [data]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied", description: "The JSON is on your clipboard." });
    } catch {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access — select the text and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = () => {
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${optionsType}-${date}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle data-testid="text-export-title">Export {definition.pluralName}</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!json}
              data-testid="button-copy-export"
            >
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!json}
              data-testid="button-download-export"
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive" data-testid="text-export-error">
            Failed to build the export.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-3" data-testid="text-export-summary">
              {data?.records.length ?? 0} record{(data?.records.length ?? 0) === 1 ? "" : "s"}. Edit this
              JSON and paste it into the Import tab to apply changes in bulk.
            </p>
            <pre
              className="max-h-[32rem] overflow-auto rounded-md border border-border bg-muted p-4 text-xs font-mono"
              data-testid="text-export-json"
            >
              {json}
            </pre>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function OptionsExportPage() {
  return (
    <OptionsLayout activeTab="export">
      <ExportTab />
    </OptionsLayout>
  );
}
