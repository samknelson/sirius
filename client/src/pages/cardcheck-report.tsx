import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { FileCheck, Download, Filter, Users, Search, X, ArrowUpDown, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

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
}

interface BargainingUnit {
  id: string;
  name: string;
}

interface CardcheckDefinition {
  id: string;
  name: string;
}

export default function CardcheckReport() {
  const [signedDateFrom, setSignedDateFrom] = useState<string>("");
  const [signedDateTo, setSignedDateTo] = useState<string>("");
  const [hasPreviousFilter, setHasPreviousFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [bargainingUnitFilter, setBargainingUnitFilter] = useState<string>("all");
  const [definitionFilter, setDefinitionFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<string>("workerName");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

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
  }, [reportData, searchTerm, sortField, sortDirection]);

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
    setSearchTerm("");
  };

  const hasActiveFilters = signedDateFrom || signedDateTo || hasPreviousFilter !== "all" || statusFilter !== "all" || bargainingUnitFilter !== "all" || definitionFilter !== "all";

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
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
            </CardTitle>
            <div className="flex items-center gap-2">
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
                    <TableHead>Card Check</TableHead>
                    <SortHeader field="workerName">Worker</SortHeader>
                    {showOnListsIdTypes.map((idType) => (
                      <TableHead key={idType.id}>{idType.name}</TableHead>
                    ))}
                    <SortHeader field="bargainingUnitName">Bargaining Unit</SortHeader>
                    <SortHeader field="status">Status</SortHeader>
                    <SortHeader field="signedDate">Signed Date</SortHeader>
                    <SortHeader field="hasPrevious">Previous Card Checks</SortHeader>
                    <TableHead>Definition</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedData.map((item) => (
                    <TableRow key={item.cardcheckId} data-testid={`row-cardcheck-${item.cardcheckId}`}>
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
                                      <Badge variant="default" className="bg-amber-600 text-xs cursor-help" data-testid={`badge-bu-changed-${item.cardcheckId}`}>
                                        <AlertTriangle size={10} className="mr-1" />
                                        BU Changed
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      Previous BU: {item.previousBargainingUnitName || "None"}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {item.terminatedOver30Days && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="default" className="bg-amber-600 text-xs cursor-help" data-testid={`badge-terminated-30-${item.cardcheckId}`}>
                                        <AlertTriangle size={10} className="mr-1" />
                                        Rehire (30+ days)
                                      </Badge>
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
                        <span className="text-sm">{item.definitionName}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
