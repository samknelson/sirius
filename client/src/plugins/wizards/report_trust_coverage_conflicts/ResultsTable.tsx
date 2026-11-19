import { Download, FileText } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getApiErrorMessage } from "@/lib/queryClient";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import type { EdiCoverageConflictReport } from "@shared/edi-coverage-choices";
import { CoverageEntryList, formatWhen } from "../trust_provider_edi/CoverageEntries";
import { downloadStepExport } from "../trust_provider_edi/use-coverage-review";

const count = (value: number, one: string, many = `${one}s`) => `${value.toLocaleString()} ${value === 1 ? one : many}`;

/**
 * The remaining conflicts for the chosen months, shown the way a feed's
 * exclusion list shows them. Reading only: corrections are made on each
 * person's own benefit records.
 */
export function ResultsTable({ wizardId, step, data: wizardData }: WizardStepComponentProps) {
  const url = `/api/wizards/${wizardId}/dispatch/${step.id}/data`;
  // A re-run replaces the list, so the list is keyed by the run that made it.
  const report = useQuery<EdiCoverageConflictReport>({
    queryKey: [url, { generation: wizardData?.reportMeta?.generatedAt ?? "none" }],
    enabled: !!wizardId,
  });
  const download = useMutation({ mutationFn: () => downloadStepExport(wizardId, step.id, "csv") });
  const result = report.data;

  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />{step.name}
        </CardTitle>
        {result?.generated && <Button variant="outline" size="sm" onClick={() => download.mutate()}
          disabled={download.isPending} data-testid="button-export-csv">
          <Download className="mr-2 h-4 w-4" />{download.isPending ? "Preparing download…" : "Download list (CSV)"}
        </Button>}
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      {download.isError && <p role="alert" className="text-sm text-destructive">
        {getApiErrorMessage(download.error, "Could not prepare the download.")}
      </p>}
      {report.isLoading && <p className="text-sm text-muted-foreground">Loading results…</p>}
      {report.isError && <p role="alert" className="text-sm text-destructive">
        Could not read the results. Reload the page and try again.
      </p>}
      {result && !result.generated && <p className="text-sm text-muted-foreground">
        No results yet. Run the report to list conflicting coverage.
      </p>}
      {result?.generated && <>
        <div className="space-y-1 text-sm" data-testid="conflict-summary">
          <p className="font-medium" role="status">
            {result.conflictCount
              ? `${count(result.conflictCount, "conflict")} for ${count(result.peopleCount, "person", "people")}, involving ${count(result.recordCount, "coverage record")}.`
              : "No conflicting coverage was found."}
          </p>
          <p className="text-muted-foreground">
            Coverage months {result.fromMonth} to {result.toMonth}, all benefits. Listed <time dateTime={result.generatedAt}>
              {formatWhen(result.generatedAt)}</time>. Corrections made since then do not appear until the report is run again.
          </p>
          <p className="text-muted-foreground">
            {result.rule === "exclude-conflicting"
              ? "The temporary rule is on: carrier files leave these people out for these months and list them on the run."
              : "The temporary rule is off: a carrier file that needs one of these months stops until it is corrected."}
          </p>
        </div>
        <CoverageEntryList title="Conflicting coverage" entries={result.conflicts} total={result.conflictCount}
          empty="Nothing to clean up in these months."
          personHref={workerId => `/workers/${workerId}/benefits/history`} />
      </>}
    </CardContent>
  </Card>;
}
