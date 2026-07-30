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

interface BenefitSummaryBenefitRow {
  benefitId: string;
  benefitName: string;
  counts: Record<"last" | "current" | "next", number>;
  lostThisMonth: number;
}

interface BenefitSummaryGroup {
  benefitTypeId: string;
  benefitTypeName: string;
  counts: Record<"last" | "current" | "next", number>;
  lostThisMonth: number;
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
                {data.groups.flatMap((group) => [
                  ...group.benefits.map((row) => (
                    <TableRow
                      key={row.benefitId}
                      data-testid={`benefit-summary-benefit-row-${row.benefitId}`}
                    >
                      <TableCell>
                        <span className="font-medium">{row.benefitName}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          ({group.benefitTypeName})
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{row.counts.last}</TableCell>
                      <TableCell className="text-right">{row.counts.current}</TableCell>
                      <TableCell className="text-right">{row.counts.next}</TableCell>
                      <TableCell className="text-right">
                        {row.lostThisMonth > 0 ? (
                          <span className="text-destructive font-medium">
                            {row.lostThisMonth}
                          </span>
                        ) : (
                          0
                        )}
                      </TableCell>
                    </TableRow>
                  )),
                  <TableRow
                    key={`${group.benefitTypeId}-total`}
                    className="bg-muted/50"
                    data-testid={`benefit-summary-row-${group.benefitTypeId}`}
                  >
                    <TableCell className="font-medium">
                      {group.benefitTypeName} total
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {group.counts.last}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {group.counts.current}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {group.counts.next}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {group.lostThisMonth > 0 ? (
                        <span className="text-destructive">{group.lostThisMonth}</span>
                      ) : (
                        0
                      )}
                    </TableCell>
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
