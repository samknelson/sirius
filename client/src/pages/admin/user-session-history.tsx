import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, ChevronRight, Clock3, RotateCw } from "lucide-react";
import { SESSION_HISTORY_PAGE_SIZES, type UserSessionHistoryPage } from "@shared/session-history";
import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { format } from "@/lib/date-format";

function SessionHistoryForUser({ userId }: { userId: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const historyQuery = useQuery<UserSessionHistoryPage>({
    queryKey: ["/api/admin/users", userId, "session_history", page, pageSize],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/admin/users/${encodeURIComponent(userId)}/session_history?page=${page}&pageSize=${pageSize}`,
      ),
    retry: false,
  });

  const data = historyQuery.data;
  const totalPages = data?.totalPages ?? 0;
  const firstEntry = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastEntry = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <section className="space-y-5" aria-labelledby="session-history-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            Account activity
          </div>
          <h1 id="session-history-heading" className="text-2xl font-semibold tracking-tight text-foreground">
            Session history
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recorded session activity associated with this user.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-sm text-muted-foreground">Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[88px]" aria-label="Rows per page" data-testid="select-session-history-page-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SESSION_HISTORY_PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        {historyQuery.isLoading ? (
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        ) : historyQuery.isError ? (
          <CardContent className="flex flex-col items-center px-6 py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Couldn’t load session history</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {getApiErrorMessage(historyQuery.error, "There was a problem retrieving this user’s session history.")}
            </p>
            <Button
              className="mt-5"
              variant="outline"
              onClick={() => void historyQuery.refetch()}
              disabled={historyQuery.isFetching}
              data-testid="button-retry-session-history"
            >
              <RotateCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </CardContent>
        ) : data && data.entries.length === 0 ? (
          <CardContent className="flex flex-col items-center px-6 py-14 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Clock3 className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-foreground">No sessions recorded</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Session activity will appear here when it becomes available.
            </p>
            {page > 1 && (
              <Button
                className="mt-5"
                variant="outline"
                onClick={() => setPage(1)}
                data-testid="button-session-history-first"
              >
                Back to first page
              </Button>
            )}
          </CardContent>
        ) : data ? (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[210px]">Date &amp; time</TableHead>
                    <TableHead className="min-w-[150px]">IP address</TableHead>
                    <TableHead className="min-w-[240px]">Device</TableHead>
                    <TableHead className="min-w-[280px]">Session reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap font-medium text-foreground">
                        {format(entry.timestamp, "MMM d, yyyy · h:mm:ss a")}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {entry.ip || <span className="font-sans italic">Not recorded</span>}
                      </TableCell>
                      <TableCell className="min-w-[240px] max-w-[480px] break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        {entry.userAgent || <span className="italic">Not recorded</span>}
                      </TableCell>
                      <TableCell className="break-all font-mono text-xs text-muted-foreground">
                        {entry.sessionReference}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Showing <span className="font-medium text-foreground">{firstEntry}–{lastEntry}</span> of{" "}
                <span className="font-medium text-foreground">{data.total}</span> sessions
              </p>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <span className="mr-1 text-sm text-muted-foreground">
                  Page {data.page} of {data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || historyQuery.isFetching}
                  aria-label="Previous page"
                  data-testid="button-session-history-previous"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Previous</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages || historyQuery.isFetching}
                  aria-label="Next page"
                  data-testid="button-session-history-next"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Next</span>
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </Card>
    </section>
  );
}

function UserSessionHistoryContent() {
  const { user } = useUserLayout();

  return <SessionHistoryForUser key={user.id} userId={user.id} />;
}

export default function UserSessionHistoryPage() {
  return (
    <UserLayout activeTab="session_history">
      <UserSessionHistoryContent />
    </UserLayout>
  );
}
