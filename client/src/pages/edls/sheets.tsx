import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useSearch, useLocation } from "wouter";
import { format, addDays, startOfDay } from "date-fns";
import { formatYmd } from "@shared/utils/date";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Plus, FileSpreadsheet, Calendar, Users, CalendarDays, Eye, Pencil, Settings, UserCheck, Layers, Factory, ChevronsUpDown, Check, X } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { EdlsSheetForm, type SheetFormData } from "@/components/edls/EdlsSheetForm";
import type { EdlsSheet } from "@shared/schema";
import { cn } from "@/lib/utils";

interface EdlsSheetWithRelations extends EdlsSheet {
  employer?: { id: string; name: string };
  department?: { id: string; name: string };
  supervisorUser?: { id: string; firstName: string | null; lastName: string | null; email: string };
  assigneeUser?: { id: string; firstName: string | null; lastName: string | null; email: string };
  jobGroup?: { id: string; name: string };
  facility?: { id: string; name: string };
  assignedCount?: number;
}

interface FacilityOption {
  id: string;
  name: string;
}

interface PaginatedFacilities {
  data: FacilityOption[];
  total: number;
  page: number;
  limit: number;
}

interface JobGroupOption {
  id: string;
  name: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 dark:bg-gray-800/50",
  request: "bg-yellow-100 dark:bg-yellow-900/30",
  lock: "bg-green-100 dark:bg-green-900/30",
  reserved: "bg-blue-100 dark:bg-blue-900/30",
  trash: "bg-red-100 dark:bg-red-900/30",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  request: "Requested",
  lock: "Scheduled",
  reserved: "Reserved",
  trash: "Trash",
};

function formatUserName(user: { firstName: string | null; lastName: string | null; email: string } | undefined): string {
  if (!user) return "—";
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  return user.email;
}

interface PaginatedEdlsSheets {
  data: EdlsSheetWithRelations[];
  total: number;
  page: number;
  limit: number;
}

type DateFilterType = "all" | "today" | "tomorrow" | "day2" | "day3" | "day4" | "day5" | "day6" | "other" | "range";

function getDateFilterOptions(): Array<{ value: DateFilterType; label: string; date?: Date }> {
  const today = startOfDay(new Date());
  const options: Array<{ value: DateFilterType; label: string; date?: Date }> = [
    { value: "all", label: "All Dates" },
    { value: "today", label: "Today", date: today },
    { value: "tomorrow", label: "Tomorrow", date: addDays(today, 1) },
  ];
  
  for (let i = 2; i <= 6; i++) {
    const date = addDays(today, i);
    options.push({
      value: `day${i}` as DateFilterType,
      label: `${format(date, "EEEE")} (${format(date, "d MMMM")})`,
      date,
    });
  }
  
  options.push(
    { value: "other", label: "Other Date" },
    { value: "range", label: "Date Range" }
  );
  
  return options;
}

