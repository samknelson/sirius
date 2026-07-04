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
import { Download, FileText, Eye } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import type { ReactNode } from "react";
import type { WizardStepComponentProps } from "./types";

interface ReportColumn {
  id: string;
  header: string;
  type?: string;
  width?: number;
}

type ResultsTableProps = WizardStepComponentProps & {
  /**
   * Optional per-cell override. Return a node to render a bespoke cell
   * (e.g. a report-specific link); return `undefined` to fall back to the
   * generic, type-driven rendering below. Report plugins that need
   * row-specific links wrap this component from their escape-hatch dir.
   */
  renderCell?: (
    col: ReportColumn,
    row: Record<string, unknown>,
  ) => ReactNode | undefined;
};

/**
 * Generic, type-driven cell rendering shared by every report. Mirrors the
 * legacy report ResultsStep: `link`-typed cells hold a `{ url, label }`
 * object, `date` cells are formatted, `boolean` cells read Yes/No, and
 * everything else is stringified.
 */
function defaultCell(col: ReportColumn, row: Record<string, unknown>): ReactNode {
  const value = row[col.id];
  if (value === null || value === undefined) return "";
  if (col.type === "link" && typeof value === "object") {
    const link = value as { url?: string; label?: string };
    if (link.url) {
      return (
        <Link
          href={link.url}
          className="inline-flex items-center gap-1 text-primary hover:text-primary/80 hover:underline"
        >
          <Eye className="h-4 w-4" />
          <span className="text-sm">{link.label ?? link.url}</span>
        </Link>
      );
    }
  }
  if (col.type === "date") {
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? String(value) : format(d, "PP");
  }
  if (col.type === "boolean") return value ? "Yes" : "No";
  return String(value);
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
export function ResultsTable({ wizardId, step, renderCell }: ResultsTableProps) {
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
                        {columns.map((col) => {
                          const custom = renderCell?.(col, row);
                          return (
                            <TableCell key={col.id}>
                              {custom !== undefined
                                ? custom
                                : defaultCell(col, row)}
                            </TableCell>
                          );
                        })}
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
