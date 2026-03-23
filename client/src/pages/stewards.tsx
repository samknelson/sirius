import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, Filter, X, Users, Trash2 } from "lucide-react";
import { useState, useMemo } from "react";
import { stringify } from "csv-stringify/browser/esm/sync";
import type { Employer, BargainingUnit } from "@shared/schema";
import { useTerm } from "@/contexts/TerminologyContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  const term = useTerm();
  const { toast } = useToast();
  const [showFilters, setShowFilters] = useState(false);
  const [filterEmployer, setFilterEmployer_] = useState<string>("all");
  const [filterBargainingUnit, setFilterBargainingUnit_] = useState<string>("all");
  const [searchTerm, setSearchTerm_] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const setFilterEmployer = (v: string) => { setFilterEmployer_(v); setSelectedIds(new Set()); };
  const setFilterBargainingUnit = (v: string) => { setFilterBargainingUnit_(v); setSelectedIds(new Set()); };
  const setSearchTerm = (v: string) => { setSearchTerm_(v); setSelectedIds(new Set()); };

  const { data: assignments, isLoading } = useQuery<StewardAssignmentListItem[]>({
    queryKey: ["/api/steward-assignments"],
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: bargainingUnits = [] } = useQuery<BargainingUnit[]>({
    queryKey: ["/api/bargaining-units"],
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      return apiRequest("POST", "/api/steward-assignments/bulk-delete", { ids });
    },
    onSuccess: (result: { deleted: number; notFound: number; errors: number; total: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/steward-assignments"] });
      setSelectedIds(new Set());
      if (result.errors > 0 || result.notFound > 0) {
        const parts: string[] = [];
        if (result.deleted > 0) parts.push(`${result.deleted} removed`);
        if (result.notFound > 0) parts.push(`${result.notFound} not found`);
        if (result.errors > 0) parts.push(`${result.errors} failed`);
        toast({
          title: result.deleted > 0 ? "Partially completed" : "Failed",
          description: parts.join(", "),
          variant: result.deleted === 0 ? "destructive" : undefined,
        });
      } else {
        toast({
          title: "Assignments removed",
          description: `${result.deleted} ${term("steward", { lowercase: true })} assignment${result.deleted !== 1 ? "s" : ""} removed successfully.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove assignments",
        variant: "destructive",
      });
    },
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
    setSelectedIds(new Set());
  };

  const handleExportCSV = () => {
    if (!filteredAssignments.length) return;

    const csvData = filteredAssignments.map(assignment => ({
      [`${term("steward")} Name`]: assignment.worker?.displayName || "Unknown",
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

  const filteredIds = useMemo(() => new Set(filteredAssignments.map(a => a.id)), [filteredAssignments]);
  const allFilteredSelected = filteredAssignments.length > 0 && filteredAssignments.every(a => selectedIds.has(a.id));
  const someFilteredSelected = filteredAssignments.some(a => selectedIds.has(a.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const id of Array.from(filteredIds)) {
          next.delete(id);
        }
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const id of Array.from(filteredIds)) {
          next.add(id);
        }
        return next;
      });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkRemove = () => {
    const ids = Array.from(selectedIds);
    bulkDeleteMutation.mutate(ids);
    setShowConfirmDialog(false);
  };

  const selectedCount = selectedIds.size;
  const selectedNames = useMemo(() => {
    if (!assignments) return [];
    return assignments
      .filter(a => selectedIds.has(a.id))
      .map(a => a.worker?.displayName || "Unknown")
      .slice(0, 5);
  }, [assignments, selectedIds]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100" data-testid="text-page-title">
          {term("steward", { plural: true })}
        </h1>
        <p className="text-muted-foreground mt-1">
          View all {term("steward", { plural: true, lowercase: true })} assignments across employers and bargaining units
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {term("steward")} Assignments
            </CardTitle>
            <CardDescription>
              {isLoading ? "Loading..." : `${filteredAssignments.length} assignment${filteredAssignments.length !== 1 ? "s" : ""}`}
              {hasActiveFilters && ` (filtered from ${assignments?.length || 0} total)`}
              {selectedCount > 0 && ` \u00B7 ${selectedCount} selected`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedCount > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowConfirmDialog(true)}
                disabled={bulkDeleteMutation.isPending}
                data-testid="button-bulk-remove"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove {selectedCount}
              </Button>
            )}
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
                  <p>No {term("steward", { lowercase: true })} assignments match your filters.</p>
                  <Button variant="link" onClick={clearFilters} className="mt-2">
                    Clear filters
                  </Button>
                </>
              ) : (
                <p>No {term("steward", { lowercase: true })} assignments found.</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead>{term("steward")}</TableHead>
                  <TableHead>Employer</TableHead>
                  <TableHead>Bargaining Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssignments.map((assignment) => (
                  <TableRow key={assignment.id} data-testid={`row-steward-${assignment.id}`}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(assignment.id)}
                        onCheckedChange={() => toggleSelect(assignment.id)}
                        aria-label={`Select ${assignment.worker?.displayName || "assignment"}`}
                        data-testid={`checkbox-steward-${assignment.id}`}
                      />
                    </TableCell>
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

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selectedCount} {term("steward", { lowercase: true })} assignment{selectedCount !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the {term("steward", { lowercase: true })} status for the selected workers. This action will be logged to each worker's record.
              {selectedNames.length > 0 && (
                <span className="block mt-2 text-foreground">
                  {selectedNames.join(", ")}
                  {selectedCount > 5 && `, and ${selectedCount - 5} more`}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkRemove}
              data-testid="button-confirm-remove"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
