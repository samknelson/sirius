import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { Download, ArrowUpDown, Filter, X, Eye, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { formatAmount as formatCurrencyAmount } from "@shared/currency";

interface LedgerEntryData {
  workerId?: string;
  employerId?: string;
  [key: string]: any;
}

interface LedgerEntryWithDetails {
  id: string;
  amount: string;
  date: string;
  statementYmd: string | null;
  memo: string | null;
  eaId: string;
  referenceType: string | null;
  referenceId: string | null;
  referenceName: string | null;
  entityType: string;
  entityId: string;
  entityName: string | null;
  eaAccountId: string;
  eaAccountName: string | null;
  chargePlugin: string | null;
  chargePluginKey: string | null;
  chargePluginConfigId: string | null;
  data?: LedgerEntryData | null;
}

type SortField = "amount" | "date" | "statementYmd" | "entityName" | "memo";
type SortDirection = "asc" | "desc";

interface PaginatedResponse {
  data: LedgerEntryWithDetails[];
  total: number;
  /** Distinct entity types across the whole scope (not just the page). */
  entityTypes?: string[];
}

interface LedgerTransactionsViewProps {
  baseUrl: string;
  title: string;
  csvFilename: string;
  showEntityType?: boolean;
  showEntityName?: boolean;
  showEaAccount?: boolean;
  showEaLink?: boolean;
  currencyCode?: string;
  pageSize?: number;
}

// Helper function to generate reference link based on type and ID
function getReferenceLink(
  referenceType: string | null, 
  referenceId: string | null,
  data?: LedgerEntryData | null
): string | null {
  if (!referenceType || !referenceId) return null;
  
  switch (referenceType) {
    case "employer":
      return `/employers/${referenceId}`;
    case "worker":
      return `/workers/${referenceId}`;
    case "trustProvider":
      return `/trust/provider/${referenceId}`;
    case "payment":
      return `/ledger/payment/${referenceId}`;
    case "hour":
    case "hours":
    case "hour_adjustment":
      // Check if referenceId is a legacy composite key (workerId:employerId:year:month)
      // or the new format (hoursId UUID)
      const isLegacyFormat = referenceId.split(":").length === 4;
      if (isLegacyFormat) {
        // Legacy format - link to the worker's daily hours page
        if (data?.workerId) {
          return `/workers/${data.workerId}/employment/daily`;
        }
        return null;
      }
      // New format - referenceId is the hour entry ID directly
      return `/hours/${referenceId}`;
    default:
      return null;
  }
}

export function LedgerTransactionsView({ 
  baseUrl, 
  title, 
  csvFilename,
  showEntityType = true,
  showEntityName = true,
  showEaAccount = true,
  showEaLink = true,
  currencyCode = "USD",
  pageSize = 50,
}: LedgerTransactionsViewProps) {
  const { toast } = useToast();
  
  // Modal state for viewing transaction details
  const [selectedTransaction, setSelectedTransaction] = useState<LedgerEntryWithDetails | null>(null);
  
  // Pagination state
  const [page, setPage] = useState(0);
  const [limit] = useState(pageSize);
  
  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [filterEntityName, setFilterEntityName] = useState("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterDescription, setFilterDescription] = useState("");

  // Filters are applied SERVER-SIDE across the whole scoped dataset (not just
  // the current page). Text inputs are debounced before hitting the API.
  const [debouncedFilters, setDebouncedFilters] = useState({
    entityType: "all",
    entityName: "",
    memo: "",
    amountMin: "",
    amountMax: "",
    dateFrom: "",
    dateTo: "",
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(prev => {
        const next = {
          entityType: filterEntityType,
          entityName: filterEntityName.trim(),
          memo: filterDescription.trim(),
          amountMin: filterAmountMin.trim(),
          amountMax: filterAmountMax.trim(),
          dateFrom: filterDateFrom,
          dateTo: filterDateTo,
        };
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
        setPage(0); // filtered dataset changed — restart from the first page
        return next;
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [filterEntityType, filterEntityName, filterDescription, filterAmountMin, filterAmountMax, filterDateFrom, filterDateTo]);

  const filterParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedFilters.entityType !== "all") params.set("entityType", debouncedFilters.entityType);
    if (debouncedFilters.entityName) params.set("entityName", debouncedFilters.entityName);
    if (debouncedFilters.memo) params.set("memo", debouncedFilters.memo);
    if (debouncedFilters.amountMin) params.set("amountMin", debouncedFilters.amountMin);
    if (debouncedFilters.amountMax) params.set("amountMax", debouncedFilters.amountMax);
    if (debouncedFilters.dateFrom) params.set("dateFrom", debouncedFilters.dateFrom);
    if (debouncedFilters.dateTo) params.set("dateTo", debouncedFilters.dateTo);
    return params.toString();
  }, [debouncedFilters]);
  
  // Sort state (sorting stays client-side within the current page)
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const offset = page * limit;
  const queryUrl = `${baseUrl}?limit=${limit}&offset=${offset}${filterParams ? `&${filterParams}` : ""}`;

  const { data: response, isLoading } = useQuery<PaginatedResponse>({
    queryKey: [baseUrl, page, limit, filterParams],
    queryFn: async () => {
      const res = await fetch(queryUrl, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch transactions');
      return res.json();
    },
  });

  const transactions = response?.data || [];
  const total = response?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const goToPage = useCallback((newPage: number) => {
    setPage(Math.max(0, Math.min(newPage, totalPages - 1)));
  }, [totalPages]);

  // Calculate total columns for colSpan
  const totalColumns = 7 + // Base columns: Date, Statement, Amount, Memo, Reference Type, Reference, Links
    (showEntityType ? 1 : 0) +
    (showEntityName ? 1 : 0) +
    (showEaAccount ? 1 : 0);

  // Sort transactions (filtering happens server-side; sorting stays
  // client-side within the current page)
  const filteredAndSortedTransactions = useMemo(() => {
    if (!transactions || transactions.length === 0) return [];

    const result = [...transactions];

    // Apply sorting
    result.sort((a, b) => {
      let aValue: number | string | null;
      let bValue: number | string | null;

      // Get values based on sort field
      if (sortField === "amount") {
        aValue = parseFloat(a.amount);
        bValue = parseFloat(b.amount);
      } else if (sortField === "entityName") {
        aValue = a.entityName || "";
        bValue = b.entityName || "";
      } else if (sortField === "memo") {
        aValue = a.memo || "";
        bValue = b.memo || "";
      } else if (sortField === "date") {
        aValue = a.date ? new Date(a.date).getTime() : null;
        bValue = b.date ? new Date(b.date).getTime() : null;
      } else if (sortField === "statementYmd") {
        aValue = a.statementYmd || "";
        bValue = b.statementYmd || "";
      } else {
        return 0;
      }

      // Handle string sorting (entity name, memo)
      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortDirection === "asc" 
          ? aValue.localeCompare(bValue) 
          : bValue.localeCompare(aValue);
      }

      // Handle numeric sorting
      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }

      // Handle null values
      if (aValue !== null && bValue !== null) {
        return sortDirection === "asc" ? (aValue as number) - (bValue as number) : (bValue as number) - (aValue as number);
      }
      
      // Exactly one value is null - put nulls at the end
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      
      return 0;
    });

    return result;
  }, [
    transactions,
    sortField,
    sortDirection,
  ]);

  // Entity type filter options — the server reports the distinct types
  // across the whole scope; fall back to the current page for older routes.
  const entityTypes = useMemo(() => {
    if (response?.entityTypes) return response.entityTypes;
    if (!transactions || transactions.length === 0) return [];
    const types = new Set(transactions.map(t => t.entityType));
    return Array.from(types).sort();
  }, [response?.entityTypes, transactions]);

  // Clear all filters
  const clearFilters = () => {
    setFilterEntityType("all");
    setFilterEntityName("");
    setFilterDescription("");
    setFilterAmountMin("");
    setFilterAmountMax("");
    setFilterDateFrom("");
    setFilterDateTo("");
  };

  // Export to CSV — the server streams the ENTIRE filtered dataset (no row
  // cap), so we navigate to the CSV URL instead of buffering it in memory.
  const exportToCSV = () => {
    const params = new URLSearchParams(filterParams);
    params.set("format", "csv");
    params.set("filename", csvFilename);
    const link = document.createElement("a");
    link.href = `${baseUrl}?${params.toString()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Export started",
      description: "Your download will begin shortly. Large ledgers can take a minute to generate.",
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const formatAmountDisplay = (amount: string) => {
    const num = parseFloat(amount);
    const formattedAbs = formatCurrencyAmount(Math.abs(num), currencyCode);
    return num >= 0 ? formattedAbs : `(${formattedAbs})`;
  };

  const hasActiveFilters = 
    filterEntityType !== "all" ||
    filterEntityName !== "" ||
    filterDescription !== "" ||
    filterAmountMin !== "" ||
    filterAmountMax !== "" ||
    filterDateFrom !== "" ||
    filterDateTo !== "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              {total > 0 ? (
                <>
                  Showing {offset + 1}-{Math.min(offset + transactions.length, total)} of {total.toLocaleString()} transactions
                  {hasActiveFilters && <> (filtered)</>}
                </>
              ) : hasActiveFilters ? (
                "No transactions match your filters"
              ) : (
                "No transactions found"
              )}
            </CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              data-testid="button-toggle-filters"
            >
              <Filter size={16} className="mr-2" />
              {showFilters ? "Hide" : "Show"} Filters
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportToCSV}
              disabled={total === 0}
              data-testid="button-export-csv"
            >
              <Download size={16} className="mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 p-4 bg-muted rounded-lg space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Filters</h4>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  data-testid="button-clear-filters"
                >
                  <X size={16} className="mr-2" />
                  Clear All
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Entity Type Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Entity Type</label>
                <Select value={filterEntityType} onValueChange={setFilterEntityType}>
                  <SelectTrigger data-testid="select-filter-entity-type">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {entityTypes.map(type => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Entity Name Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Entity Name</label>
                <Input
                  placeholder="Search entity name..."
                  value={filterEntityName}
                  onChange={(e) => setFilterEntityName(e.target.value)}
                  data-testid="input-filter-entity-name"
                />
              </div>

              {/* Memo Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Memo</label>
                <Input
                  placeholder="Search memo..."
                  value={filterDescription}
                  onChange={(e) => setFilterDescription(e.target.value)}
                  data-testid="input-filter-memo"
                />
              </div>

              {/* Amount Min Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Min Amount</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={filterAmountMin}
                  onChange={(e) => setFilterAmountMin(e.target.value)}
                  data-testid="input-filter-amount-min"
                />
              </div>

              {/* Amount Max Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Max Amount</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={filterAmountMax}
                  onChange={(e) => setFilterAmountMax(e.target.value)}
                  data-testid="input-filter-amount-max"
                />
              </div>

              {/* Date From Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Date From</label>
                <Input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  data-testid="input-filter-date-from"
                />
              </div>

              {/* Date To Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Date To</label>
                <Input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  data-testid="input-filter-date-to"
                />
              </div>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("date")}
                    data-testid="button-sort-date"
                  >
                    Date
                    <ArrowUpDown size={16} className="ml-2" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("statementYmd")}
                    data-testid="button-sort-statement"
                  >
                    Statement
                    <ArrowUpDown size={16} className="ml-2" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("amount")}
                    data-testid="button-sort-amount"
                  >
                    Amount
                    <ArrowUpDown size={16} className="ml-2" />
                  </Button>
                </TableHead>
                {showEntityType && <TableHead>Entity Type</TableHead>}
                {showEntityName && (
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSort("entityName")}
                      data-testid="button-sort-entity-name"
                    >
                      Entity Name
                      <ArrowUpDown size={16} className="ml-2" />
                    </Button>
                  </TableHead>
                )}
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort("memo")}
                    data-testid="button-sort-memo"
                  >
                    Memo
                    <ArrowUpDown size={16} className="ml-2" />
                  </Button>
                </TableHead>
                <TableHead>Reference Type</TableHead>
                <TableHead>Reference</TableHead>
                {showEaAccount && <TableHead>Account</TableHead>}
                <TableHead>Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={totalColumns} className="text-center py-8 text-muted-foreground">
                    Loading transactions...
                  </TableCell>
                </TableRow>
              ) : filteredAndSortedTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={totalColumns} className="text-center py-8 text-muted-foreground">
                    {hasActiveFilters ? "No transactions match your filters" : "No transactions found"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedTransactions.map((transaction) => (
                  <TableRow key={transaction.id} data-testid={`row-transaction-${transaction.id}`}>
                    <TableCell data-testid={`cell-date-${transaction.id}`}>
                      {transaction.date ? new Date(transaction.date).toLocaleDateString() : ""}
                    </TableCell>
                    <TableCell data-testid={`cell-statement-${transaction.id}`}>
                      {transaction.statementYmd ? transaction.statementYmd.slice(0, 7) : "—"}
                    </TableCell>
                    <TableCell 
                      className={parseFloat(transaction.amount) < 0 ? "text-red-600 dark:text-red-400" : ""}
                      data-testid={`cell-amount-${transaction.id}`}
                    >
                      {formatAmountDisplay(transaction.amount)}
                    </TableCell>
                    {showEntityType && (
                      <TableCell data-testid={`cell-entity-type-${transaction.id}`}>
                        {transaction.entityType}
                      </TableCell>
                    )}
                    {showEntityName && (
                      <TableCell data-testid={`cell-entity-name-${transaction.id}`}>
                        {transaction.entityName || "—"}
                      </TableCell>
                    )}
                    <TableCell data-testid={`cell-memo-${transaction.id}`}>
                      {transaction.memo || "—"}
                    </TableCell>
                    <TableCell data-testid={`cell-reference-type-${transaction.id}`}>
                      {transaction.referenceType || "—"}
                    </TableCell>
                    <TableCell data-testid={`cell-reference-${transaction.id}`}>
                      {transaction.referenceName || "—"}
                    </TableCell>
                    {showEaAccount && (
                      <TableCell data-testid={`cell-ea-account-${transaction.id}`}>
                        {transaction.eaAccountName || "—"}
                      </TableCell>
                    )}
                    <TableCell data-testid={`cell-links-${transaction.id}`}>
                      <div className="flex gap-2 items-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          title="View transaction details"
                          onClick={() => setSelectedTransaction(transaction)}
                          data-testid={`button-view-transaction-${transaction.id}`}
                        >
                          <Eye size={14} className="mr-1" />
                          View
                        </Button>
                        {(() => {
                          const refLink = getReferenceLink(transaction.referenceType, transaction.referenceId, transaction.data);
                          return refLink ? (
                            <Link href={refLink}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                title={`View ${transaction.referenceType || 'reference'}`}
                                data-testid={`button-link-reference-${transaction.id}`}
                              >
                                Ref
                              </Button>
                            </Link>
                          ) : null;
                        })()}
                        {showEaLink && (
                          <Link href={`/ea/${transaction.eaId}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              title="View EA record"
                              data-testid={`button-link-ea-${transaction.id}`}
                            >
                              Acct
                            </Button>
                          </Link>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t mt-4">
            <div className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages.toLocaleString()}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => goToPage(0)}
                disabled={page === 0 || isLoading}
                data-testid="button-first-page"
              >
                <ChevronsLeft size={16} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => goToPage(page - 1)}
                disabled={page === 0 || isLoading}
                data-testid="button-prev-page"
              >
                <ChevronLeft size={16} />
              </Button>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={page + 1}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val)) goToPage(val - 1);
                  }}
                  className="w-16 h-9 text-center"
                  data-testid="input-page-number"
                />
                <span className="text-sm text-muted-foreground">of {totalPages.toLocaleString()}</span>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages - 1 || isLoading}
                data-testid="button-next-page"
              >
                <ChevronRight size={16} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => goToPage(totalPages - 1)}
                disabled={page >= totalPages - 1 || isLoading}
                data-testid="button-last-page"
              >
                <ChevronsRight size={16} />
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={!!selectedTransaction} onOpenChange={(open) => !open && setSelectedTransaction(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
            <DialogDescription>
              Complete information for this ledger transaction
            </DialogDescription>
          </DialogHeader>
          
          {selectedTransaction && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Transaction ID</label>
                  <p className="mt-1 font-mono text-sm break-all" data-testid="modal-transaction-id">
                    {selectedTransaction.id}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Date</label>
                  <p className="mt-1" data-testid="modal-transaction-date">
                    {selectedTransaction.date 
                      ? new Date(selectedTransaction.date).toLocaleDateString() 
                      : "—"}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Statement Month</label>
                  <p className="mt-1" data-testid="modal-transaction-statement">
                    {selectedTransaction.statementYmd ? selectedTransaction.statementYmd.slice(0, 7) : "—"}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Amount</label>
                  <p 
                    className={`mt-1 font-semibold ${parseFloat(selectedTransaction.amount) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                    data-testid="modal-transaction-amount"
                  >
                    {formatAmountDisplay(selectedTransaction.amount)}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Entity Type</label>
                  <p className="mt-1" data-testid="modal-transaction-entity-type">
                    {selectedTransaction.entityType}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Entity Name</label>
                  <p className="mt-1" data-testid="modal-transaction-entity-name">
                    {selectedTransaction.entityName || "—"}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Entity ID</label>
                  <p className="mt-1 font-mono text-sm break-all" data-testid="modal-transaction-entity-id">
                    {selectedTransaction.entityId}
                  </p>
                </div>
                
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-muted-foreground">Memo</label>
                  <p className="mt-1" data-testid="modal-transaction-memo">
                    {selectedTransaction.memo || "—"}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Reference Type</label>
                  <p className="mt-1" data-testid="modal-transaction-reference-type">
                    {selectedTransaction.referenceType || "—"}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Reference ID</label>
                  <p className="mt-1 font-mono text-sm break-all" data-testid="modal-transaction-reference-id">
                    {selectedTransaction.referenceId || "—"}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Reference Name</label>
                  <p className="mt-1" data-testid="modal-transaction-reference-name">
                    {selectedTransaction.referenceName || "—"}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">EA ID</label>
                  <p className="mt-1 font-mono text-sm break-all" data-testid="modal-transaction-ea-id">
                    {selectedTransaction.eaId}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Account Name</label>
                  <p className="mt-1" data-testid="modal-transaction-account-name">
                    {selectedTransaction.eaAccountName || "—"}
                  </p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Account ID</label>
                  <p className="mt-1 font-mono text-sm break-all" data-testid="modal-transaction-account-id">
                    {selectedTransaction.eaAccountId}
                  </p>
                </div>
              </div>
              
              {selectedTransaction.chargePlugin && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-3">Charge Plugin Details</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Plugin Type</label>
                      <p className="mt-1 font-mono text-sm" data-testid="modal-transaction-charge-plugin">
                        {selectedTransaction.chargePlugin}
                      </p>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Configuration ID</label>
                      <p className="mt-1 font-mono text-sm break-all" data-testid="modal-transaction-charge-plugin-config-id">
                        {selectedTransaction.chargePluginConfigId || "—"}
                      </p>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Plugin Key</label>
                      <p className="mt-1 font-mono text-sm break-all" data-testid="modal-transaction-charge-plugin-key">
                        {selectedTransaction.chargePluginKey || "—"}
                      </p>
                    </div>
                    
                    {selectedTransaction.chargePluginConfigId && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Configuration</label>
                        <div className="mt-1">
                          <Link href={`/config/ledger/charge-plugins/${selectedTransaction.chargePlugin}/edit/${selectedTransaction.chargePluginConfigId}`}>
                            <Button 
                              variant="outline" 
                              size="sm"
                              data-testid="modal-button-view-charge-plugin-config"
                            >
                              View Configuration
                            </Button>
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedTransaction.data && Object.keys(selectedTransaction.data).length > 0 && (
                <div className="border-t pt-4">
                  <label className="text-sm font-medium text-muted-foreground">Additional Data</label>
                  <div className="mt-2 p-3 bg-muted rounded-md">
                    <pre className="text-sm overflow-x-auto whitespace-pre-wrap break-all" data-testid="modal-transaction-data">
                      {JSON.stringify(selectedTransaction.data, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
              
              <div className="flex justify-end gap-2 pt-4 border-t">
                {(() => {
                  const refLink = getReferenceLink(
                    selectedTransaction.referenceType, 
                    selectedTransaction.referenceId, 
                    selectedTransaction.data
                  );
                  return refLink ? (
                    <Link href={refLink}>
                      <Button variant="outline" data-testid="modal-button-view-reference">
                        View Reference
                      </Button>
                    </Link>
                  ) : null;
                })()}
                <Link href={`/ea/${selectedTransaction.eaId}`}>
                  <Button variant="outline" data-testid="modal-button-view-ea">
                    View Account
                  </Button>
                </Link>
                <Button onClick={() => setSelectedTransaction(null)} data-testid="modal-button-close">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
