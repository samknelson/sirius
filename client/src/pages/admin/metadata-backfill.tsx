import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { RecordHistoryLayout } from "@/components/layouts/RecordHistoryLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

/**
 * Filling in record history for records that predate the bookkeeping.
 *
 * What a filled-in row says is deliberately thin: the record was first seen at
 * the moment the button was pressed, by nobody. The system cannot know when a
 * pre-existing record was created or who created it, and inventing a plausible
 * answer would be worse than admitting to the sighting — the same thing it
 * already does for any record it meets mid-life.
 *
 * A run writes at most a batch and never overwrites an existing row, so the
 * button can be pressed as often as it takes. A run that fails partway keeps
 * everything it had already written.
 */

/** Kept in step with the server's own cap on one run. */
const BATCH_LIMIT = 1000;

interface ContextChoice {
  contextId: string;
  label: string;
}

type MissingCount =
  | { contextId: string; countable: true; missing: number }
  | { contextId: string; countable: false; reason: string };

type SortColumn = "label" | "contextId" | "missing";
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

interface BackfillResult {
  contextId: string;
  written: number;
  alreadyPresent: number;
  skipped: number;
  missing: number;
}

export async function runMetadataBackfill(contextId: string): Promise<BackfillResult> {
  return apiRequest("POST", "/api/admin/entity-metadata/backfill", {
    contextId,
    limit: BATCH_LIMIT,
  });
}

function missingCountKey(contextId: string) {
  return `/api/admin/entity-metadata/contexts/${contextId}/missing`;
}

function countValue(count: MissingCount | undefined): number | null {
  return count?.countable === true ? count.missing : null;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function compareRows(
  left: { context: ContextChoice; count?: MissingCount },
  right: { context: ContextChoice; count?: MissingCount },
  sort: SortState,
) {
  let comparison = 0;
  if (sort.column === "label") {
    comparison = compareText(left.context.label, right.context.label);
  } else if (sort.column === "contextId") {
    comparison = compareText(left.context.contextId, right.context.contextId);
  } else {
    const leftCount = countValue(left.count);
    const rightCount = countValue(right.count);
    if (leftCount !== null && rightCount === null) {
      return -1;
    } else if (leftCount === null && rightCount !== null) {
      return 1;
    } else if (leftCount !== null && rightCount !== null) {
      comparison = leftCount - rightCount;
    }
  }

  if (comparison !== 0) {
    return sort.direction === "asc" ? comparison : -comparison;
  }

  const labelTieBreak = compareText(left.context.label, right.context.label);
  return labelTieBreak !== 0
    ? labelTieBreak
    : compareText(left.context.contextId, right.context.contextId);
}

function SortableHeader({
  column,
  label,
  sort,
  onToggle,
}: {
  column: SortColumn;
  label: string;
  sort: SortState;
  onToggle: (column: SortColumn) => void;
}) {
  const active = sort.column === column;
  const Icon = active
    ? sort.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <TableHead
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onToggle(column)}
        className="flex items-center gap-1 font-medium hover:text-foreground"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
    </TableHead>
  );
}