export default function EdlsSheetsPage() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [dateFilterType, setDateFilterType] = useState<DateFilterType>("all");
  const [otherDate, setOtherDate] = useState<Date | undefined>(undefined);
  const [rangeFromDate, setRangeFromDate] = useState<Date | undefined>(undefined);
  const [rangeToDate, setRangeToDate] = useState<Date | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [eventFilter, setEventFilter] = useState<string>("all");
  const search = useSearch();
  const [, setLocation] = useLocation();
  const initialFacilityFromUrl = useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get("facilityId") ?? "";
  }, []);
  const [facilityFilter, setFacilityFilterState] = useState<string>(initialFacilityFromUrl);
  const [facilitySearch, setFacilitySearch] = useState<string>("");
  const [facilityPickerOpen, setFacilityPickerOpen] = useState(false);

  const setFacilityFilter = (value: string) => {
    setFacilityFilterState(value);
    const params = new URLSearchParams(window.location.search);
    if (value) {
      params.set("facilityId", value);
    } else {
      params.delete("facilityId");
    }
    const qs = params.toString();
    const path = window.location.pathname + (qs ? `?${qs}` : "");
    setLocation(path, { replace: true });
  };

  useEffect(() => {
    const params = new URLSearchParams(search);
    const next = params.get("facilityId") ?? "";
    if (next !== facilityFilter) {
      setFacilityFilterState(next);
    }
  }, [search]);

  const { data: facilitiesData } = useQuery<PaginatedFacilities>({
    queryKey: ["/api/facilities", { search: facilitySearch, sheetsFilter: true }],
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
    queryKey: ["/api/facilities", facilityFilter],
    queryFn: async () => {
      const res = await fetch(`/api/facilities/${facilityFilter}`);
      if (!res.ok) throw new Error("Failed to fetch facility");
      return res.json();
    },
    enabled: !!facilityFilter && !facilityOptions.some(f => f.id === facilityFilter),
  });
  const selectedFacilityName = facilityOptions.find(f => f.id === facilityFilter)?.name ?? selectedFacility?.name;
  
  const dateFilterOptions = useMemo(() => getDateFilterOptions(), []);
  
  const { dateFrom, dateTo } = useMemo(() => {
    if (dateFilterType === "all") {
      return { dateFrom: undefined, dateTo: undefined };
    }
    if (dateFilterType === "other" && otherDate) {
      const dateStr = format(otherDate, "yyyy-MM-dd");
      return { dateFrom: dateStr, dateTo: dateStr };
    }
    if (dateFilterType === "range") {
      return {
        dateFrom: rangeFromDate ? format(rangeFromDate, "yyyy-MM-dd") : undefined,
        dateTo: rangeToDate ? format(rangeToDate, "yyyy-MM-dd") : undefined,
      };
    }
    const option = dateFilterOptions.find(o => o.value === dateFilterType);
    if (option?.date) {
      const dateStr = format(option.date, "yyyy-MM-dd");
      return { dateFrom: dateStr, dateTo: dateStr };
    }
    return { dateFrom: undefined, dateTo: undefined };
  }, [dateFilterType, otherDate, rangeFromDate, rangeToDate, dateFilterOptions]);
  
  const eventOptionsDate = useMemo(() => {
    if (dateFrom && dateFrom === dateTo) return dateFrom;
    if (dateFrom && !dateTo) return dateFrom;
    if (!dateFrom && dateTo) return dateTo;
    return undefined;
  }, [dateFrom, dateTo]);

  const { data: eventOptions = [] } = useQuery<JobGroupOption[]>({
    queryKey: ["/api/edls/job-group-options", eventOptionsDate],
    queryFn: async () => {
      if (!eventOptionsDate) return [];
      const res = await fetch(`/api/edls/job-group-options?date=${eventOptionsDate}`);
      if (!res.ok) throw new Error("Failed to fetch event options");
      return res.json();
    },
    enabled: !!eventOptionsDate,
  });

  useEffect(() => {
    if (eventFilter !== "all" && !eventOptions.some(o => o.id === eventFilter)) {
      setEventFilter("all");
    }
  }, [eventFilter, eventOptions]);

  const activeEventFilter = eventFilter !== "all" && eventOptions.some(o => o.id === eventFilter) ? eventFilter : "all";

  const queryParams = new URLSearchParams();
  if (dateFrom) queryParams.set("dateFrom", dateFrom);
  if (dateTo) queryParams.set("dateTo", dateTo);
  if (statusFilter && statusFilter !== "all") queryParams.set("status", statusFilter);
  if (activeEventFilter && activeEventFilter !== "all") queryParams.set("jobGroupId", activeEventFilter);
  if (facilityFilter) queryParams.set("facilityId", facilityFilter);
  const queryString = queryParams.toString();
  
  const { data: sheetsData, isLoading } = useQuery<PaginatedEdlsSheets>({
    queryKey: ["/api/edls/sheets", { dateFrom, dateTo, status: statusFilter, jobGroupId: activeEventFilter, facilityId: facilityFilter }],
    queryFn: async () => {
      const url = queryString ? `/api/edls/sheets?${queryString}` : "/api/edls/sheets";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sheets");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: SheetFormData) => {
      return apiRequest("POST", "/api/edls/sheets", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets"] });
      setIsCreateDialogOpen(false);
      toast({
        title: "Sheet Created",
        description: "The new sheet has been created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create sheet",
        variant: "destructive",
      });
    },
  });

  const handleCreateSheet = (data: SheetFormData) => {
    createMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const sheets = sheetsData?.data || [];

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <div>
            <CardTitle data-testid="title-page" className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              EDLS Sheets
            </CardTitle>
            <CardDescription>
              Manage employer day labor scheduling sheets
            </CardDescription>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-sheet">
                <Plus className="h-4 w-4 mr-2" />
                New Sheet
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Sheet</DialogTitle>
                <DialogDescription>
                  Add a new day labor scheduling sheet for an employer.
                </DialogDescription>
              </DialogHeader>
              <EdlsSheetForm
                onSubmit={handleCreateSheet}
                onCancel={() => setIsCreateDialogOpen(false)}
                isSubmitting={createMutation.isPending}
                submitLabel="Create Sheet"
              />
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                Date Filter
              </label>
              <Select 
                value={dateFilterType} 
                onValueChange={(value) => setDateFilterType(value as DateFilterType)}
              >
                <SelectTrigger className="w-[220px]" data-testid="select-date-filter">
                  <SelectValue placeholder="Select date filter" />
                </SelectTrigger>
                <SelectContent>
                  {dateFilterOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} data-testid={`option-date-${option.value}`}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <FileSpreadsheet className="h-4 w-4" />
                Status
              </label>
              <Select 
                value={statusFilter} 
                onValueChange={setStatusFilter}
              >
                <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-status-all">All Statuses</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value} data-testid={`option-status-${value}`}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Layers className="h-4 w-4" />
                Event
              </label>
              <Select
                value={eventFilter}
                onValueChange={setEventFilter}
                disabled={!eventOptionsDate || eventOptions.length === 0}
              >
                <SelectTrigger className="w-[220px]" data-testid="select-event-filter">
                  <SelectValue placeholder={!eventOptionsDate ? "Select a date first" : "All Events"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-event-all">All Events</SelectItem>
                  {eventOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id} data-testid={`option-event-${option.id}`}>
                      {option.name}
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
                    className={cn(
                      "w-[220px] justify-between font-normal",
                      !facilityFilter && "text-muted-foreground"
                    )}
                    data-testid="button-facility-filter"
                  >
                    <span className="truncate">
                      {facilityFilter ? (selectedFacilityName ?? "Selected facility") : "All Facilities"}
                    </span>
                    <span className="flex items-center gap-1">
                      {facilityFilter && (
                        <X
                          className="h-4 w-4 opacity-60 hover:opacity-100"
                          data-testid="button-facility-filter-clear"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setFacilityFilter("");
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
                            setFacilityFilter("");
                            setFacilityPickerOpen(false);
                          }}
                          data-testid="option-facility-filter-all"
                        >
                          <Check className={cn("mr-2 h-4 w-4", !facilityFilter ? "opacity-100" : "opacity-0")} />
                          All Facilities
                        </CommandItem>
                        {facilityOptions.map((f) => (
                          <CommandItem
                            key={f.id}
                            value={f.id}
                            onSelect={() => {
                              setFacilityFilter(f.id);
                              setFacilityPickerOpen(false);
                            }}
                            data-testid={`option-facility-filter-${f.id}`}
                          >
                            <Check className={cn("mr-2 h-4 w-4", facilityFilter === f.id ? "opacity-100" : "opacity-0")} />
                            {f.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            
            {dateFilterType === "other" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-muted-foreground">Select Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-[200px] justify-start text-left font-normal",
                        !otherDate && "text-muted-foreground"
                      )}
                      data-testid="button-other-date"
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {otherDate ? format(otherDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={otherDate}
                      onSelect={setOtherDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
            
            {dateFilterType === "range" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-muted-foreground">From</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-[200px] justify-start text-left font-normal",
                          !rangeFromDate && "text-muted-foreground"
                        )}
                        data-testid="button-date-from"
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        {rangeFromDate ? format(rangeFromDate, "PPP") : "Start date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={rangeFromDate}
                        onSelect={setRangeFromDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-muted-foreground">To</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-[200px] justify-start text-left font-normal",
                          !rangeToDate && "text-muted-foreground"
                        )}
                        data-testid="button-date-to"
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        {rangeToDate ? format(rangeToDate, "PPP") : "End date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={rangeToDate}
                        onSelect={setRangeToDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </>
            )}
          </div>
          
          {sheets.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No sheets found.</p>
              <p className="text-sm">{dateFilterType !== "all" ? "Try adjusting your date filter or create a new sheet." : "Create a new sheet to get started."}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Supervisor / Assignee</TableHead>
                  <TableHead>Workers</TableHead>
                  <TableHead>Tools</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheets.map((sheet) => (
                  <TableRow 
                    key={sheet.id} 
                    data-testid={`row-sheet-${sheet.id}`}
                    className={cn(STATUS_COLORS[sheet.status] || "")}
                  >
                    <TableCell>
                      <span className="text-sm font-medium">
                        {STATUS_LABELS[sheet.status] || sheet.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{sheet.title}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {formatYmd(sheet.ymd, 'long')}
                      </div>
                    </TableCell>
                    <TableCell>
                      {sheet.department?.name || "—"}
                    </TableCell>
                    <TableCell data-testid={`text-event-${sheet.id}`}>
                      {sheet.jobGroup?.name || "—"}
                    </TableCell>
                    <TableCell data-testid={`text-facility-${sheet.id}`}>
                      {sheet.facility?.name || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{formatUserName(sheet.supervisorUser)}</div>
                        {sheet.assigneeUser && sheet.assigneeUser.id !== sheet.supervisorUser?.id && (
                          <div className="text-muted-foreground">{formatUserName(sheet.assigneeUser)}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span data-testid={`text-workers-${sheet.id}`}>
                          {sheet.assignedCount ?? 0}/{sheet.workerCount}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link href={`/edls/sheet/${sheet.id}`}>
                          <Button size="icon" variant="ghost" data-testid={`button-view-${sheet.id}`} title="View">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Link href={`/edls/sheet/${sheet.id}/edit`}>
                          <Button size="icon" variant="ghost" data-testid={`button-edit-${sheet.id}`} title="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Link href={`/edls/sheet/${sheet.id}/manage`}>
                          <Button size="icon" variant="ghost" data-testid={`button-manage-${sheet.id}`} title="Manage">
                            <Settings className="h-4 w-4" />
                          </Button>
                        </Link>
                        {sheet.status !== "lock" && sheet.status !== "trash" && (
                          <Link href={`/edls/sheet/${sheet.id}/assignments`}>
                            <Button size="icon" variant="ghost" data-testid={`button-assignments-${sheet.id}`} title="Assignments">
                              <UserCheck className="h-4 w-4" />
                            </Button>
                          </Link>
                        )}
                      </div>
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
