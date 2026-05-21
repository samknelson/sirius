import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface AnnualSummary {
  id: string;
  workerId: string;
  year: number;
  totalHours: string | null;
  qualified: boolean;
  annualAccrual: string | null;
  cumulativeAccrual: string | null;
  shares: string | null;
  data: Record<string, unknown> | null;
}

export default function PensionAnnualSummariesPage() {
  usePageTitle("Pension Annual Summaries");
  const [year, setYear] = useState<number>(new Date().getFullYear() - 1);

  const { data: summaries = [], isLoading } = useQuery<AnnualSummary[]>({
    queryKey: [`/api/sitespecific/gbhet/pension/annual-summaries/year/${year}`],
  });

  return (
    <div className="container py-6 space-y-4" data-testid="page-annual-summaries">
      <Card>
        <CardHeader>
          <CardTitle>Pension Annual Summaries</CardTitle>
          <CardDescription>Per-worker rollups (hours, qualification, accruals, shares) for a given plan year</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div>
              <Label htmlFor="year">Plan Year</Label>
              <Input id="year" type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value) || year)}
                className="w-32" data-testid="input-year" />
            </div>
            <Button variant="outline" onClick={() => setYear(year)} data-testid="button-refresh">Refresh</Button>
          </div>
          {isLoading ? (
            <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Total Hours</TableHead>
                  <TableHead>Qualified</TableHead>
                  <TableHead>Annual Accrual</TableHead>
                  <TableHead>Cumulative Accrual</TableHead>
                  <TableHead>Shares</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No annual summaries for {year}</TableCell></TableRow>
                ) : summaries.map((s) => (
                  <TableRow key={s.id} data-testid={`row-summary-${s.id}`}>
                    <TableCell className="font-mono text-xs">{s.workerId}</TableCell>
                    <TableCell>{s.totalHours ? Number(s.totalHours).toFixed(2) : "—"}</TableCell>
                    <TableCell>{s.qualified ? "Yes" : "No"}</TableCell>
                    <TableCell>{s.annualAccrual ? `$${Number(s.annualAccrual).toFixed(2)}` : "—"}</TableCell>
                    <TableCell>{s.cumulativeAccrual ? `$${Number(s.cumulativeAccrual).toFixed(2)}` : "—"}</TableCell>
                    <TableCell>{s.shares ? Number(s.shares).toFixed(6) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
