import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { RecordHistoryLayout } from "@/components/layouts/RecordHistoryLayout";
import { RecordHistoryDialog, type RecordMetadata } from "@/components/shared/RecordHistoryDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "@/lib/date-format";
import { formatRecordSequence } from "@shared/utils/record-sequence";

/**
 * Every record history row in the system, filtered and paged.
 *
 * This is a view of the bookkeeping itself rather than of any one record: what
 * has been recorded, for which kinds of record, when, and by whom. The three
 * stamps a row carries — created, last modified, sub-record modified — are all
 * filterable by date range and by person, because the questions this page
 * exists to answer are of the form "what did this person change last Tuesday"
 * and "which of these was created before the migration".
 *
 * A row opens the same dialog the badge on the record's own page opens and
 * offers the server-owned Go to record resolver for every record.
 */

const PAGE_SIZE = 50;

/** Which column the list is ordered by. Mirrors the server's allowed set. */
type SortColumn =
  | "seq"
  | "contextId"
  | "createdDate"
  | "modifiedDate"
  | "subrecordModifiedDate";

interface MetadataRow extends RecordMetadata {
  contextLabel: string;
  /** The universal server-owned record resolver URL. */
  href: string;
}

interface ListResponse {
  data: MetadataRow[];
  total: number;
  page: number;
  limit: number;
}

interface ContextChoice {
  contextId: string;
  label: string;
}

interface Person {
  id: string;
  name: string;
}

/** One stamp's filters. Empty strings mean "not filtered". */
interface StampFilter {
  from: string;
  to: string;
  personId: string;
}

const EMPTY_STAMP: StampFilter = { from: "", to: "", personId: "" };

interface Filters {
  contextId: string;
  created: StampFilter;
  modified: StampFilter;
  subrecord: StampFilter;
}

const EMPTY_FILTERS: Filters = {
  contextId: "",
  created: { ...EMPTY_STAMP },
  modified: { ...EMPTY_STAMP },
  subrecord: { ...EMPTY_STAMP },
};

/** The value a Select uses for "no filter"; an empty string is not allowed. */
const ANY = "__any__";

function stampParams(params: URLSearchParams, prefix: string, filter: StampFilter) {
  // A date input gives a day, and a day means the whole of it: the "to" end
  // has to reach the end of that day or a row stamped in the afternoon falls
  // outside a range that names its own date.
  if (filter.from) params.set(`${prefix}From`, `${filter.from}T00:00:00`);
  if (filter.to) params.set(`${prefix}To`, `${filter.to}T23:59:59.999`);
  if (filter.personId) params.set(`${prefix}By`, filter.personId);
}

