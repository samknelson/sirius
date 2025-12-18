import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Filter, X, Users } from "lucide-react";
import { useState, useMemo } from "react";
import { stringify } from "csv-stringify/browser/esm/sync";
import type { Employer, BargainingUnit } from "@shared/schema";

interface StewardAssignmentListItem {
  id: string;
  workerId: string;
  employerId: string;
  bargainingUnitId: string;
  employer?: { id: string; name: string };
  bargainingUnit?: { id: string; name: string };
  worker?: { id: string; displayName: string };
}

export default function Stewards() {
  const [showFilters, setShowFilters] = useState(false);
  const [filterEmployer, setFilterEmployer] = useState<string>("all");
  const [filterBargainingUnit, setFilterBargainingUnit] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: assignments, isLoading } = useQuery<StewardAssignmentListItem[]>({
    queryKey: ["/api/steward-assignments"],
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: bargainingUnits = [] } = useQuery<BargainingUnit[]>({
    queryKey: ["/api/bargaining-units"],
  });

  const filteredAssignments = useMemo(() => {
    if (!assignments) return [];
    
    return assignments.filter(assignment => {
      if (filterEmployer !== "all" && assignment.employerId !== filterEmployer) {
        return false;
      }
      if (filterBargainingUnit !== "all" && assignment.bargainingUnitId !== filterBargainingUnit) {
        return false;
      }
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const nameMatch = assignment.worker?.displayName?.toLowerCase().includes(search);
        const employerMatch = assignment.employer?.name?.toLowerCase().includes(search);
        const unitMatch = assignment.bargainingUnit?.name?.toLowerCase().includes(search);
        if (!nameMatch && !employerMatch && !unitMatch) {
          return false;
        }
      }
      return true;
    });
  }, [assignments, filterEmployer, filterBargainingUnit, searchTerm]);

  const hasActiveFilters = filterEmployer !== "all" || filterBargainingUnit !== "all" || searchTerm !== "";

  const clearFilters = () => {
    setFilterEmployer("all");
    setFilterBargainingUnit("all");
    setSearchTerm("");
  };

  const handleExportCSV = () => {
    if (!filteredAssignments.length) return;

    const csvData = filteredAssignments.map(assignment => ({
      "Steward Name": assignment.worker?.displayName || "Unknown",
      "Employer": assignment.employer?.name || "Unknown",
      "Bargaining Unit": assignment.bargainingUnit?.name || "Unknown",
    }));

    const csv = stringify(csvData, { header: true });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `steward-assignments-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100" data-testid="text-page-title">
          Shop Stewards
        </h1>
        <p className="text-muted-foreground mt-1">
          View all shop steward assignments across employers and bargaining units
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Steward Assignments
            </CardTitle>
            <CardDescription>
              {isLoading ? "Loading..." : `${filteredAssignments.length} assignment${filteredAssignments.length !== 1 ? "s" : ""}`}
              {hasActiveFilters && ` (filtered from ${assignments?.length || 0} total)`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              data-testid="button-toggle-filters"
            >
              <Filter className="h-4 w-4 mr-2" />
              Filters
              {hasActiveFilters && <Badge variant="secondary" className="ml-2">Active</Badge>}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={filteredAssignments.length === 0}
              data-testid="button-export-csv"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>

        {showFilters && (
          <div className="px-6 pb-4 border-b">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Search</label>
                <Input
                  placeholder="Search by name, employer, or unit..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-search"
                />
              </div>
              <div className="min-w-[200px]">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Employer</label>
                <Select value={filterEmployer} onValueChange={setFilterEmployer}>
                  <SelectTrigger data-testid="select-employer">
                    <SelectValue placeholder="All employers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All employers</SelectItem>
                    {employers.map(employer => (
                      <SelectItem key={employer.id} value={employer.id}>
                        {employer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[200px]">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Bargaining Unit</label>
                <Select value={filterBargainingUnit} onValueChange={setFilterBargainingUnit}>
                  <SelectTrigger data-testid="select-bargaining-unit">
                    <SelectValue placeholder="All units" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All units</SelectItem>
                    {bargainingUnits.map(unit => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>
        )}

        <CardContent className="pt-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredAssignments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {hasActiveFilters ? (
                <>
                  <p>No steward assignments match your filters.</p>
                  <Button variant="link" onClick={clearFilters} className="mt-2">
                    Clear filters
                  </Button>
                </>
              ) : (
                <p>No steward assignments found.</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Steward</TableHead>
                  <TableHead>Employer</TableHead>
                  <TableHead>Bargaining Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssignments.map((assignment) => (
                  <TableRow key={assignment.id} data-testid={`row-steward-${assignment.id}`}>
                    <TableCell>
                      {assignment.worker ? (
                        <Link href={`/workers/${assignment.workerId}`}>
                          <span className="text-primary hover:underline cursor-pointer" data-testid={`link-worker-${assignment.workerId}`}>
                            {assignment.worker.displayName}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Unknown worker</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {assignment.employer?.name || <span className="text-muted-foreground">Unknown</span>}
                    </TableCell>
                    <TableCell>
                      {assignment.bargainingUnit?.name || <span className="text-muted-foreground">Unknown</span>}
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
