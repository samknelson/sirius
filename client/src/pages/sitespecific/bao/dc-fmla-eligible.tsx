import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { HeartPulse } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/queryClient";
import { formatYmdMonth } from "@shared/utils/date";

type WorkerRef = { workerId: string; siriusId: number | null; name: string };

type FmlaEligibleResponse = {
  fmlaEligible: Array<{ worker: WorkerRef; fmlaMonths: string[] }>;
};

/**
 * The COMPLETE current FMLA-eligible list (workers meeting the rolling FMLA
 * gate with no open DC case). The dashboard shows only a linked count.
 */
export default function BaoDcFmlaEligiblePage() {
  const { data, isLoading, error } = useQuery<FmlaEligibleResponse>({
    queryKey: ["/api/sitespecific/bao/dc/fmla-eligible"],
  });

  const rows = data?.fmlaEligible ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5" /> FMLA-eligible workers
          </CardTitle>
          <CardDescription>
            Every worker currently meeting the rolling FMLA eligibility gate
            with no open Disability Credit case.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive" data-testid="text-dc-fmla-eligible-error">
              {getApiErrorMessage(error, "Could not load the list.")}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-dc-fmla-eligible-empty">
              No workers are currently FMLA-eligible without an open case.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>FMLA months (rolling window)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.worker.workerId}
                    data-testid={`row-dc-fmla-eligible-${row.worker.workerId}`}
                  >
                    <TableCell>
                      <Link
                        href={`/workers/${row.worker.workerId}/sitespecific/bao/disability-credit`}
                        className="text-primary hover:underline"
                      >
                        {row.worker.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <Badge variant="secondary">{row.fmlaMonths.length}</Badge>
                        <span className="text-muted-foreground text-xs">
                          {row.fmlaMonths.map((m) => formatYmdMonth(m)).join(", ")}
                        </span>
                      </span>
                    </TableCell>
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
