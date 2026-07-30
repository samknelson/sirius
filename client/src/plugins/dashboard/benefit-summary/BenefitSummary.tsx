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

type MonthKey = "last" | "current" | "next";

interface BenefitSummaryBenefitRow {
  benefitId: string;
  benefitName: string;
  counts: Record<MonthKey, number>;
  lost: Record<MonthKey, number>;
}

interface BenefitSummaryGroup {
  benefitTypeId: string;
  benefitTypeName: string;
  counts: Record<MonthKey, number>;
  lost: Record<MonthKey, number>;
  benefits: BenefitSummaryBenefitRow[];
}

interface BenefitSummaryContent {
  months: BenefitSummaryMonth[];
  groups: BenefitSummaryGroup[];
  configured: boolean;
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
        ) : !data || data.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="benefit-summary-empty">
            {data?.configured
              ? "The selected benefit types have no active benefits to summarize."
              : "No benefit types selected. An administrator can choose which benefit types to summarize in this widget's settings."}
          </p>
        ) : (
          <div data-testid="benefit-summary-groups">
            <Table className="text-xs" data-testid="benefit-summary-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 px-2">Benefit</TableHead>
                  {data.months.map((m) => (
                    <TableHead key={m.key} className="h-8 px-2 text-right whitespace-nowrap">
                      {m.label.split(" ")[0]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.groups.flatMap((group) => [
                  ...group.benefits.map((row) => (
                    <TableRow
                      key={row.benefitId}
                      data-testid={`benefit-summary-benefit-row-${row.benefitId}`}
                    >
                      <TableCell className="py-1.5 px-2">{row.benefitName}</TableCell>
                      {data.months.map((m) => (
                        <TableCell
                          key={m.key}
                          className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap"
                        >
                          {row.counts[m.key].toLocaleString()}
                          {row.lost[m.key] > 0 && (
                            <span className="text-destructive font-medium">
                              {" "}
                              ({row.lost[m.key].toLocaleString()})
                            </span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  )),
                  <TableRow
                    key={`${group.benefitTypeId}-total`}
                    className="bg-muted/50"
                    data-testid={`benefit-summary-row-${group.benefitTypeId}`}
                  >
                    <TableCell className="py-1.5 px-2 font-medium whitespace-nowrap">
                      {group.benefitTypeName} total
                    </TableCell>
                    {data.months.map((m) => (
                      <TableCell
                        key={m.key}
                        className="py-1.5 px-2 text-right font-medium tabular-nums whitespace-nowrap"
                      >
                        {group.counts[m.key].toLocaleString()}
                        {group.lost[m.key] > 0 && (
                          <span className="text-destructive">
                            {" "}
                            ({group.lost[m.key].toLocaleString()})
                          </span>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>,
                ])}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
