import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { FileCheck, Download, Filter, Users, Search, X, ArrowUpDown, AlertTriangle, Ban, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CardcheckReportItem {
  cardcheckId: string;
  workerId: string;
  workerSiriusId: number;
  workerName: string;
  bargainingUnitId: string | null;
  bargainingUnitName: string | null;
  status: 'pending' | 'signed' | 'revoked';
  signedDate: string | null;
  hasPreviousCardcheck: boolean;
  previousCardcheckCount: number;
  definitionId: string;
  definitionName: string;
  buChanged: boolean;
  previousBargainingUnitName: string | null;
  terminatedOver30Days: boolean;
  cardBargainingUnitId: string | null;
  cardBargainingUnitName: string | null;
  buMismatch: boolean;
  currentlyTerminated30Days: boolean;
  currentTerminationDate: string | null;
}

interface BargainingUnit {
  id: string;
  name: string;
}

interface CardcheckDefinition {
  id: string;
  name: string;
}

function isInvalid(item: CardcheckReportItem): boolean {
  return item.status !== "revoked" && (item.buMismatch || item.currentlyTerminated30Days);
}

export default function CardcheckReport() {
  const { toast } = useToast();
  const [signedDateFrom, setSignedDateFrom] = useState<string>("");
  const [signedDateTo, setSignedDateTo] = useState<string>("");
  const [hasPreviousFilter, setHasPreviousFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [bargainingUnitFilter, setBargainingUnitFilter] = useState<string>("all");
  const [definitionFilter, setDefinitionFilter] = useState<string>("all");
  const [validityFilter, setValidityFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<string>("workerName");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (signedDateFrom) params.append("signedDateFrom", signedDateFrom);
    if (signedDateTo) params.append("signedDateTo", signedDateTo);
    if (hasPreviousFilter !== "all") params.append("hasPreviousCardcheck", hasPreviousFilter);
    if (statusFilter !== "all") params.append("status", statusFilter);
    if (bargainingUnitFilter !== "all") params.append("bargainingUnitId", bargainingUnitFilter);
    if (definitionFilter !== "all") params.append("definitionId", definitionFilter);
    return params.toString();
  }, [signedDateFrom, signedDateTo, hasPreviousFilter, statusFilter, bargainingUnitFilter, definitionFilter]);

  const { data: reportData, isLoading: reportLoading } = useQuery<CardcheckReportItem[]>({
    queryKey: ["/api/reports/cardchecks", queryParams],
    queryFn: async () => {
      const response = await fetch(`/api/reports/cardchecks?${queryParams}`);
      if (!response.ok) throw new Error("Failed to fetch report");
      return response.json();
    },
  });

  const { data: bargainingUnits, isLoading: buLoading } = useQuery<BargainingUnit[]>({
    queryKey: ["/api/bargaining-units"],
  });

  const { data: definitions, isLoading: defsLoading } = useQuery<CardcheckDefinition[]>({
    queryKey: ["/api/cardcheck/definitions"],
  });

  const { data: showOnListsIdTypes = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/worker-id-types/show-on-lists"],
  });

  const reportWorkerIds = useMemo(() => {
    if (!reportData) return [];
    return Array.from(new Set(reportData.map(item => item.workerId)));
  }, [reportData]);

  const { data: workerIdsForList = [] } = useQuery<{ workerId: string; typeId: string; value: string }[]>({
    queryKey: ["/api/worker-ids/for-list", reportWorkerIds],
    queryFn: async () => {
      if (reportWorkerIds.length === 0 || showOnListsIdTypes.length === 0) return [];
      const res = await fetch("/api/worker-ids/for-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerIds: reportWorkerIds }),
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: reportWorkerIds.length > 0 && showOnListsIdTypes.length > 0,
  });

  const workerIdValueMap = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const item of workerIdsForList) {
      if (!map.has(item.workerId)) {
        map.set(item.workerId, new Map());
      }
      map.get(item.workerId)!.set(item.typeId, item.value);
    }
    return map;
  }, [workerIdsForList]);

  const prevFilterKey = useMemo(() => {
    return `${searchTerm}|${validityFilter}|${queryParams}`;
  }, [searchTerm, validityFilter, queryParams]);

  const [lastFilterKey, setLastFilterKey] = useState(prevFilterKey);
  if (prevFilterKey !== lastFilterKey) {
    setLastFilterKey(prevFilterKey);
    if (selectedIds.size > 0) {
      setSelectedIds(new Set());
    }
  }

  const filteredAndSortedData = useMemo(() => {
    if (!reportData) return [];
    
    let filtered = reportData;
    
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        item.workerName.toLowerCase().includes(lowerSearch) ||
        item.workerSiriusId.toString().includes(lowerSearch)
      );
    }

    if (validityFilter === "invalid") {
      filtered = filtered.filter(item => isInvalid(item));
    } else if (validityFilter === "valid") {
      filtered = filtered.filter(item => !isInvalid(item));
    }
    
    return filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "workerName":
          comparison = a.workerName.localeCompare(b.workerName);
          break;
        case "bargainingUnitName":
          comparison = (a.bargainingUnitName || "").localeCompare(b.bargainingUnitName || "");
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
        case "signedDate":
          const dateA = a.signedDate ? new Date(a.signedDate).getTime() : 0;
          const dateB = b.signedDate ? new Date(b.signedDate).getTime() : 0;
          comparison = dateA - dateB;
          break;
        case "hasPrevious":
          comparison = Number(a.hasPreviousCardcheck) - Number(b.hasPreviousCardcheck);
          break;
        default:
          comparison = 0;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [reportData, searchTerm, sortField, sortDirection, validityFilter]);

  const selectableItems = useMemo(() => {
    return filteredAndSortedData.filter(item => item.status !== "revoked");
  }, [filteredAndSortedData]);

  const allSelectableSelected = selectableItems.length > 0 && selectableItems.every(item => selectedIds.has(item.cardcheckId));

  const toggleSelectAll = useCallback(() => {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableItems.map(item => item.cardcheckId)));
    }
  }, [allSelectableSelected, selectableItems]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const bulkRevokeMutation = useMutation({
    mutationFn: async (cardcheckIds: string[]) => {
      const res = await apiRequest("POST", "/api/cardchecks/bulk-revoke", { cardcheckIds });
      return res.json();
    },
    onSuccess: (data: { revoked: number; skipped: number; errors: string[] }) => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/reports/cardchecks"] });
      const parts: string[] = [];
      if (data.revoked > 0) parts.push(`${data.revoked} card check${data.revoked !== 1 ? "s" : ""} revoked`);
      if (data.skipped > 0) parts.push(`${data.skipped} already revoked`);
      if (data.errors.length > 0) parts.push(`${data.errors.length} error${data.errors.length !== 1 ? "s" : ""}`);
      toast({
        title: "Bulk Revoke Complete",
        description: parts.join(", "),
        variant: data.errors.length > 0 ? "destructive" : "default",
      });
    },
    onError: () => {
      toast({
        title: "Bulk Revoke Failed",
        description: "An error occurred while revoking card checks.",
        variant: "destructive",
      });
    },
  });

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const clearFilters = () => {
    setSignedDateFrom("");
    setSignedDateTo("");
    setHasPreviousFilter("all");
    setStatusFilter("all");
    setBargainingUnitFilter("all");
    setDefinitionFilter("all");
    setValidityFilter("all");
    setSearchTerm("");
  };

  const hasActiveFilters = signedDateFrom || signedDateTo || hasPreviousFilter !== "all" || statusFilter !== "all" || bargainingUnitFilter !== "all" || definitionFilter !== "all" || validityFilter !== "all";

  const invalidCount = useMemo(() => {
    if (!reportData) return 0;
    return reportData.filter(item => isInvalid(item)).length;
  }, [reportData]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "signed":
        return <Badge variant="default" className="bg-green-600" data-testid={`badge-status-signed`}>Signed</Badge>;
      case "pending":
        return <Badge variant="secondary" data-testid={`badge-status-pending`}>Pending</Badge>;
      case "revoked":
        return <Badge variant="destructive" data-testid={`badge-status-revoked`}>Revoked</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const SortHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <TableHead 
      className="cursor-pointer select-none hover-elevate"
      onClick={() => handleSort(field)}
      data-testid={`table-header-${field}`}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown size={14} className={sortField === field ? "opacity-100" : "opacity-40"} />
      </div>
    </TableHead>
  );

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Card Check Report"
        icon={<FileCheck className="text-primary-foreground" size={16} />}
      />

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Filter size={18} />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
            <div className="space-y-2">
              <Label htmlFor="signedDateFrom">Signed Date From</Label>
              <Input
                id="signedDateFrom"
                type="date"
                value={signedDateFrom}
                onChange={(e) => setSignedDateFrom(e.target.value)}
                data-testid="input-signed-date-from"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="signedDateTo">Signed Date To</Label>
              <Input
                id="signedDateTo"
                type="date"
                value={signedDateTo}
                onChange={(e) => setSignedDateTo(e.target.value)}
                data-testid="input-signed-date-to"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="status" data-testid="select-status">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="signed">Signed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="hasPrevious">Has Previous Card Check</Label>
              <Select value={hasPreviousFilter} onValueChange={setHasPreviousFilter}>
                <SelectTrigger id="hasPrevious" data-testid="select-has-previous">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Yes (Has Previous)</SelectItem>
                  <SelectItem value="false">No (First Card Check)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="bargainingUnit">Bargaining Unit</Label>
              <Select value={bargainingUnitFilter} onValueChange={setBargainingUnitFilter}>
                <SelectTrigger id="bargainingUnit" data-testid="select-bargaining-unit">
                  <SelectValue placeholder="All Units" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Units</SelectItem>
                  {bargainingUnits?.map((bu) => (
                    <SelectItem key={bu.id} value={bu.id}>{bu.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="definition">Card Check Definition</Label>
              <Select value={definitionFilter} onValueChange={setDefinitionFilter}>
                <SelectTrigger id="definition" data-testid="select-definition">
                  <SelectValue placeholder="All Definitions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Definitions</SelectItem>
                  {definitions?.map((def) => (
                    <SelectItem key={def.id} value={def.id}>{def.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="validity">Validity</Label>
              <Select value={validityFilter} onValueChange={setValidityFilter}>
                <SelectTrigger id="validity" data-testid="select-validity">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="invalid">Invalid Only{invalidCount > 0 ? ` (${invalidCount})` : ""}</SelectItem>
                  <SelectItem value="valid">Valid Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {hasActiveFilters && (
            <div className="mt-4 flex items-center justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                data-testid="button-clear-filters"
              >
                <X size={14} className="mr-1" />
                Clear Filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users size={18} />
              Results
              {filteredAndSortedData.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {filteredAndSortedData.length} card checks
                </Badge>
              )}
              {invalidCount > 0 && (
                <Badge variant="destructive" className="ml-1" data-testid="badge-invalid-count">
                  <ShieldAlert size={12} className="mr-1" />
                  {invalidCount} invalid
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowRevokeDialog(true)}
                  disabled={bulkRevokeMutation.isPending}
                  data-testid="button-revoke-selected"
                >
                  <Ban size={14} className="mr-1" />
                  Revoke Selected ({selectedIds.size})
                </Button>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={16} />
                <Input
                  placeholder="Search by name or ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-64"
                  data-testid="input-search"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {reportLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredAndSortedData.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileCheck size={48} className="mx-auto mb-4 opacity-50" />
              <p>No card checks found matching the filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={allSelectableSelected}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead>Card Check</TableHead>
                    <SortHeader field="workerName">Worker</SortHeader>
                    {showOnListsIdTypes.map((idType) => (
                      <TableHead key={idType.id}>{idType.name}</TableHead>
                    ))}
                    <SortHeader field="bargainingUnitName">Bargaining Unit</SortHeader>
                    <SortHeader field="status">Status</SortHeader>
                    <SortHeader field="signedDate">Signed Date</SortHeader>
                    <SortHeader field="hasPrevious">Previous Card Checks</SortHeader>
                    <TableHead>Alerts</TableHead>
                    <TableHead>Definition</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedData.map((item) => {
                    const itemIsInvalid = isInvalid(item);
                    const isSelectable = item.status !== "revoked";
                    return (
                      <TableRow
                        key={item.cardcheckId}
                        data-testid={`row-cardcheck-${item.cardcheckId}`}
                        className={itemIsInvalid ? "bg-red-50 dark:bg-red-950/20" : ""}
                      >
                        <TableCell>
                          {isSelectable ? (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.cardcheckId)}
                              onChange={() => toggleSelect(item.cardcheckId)}
                              className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                              data-testid={`checkbox-cardcheck-${item.cardcheckId}`}
                            />
                          ) : (
                            <span className="inline-block h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Link href={`/cardchecks/${item.cardcheckId}`}>
                            <span className="text-primary hover:underline cursor-pointer" data-testid={`link-cardcheck-${item.cardcheckId}`}>
                              View
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span data-testid={`text-worker-${item.workerId}`}>
                            {item.workerName}
                          </span>
                          <div className="text-xs text-muted-foreground">
                            ID: {item.workerSiriusId}
                          </div>
                        </TableCell>
                        {showOnListsIdTypes.map((idType) => {
                          const typeMap = workerIdValueMap.get(item.workerId);
                          const value = typeMap?.get(idType.id);
                          return (
                            <TableCell key={idType.id} data-testid={`worker-id-${idType.id}-${item.workerId}`}>
                              {value || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          {item.bargainingUnitName || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(item.status)}
                        </TableCell>
                        <TableCell>
                          {item.signedDate ? format(new Date(item.signedDate), "MMM d, yyyy") : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {item.hasPreviousCardcheck ? (
                            <div className="space-y-1">
                              <Badge variant="outline">
                                {item.previousCardcheckCount} previous
                              </Badge>
                              {(item.buChanged || item.terminatedOver30Days) && (
                                <div className="flex flex-col gap-1">
                                  {item.buChanged && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <Badge variant="default" className="bg-amber-600 text-xs cursor-help" data-testid={`badge-bu-changed-${item.cardcheckId}`}>
                                            <AlertTriangle size={10} className="mr-1" />
                                            BU Changed
                                          </Badge>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Previous BU: {item.previousBargainingUnitName || "None"}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                  {item.terminatedOver30Days && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <Badge variant="default" className="bg-amber-600 text-xs cursor-help" data-testid={`badge-terminated-30-${item.cardcheckId}`}>
                                            <AlertTriangle size={10} className="mr-1" />
                                            Rehire (30+ days)
                                          </Badge>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Worker was terminated for 30+ days before this card check
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">First card check</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {item.buMismatch && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Badge variant="destructive" className="text-xs cursor-help" data-testid={`badge-bu-mismatch-${item.cardcheckId}`}>
                                      <ShieldAlert size={10} className="mr-1" />
                                      BU Mismatch
                                    </Badge>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div>Card BU: {item.cardBargainingUnitName || "None"}</div>
                                  <div>Worker's current BU: {item.bargainingUnitName || "None"}</div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {item.currentlyTerminated30Days && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Badge variant="destructive" className="text-xs cursor-help" data-testid={`badge-currently-terminated-${item.cardcheckId}`}>
                                      <ShieldAlert size={10} className="mr-1" />
                                      Terminated 30+
                                    </Badge>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Terminated since {item.currentTerminationDate ? format(new Date(item.currentTerminationDate + "T00:00:00"), "MMM d, yyyy") : "unknown date"}
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {!item.buMismatch && !item.currentlyTerminated30Days && (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{item.definitionName}</span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {selectedIds.size} Card Check{selectedIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke {selectedIds.size} selected card check{selectedIds.size !== 1 ? "s" : ""}. 
              Revoked card checks cannot be modified or restored. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-revoke">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                bulkRevokeMutation.mutate(Array.from(selectedIds));
                setShowRevokeDialog(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-revoke"
            >
              Revoke {selectedIds.size} Card Check{selectedIds.size !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
