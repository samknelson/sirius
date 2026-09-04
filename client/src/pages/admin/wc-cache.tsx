import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WcLayout } from "@/components/layouts/WebServicesLayout";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  Trash2,
} from "lucide-react";

/**
 * The web client cache: what we asked third parties and what they answered.
 *
 * Freshness is not stored anywhere — the server derives it from the window the
 * request type declares in the behavior registry, judged the same way the
 * request wrapper judges it. A row whose request type is no longer registered
 * has no window, so its freshness reads "Unknown"; it still lists, still opens
 * and can still be expired.
 */

interface WcCacheRow {
  id: string;
  service: string;
  requestType: string;
  requestKey: string;
  outcome: "success" | "failure";
  fetchedAt: string;
  createdAt: string;
  registered: boolean;
  fresh: boolean | null;
  windowMs: number | null;
}

interface WcCacheDetail extends WcCacheRow {
  response: unknown;
}

interface RequestTypeOption {
  service: string;
  requestType: string;
  rows: number;
  registered: boolean;
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

/** A window in the largest unit that stays readable. */
function formatWindow(ms: number | null): string {
  if (ms === null) return "—";
  if (ms <= 0) return "never fresh";
  const minutes = ms / 60000;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)} hr`;
  return `${Math.round(hours / 24)} days`;
}

function OutcomeBadge({ outcome }: { outcome: WcCacheRow["outcome"] }) {
  return (
    <Badge
      variant={outcome === "success" ? "default" : "destructive"}
      data-testid={`badge-outcome-${outcome}`}
    >
      {outcome === "success" ? "Answered" : "Failed"}
    </Badge>
  );
}

function FreshnessBadge({ row }: { row: WcCacheRow }) {
  if (!row.registered) {
    return (
      <Badge
        variant="outline"
        title="No behavior is registered for this service and request type, so there is no window to judge it against."
        data-testid="badge-fresh-unknown"
      >
        Unknown
      </Badge>
    );
  }
  return row.fresh ? (
    <Badge variant="secondary" data-testid="badge-fresh-yes">
      Fresh
    </Badge>
  ) : (
    <Badge variant="outline" data-testid="badge-fresh-no">
      Stale
    </Badge>
  );
}

interface Filters {
  service: string;
  requestType: string;
  requestKey: string;
}

const EMPTY_FILTERS: Filters = { service: "all", requestType: "all", requestKey: "" };

function buildParams(page: number, filters: Filters) {
  const params: Record<string, string | number> = { page, pageSize: PAGE_SIZE };
  if (filters.service !== "all") params.service = filters.service;
  if (filters.requestType !== "all") params.requestType = filters.requestType;
  if (filters.requestKey.trim()) params.requestKey = filters.requestKey.trim();
  return params;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-border last:border-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="col-span-2 text-sm break-all">{value ?? "—"}</span>
    </div>
  );
}

/**
 * Forget one stored answer so the next request for that key goes back to the
 * vendor. Works on an unregistered entry too — nothing about removing a row
 * needs to know its window.
 */
function useExpireEntry(onExpired: () => void) {
  const { toast } = useToast();
  return useMutation<{ expired: boolean }, Error, string>({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/admin/wc-cache/${id}/expire`) as Promise<{ expired: boolean }>,
    onSuccess: () => {
      toast({
        title: "Entry expired",
        description: "The stored answer was removed. The next request goes back to the vendor.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/wc-cache"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/wc-cache/request-types"] });
      onExpired();
    },
    onError: (error) => {
      toast({
        title: "Failed to expire entry",
        description: getApiErrorMessage(error, "Unknown error"),
        variant: "destructive",
      });
    },
  });
}

function DetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery<WcCacheDetail>({
    queryKey: ["/api/admin/wc-cache", id],
    enabled: id !== null,
  });
  const expire = useExpireEntry(onClose);

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-entry-detail">
        <DialogHeader>
          <DialogTitle>Cached response</DialogTitle>
          <DialogDescription>
            The stored answer exactly as the vendor returned it.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" data-testid="loading-entry-detail" />
          </div>
        ) : isError || !data ? (
          <p
            className="py-12 text-center text-sm text-muted-foreground"
            data-testid="text-entry-detail-error"
          >
            This entry could not be loaded — it may already have been expired or swept.
          </p>
        ) : (
          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-4">
              <div>
                <Field label="Service" value={data.service} />
                <Field label="Request type" value={data.requestType} />
                <Field label="Request key" value={data.requestKey} />
                <Field label="Outcome" value={<OutcomeBadge outcome={data.outcome} />} />
                <Field label="Freshness" value={<FreshnessBadge row={data} />} />
                <Field
                  label="Window"
                  value={
                    data.registered
                      ? formatWindow(data.windowMs)
                      : "No registered behavior — this request type is no longer known."
                  }
                />
                <Field label="Fetched at" value={formatDate(data.fetchedAt)} />
                <Field label="First seen" value={formatDate(data.createdAt)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Response</span>
                <pre
                  className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all"
                  data-testid="text-response"
                >
                  {JSON.stringify(data.response, null, 2)}
                </pre>
              </div>
            </div>
          </ScrollArea>
        )}
        {!isLoading && !isError && data && (
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => expire.mutate(data.id)}
              disabled={expire.isPending}
              data-testid="button-expire-detail"
            >
              {expire.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Force expire
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function WcCachePage() {
  usePageTitle("Outgoing Web Service Cache");

  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: requestTypes = [] } = useQuery<RequestTypeOption[]>({
    queryKey: ["/api/admin/wc-cache/request-types"],
  });

  const params = buildParams(page, filters);
  const { data, isLoading } = useQuery<PaginatedResponse<WcCacheRow>>({
    queryKey: ["/api/admin/wc-cache", params],
  });

  const expire = useExpireEntry(() => {});

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  const services = Array.from(new Set(requestTypes.map((t) => t.service))).sort();
  // Request types narrow to the chosen service, so the two dropdowns cannot be
  // combined into a filter that matches nothing.
  const typesForService = Array.from(
    new Set(
      requestTypes
        .filter((t) => filters.service === "all" || t.service === filters.service)
        .map((t) => t.requestType),
    ),
  ).sort();

  function changeFilters(next: Filters) {
    setFilters(next);
    setPage(1);
  }

  return (
    <WcLayout activeTab="wc-cache">
      <p className="text-muted-foreground" data-testid="text-page-description">
        Every outbound request to a third party is answered from here while the
        answer is still fresh. Freshness is worked out from the window each
        request type declares, not from anything stored on the row. Expiring an
        entry forgets the stored answer, so the next request goes back to the
        vendor.
      </p>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Service</label>
              <Select
                value={filters.service}
                onValueChange={(v) =>
                  changeFilters({ ...filters, service: v, requestType: "all" })
                }
              >
                <SelectTrigger className="w-48" data-testid="select-service">
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {services.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Request type</label>
              <Select
                value={filters.requestType}
                onValueChange={(v) => changeFilters({ ...filters, requestType: v })}
              >
                <SelectTrigger className="w-56" data-testid="select-request-type">
                  <SelectValue placeholder="All request types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All request types</SelectItem>
                  {typesForService.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Request key</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="w-64 pl-8"
                  placeholder="Search request key…"
                  value={filters.requestKey}
                  onChange={(e) => changeFilters({ ...filters, requestKey: e.target.value })}
                  data-testid="input-request-key"
                />
              </div>
            </div>

            <Button
              variant="outline"
              onClick={() => changeFilters({ ...EMPTY_FILTERS })}
              data-testid="button-clear-filters"
            >
              Clear
            </Button>
          </div>

          <div className="rounded-md border">
            <Table data-testid="table-wc-cache">
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Request type</TableHead>
                  <TableHead>Request key</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Fetched at</TableHead>
                  <TableHead>Freshness</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <Loader2 className="h-6 w-6 animate-spin inline" data-testid="loading-rows" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-32 text-center text-muted-foreground"
                      data-testid="text-empty"
                    >
                      No cached responses match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => setDetailId(row.id)}
                      data-testid={`row-entry-${row.id}`}
                    >
                      <TableCell className="font-medium">{row.service}</TableCell>
                      <TableCell className="break-all">
                        {row.requestType}
                        {row.registered ? null : (
                          <div className="text-xs text-muted-foreground">not registered</div>
                        )}
                      </TableCell>
                      <TableCell className="break-all max-w-xs">{row.requestKey}</TableCell>
                      <TableCell>
                        <OutcomeBadge outcome={row.outcome} />
                      </TableCell>
                      <TableCell>{formatDate(row.fetchedAt)}</TableCell>
                      <TableCell>
                        <FreshnessBadge row={row} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Force expire"
                          disabled={expire.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            expire.mutate(row.id);
                          }}
                          data-testid={`button-expire-${row.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-muted-foreground" data-testid="text-count">
              {total === 0 ? "No entries" : `Showing ${start}–${end} of ${total.toLocaleString()}`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                data-testid="button-prev"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span className="text-sm" data-testid="text-page-info">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                data-testid="button-next"
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <DetailDialog id={detailId} onClose={() => setDetailId(null)} />
    </WcLayout>
  );
}
