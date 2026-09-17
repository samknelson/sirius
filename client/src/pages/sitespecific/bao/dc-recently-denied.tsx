import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { formatYmd } from "@/components/sitespecific/bao/dc-shared";
import type { BaoDcCase } from "@shared/schema";

type RecentlyDeniedRow = {
  case: BaoDcCase;
  worker: { workerId: string; siriusId: number | null; name: string };
  denialYmd: string;
};

export default function BaoDcRecentlyDeniedPage() {
  const { data, isLoading, error } = useQuery<RecentlyDeniedRow[]>({
    queryKey: ["/api/sitespecific/bao/dc/recently-denied"],
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleX className="h-5 w-5" /> Recently denied Disability Credit cases
          </CardTitle>
          <CardDescription>
            Cases denied in the last 30 days, newest denial first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive" data-testid="text-dc-recently-denied-error">
              {getApiErrorMessage(error, "Could not load recently denied cases.")}
            </p>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-dc-recently-denied-empty">
              No cases were denied in the last 30 days.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Denied</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.case.id} data-testid={`row-dc-recently-denied-${row.case.id}`}>
                    <TableCell>
                      <Link
                        href={`/workers/${row.worker.workerId}`}
                        className="text-primary hover:underline"
                      >
                        {row.worker.name}
                      </Link>
                    </TableCell>
                    <TableCell>{formatYmd(row.denialYmd)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/bao/dc/cases/${row.case.id}`}>View case</Link>
                      </Button>
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