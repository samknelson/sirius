import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, FileSpreadsheet } from "lucide-react";
import { FeedMap } from "@/components/wizards/framework/feed/FeedMap";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface WeekInfo {
  week: number;
  payWeekStart: string | null;
  payWeekEnding: string | null;
  checkDate: string | null;
}

interface MapStepData {
  format: string;
  parsed: {
    rowCount: number;
    weeks: WeekInfo[];
    payrollMonthLabel: string | null;
    fileRates: Record<string, number>;
    sampleRows: Array<{
      workLocationName: string | null;
      fullName: string | null;
      employeeStatus: string | null;
      personNumber: string | null;
      shiftCount: number | null;
    }>;
  } | null;
  parseError: string | null;
}

/**
 * Parse/Map step. Generic format → the standard column-mapping UI; matrix
 * formats (Marriott S2) are parsed automatically, so this just previews the
 * detected layout.
 */
export function Local26Map(props: WizardStepComponentProps) {
  const { wizardId, step } = props;
  const { data, isLoading } = useQuery<MapStepData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </CardContent>
      </Card>
    );
  }

  if (data?.format === "generic") {
    return <FeedMap {...props} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Marriott S2 Layout
        </CardTitle>
        <CardDescription>
          This format is parsed automatically — no column mapping needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data?.parseError && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Could not parse the file</AlertTitle>
            <AlertDescription>{data.parseError}</AlertDescription>
          </Alert>
        )}
        {!data?.parseError && !data?.parsed && (
          <p className="text-muted-foreground text-sm">
            Upload a file first, then return to this step.
          </p>
        )}
        {data?.parsed && (
          <div className="space-y-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>File parsed successfully</AlertTitle>
              <AlertDescription>
                {data.parsed.rowCount.toLocaleString()} worker rows,{" "}
                {data.parsed.weeks.length} reporting week
                {data.parsed.weeks.length === 1 ? "" : "s"} detected
                {data.parsed.payrollMonthLabel
                  ? ` (payroll month: ${data.parsed.payrollMonthLabel})`
                  : ""}
                .
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              {data.parsed.weeks.map((w) => (
                <Badge key={w.week} variant="outline" data-testid={`badge-week-${w.week}`}>
                  Week {w.week}
                  {w.payWeekEnding ? ` — ends ${w.payWeekEnding}` : ""}
                </Badge>
              ))}
            </div>
            {Object.keys(data.parsed.fileRates || {}).length > 0 && (
              <div className="text-sm text-muted-foreground">
                Rate constants in file:{" "}
                {Object.entries(data.parsed.fileRates)
                  .map(([k, v]) => `${k} $${v}`)
                  .join(", ")}
              </div>
            )}
            {data.parsed.sampleRows.length > 0 && (
              <div className="text-sm">
                <p className="font-medium mb-1">Sample rows</p>
                <div className="space-y-1">
                  {data.parsed.sampleRows.map((r, i) => (
                    <div key={i} className="text-muted-foreground border-l-2 pl-3">
                      {r.fullName || "—"} · {r.workLocationName || "—"} · status{" "}
                      {r.employeeStatus || "—"} · #{r.personNumber || "—"}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
