import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Plus, Building, ArrowUp, ArrowDown } from "lucide-react";
import { useAccessCheck } from "@/hooks/use-access-check";
import type { Facility } from "@shared/schema";

interface PaginatedResult {
  data: Facility[];
  total: number;
  page: number;
  limit: number;
}

type SortDir = "asc" | "desc";

export default function FacilityListPage() {
  usePageTitle("Facilities");
  const { canAccess: canEdit } = useAccessCheck("facility.edit", undefined);
  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const limit = 50;

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", String(limit));
  queryParams.set("sortDir", sortDir);
  if (search) queryParams.set("search", search);

  const { data, isLoading } = useQuery<PaginatedResult>({
    queryKey: ["/api/facilities", { page, search, sortDir }],
    queryFn: async () => {
      const res = await fetch(`/api/facilities?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch facilities");
      return res.json();
    },
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  function toggleSort() {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    setPage(0);
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Building className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold" data-testid="heading-facilities">Facilities</h1>
        </div>
        {canEdit && (
          <Link href="/facilities/new">
            <Button data-testid="button-add-facility">
              <Plus className="h-4 w-4 mr-2" />
              New Facility
            </Button>
          </Link>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-list" />
        </div>
      ) : !data?.data.length ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-no-facilities">
            No facilities found.
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
                      onClick={toggleSort}
                      data-testid="sort-name"
                    >
                      Name
                      {sortDir === "asc"
                        ? <ArrowUp className="inline h-3 w-3 ml-1" />
                        : <ArrowDown className="inline h-3 w-3 ml-1" />}
                    </th>
                    <th className="text-left p-3 font-medium text-sm">Sirius ID</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((f) => (
                    <tr key={f.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-facility-${f.id}`}>
                      <td className="p-3">
                        <Link href={`/facilities/${f.id}`} className="text-primary hover:underline font-medium" data-testid={`link-facility-${f.id}`}>
                          {f.name}
                        </Link>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground" data-testid={`text-sirius-id-${f.id}`}>
                        {f.siriusId || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground" data-testid="text-pagination-info">
                Showing {page * limit + 1}–{Math.min((page + 1) * limit, data.total)} of {data.total}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} data-testid="button-prev">
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} data-testid="button-next">
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