export default function MetadataListPage() {
  usePageTitle("Record History");

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortColumn>("modifiedDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [openRow, setOpenRow] = useState<MetadataRow | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    params.set("sort", sort);
    params.set("sortDir", sortDir);
    if (filters.contextId) params.set("contextId", filters.contextId);
    stampParams(params, "created", filters.created);
    stampParams(params, "modified", filters.modified);
    stampParams(params, "subrecord", filters.subrecord);
    return params.toString();
  }, [filters, sort, sortDir, page]);

  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: [`/api/admin/entity-metadata/list?${queryString}`],
  });

  const { data: contextData } = useQuery<{ contexts: ContextChoice[] }>({
    queryKey: ["/api/admin/entity-metadata/contexts"],
  });

  const { data: peopleData } = useQuery<{ people: Person[] }>({
    queryKey: ["/api/admin/entity-metadata/people"],
  });

  const contexts = contextData?.contexts ?? [];
  const people = peopleData?.people ?? [];
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** Any filter change starts again at the first page. */
  function updateFilters(next: Filters) {
    setFilters(next);
    setPage(0);
  }

  function toggleSort(column: SortColumn) {
    if (sort === column) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSort(column);
      setSortDir("desc");
    }
    setPage(0);
  }

  return (
    <RecordHistoryLayout activeTab="record-metadata-list">
      <p className="text-sm text-muted-foreground">
        Every record the system has recorded a history for, newest change first. What a record's
        history says is written as the record changes and cannot be edited from here.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm space-y-1">
            <Label className="text-xs">Kind of record</Label>
            <Select
              value={filters.contextId || ANY}
              onValueChange={(next) =>
                updateFilters({ ...filters, contextId: next === ANY ? "" : next })
              }
            >
              <SelectTrigger data-testid="select-table">
                <SelectValue placeholder="All kinds" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All kinds</SelectItem>
                {contexts.map((context) => (
                  <SelectItem key={context.contextId} value={context.contextId}>
                    {context.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <StampFilterFields
              legend="Created"
              prefix="created"
              value={filters.created}
              people={people}
              onChange={(next) => updateFilters({ ...filters, created: next })}
            />
            <StampFilterFields
              legend="Last modified"
              prefix="modified"
              value={filters.modified}
              people={people}
              onChange={(next) => updateFilters({ ...filters, modified: next })}
            />
            <StampFilterFields
              legend="Sub-record modified"
              prefix="subrecord"
              value={filters.subrecord}
              people={people}
              onChange={(next) => updateFilters({ ...filters, subrecord: next })}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => updateFilters({ ...EMPTY_FILTERS })}
            data-testid="button-clear-filters"
          >
            Clear filters
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground" data-testid="text-list-loading">
              Loading…
            </p>
          ) : isError ? (
            <p className="text-sm text-muted-foreground" data-testid="text-list-error">
              Record history could not be read.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-list-empty">
              No records match these filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      column="seq"
                      sort={sort}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    >
                      Sequence
                    </SortableHead>
                    <SortableHead
                      column="contextId"
                      sort={sort}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    >
                      Kind
                    </SortableHead>
                    <SortableHead
                      column="createdDate"
                      sort={sort}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    >
                      Created
                    </SortableHead>
                    <SortableHead
                      column="modifiedDate"
                      sort={sort}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    >
                      Last modified
                    </SortableHead>
                    <SortableHead
                      column="subrecordModifiedDate"
                      sort={sort}
                      sortDir={sortDir}
                      onSort={toggleSort}
                    >
                      Sub-record modified
                    </SortableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.entityId} data-testid={`row-metadata-${row.seq}`}>
                      <TableCell className="font-mono text-xs">
                        {formatRecordSequence(row.seq)}
                      </TableCell>
                      <TableCell>{row.contextLabel}</TableCell>
                      <TableCell>
                        <StampCell stamp={row.created} />
                      </TableCell>
                      <TableCell>
                        <StampCell stamp={row.modified} />
                      </TableCell>
                      <TableCell>
                        <StampCell stamp={row.subrecordModified} />
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setOpenRow(row)}
                          data-testid={`button-open-metadata-${row.seq}`}
                        >
                          Details
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          <a
                            href={row.href}
                            title="Open the record"
                            data-testid={`link-record-${row.seq}`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center justify-between pt-4">
            <p className="text-sm text-muted-foreground" data-testid="text-list-count">
              {total === 0
                ? "No records"
                : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total.toLocaleString()}`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 0}
                onClick={() => setPage((current) => current - 1)}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span className="text-sm" data-testid="text-page-info">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((current) => current + 1)}
                data-testid="button-next-page"
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/*
        The list already holds the row it is showing, so the dialog is handed
        it rather than asked to fetch it again.
      */}
      <RecordHistoryDialog
        open={openRow !== null}
        onOpenChange={(next) => {
          if (!next) setOpenRow(null);
        }}
        state={{ status: "ready", metadata: openRow }}
      />
    </RecordHistoryLayout>
  );
}

/**
 * A sortable column heading.
 *
 * At module scope, not inside the page: a component declared inside another
 * component is a new component type on every render, so React unmounts and
 * remounts what it draws. For the filter fields below that costs the caret out
 * of a date box mid-typing on every keystroke.
 */
function SortableHead({
  column,
  sort,
  sortDir,
  onSort,
  children,
}: {
  column: SortColumn;
  sort: SortColumn;
  sortDir: "asc" | "desc";
  onSort: (column: SortColumn) => void;
  children: React.ReactNode;
}) {
  const active = sort === column;
  return (
    <TableHead>
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground"
        onClick={() => onSort(column)}
        data-testid={`button-sort-${column}`}
      >
        {children}
        {active &&
          (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TableHead>
  );
}

/** The date range and person filters for one of the three stamps. */
function StampFilterFields({
  legend,
  prefix,
  value,
  people,
  onChange,
}: {
  legend: string;
  prefix: string;
  value: StampFilter;
  people: Person[];
  onChange: (next: StampFilter) => void;
}) {
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-from`} className="text-xs">
            From
          </Label>
          <Input
            id={`${prefix}-from`}
            type="date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            data-testid={`input-${prefix}-from`}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-to`} className="text-xs">
            To
          </Label>
          <Input
            id={`${prefix}-to`}
            type="date"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            data-testid={`input-${prefix}-to`}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Person</Label>
        <Select
          value={value.personId || ANY}
          onValueChange={(next) => onChange({ ...value, personId: next === ANY ? "" : next })}
        >
          <SelectTrigger data-testid={`select-${prefix}-person`}>
            <SelectValue placeholder="Anyone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Anyone</SelectItem>
            {people.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </fieldset>
  );
}

function StampCell({ stamp }: { stamp: RecordMetadata["created"] }) {
  if (!stamp.date) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="text-sm">
      <div className="whitespace-nowrap">{format(new Date(stamp.date), "MMM d, yyyy h:mm a")}</div>
      <div className="text-muted-foreground">{stamp.personName ?? "person not recorded"}</div>
    </div>
  );
}
