import { useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Users, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccessCheckBatch } from "@/hooks/use-access-check";
import { AssignmentStatusDotsButton } from "@/components/edls/AssignmentStatusDot";
import { WorkerAssignmentDetailsDialog } from "@/components/edls/WorkerAssignmentDetailsDialog";

interface Option {
  id: string;
  name: string;
  code?: string | null;
  parent?: string | null;
  industryId?: string | null;
}
interface WorkerRow {
  id: string;
  siriusId: number | null;
  displayName: string | null;
  given: string | null;
  family: string | null;
  active: boolean;
  memberStatusId: string | null;
  memberStatusName: string | null;
  memberStatusCode: string | null;
  priorStatus: string | null;
  currentStatus: string | null;
  nextStatus: string | null;
  ids: Record<string, string>;
  ratingValue: number | null;
}
interface WorkerResponse {
  rows: WorkerRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  idTypes: Option[];
  industryId: string | null;
  ratingsEnabled: boolean;
}

function workerName(worker: WorkerRow): string {
  if (worker.family || worker.given) return [worker.family, worker.given].filter(Boolean).join(", ");
  return worker.displayName || `Worker #${worker.siriusId ?? "?"}`;
}

export default function EdlsWorkersPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const page = Math.max(1, Number(params.get("page") || "1"));
  const nameParam = params.get("name") || "";
  const [name, setName] = useState(nameParam);
  const [detailsWorkerId, setDetailsWorkerId] = useState<string | null>(null);

  useEffect(() => setName(nameParam), [nameParam]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (name.trim() !== nameParam) updateUrl(setLocation, { name: name.trim() || null, page: "1" });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [name, nameParam, setLocation]);

  const queryString = params.toString();
  const { data, isLoading, isFetching, isError } = useQuery<WorkerResponse>({
    queryKey: ["/api/edls/workers", queryString],
    queryFn: async () => {
      const response = await fetch(`/api/edls/workers${queryString ? `?${queryString}` : ""}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load EDLS workers");
      return response.json();
    },
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const access = useAccessCheckBatch("worker.view", rows.map((row) => row.id));
  const update = (changes: Record<string, string | null>) => updateUrl(setLocation, { ...changes, ...(changes.page ? {} : { page: "1" }) });
  const setPage = (next: number) => updateUrl(setLocation, { page: String(next) });
  const { data: memberStatuses = [] } = useQuery<Option[]>({
    queryKey: ["/api/options/worker-ms"],
  });
  const { data: rankingOptions = [] } = useQuery<Option[]>({
    queryKey: ["/api/options/worker-rating"],
    enabled: data?.ratingsEnabled === true,
  });
  const edlsMemberStatuses = data?.industryId
    ? memberStatuses.filter((status) => status.industryId === data.industryId)
    : [];

  return (
    <>
      <PageHeader title="EDLS Workers" icon={<Users className="h-5 w-5 text-primary-foreground" />} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Workers</h2>
          <p className="mt-1 text-muted-foreground">Review EDLS activity, assignments, member status, IDs, and rankings.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Filters are applied on the server.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Name</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9 w-56" value={name} onChange={(event) => setName(event.target.value)} placeholder="Search by name" data-testid="input-edls-worker-name" />
              </div>
            </div>
            <FilterSelect label="Active in EDLS" value={params.get("active") || "all"} options={[{ id: "all", name: "All workers" }, { id: "true", name: "Active" }, { id: "false", name: "Inactive" }]} onChange={(value) => update({ active: value === "all" ? null : value })} testId="select-edls-worker-active" />
            <FilterSelect label="Member status" value={params.get("memberStatusId") || "all"} options={[{ id: "all", name: "All statuses" }, ...edlsMemberStatuses]} onChange={(value) => update({ memberStatusId: value === "all" ? null : value })} testId="select-edls-worker-member-status" disabled={!data?.industryId} />
            {data?.ratingsEnabled && <FilterSelect label="Ranking" value={params.get("ratingId") || "all"} options={[{ id: "all", name: "No ranking" }, ...rankingOptions]} onChange={(value) => update({ ratingId: value === "all" ? null : value, ratingValue: value === "all" ? null : params.get("ratingValue") })} testId="select-edls-worker-ranking" />}
            {data?.ratingsEnabled && params.get("ratingId") && (
              <div className="space-y-1">
                <label className="text-sm font-medium">Minimum ranking</label>
                <Input type="number" className="w-32" value={params.get("ratingValue") || ""} onChange={(event) => update({ ratingValue: event.target.value || null })} placeholder="Any" />
              </div>
            )}
            <FilterSelect label="ID type" value={params.get("idTypeId") || "all"} options={[{ id: "all", name: "Any ID type" }, ...(data?.idTypes ?? [])]} onChange={(value) => update({ idTypeId: value === "all" ? null : value })} testId="select-edls-worker-id-type" />
            {params.get("idTypeId") && <div className="space-y-1"><label className="text-sm font-medium">ID value</label><Input className="w-36" value={params.get("idValue") || ""} onChange={(event) => update({ idValue: event.target.value || null })} placeholder="Any value" /></div>}
          </CardContent>
        </Card>

        {data && !data.industryId && (
          <Alert>
            <AlertDescription>
              EDLS does not have an employer industry configured, so member statuses are unavailable.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? <div className="p-6 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
              : isError ? <div className="p-8 text-center text-destructive">Unable to load EDLS workers. Please try again.</div>
              : rows.length === 0 ? <div className="p-8 text-center text-muted-foreground">No workers match the selected filters.</div>
              : <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Worker</TableHead><TableHead>Active in EDLS</TableHead><TableHead>Member status</TableHead>
                    <TableHead>Assignments</TableHead>
                    {data?.idTypes.map((type) => <TableHead key={type.id}>{type.name}</TableHead>)}
                    {data?.ratingsEnabled && params.get("ratingId") && <TableHead>{rankingOptions.find((option) => option.id === params.get("ratingId"))?.name ?? "Ranking"}</TableHead>}
                  </TableRow></TableHeader>
                  <TableBody>{rows.map((row) => <TableRow key={row.id}>
                    <TableCell className="font-medium">{access.accessMap.get(row.id) ? <Link href={`/workers/${row.id}`} className="text-primary hover:underline">{workerName(row)}</Link> : workerName(row)}</TableCell>
                    <TableCell>{row.active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                    <TableCell>{row.memberStatusName ?? "Unassigned"}{row.memberStatusCode ? <span className="ml-1 text-muted-foreground">({row.memberStatusCode})</span> : null}</TableCell>
                    <TableCell><AssignmentStatusDotsButton priorStatus={row.priorStatus} currentStatus={row.currentStatus} nextStatus={row.nextStatus} onClick={() => setDetailsWorkerId(row.id)} testId={`status-dots-${row.id}`} /></TableCell>
                    {data?.idTypes.map((type) => <TableCell key={type.id}>{row.ids?.[type.id] ?? "—"}</TableCell>)}
                    {data?.ratingsEnabled && params.get("ratingId") && <TableCell>{row.ratingValue ?? "—"}</TableCell>}
                  </TableRow>)}</TableBody>
                </Table>
              </div>}
          </CardContent>
        </Card>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{data ? `${data.total} worker${data.total === 1 ? "" : "s"}` : ""}{isFetching ? " · Updating…" : ""}</p>
          {data && data.totalPages > 1 && <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4 mr-1" /> Previous</Button><span className="text-sm">Page {data.page} of {data.totalPages}</span><Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next <ChevronRight className="h-4 w-4 ml-1" /></Button></div>}
        </div>
        {detailsWorkerId && <WorkerAssignmentDetailsDialog workerId={detailsWorkerId} queryUrl={`/api/edls/workers/${detailsWorkerId}/assignment-details`} open onOpenChange={(open) => { if (!open) setDetailsWorkerId(null); }} />}
      </main>
    </>
  );
}

function FilterSelect({ label, value, options, onChange, testId, disabled = false }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; testId: string; disabled?: boolean }) {
  return <div className="space-y-1"><label className="text-sm font-medium">{label}</label><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger className="w-44" data-testid={testId}><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent></Select></div>;
}

function updateUrl(setLocation: (to: string) => void, changes: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  Object.entries(changes).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
  setLocation(`/edls/workers${params.toString() ? `?${params.toString()}` : ""}`);
}