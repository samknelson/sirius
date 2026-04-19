import { useMemo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch, useLocation } from "wouter";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
import { Stethoscope, Users, Factory, Layers, UserCheck, ChevronsUpDown, Check, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { getTodayYmd, formatYmd } from "@shared/utils/date";

const FUTURE_LIMIT = 5;

interface ActiveWorkerTosWorker {
  id: string;
  siriusId: number | null;
  displayName: string | null;
  given: string | null;
  family: string | null;
}

interface ActiveTosRecord {
  id: string;
  workerId: string;
  startDate: string;
  endDate: string | null;
  description: string | null;
  worker: ActiveWorkerTosWorker;
}

interface AssignmentForWorker {
  assignmentId: string;
  ymd: string;
  sheetId: string;
  sheetTitle: string;
  sheetStatus: string;
  crewId: string;
  crewTitle: string;
  startTime: string | null;
  endTime: string | null;
  supervisor: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  facility: { id: string; name: string } | null;
  jobGroup: { id: string; name: string } | null;
  data: Record<string, unknown> | null;
}

interface TosItem {
  tos: ActiveTosRecord;
  edlsId: string | null;
  memberStatusCode: string | null;
  today: AssignmentForWorker | null;
  future: AssignmentForWorker[];
}

interface TosResponse {
  items: TosItem[];
  filterActive: boolean;
  workerIdTypeConfigured: boolean;
}

interface SupervisorOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

interface SupervisorContextResponse {
  options: SupervisorOption[];
}

interface FacilityOption {
  id: string;
  name: string;
}

interface PaginatedFacilities {
  data: FacilityOption[];
}

interface JobGroupOption {
  id: string;
  name: string;
}

interface PaginatedJobGroups {
  data: JobGroupOption[];
}

function workerName(w: ActiveWorkerTosWorker): string {
  if (w.family || w.given) return [w.family, w.given].filter(Boolean).join(", ");
  return w.displayName || `Worker #${w.siriusId ?? "?"}`;
}

function supervisorName(s: AssignmentForWorker["supervisor"]): string {
  if (!s) return "—";
  if (s.firstName || s.lastName) return [s.firstName, s.lastName].filter(Boolean).join(" ");
  return s.email;
}

function effectiveStartTime(a: AssignmentForWorker): string | null {
  const override = a.data && typeof (a.data as { startTime?: unknown }).startTime === "string"
    ? ((a.data as { startTime: string }).startTime)
    : null;
  const raw = override || a.startTime;
  return raw ? raw.slice(0, 5) : null;
}

function AssignmentCell({
  a,
  showDate,
  testIdPrefix,
}: {
  a: AssignmentForWorker;
  showDate: boolean;
  testIdPrefix: string;
}) {
  const time = effectiveStartTime(a);
  const parts: string[] = [];
  if (showDate) parts.push(formatYmd(a.ymd, "short"));
  parts.push(a.crewTitle);
  if (time) parts.push(time);
  parts.push(`Sup: ${supervisorName(a.supervisor)}`);
  if (a.facility) parts.push(a.facility.name);
  return (
    <Link
      href={`/edls/sheet/${a.sheetId}`}
      className="text-sm hover:underline block leading-snug"
      data-testid={`${testIdPrefix}-${a.assignmentId}`}
    >
      {parts.join(" · ")}
    </Link>
  );
}

export default function EdlsTosPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();

  const initialFilters = useMemo(() => {
    const params = new URLSearchParams(search);
    return {
      supervisorId: params.get("supervisorId") ?? "",
      facilityId: params.get("facilityId") ?? "",
      jobGroupId: params.get("jobGroupId") ?? "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [supervisorId, setSupervisorIdState] = useState(initialFilters.supervisorId);
  const [facilityId, setFacilityIdState] = useState(initialFilters.facilityId);
  const [jobGroupId, setJobGroupIdState] = useState(initialFilters.jobGroupId);
  const [facilitySearch, setFacilitySearch] = useState("");
  const [facilityPickerOpen, setFacilityPickerOpen] = useState(false);

  const writeUrl = (next: { supervisorId: string; facilityId: string; jobGroupId: string }) => {
    const params = new URLSearchParams();
    if (next.supervisorId) params.set("supervisorId", next.supervisorId);
    if (next.facilityId) params.set("facilityId", next.facilityId);
    if (next.jobGroupId) params.set("jobGroupId", next.jobGroupId);
    const qs = params.toString();
    setLocation("/edls/tos" + (qs ? `?${qs}` : ""), { replace: true });
  };

  const setSupervisorId = (v: string) => {
    setSupervisorIdState(v);
    writeUrl({ supervisorId: v, facilityId, jobGroupId });
  };
  const setFacilityId = (v: string) => {
    setFacilityIdState(v);
    writeUrl({ supervisorId, facilityId: v, jobGroupId });
  };
  const setJobGroupId = (v: string) => {
    setJobGroupIdState(v);
    writeUrl({ supervisorId, facilityId, jobGroupId: v });
  };

  useEffect(() => {
    const params = new URLSearchParams(search);
    setSupervisorIdState(params.get("supervisorId") ?? "");
    setFacilityIdState(params.get("facilityId") ?? "");
    setJobGroupIdState(params.get("jobGroupId") ?? "");
  }, [search]);

  const startYmd = getTodayYmd();

  const queryParams = new URLSearchParams({ startYmd });
  if (supervisorId) queryParams.set("supervisorId", supervisorId);
  if (facilityId) queryParams.set("facilityId", facilityId);
  if (jobGroupId) queryParams.set("jobGroupId", jobGroupId);

  const { data, isLoading, isError } = useQuery<TosResponse>({
    queryKey: ["/api/edls/tos", { startYmd, supervisorId, facilityId, jobGroupId }],
    queryFn: async () => {
      const res = await fetch(`/api/edls/tos?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load TOS list");
      return res.json();
    },
  });

  const { data: supervisorContext } = useQuery<SupervisorContextResponse>({
    queryKey: ["/api/edls/supervisor-context"],
    queryFn: async () => {
      const res = await fetch("/api/edls/supervisor-context", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load supervisors");
      return res.json();
    },
  });
  const supervisorOptions = supervisorContext?.options ?? [];

  const { data: facilitiesData } = useQuery<PaginatedFacilities>({
    queryKey: ["/api/facilities", { search: facilitySearch, tosFilter: true }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "0", limit: "50", sortDir: "asc" });
      if (facilitySearch) params.set("search", facilitySearch);
      const res = await fetch(`/api/facilities?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch facilities");
      return res.json();
    },
  });
  const facilityOptions = facilitiesData?.data ?? [];

  const { data: selectedFacility } = useQuery<{ id: string; name: string }>({
    queryKey: ["/api/facilities", facilityId],
    queryFn: async () => {
      const res = await fetch(`/api/facilities/${facilityId}`);
      if (!res.ok) throw new Error("Failed to fetch facility");
      return res.json();
    },
    enabled: !!facilityId && !facilityOptions.some((f) => f.id === facilityId),
  });
  const selectedFacilityName =
    facilityOptions.find((f) => f.id === facilityId)?.name ?? selectedFacility?.name;

  const { data: jobGroupsData } = useQuery<PaginatedJobGroups>({
    queryKey: ["/api/dispatch-job-groups", { active: "active", limit: 100, sortDir: "asc" }],
    queryFn: async () => {
      const res = await fetch("/api/dispatch-job-groups?active=active&limit=100&sortDir=asc", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job groups");
      return res.json();
    },
  });
  const jobGroupOptions: JobGroupOption[] = (jobGroupsData?.data ?? []).map((g) => ({ id: g.id, name: g.name }));

  const items = data?.items ?? [];
  const filterActive = data?.filterActive ?? false;
  const hasAnyFilter = !!(supervisorId || facilityId || jobGroupId);

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle data-testid="title-page" className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5" />
            Absences — Workers on Time Off Sick
          </CardTitle>
          <CardDescription>
            Active sick absences and each worker's upcoming day-labor assignments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <UserCheck className="h-4 w-4" />
                Supervisor
              </label>
              <Select value={supervisorId || "all"} onValueChange={(v) => setSupervisorId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[240px]" data-testid="select-supervisor-filter">
                  <SelectValue placeholder="All supervisors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-supervisor-all">
                    All supervisors
                  </SelectItem>
                  {supervisorOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id} data-testid={`option-supervisor-${s.id}`}>
                      {supervisorName(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Factory className="h-4 w-4" />
                Facility
              </label>
              <Popover open={facilityPickerOpen} onOpenChange={setFacilityPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className={cn("w-[240px] justify-between font-normal", !facilityId && "text-muted-foreground")}
                    data-testid="button-facility-filter"
                  >
                    <span className="truncate">
                      {facilityId ? selectedFacilityName ?? "Selected facility" : "All facilities"}
                    </span>
                    <span className="flex items-center gap-1">
                      {facilityId && (
                        <X
                          className="h-4 w-4 opacity-60 hover:opacity-100"
                          data-testid="button-facility-filter-clear"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setFacilityId("");
                          }}
                        />
                      )}
                      <ChevronsUpDown className="h-4 w-4 opacity-50" />
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search facilities..."
                      value={facilitySearch}
                      onValueChange={setFacilitySearch}
                      data-testid="input-facility-filter-search"
                    />
                    <CommandList>
                      <CommandEmpty>No facilities found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__all__"
                          onSelect={() => {
                            setFacilityId("");
                            setFacilityPickerOpen(false);
                          }}
                          data-testid="option-facility-all"
                        >
                          <Check className={cn("mr-2 h-4 w-4", !facilityId ? "opacity-100" : "opacity-0")} />
                          All facilities
                        </CommandItem>
                        {facilityOptions.map((f) => (
                          <CommandItem
                            key={f.id}
                            value={f.id}
                            onSelect={() => {
                              setFacilityId(f.id);
                              setFacilityPickerOpen(false);
                            }}
                            data-testid={`option-facility-${f.id}`}
                          >
                            <Check className={cn("mr-2 h-4 w-4", facilityId === f.id ? "opacity-100" : "opacity-0")} />
                            {f.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Layers className="h-4 w-4" />
                Job Group
              </label>
              <Select value={jobGroupId || "all"} onValueChange={(v) => setJobGroupId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[240px]" data-testid="select-job-group-filter">
                  <SelectValue placeholder="All job groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-job-group-all">
                    All job groups
                  </SelectItem>
                  {jobGroupOptions.map((g) => (
                    <SelectItem key={g.id} value={g.id} data-testid={`option-job-group-${g.id}`}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {hasAnyFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSupervisorIdState("");
                  setFacilityIdState("");
                  setJobGroupIdState("");
                  writeUrl({ supervisorId: "", facilityId: "", jobGroupId: "" });
                }}
                data-testid="button-clear-filters"
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive" data-testid="text-error">
              Failed to load TOS list.
            </p>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center py-8 text-muted-foreground" data-testid="text-empty">
              <Users className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">
                {filterActive
                  ? "No workers on Time Off Sick have upcoming assignments matching the filters."
                  : "No workers are currently on Time Off Sick."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop: table layout */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">ID</TableHead>
                    <TableHead className="w-[60px]">Status</TableHead>
                    <TableHead className="w-[260px]">Worker</TableHead>
                    <TableHead className="w-[280px]">Today</TableHead>
                    <TableHead>Next (up to {FUTURE_LIMIT})</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(({ tos, edlsId, memberStatusCode, today, future }) => {
                    const visibleFuture = future.slice(0, FUTURE_LIMIT);
                    const overflow = Math.max(0, future.length - FUTURE_LIMIT);
                    return (
                      <TableRow key={tos.id} data-testid={`row-tos-${tos.workerId}`}>
                        <TableCell
                          className="font-mono text-sm align-top"
                          data-testid={`text-edls-id-${tos.workerId}`}
                        >
                          {edlsId ?? "—"}
                        </TableCell>
                        <TableCell
                          className="font-mono text-sm align-top text-muted-foreground"
                          data-testid={`text-member-status-${tos.workerId}`}
                        >
                          {memberStatusCode ?? "—"}
                        </TableCell>
                        <TableCell className="align-top">
                          <Link
                            href={`/workers/${tos.workerId}`}
                            className="font-medium hover:underline"
                            data-testid={`link-worker-${tos.workerId}`}
                          >
                            {workerName(tos.worker)}
                          </Link>
                          <div
                            className="text-xs text-muted-foreground mt-0.5"
                            data-testid={`text-tos-start-${tos.workerId}`}
                          >
                            Sick since {format(new Date(tos.startDate), "MMM d, yyyy")}
                            {tos.description ? ` — ${tos.description}` : ""}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          {today ? (
                            <AssignmentCell
                              a={today}
                              showDate={false}
                              testIdPrefix="link-today"
                            />
                          ) : (
                            <span
                              className="text-sm text-muted-foreground"
                              data-testid={`text-no-today-${tos.workerId}`}
                            >
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {visibleFuture.length === 0 ? (
                            <span
                              className="text-sm text-muted-foreground"
                              data-testid={`text-no-future-${tos.workerId}`}
                            >
                              —
                            </span>
                          ) : (
                            <div className="space-y-0.5">
                              {visibleFuture.map((a) => (
                                <AssignmentCell
                                  key={a.assignmentId}
                                  a={a}
                                  showDate={true}
                                  testIdPrefix="link-future"
                                />
                              ))}
                              {overflow > 0 && (
                                <div
                                  className="text-xs text-muted-foreground italic"
                                  data-testid={`text-future-overflow-${tos.workerId}`}
                                >
                                  +{overflow} more
                                </div>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile: stacked cards */}
          <div className="md:hidden space-y-3">
            {items.map(({ tos, edlsId, memberStatusCode, today, future }) => {
              const visibleFuture = future.slice(0, FUTURE_LIMIT);
              const overflow = Math.max(0, future.length - FUTURE_LIMIT);
              return (
                <Card key={tos.id} data-testid={`row-tos-${tos.workerId}`}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/workers/${tos.workerId}`}
                          className="font-medium hover:underline block truncate"
                          data-testid={`link-worker-${tos.workerId}`}
                        >
                          {workerName(tos.worker)}
                        </Link>
                        <div
                          className="text-xs text-muted-foreground mt-0.5"
                          data-testid={`text-tos-start-${tos.workerId}`}
                        >
                          Sick since {format(new Date(tos.startDate), "MMM d, yyyy")}
                          {tos.description ? ` — ${tos.description}` : ""}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        <span
                          className="font-mono text-xs"
                          data-testid={`text-edls-id-${tos.workerId}`}
                        >
                          {edlsId ?? "—"}
                        </span>
                        <span
                          className="font-mono text-xs text-muted-foreground"
                          data-testid={`text-member-status-${tos.workerId}`}
                        >
                          {memberStatusCode ?? "—"}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        Today
                      </div>
                      {today ? (
                        <AssignmentCell a={today} showDate={false} testIdPrefix="link-today" />
                      ) : (
                        <span
                          className="text-sm text-muted-foreground"
                          data-testid={`text-no-today-${tos.workerId}`}
                        >
                          —
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        Next (up to {FUTURE_LIMIT})
                      </div>
                      {visibleFuture.length === 0 ? (
                        <span
                          className="text-sm text-muted-foreground"
                          data-testid={`text-no-future-${tos.workerId}`}
                        >
                          —
                        </span>
                      ) : (
                        <div className="space-y-0.5">
                          {visibleFuture.map((a) => (
                            <AssignmentCell
                              key={a.assignmentId}
                              a={a}
                              showDate={true}
                              testIdPrefix="link-future"
                            />
                          ))}
                          {overflow > 0 && (
                            <div
                              className="text-xs text-muted-foreground italic"
                              data-testid={`text-future-overflow-${tos.workerId}`}
                            >
                              +{overflow} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
