import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, FileText } from "lucide-react";
import type { WizardStepComponentProps } from "./types";

interface ReportColumn {
  id: string;
  header: string;
  type?: string;
  width?: number;
}

interface StepData {
  columns: ReportColumn[];
  records: Array<Record<string, unknown>>;
  recordCount: number;
}

/**
 * Generic escape-hatch component for `results` steps. Reads the columns +
 * rows the dispatcher exposes at GET .../dispatch/:stepId/data and offers
 * a CSV export via GET .../dispatch/:stepId/export. Columns-driven, so
 * any report wizard reuses it unchanged.
 */
export function ResultsTable({ wizardId, step }: WizardStepComponentProps) {
  const { data, isLoading } = useQuery<StepData>({
    queryKey: [`/api/wizards/${wizardId}/dispatch/${step.id}/data`],
    enabled: !!wizardId,
  });

  const columns = data?.columns ?? [];
  const records = data?.records ?? [];
  const recordCount = data?.recordCount ?? records.length;
  const hasReport = columns.length > 0 || recordCount > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            {step.name}
          </CardTitle>
          {hasReport && (
            <Button asChild variant="outline" size="sm">
              <a
                href={`/api/wizards/${wizardId}/dispatch/${step.id}/export`}
                data-testid="button-export-csv"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </a>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading results…</p>
        ) : !hasReport ? (
          <p className="text-sm text-muted-foreground">
            No results yet. Run the report to generate results.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {recordCount} record{recordCount === 1 ? "" : "s"}
            </p>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead key={col.id}>{col.header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={columns.length || 1}
                        className="text-center text-muted-foreground"
                      >
                        No records matched the report criteria.
                      </TableCell>
                    </TableRow>
                  ) : (
                    records.map((row, idx) => (
                      <TableRow key={idx} data-testid={`results-row-${idx}`}>
                        {columns.map((col) => (
                          <TableCell key={col.id}>
                            {row[col.id] === null || row[col.id] === undefined
                              ? ""
                              : String(row[col.id])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
