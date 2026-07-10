import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";

interface EbsDenormRecord {
  id: string;
  denormId: string;
  uniqueId: string;
  pluginId: string;
  eventType: string;
  payload: unknown;
  subjectId: string;
  sendOn: string;
  dontSendAfter: string;
}

interface EbsStatusRecord {
  id: string;
  uniqueId: string;
  status: "sent" | "expired";
  createdAt: string;
  purgeAfter: string;
}

interface EbsScheduledRow {
  denorm: EbsDenormRecord;
  status: EbsStatusRecord | null;
}

interface EbsSentRow {
  status: EbsStatusRecord;
  denorm: EbsDenormRecord | null;
}

interface PaginatedResponse<T> {
  rows: T[];
  total: number;
}

const PAGE_SIZE = 25;

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function toDateParam(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

interface Filters {
  eventType: string;
  subjectId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { eventType: "all", subjectId: "", from: "", to: "" };

/** Build the object segment of the query key from active filters + paging. */
function buildParams(page: number, filters: Filters) {
  const params: Record<string, string | number> = { page, pageSize: PAGE_SIZE };
  if (filters.eventType !== "all") params.eventType = filters.eventType;
  if (filters.subjectId.trim()) params.subjectId = filters.subjectId.trim();
  const from = toDateParam(filters.from);
  const to = toDateParam(filters.to);
  if (from) params.from = from;
  if (to) params.to = to;
  return params;
}

function StatusBadge({ status }: { status: EbsStatusRecord["status"] }) {
  return (
    <Badge
      variant={status === "sent" ? "default" : "secondary"}
      data-testid={`badge-status-${status}`}
    >
      {status === "sent" ? "Sent" : "Expired"}
    </Badge>
  );
}

function FilterBar({
  filters,
  onChange,
  eventTypes,
  dateLabel,
  testIdPrefix,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  eventTypes: string[];
  dateLabel: string;
  testIdPrefix: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Event type</label>
        <Select
          value={filters.eventType}
          onValueChange={(v) => onChange({ ...filters, eventType: v })}
        >
          <SelectTrigger className="w-56" data-testid={`${testIdPrefix}-select-event-type`}>
            <SelectValue placeholder="All event types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {eventTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Owner ID</label>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="Search owner ID…"
            value={filters.subjectId}
            onChange={(e) => onChange({ ...filters, subjectId: e.target.value })}
            data-testid={`${testIdPrefix}-input-owner`}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{dateLabel} from</label>
        <Input
          type="date"
          className="w-40"
          value={filters.from}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
          data-testid={`${testIdPrefix}-input-from`}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{dateLabel} to</label>
        <Input
          type="date"
          className="w-40"
          value={filters.to}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
          data-testid={`${testIdPrefix}-input-to`}
        />
      </div>

      <Button
        variant="outline"
        onClick={() => onChange({ ...EMPTY_FILTERS })}
        data-testid={`${testIdPrefix}-button-clear`}
      >
        Clear
      </Button>
    </div>
  );
}

function Pagination({
  page,
  total,
  onPageChange,
  testIdPrefix,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
  testIdPrefix: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="flex items-center justify-between pt-4">
      <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}-count`}>
        {total === 0 ? "No records" : `Showing ${start}–${end} of ${total.toLocaleString()}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          data-testid={`${testIdPrefix}-button-prev`}
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <span className="text-sm" data-testid={`${testIdPrefix}-page-info`}>
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          data-testid={`${testIdPrefix}-button-next`}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-border last:border-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="col-span-2 text-sm break-all">{value ?? "—"}</span>
    </div>
  );
}

function DenormFields({ denorm }: { denorm: EbsDenormRecord }) {
  return (
    <>
      <Field label="ID" value={denorm.id} />
      <Field label="Denorm ID" value={denorm.denormId} />
      <Field label="Unique ID" value={denorm.uniqueId} />
      <Field label="Plugin ID" value={denorm.pluginId} />
      <Field label="Event Type" value={denorm.eventType} />
      <Field label="Owner ID" value={denorm.subjectId} />
      <Field label="Send On" value={formatDate(denorm.sendOn)} />
      <Field label="Don't Send After" value={formatDate(denorm.dontSendAfter)} />
    </>
  );
}

function StatusFields({ status }: { status: EbsStatusRecord }) {
  return (
    <>
      <Field label="ID" value={status.id} />
      <Field label="Unique ID" value={status.uniqueId} />
      <Field label="Status" value={<StatusBadge status={status.status} />} />
      <Field label="Created At" value={formatDate(status.createdAt)} />
      <Field label="Purge After" value={formatDate(status.purgeAfter)} />
    </>
  );
}

function PayloadBlock({ payload }: { payload: unknown }) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">Payload</span>
      <pre
        className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all"
        data-testid="text-payload"
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

function ScheduledDetailDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery<EbsScheduledRow>({
    queryKey: ["/api/admin/ebs/scheduled", id],
    enabled: id !== null,
  });

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-scheduled-detail">
        <DialogHeader>
          <DialogTitle>Scheduled event</DialogTitle>
          <DialogDescription>Read-only view of a pending scheduled event and its delivery status.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" data-testid="loading-scheduled-detail" />
          </div>
        ) : isError || !data ? (
          <p className="py-12 text-center text-sm text-muted-foreground" data-testid="text-scheduled-detail-error">
            This scheduled event could not be loaded — it may have already fired and been cleaned up.
          </p>
        ) : (
          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-1">Scheduled event (ebs_denorm)</h3>
                <DenormFields denorm={data.denorm} />
              </div>
              <PayloadBlock payload={data.denorm.payload} />
              <div>
                <h3 className="text-sm font-semibold mb-1">Delivery status (ebs_status)</h3>
                {data.status ? (
                  <StatusFields status={data.status} />
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-status">
                    Not yet delivered — no status record exists for this event.
                  </p>
                )}
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SentDetailDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery<EbsSentRow>({
    queryKey: ["/api/admin/ebs/sent", id],
    enabled: id !== null,
  });

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-sent-detail">
        <DialogHeader>
          <DialogTitle>Sent event</DialogTitle>
          <DialogDescription>Read-only view of a terminal delivery record and its originating event.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" data-testid="loading-sent-detail" />
          </div>
        ) : isError || !data ? (
          <p className="py-12 text-center text-sm text-muted-foreground" data-testid="text-sent-detail-error">
            This delivery record could not be loaded — it may have been purged by retention cleanup.
          </p>
        ) : (
          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-1">Delivery status (ebs_status)</h3>
                <StatusFields status={data.status} />
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-1">Originating event (ebs_denorm)</h3>
                {data.denorm ? (
                  <>
                    <DenormFields denorm={data.denorm} />
                    <div className="mt-4">
                      <PayloadBlock payload={data.denorm.payload} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-denorm">
                    The scheduled event has been cleaned up — only the delivery record remains.
                  </p>
                )}
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduledView({ eventTypes }: { eventTypes: string[] }) {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });
  const [detailId, setDetailId] = useState<string | null>(null);

  const params = buildParams(page, filters);
  const { data, isLoading } = useQuery<PaginatedResponse<EbsScheduledRow>>({
    queryKey: ["/api/admin/ebs/scheduled", params],
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const handleFilterChange = (next: Filters) => {
    setFilters(next);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        eventTypes={eventTypes}
        dateLabel="Send on"
        testIdPrefix="scheduled"
      />

      <div className="rounded-md border">
        <Table data-testid="table-scheduled">
          <TableHeader>
            <TableRow>
              <TableHead>Event Type</TableHead>
              <TableHead>Owner ID</TableHead>
              <TableHead>Plugin</TableHead>
              <TableHead>Send On</TableHead>
              <TableHead>Don't Send After</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin inline" data-testid="loading-scheduled" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground" data-testid="text-scheduled-empty">
                  No scheduled events match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.denorm.id}
                  className="cursor-pointer"
                  onClick={() => setDetailId(row.denorm.id)}
                  data-testid={`row-scheduled-${row.denorm.id}`}
                >
                  <TableCell className="font-medium">{row.denorm.eventType}</TableCell>
                  <TableCell className="break-all">{row.denorm.subjectId}</TableCell>
                  <TableCell className="break-all">{row.denorm.pluginId}</TableCell>
                  <TableCell>{formatDate(row.denorm.sendOn)}</TableCell>
                  <TableCell>{formatDate(row.denorm.dontSendAfter)}</TableCell>
                  <TableCell>
                    {row.status ? (
                      <StatusBadge status={row.status.status} />
                    ) : (
                      <Badge variant="outline">Pending</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination page={page} total={total} onPageChange={setPage} testIdPrefix="scheduled" />
      <ScheduledDetailDialog id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function SentView({ eventTypes }: { eventTypes: string[] }) {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });
  const [detailId, setDetailId] = useState<string | null>(null);

  const params = buildParams(page, filters);
  const { data, isLoading } = useQuery<PaginatedResponse<EbsSentRow>>({
    queryKey: ["/api/admin/ebs/sent", params],
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const handleFilterChange = (next: Filters) => {
    setFilters(next);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        eventTypes={eventTypes}
        dateLabel="Created"
        testIdPrefix="sent"
      />

      <div className="rounded-md border">
        <Table data-testid="table-sent">
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Event Type</TableHead>
              <TableHead>Owner ID</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead>Purge After</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin inline" data-testid="loading-sent" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground" data-testid="text-sent-empty">
                  No sent events match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.status.id}
                  className="cursor-pointer"
                  onClick={() => setDetailId(row.status.id)}
                  data-testid={`row-sent-${row.status.id}`}
                >
                  <TableCell>
                    <StatusBadge status={row.status.status} />
                  </TableCell>
                  <TableCell className="font-medium">{row.denorm?.eventType ?? "—"}</TableCell>
                  <TableCell className="break-all">{row.denorm?.subjectId ?? "—"}</TableCell>
                  <TableCell>{formatDate(row.status.createdAt)}</TableCell>
                  <TableCell>{formatDate(row.status.purgeAfter)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination page={page} total={total} onPageChange={setPage} testIdPrefix="sent" />
      <SentDetailDialog id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

export default function EbsInspectionPage() {
  usePageTitle("Event Scheduler");

  const { data: eventTypes = [] } = useQuery<string[]>({
    queryKey: ["/api/admin/ebs/event-types"],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"
          data-testid="text-page-title"
        >
          <CalendarClock className="h-6 w-6" />
          Event Scheduler
        </h1>
        <p className="text-muted-foreground mt-2" data-testid="text-page-description">
          Read-only inspection of the deferred event bus. Scheduled events are
          pending reminders waiting to fire; sent events are the terminal record
          of what has already been delivered or expired.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="scheduled" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="scheduled" data-testid="tab-scheduled">
                Scheduled events
              </TabsTrigger>
              <TabsTrigger value="sent" data-testid="tab-sent">
                Sent events
              </TabsTrigger>
            </TabsList>
            <TabsContent value="scheduled">
              <ScheduledView eventTypes={eventTypes} />
            </TabsContent>
            <TabsContent value="sent">
              <SentView eventTypes={eventTypes} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
