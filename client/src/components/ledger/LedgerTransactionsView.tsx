import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { Download, ArrowUpDown, Filter, X } from "lucide-react";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { stringify } from "csv-stringify/browser/esm/sync";
import { Link } from "wouter";

interface LedgerEntryData {
  workerId?: string;
  employerId?: string;
  [key: string]: any;
}

interface LedgerEntryWithDetails {
  id: string;
  amount: string;
  date: string;
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
  data?: LedgerEntryData | null;
}

type SortField = "amount" | "date" | "entityName" | "memo";
type SortDirection = "asc" | "desc";

interface LedgerTransactionsViewProps {
  queryKey: string[];
  title: string;
  csvFilename: string;
  showEntityType?: boolean;
  showEntityName?: boolean;
  showEaAccount?: boolean;
  showEaLink?: boolean;
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
      // For hour entries, we need the workerId from the data field
      // referenceId is the hour entry ID
      if (data?.workerId) {
        // Check if referenceId is a legacy composite key (workerId:employerId:year:month)
        // or the new format (hoursId UUID)
        const isLegacyFormat = referenceId.split(":").length === 4;
        if (isLegacyFormat) {
          // Legacy format - link to the worker's daily hours page
          return `/workers/${data.workerId}/employment/daily`;
        }
        // New format - referenceId is the hour entry ID directly
        return `/workers/${data.workerId}/hours/${referenceId}`;
      }
      return null;
    default:
      return null;
  }
}

export function LedgerTransactionsView({ 
  queryKey, 
  title, 
  csvFilename,
  showEntityType = true,
  showEntityName = true,
  showEaAccount = true,
  showEaLink = true,
}: LedgerTransactionsViewProps) {
  const { toast } = useToast();
  
  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [filterEntityName, setFilterEntityName] = useState("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterDescription, setFilterDescription] = useState("");
  
  // Sort state
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const { data: transactions, isLoading } = useQuery<LedgerEntryWithDetails[]>({
    queryKey,
  });

  // Calculate total columns for colSpan
  const totalColumns = 6 + // Base columns: Date, Amount, Memo, Reference Type, Reference, Links
    (showEntityType ? 1 : 0) +
    (showEntityName ? 1 : 0) +
    (showEaAccount ? 1 : 0);

  // Filter and sort transactions
  const filteredAndSortedTransactions = useMemo(() => {
    if (!transactions) return [];

    let result = [...transactions];

    // Apply filters
    if (filterEntityType !== "all") {
      result = result.filter(t => t.entityType === filterEntityType);
    }

    if (filterEntityName) {
      result = result.filter(t => {
        return t.entityName?.toLowerCase().includes(filterEntityName.toLowerCase());
      });
    }

    if (filterDescription) {
      result = result.filter(t => {
        return t.memo?.toLowerCase().includes(filterDescription.toLowerCase());
      });
    }

    if (filterAmountMin) {
      const min = parseFloat(filterAmountMin);
      result = result.filter(t => parseFloat(t.amount) >= min);
    }

    if (filterAmountMax) {
      const max = parseFloat(filterAmountMax);
      result = result.filter(t => parseFloat(t.amount) <= max);
    }

    // Date filters
    if (filterDateFrom) {
      const from = new Date(filterDateFrom);
      result = result.filter(t => t.date && new Date(t.date) >= from);
    }

    if (filterDateTo) {
      const to = new Date(filterDateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(t => t.date && new Date(t.date) <= to);
    }

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
    filterEntityType,
    filterEntityName,
    filterDescription,
    filterAmountMin,
    filterAmountMax,
    filterDateFrom,
    filterDateTo,
    sortField,
    sortDirection,
  ]);

  // Get unique entity types
  const entityTypes = useMemo(() => {
    if (!transactions) return [];
    const types = new Set(transactions.map(t => t.entityType));
    return Array.from(types).sort();
  }, [transactions]);

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

  // Export to CSV
  const exportToCSV = () => {
    const dataToExport = filteredAndSortedTransactions;
    if (!dataToExport.length) {
      toast({
        title: "No data to export",
        description: "There are no transactions to export.",
        variant: "destructive",
      });
      return;
    }

    const csvData = dataToExport.map(transaction => ({
      Date: transaction.date ? new Date(transaction.date).toLocaleDateString() : "",
      Amount: parseFloat(transaction.amount).toFixed(2),
      "Entity Type": transaction.entityType,
      "Entity Name": transaction.entityName || "",
      Memo: transaction.memo || "",
      "Reference Type": transaction.referenceType || "",
      "Reference": transaction.referenceName || "",
      "EA Account": transaction.eaAccountName || "",
      "Transaction ID": transaction.id,
    }));

    const csv = stringify(csvData, {
      header: true,
      columns: [
        "Date",
        "Amount",
        "Entity Type",
        "Entity Name",
        "Memo",
        "Reference Type",
        "Reference",
        "EA Account",
        "Transaction ID",
      ],
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${csvFilename}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Export successful",
      description: `Exported ${dataToExport.length} filtered transaction(s) to CSV.`,
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

  const formatAmount = (amount: string) => {
    const num = parseFloat(amount);
    const formatted = Math.abs(num).toFixed(2);
    return num >= 0 ? `$${formatted}` : `($${formatted})`;
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
              {transactions && transactions.length > 0 ? (
                <>
                  {filteredAndSortedTransactions.length !== transactions.length ? (
                    <>Showing {filteredAndSortedTransactions.length} of {transactions.length} transactions (filtered)</>
                  ) : (
                    <>Showing {transactions.length} transactions</>
                  )}
                </>
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
              disabled={!transactions || transactions.length === 0}
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
                    <TableCell 
                      className={parseFloat(transaction.amount) < 0 ? "text-red-600 dark:text-red-400" : ""}
                      data-testid={`cell-amount-${transaction.id}`}
                    >
                      {formatAmount(transaction.amount)}
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
      </CardContent>
    </Card>
  );
}
