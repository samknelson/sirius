import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Calculator, CheckCircle2, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PensionTopSummary {
  workerId: string;
  totalShares: string;
  currentShareValue: string;
  accumulatedBenefit: string;
  qualifiedYears: number;
}

interface PensionYearSummary {
  year: number;
  accrualMethod?: string;
  totalHours: number;
  accrualPct?: number;
  benefitRate?: number;
  contributionPct?: number;
  contributionTotal?: string;
  contributionEntryCount?: number;
  sharesEarned?: string;
  sharesEntryCount?: number;
  shareValue?: number | null;
  plan: string;
  amount: string;
  qualified: boolean;
  qualificationThresholdHours: number;
  tierId?: string | null;
  tierMinHours?: number | null;
}

function WorkerVdbPensionContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();

  const { data: summaries, isLoading } = useQuery<PensionYearSummary[]>({
    queryKey: [`/api/sitespecific/gbhet/pension/sla/worker/${worker.id}`],
  });

  const { data: topSummary } = useQuery<PensionTopSummary>({
    queryKey: [`/api/sitespecific/gbhet/pension/payout-calculator/worker/${worker.id}/summary`],
  });

  const computeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/sitespecific/gbhet/pension/sla/compute/worker/${worker.id}`, {
        configId: "manual",
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/sitespecific/gbhet/pension/sla/worker", worker.id],
      });
      let desc = `Processed ${data.processed} year(s): ${data.created} created, ${data.updated} updated, ${data.skipped} unchanged.`;
      if (data.contributionResult) {
        const cr = data.contributionResult;
        desc += ` Contribution %: ${cr.created} created, ${cr.updated} updated.`;
      }
      if (data.varContribResult) {
        const vc = data.varContribResult;
        desc += ` Shares: ${vc.created} created, ${vc.updated} updated.`;
      }
      toast({
        title: "SLA and Shares Calculation Complete",
        description: desc,
      });
    },
    onError: (error) => {
      toast({
        title: "SLA Calculation Failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8" data-testid="loading-pension">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const tieredYears = (summaries?.filter(s => s.accrualMethod !== "contribution_pct") || [])
    .sort((a, b) => b.year - a.year);
  const contribYears = (summaries?.filter(s => s.accrualMethod === "contribution_pct") || [])
    .sort((a, b) => b.year - a.year);

  const tieredTotal = tieredYears.reduce((sum, s) => sum + parseFloat(s.amount || "0"), 0);
  const contribTotal = contribYears.reduce((sum, s) => sum + parseFloat(s.amount || "0"), 0);
  const combinedTotal = tieredTotal + contribTotal;

  const tieredShares = tieredYears.reduce((sum, s) => sum + parseFloat(s.sharesEarned || "0"), 0);
  const contribShares = contribYears.reduce((sum, s) => sum + parseFloat(s.sharesEarned || "0"), 0);
  const combinedShares = tieredShares + contribShares;

  return (
    <div className="space-y-4">
      {topSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Current Share Value</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold" data-testid="text-current-share-value">
                {topSummary.currentShareValue ? `$${Number(topSummary.currentShareValue).toFixed(4)}` : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Accumulated Benefit</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold" data-testid="text-accumulated-benefit">
                ${Number(topSummary.accumulatedBenefit || 0).toFixed(2)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Qualified Years</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold" data-testid="text-qualified-years">
                {topSummary.qualifiedYears}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="text-lg" data-testid="text-pension-title">VDB Pension - Simple Life Allocation</CardTitle>
            {(tieredYears.length > 0 || contribYears.length > 0) && (
              <p className="text-sm text-muted-foreground mt-1" data-testid="text-combined-total">
                Combined Total SLA: <span className="font-semibold text-foreground">${combinedTotal.toFixed(2)}</span>
                <span className="mx-2">|</span>
                Total Shares Earned: <span className="font-semibold text-foreground">{combinedShares.toFixed(2)}</span>
              </p>
            )}
          </div>
          <Button
            onClick={() => computeMutation.mutate()}
            disabled={computeMutation.isPending}
            data-testid="button-calculate-sla"
          >
            {computeMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="mr-2 h-4 w-4" />
            )}
            Calculate SLA and Shares
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {contribYears.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2" data-testid="text-contribution-heading">Contribution % Years</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">Total Hours</TableHead>
                    <TableHead className="text-right">Qualified</TableHead>
                    <TableHead className="text-right">Contribution %</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead className="text-right">SLA Total</TableHead>
                    <TableHead className="text-right">Shares Earned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/50 font-semibold" data-testid="row-contribution-total">
                    <TableCell colSpan={6} className="text-right">Totals</TableCell>
                    <TableCell className="text-right">${contribTotal.toFixed(2)}</TableCell>
                    <TableCell className="text-right" data-testid="text-total-shares">
                      {contribYears.reduce((sum, s) => sum + parseFloat(s.sharesEarned || "0"), 0).toFixed(6)}
                    </TableCell>
                  </TableRow>
                  {contribYears.map((s) => (
                    <TableRow key={s.year} data-testid={`row-contrib-year-${s.year}`}>
                      <TableCell className="font-medium">{s.year}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{s.plan}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {s.totalHours.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.qualified ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive inline" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {(s.contributionPct ?? 0) > 0 ? `${s.contributionPct}%` : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.contributionEntryCount || 0}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {parseFloat(s.amount) > 0 ? `$${parseFloat(s.amount).toFixed(2)}` : "-"}
                      </TableCell>
                      <TableCell className="text-right font-medium" data-testid={`text-shares-${s.year}`}>
                        {parseFloat(s.sharesEarned || "0") > 0 ? parseFloat(s.sharesEarned || "0").toFixed(6) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {tieredYears.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2" data-testid="text-tiered-heading">Tiered Benefit Schedule Years</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">Total Hours</TableHead>
                    <TableHead className="text-right">Qualified</TableHead>
                    <TableHead className="text-right">Accrual %</TableHead>
                    <TableHead className="text-right">Benefit Rate</TableHead>
                    <TableHead className="text-right">SLA Amount</TableHead>
                    <TableHead className="text-right">Shares Earned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/50 font-semibold" data-testid="row-tiered-total">
                    <TableCell colSpan={6} className="text-right">Totals</TableCell>
                    <TableCell className="text-right">${tieredTotal.toFixed(2)}</TableCell>
                    <TableCell className="text-right" data-testid="text-tiered-total-shares">
                      {tieredYears.reduce((sum, s) => sum + parseFloat(s.sharesEarned || "0"), 0).toFixed(6)}
                    </TableCell>
                  </TableRow>
                  {tieredYears.map((s) => (
                    <TableRow key={s.year} data-testid={`row-tiered-year-${s.year}`}>
                      <TableCell className="font-medium">{s.year}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{s.plan}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {s.totalHours.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.qualified ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive inline" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {(s.accrualPct ?? 0) > 0 ? `${s.accrualPct}%` : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {(s.benefitRate ?? 0) > 0 ? `$${(s.benefitRate ?? 0).toFixed(2)}` : "-"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {parseFloat(s.amount) > 0 ? `$${parseFloat(s.amount).toFixed(2)}` : "-"}
                      </TableCell>
                      <TableCell className="text-right font-medium" data-testid={`text-tiered-shares-${s.year}`}>
                        {parseFloat(s.sharesEarned || "0") > 0 ? parseFloat(s.sharesEarned || "0").toFixed(6) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {tieredYears.length === 0 && contribYears.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="text-no-pension-data">
              No plan years configured. Configure plan years in pension administration.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function WorkerVdbPension() {
  return (
    <WorkerLayout activeTab="vdb-pension">
      <WorkerVdbPensionContent />
    </WorkerLayout>
  );
}
