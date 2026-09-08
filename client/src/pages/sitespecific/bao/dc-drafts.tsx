import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FileClock } from "lucide-react";
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

type DraftRow = {
  case: BaoDcCase;
  worker: { workerId: string; siriusId: number | null; name: string };
  openedAt: string;
  ageDays: number;
  latestActivity: { eventType: string; at: string } | null;
};

const activityLabel = (eventType: string) =>
  eventType.replace(/^case_/, "").replaceAll("_", " ");

export default function BaoDcDraftQueuePage() {
  const { data, isLoading, error } = useQuery<DraftRow[]>({
    queryKey: ["/api/sitespecific/bao/dc/drafts"],
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileClock className="h-5 w-5" /> Disability Credit draft queue
          </CardTitle>
          <CardDescription>
            All unfinished draft cases, oldest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" data-testid="skeleton-dc-drafts" />
          ) : error ? (
            <p className="text-sm text-destructive" data-testid="text-dc-drafts-error">
              {getApiErrorMessage(error, "Could not load the draft queue.")}
            </p>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-dc-drafts-empty">
              No draft cases.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Open for</TableHead>
                  <TableHead>Latest activity</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.case.id} data-testid={`row-dc-draft-${row.case.id}`}>
                    <TableCell>
                      <Link
                        href={`/workers/${row.worker.workerId}`}
                        className="text-primary hover:underline"
                      >
                        {row.worker.name}
                      </Link>
                    </TableCell>
                    <TableCell>{formatYmd(row.case.openedYmd)}</TableCell>
                    <TableCell>{row.ageDays} day(s)</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.latestActivity
                        ? `${activityLabel(row.latestActivity.eventType)} · ${new Date(
                            row.latestActivity.at,
                          ).toLocaleDateString()}`
                        : "No activity"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        data-testid={`link-dc-draft-${row.case.id}`}
                      >
                        <Link href={`/bao/dc/cases/${row.case.id}`}>Continue</Link>
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