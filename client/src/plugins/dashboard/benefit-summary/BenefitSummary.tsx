import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HeartPulse, Loader2 } from "lucide-react";
import type { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";

interface BenefitSummaryMonth {
  month: number;
  year: number;
  key: "last" | "current" | "next";
  label: string;
}

interface BenefitSummaryRow {
  benefitId: string;
  benefitName: string;
  counts: Record<"last" | "current" | "next", number>;
  lostThisMonth: number;
}

interface BenefitSummaryContent {
  months: BenefitSummaryMonth[];
  rows: BenefitSummaryRow[];
}

export function BenefitSummary(props: DashboardPluginProps) {
  const { data, isLoading, isError } = useDashboardContent<BenefitSummaryContent>(
    "benefit-summary",
  );

  return (
    <Card data-testid={`plugin-benefit-summary-${props.configId ?? "default"}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="h-5 w-5" />
          {props.configName || "Benefit Summary"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div
            className="flex items-center justify-center py-6 text-muted-foreground"
            data-testid="benefit-summary-loading"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive" data-testid="benefit-summary-error">
            Failed to load benefit summary.
          </p>
        ) : !data || data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="benefit-summary-empty">
            No benefits selected. An administrator can choose which benefits to
            summarize in this widget's settings.
          </p>
        ) : (
          <Table data-testid="benefit-summary-table">
            <TableHeader>
              <TableRow>
                <TableHead>Benefit</TableHead>
                {data.months.map((m) => (
                  <TableHead key={m.key} className="text-right">
                    {m.label}
                  </TableHead>
                ))}
                <TableHead className="text-right">Lost this month</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.benefitId} data-testid={`benefit-summary-row-${row.benefitId}`}>
                  <TableCell className="font-medium">{row.benefitName}</TableCell>
                  <TableCell className="text-right">{row.counts.last}</TableCell>
                  <TableCell className="text-right">{row.counts.current}</TableCell>
                  <TableCell className="text-right">{row.counts.next}</TableCell>
                  <TableCell className="text-right">
                    {row.lostThisMonth > 0 ? (
                      <span className="text-destructive font-medium">{row.lostThisMonth}</span>
                    ) : (
                      0
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
