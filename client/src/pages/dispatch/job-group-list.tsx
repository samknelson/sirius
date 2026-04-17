import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Plus, Layers, ArrowUp, ArrowDown, X } from "lucide-react";
import type { DispatchJobGroup } from "@shared/schema";

interface PaginatedResult {
  data: DispatchJobGroup[];
  total: number;
  page: number;
  limit: number;
}

function isActive(startYmd: string, endYmd: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return startYmd <= today && endYmd >= today;
}

type SortField = "name" | "startYmd";
type SortDir = "asc" | "desc";

export default function DispatchJobGroupListPage() {
  usePageTitle("Job Groups");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const limit = 50;

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", String(limit));
  queryParams.set("sort", sort);
  queryParams.set("sortDir", sortDir);
  if (search) queryParams.set("search", search);
  if (dateFilter) queryParams.set("date", dateFilter);
  if (activeFilter !== "all") queryParams.set("active", activeFilter);

  const { data, isLoading } = useQuery<PaginatedResult>({
    queryKey: ["/api/dispatch-job-groups", { page, search, date: dateFilter, active: activeFilter, sort, sortDir }],
    queryFn: async () => {
      const res = await fetch(`/api/dispatch-job-groups?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  function handleSort(field: SortField) {
    if (sort === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSort(field);
      setSortDir("asc");
    }
    setPage(0);
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sort !== field) return null;
    return sortDir === "asc"
      ? <ArrowUp className="inline h-3 w-3 ml-1" />
      : <ArrowDown className="inline h-3 w-3 ml-1" />;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Layers className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold" data-testid="heading-job-groups">Job Groups</h1>
        </div>
        <Link href="/dispatch/job_group/new">
          <Button data-testid="button-add-job-group">
            <Plus className="h-4 w-4 mr-2" />
            New Job Group
          </Button>
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <div className="relative">
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => { setDateFilter(e.target.value); setPage(0); }}
            className="w-[180px]"
            data-testid="input-date-filter"
          />
          {dateFilter && (
            <button
              onClick={() => { setDateFilter(""); setPage(0); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              data-testid="button-clear-date"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={activeFilter} onValueChange={(val) => { setActiveFilter(val); setPage(0); }}>
          <SelectTrigger className="w-[140px]" data-testid="select-active-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-list" />
        </div>
      ) : !data?.data.length ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No job groups found.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th
                      className="text-left p-3 font-medium text-sm cursor-pointer select-none hover:text-primary"
                      onClick={() => handleSort("name")}
                      data-testid="sort-name"
                    >
                      Name<SortIcon field="name" />
                    </th>
                    <th
                      className="text-left p-3 font-medium text-sm cursor-pointer select-none hover:text-primary"
                      onClick={() => handleSort("startYmd")}
                      data-testid="sort-start-ymd"
                    >
                      Start Date<SortIcon field="startYmd" />
                    </th>
                    <th className="text-left p-3 font-medium text-sm">End Date</th>
                    <th className="text-left p-3 font-medium text-sm">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((group) => {
                    const active = isActive(group.startYmd, group.endYmd);
                    return (
                      <tr key={group.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-job-group-${group.id}`}>
                        <td className="p-3">
                          <Link href={`/dispatch/job_group/${group.id}`} className="text-primary hover:underline font-medium" data-testid={`link-job-group-${group.id}`}>
                            {group.name}
                          </Link>
                        </td>
                        <td className="p-3 text-sm">{group.startYmd}</td>
                        <td className="p-3 text-sm">{group.endYmd}</td>
                        <td className="p-3">
                          <Badge variant={active ? "default" : "secondary"} data-testid={`badge-status-${group.id}`}>
                            {active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Showing {page * limit + 1}–{Math.min((page + 1) * limit, data.total)} of {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-prev">
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} data-testid="button-next">
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