export default function MetadataBackfillPage() {
  usePageTitle("Fill In Record History");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ column: "missing", direction: "desc" });

  const { data, isLoading, isError } = useQuery<{ contexts: ContextChoice[] }>({
    queryKey: ["/api/admin/entity-metadata/contexts"],
  });

  const contexts = data?.contexts ?? [];
  const countResults = useQueries({
    queries: contexts.map((context) => ({
      queryKey: [missingCountKey(context.contextId)],
    })),
  });
  const rows = contexts.map((context, index) => ({
    context,
    count: countResults[index]?.data as MissingCount | undefined,
    isLoading: countResults[index]?.isLoading ?? true,
    isError: countResults[index]?.isError ?? false,
  }));
  const visibleRows = useMemo(() => {
    const normalizedFilter = filter.trim().toLocaleLowerCase();
    return rows
      .filter(({ context }) => {
        if (!normalizedFilter) return true;
        return (
          context.label.toLocaleLowerCase().includes(normalizedFilter) ||
          context.contextId.toLocaleLowerCase().includes(normalizedFilter)
        );
      })
      .sort((left, right) => compareRows(left, right, sort));
  }, [filter, rows, sort]);

  const toggleSort = (column: SortColumn) => {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
  };

  return (
    <RecordHistoryLayout activeTab="record-metadata-backfill">
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          Records created before the system began keeping history have none. Filling it in records
          only that the record was seen now, by nobody — the system cannot know when it was really
          created or who created it, and will not guess.
        </p>
        <p>
          Each run writes up to {BATCH_LIMIT.toLocaleString()} rows for one kind of record and never
          changes a history that already exists. Run it as many times as it takes.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground" data-testid="text-tables-loading">
              Loading…
            </p>
          ) : isError ? (
            <p className="text-sm text-muted-foreground" data-testid="text-tables-error">
              The list of record kinds could not be read.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="relative max-w-md flex-1">
                  <Filter
                    className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Filter by record name or context ID"
                    aria-label="Filter by record name or context ID"
                    className="pl-9"
                  />
                </div>
                {filter && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setFilter("")}
                    aria-label="Clear filter"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHeader
                        column="label"
                        label="Record Name"
                        sort={sort}
                        onToggle={toggleSort}
                      />
                      <SortableHeader
                        column="contextId"
                        label="Context ID"
                        sort={sort}
                        onToggle={toggleSort}
                      />
                      <SortableHeader
                        column="missing"
                        label="Without History"
                        sort={sort}
                        onToggle={toggleSort}
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.length > 0 ? (
                      visibleRows.map((row) => (
                        <TableRowForContext
                          key={row.context.contextId}
                          context={row.context}
                          count={row.count}
                          isLoading={row.isLoading}
                          isError={row.isError}
                        />
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                          No record kinds match this filter.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </RecordHistoryLayout>
  );
}

/**
 * One kind of record, with its own count.
 *
 * Counted per row rather than for the whole page at once: each count is a scan
 * of that kind's table, and asking for all of them in one request would make
 * the page wait on the slowest. A kind that cannot be counted says why in its
 * own row instead of being left out of the list.
 */
function TableRowForContext({
  context,
  count,
  isLoading,
  isError,
}: {
  context: ContextChoice;
  count?: MissingCount;
  isLoading: boolean;
  isError: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const countKey = missingCountKey(context.contextId);

  const backfill = useMutation<BackfillResult>({
    mutationFn: () => runMetadataBackfill(context.contextId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [countKey] });
      toast({
        title: `${context.label}: ${result.written.toLocaleString()} filled in`,
        description:
          result.missing > 0
            ? `${result.missing.toLocaleString()} still without history. Run again to continue.`
            : "Every record of this kind now has a history.",
      });
    },
    onError: (error: Error) => {
      // A failed run still kept whatever it wrote, so the count is refreshed
      // either way and the message says so.
      queryClient.invalidateQueries({ queryKey: [countKey] });
      toast({
        title: `${context.label}: could not finish`,
        description: `${error.message} Anything already written was kept — running again continues from there.`,
        variant: "destructive",
      });
    },
  });

  const countable = count?.countable === true;
  const missing = countable ? count.missing : 0;

  return (
    <TableRow data-testid={`row-backfill-${context.contextId}`}>
      <TableCell>
        {context.label}
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-muted-foreground">{context.contextId}</span>
      </TableCell>
      <TableCell data-testid={`text-missing-${context.contextId}`}>
        <div className="flex items-center justify-between gap-3">
          <span>
            {isLoading ? (
              <span className="text-muted-foreground">Counting…</span>
            ) : isError ? (
              <span className="text-muted-foreground">Could not be counted</span>
            ) : count && !count.countable ? (
              <span className="text-muted-foreground">Unavailable — {count.reason}</span>
            ) : missing === 0 ? (
              <span className="text-muted-foreground">None</span>
            ) : (
              missing.toLocaleString()
            )}
          </span>
          {countable && missing > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={backfill.isPending}
              onClick={() => backfill.mutate()}
              data-testid={`button-backfill-${context.contextId}`}
            >
              {backfill.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Fill in {Math.min(missing, BATCH_LIMIT).toLocaleString()}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
