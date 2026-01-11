import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Eye, Plus, Calendar,
  Briefcase, Truck, HardHat, Wrench, Clock, 
  ClipboardList, Package, MapPin, Users,
  type LucideIcon
} from "lucide-react";
import { format } from "date-fns";
import { dispatchJobStatusEnum, type Employer, type DispatchJobType } from "@shared/schema";
import type { PaginatedDispatchJobs } from "../../../../server/storage/dispatch-jobs";

const ITEMS_PER_PAGE = 100;

const iconMap: Record<string, LucideIcon> = {
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar,
  ClipboardList, Package, MapPin, Users,
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  running: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  closed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  archived: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
};

interface DispatchJobsListProps {
  employerId?: string;
  showEmployerColumn?: boolean;
  showNewButton?: boolean;
  newButtonHref?: string;
}

export function DispatchJobsList({
  employerId,
  showEmployerColumn = true,
  showNewButton = true,
  newButtonHref = "/dispatch/job/new",
}: DispatchJobsListProps) {
  const [page, setPage] = useState(0);
  const [employerFilter, setEmployerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [jobTypeFilter, setJobTypeFilter] = useState<string>("all");
  const [startDateFrom, setStartDateFrom] = useState<string>("");
  const [startDateTo, setStartDateTo] = useState<string>("");

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (employerId) {
      f.employerId = employerId;
    } else if (employerFilter && employerFilter !== "all") {
      f.employerId = employerFilter;
    }
    if (statusFilter && statusFilter !== "all") f.status = statusFilter;
    if (jobTypeFilter && jobTypeFilter !== "all") f.jobTypeId = jobTypeFilter;
    if (startDateFrom) f.startDateFrom = startDateFrom;
    if (startDateTo) f.startDateTo = startDateTo;
    return f;
  }, [employerId, employerFilter, statusFilter, jobTypeFilter, startDateFrom, startDateTo]);

  useEffect(() => {
    setPage(0);
  }, [employerId, employerFilter, statusFilter, jobTypeFilter, startDateFrom, startDateTo]);

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
    enabled: showEmployerColumn,
  });

  const { data: jobTypes = [] } = useQuery<DispatchJobType[]>({
    queryKey: ["/api/options/dispatch-job-type"],
  });

  const { data: result, isLoading } = useQuery<PaginatedDispatchJobs>({
    queryKey: ["/api/dispatch-jobs", page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(ITEMS_PER_PAGE),
        ...filters,
      });
      const response = await fetch(`/api/dispatch-jobs?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch dispatch jobs");
      }
      return response.json();
    },
  });

  const jobs = result?.data || [];
  const total = result?.total || 0;
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  const handleClearFilters = () => {
    setEmployerFilter("all");
    setStatusFilter("all");
    setJobTypeFilter("all");
    setStartDateFrom("");
    setStartDateTo("");
    setPage(0);
  };

  const hasFilters = (showEmployerColumn && employerFilter !== "all") || 
                     statusFilter !== "all" || 
                     jobTypeFilter !== "all" || 
                     startDateFrom || 
                     startDateTo;

  const filterCount = showEmployerColumn ? 5 : 4;
  const gridClass = showEmployerColumn 
    ? "grid grid-cols-1 md:grid-cols-5 gap-4" 
    : "grid grid-cols-1 md:grid-cols-4 gap-4";

  return (
    <div className="space-y-4">
      {showNewButton && (
        <div className="flex justify-end">
          <Link href={newButtonHref}>
            <Button data-testid="button-add">
              <Plus className="h-4 w-4 mr-2" />
              New Job
            </Button>
          </Link>
        </div>
      )}

      <div className={gridClass}>
        {showEmployerColumn && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Employer</label>
            <Select value={employerFilter} onValueChange={setEmployerFilter}>
              <SelectTrigger data-testid="select-employer-filter">
                <SelectValue placeholder="All employers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employers</SelectItem>
                {employers.map((employer) => (
                  <SelectItem key={employer.id} value={employer.id}>
                    {employer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger data-testid="select-status-filter">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {dispatchJobStatusEnum.map((status) => (
                <SelectItem key={status} value={status}>
                  <span className="capitalize">{status}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Job Type</label>
          <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
            <SelectTrigger data-testid="select-jobtype-filter">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {jobTypes.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Start Date From</label>
          <Input
            type="date"
            value={startDateFrom}
            onChange={(e) => setStartDateFrom(e.target.value)}
            data-testid="input-start-date-from"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Start Date To</label>
          <Input
            type="date"
            value={startDateTo}
            onChange={(e) => setStartDateTo(e.target.value)}
            data-testid="input-start-date-to"
          />
        </div>
      </div>

      {hasFilters && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={handleClearFilters}
            data-testid="button-clear-filters"
          >
            Clear Filters
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : jobs.length > 0 ? (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  {showEmployerColumn && <TableHead>Employer</TableHead>}
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const jobTypeData = job.jobType?.data as { icon?: string } | null;
                  const IconComponent = jobTypeData?.icon ? iconMap[jobTypeData.icon] || Briefcase : Briefcase;
                  
                  return (
                    <TableRow key={job.id} data-testid={`row-job-${job.id}`}>
                      <TableCell className="font-medium" data-testid={`text-title-${job.id}`}>
                        {job.title}
                      </TableCell>
                      {showEmployerColumn && (
                        <TableCell data-testid={`text-employer-${job.id}`}>
                          {job.employer ? (
                            <Link href={`/employers/${job.employer.id}`}>
                              <span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                                {job.employer.name}
                              </span>
                            </Link>
                          ) : "—"}
                        </TableCell>
                      )}
                      <TableCell data-testid={`text-type-${job.id}`}>
                        {job.jobType ? (
                          <div className="flex items-center gap-2">
                            <IconComponent className="h-4 w-4 text-muted-foreground" />
                            <span>{job.jobType.name}</span>
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell data-testid={`text-status-${job.id}`}>
                        <Badge 
                          variant="secondary"
                          className={statusColors[job.status] || ""}
                        >
                          <span className="capitalize">{job.status}</span>
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-date-${job.id}`}>
                        {format(new Date(job.startDate), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/dispatch/job/${job.id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-view-${job.id}`}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {page * ITEMS_PER_PAGE + 1} to {Math.min((page + 1) * ITEMS_PER_PAGE, total)} of {total} jobs
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  data-testid="button-prev-page"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page >= totalPages - 1}
                  data-testid="button-next-page"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <p className="text-muted-foreground" data-testid="text-no-results">
            No dispatch jobs found.{" "}
            {hasFilters && "Try adjusting your filters."}
          </p>
        </div>
      )}
    </div>
  );
}
