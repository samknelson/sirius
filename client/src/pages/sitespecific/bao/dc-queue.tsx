import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { formatYmd } from "@/components/sitespecific/bao/dc-shared";
import type { BaoDcCase } from "@shared/schema";

type QueueRow = {
  case: BaoDcCase;
  queuedAt: string;
  readiness?: { ready: boolean; missing: string[] };
  monthCount: number;
};

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export default function BaoDcQueuePage() {
  const { data, isLoading, error } = useQuery<QueueRow[]>({
    queryKey: ["/api/sitespecific/bao/dc/queue"],
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5" /> Disability Credit approval queue
          </CardTitle>
          <CardDescription>Oldest first. Readiness is rechecked at approval.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive" data-testid="text-dc-queue-error">
              {getApiErrorMessage(error, "Could not load the queue.")}
            </p>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-dc-queue-empty">
              No cases in the queue.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opened</TableHead>
                  <TableHead>In queue</TableHead>
                  <TableHead>Months</TableHead>
                  <TableHead>Readiness</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.case.id} data-testid={`row-dc-queue-${row.case.id}`}>
                    <TableCell>{formatYmd(row.case.openedYmd)}</TableCell>
                    <TableCell>{daysSince(row.queuedAt)} day(s)</TableCell>
                    <TableCell>{row.monthCount}</TableCell>
                    <TableCell>
                      {row.readiness?.ready ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-transparent">
                          Ready
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          Missing: {(row.readiness?.missing ?? []).join("; ")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm" data-testid={`link-dc-queue-${row.case.id}`}>
                        <Link href={`/bao/dc/cases/${row.case.id}`}>Review</Link>
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
