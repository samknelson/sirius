import { EALayout, useEALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLedgerPaymentSchema, type LedgerPayment, type LedgerPaymentType } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, DollarSign, Download, ArrowUpDown, Filter, X, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useState, useMemo, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { z } from "zod";
import { stringify } from "csv-stringify/browser/esm/sync";
import { formatAmount } from "@shared/currency";

const paymentStatuses = ["draft", "canceled", "cleared", "error"] as const;

type SortField = "amount" | "dateCreated" | "dateReceived" | "dateCleared";
type SortDirection = "asc" | "desc";
type PaymentCategory = "financial" | "adjustment";

interface LedgerNotification {
  type: "created" | "updated" | "deleted";
  amount: string;
  description: string;
}

function EAPaymentsContent() {
  const { id } = useParams<{ id: string }>();
  const { currencyCode } = useEALayout();
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [merchant, setMerchant] = useState("");
  const [checkTransactionNumber, setCheckTransactionNumber] = useState("");
  const [adjustmentUser, setAdjustmentUser] = useState("");
  const [dateEntered, setDateEntered] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const { toast } = useToast();
  
  const getTodayString = () => new Date().toISOString().split('T')[0];
  const getEffectiveUserName = () => {
    if (!user) return "";
    const parts = [user.firstName, user.lastName].filter(Boolean);
    return parts.join(" ") || user.email || "";
  };
  
  const showLedgerNotifications = (notifications: LedgerNotification[] | undefined) => {
    if (!notifications || notifications.length === 0) return;
    
    for (const notification of notifications) {
      const typeLabel = notification.type === "created" ? "Ledger Entry Created" :
                        notification.type === "updated" ? "Ledger Entry Updated" :
                        "Ledger Entry Deleted";
      
      toast({
        title: typeLabel,
        description: `${formatAmount(parseFloat(notification.amount), currencyCode)} - ${notification.description}`,
      });
    }
  };
  
  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterPaymentType, setFilterPaymentType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterMerchant, setFilterMerchant] = useState("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [filterDateCreatedFrom, setFilterDateCreatedFrom] = useState("");
  const [filterDateCreatedTo, setFilterDateCreatedTo] = useState("");
  const [filterDateReceivedFrom, setFilterDateReceivedFrom] = useState("");
  const [filterDateReceivedTo, setFilterDateReceivedTo] = useState("");
  const [filterDateClearedFrom, setFilterDateClearedFrom] = useState("");
  const [filterDateClearedTo, setFilterDateClearedTo] = useState("");
  
  // Sort state
  const [sortField, setSortField] = useState<SortField>("dateCleared");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const { data: payments, isLoading } = useQuery<LedgerPayment[]>({
    queryKey: ["/api/ledger/payments/ea", id],
  });

  const { data: paymentTypes = [] } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

  const form = useForm<z.infer<typeof insertLedgerPaymentSchema>>({
    resolver: zodResolver(insertLedgerPaymentSchema),
    defaultValues: {
      status: "draft",
      allocated: false,
      amount: "0.00",
      paymentType: paymentTypes[0]?.id || "",
      ledgerEaId: id,
      details: null,
      dateReceived: null,
      dateCleared: null,
      memo: null,
    },
  });

  const watchedPaymentType = form.watch("paymentType");
  const selectedPaymentType = paymentTypes.find(pt => pt.id === watchedPaymentType);
  const category: PaymentCategory = (selectedPaymentType?.category as PaymentCategory) || "financial";

  useEffect(() => {
    if (dialogOpen && category === "adjustment") {
      if (!adjustmentUser) {
        setAdjustmentUser(getEffectiveUserName());
      }
      if (!dateEntered) {
        setDateEntered(getTodayString());
      }
      if (!effectiveDate) {
        setEffectiveDate(getTodayString());
      }
    }
  }, [dialogOpen, category, user]);

  const createPaymentMutation = useMutation({
    mutationFn: async (data: z.infer<typeof insertLedgerPaymentSchema>) => {
      return await apiRequest("POST", "/api/ledger/payments", data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/payments/ea", id] });
      setDialogOpen(false);
      setMerchant("");
      setCheckTransactionNumber("");
      setAdjustmentUser("");
      setDateEntered("");
      setEffectiveDate("");
      form.reset({
        status: "draft",
        allocated: false,
        amount: "0.00",
        paymentType: paymentTypes[0]?.id || "",
        ledgerEaId: id,
        details: null,
        dateReceived: null,
        dateCleared: null,
        memo: null,
      });
      toast({
        title: "Payment created",
        description: "The payment has been created successfully.",
      });
      showLedgerNotifications(data?.ledgerNotifications);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create payment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    const existingDetails = (data.details || {}) as Record<string, any>;
    const details: any = { ...existingDetails };
    
    if (category === "financial") {
      if (merchant) {
        details.merchant = merchant;
      } else {
        delete details.merchant;
      }
      
      if (checkTransactionNumber) {
        details.checkTransactionNumber = checkTransactionNumber;
      } else {
        delete details.checkTransactionNumber;
      }
      delete details.adjustmentUser;
      delete details.dateEntered;
      delete details.effectiveDate;
    } else {
      if (adjustmentUser) {
        details.adjustmentUser = adjustmentUser;
      } else {
        delete details.adjustmentUser;
      }
      
      if (dateEntered) {
        details.dateEntered = dateEntered;
      } else {
        delete details.dateEntered;
      }
      
      if (effectiveDate) {
        details.effectiveDate = effectiveDate;
      } else {
        delete details.effectiveDate;
      }
      delete details.merchant;
      delete details.checkTransactionNumber;
    }
    
    const submissionData = {
      ...data,
      details: Object.keys(details).length > 0 ? details : null,
      status: category === "adjustment" ? "cleared" as const : data.status,
    };
    
    createPaymentMutation.mutate(submissionData);
  });

  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "cleared":
        return "default";
      case "draft":
        return "secondary";
      case "canceled":
        return "outline";
      case "error":
        return "destructive";
      default:
        return "secondary";
    }
  };

  // Filter and sort payments
  const filteredAndSortedPayments = useMemo(() => {
    if (!payments) return [];

    let result = [...payments];

    // Apply filters
    if (filterPaymentType !== "all") {
      result = result.filter(p => p.paymentType === filterPaymentType);
    }

    if (filterStatus !== "all") {
      result = result.filter(p => p.status === filterStatus);
    }

    if (filterMerchant) {
      result = result.filter(p => {
        const details = p.details as any;
        return details?.merchant?.toLowerCase().includes(filterMerchant.toLowerCase());
      });
    }

    if (filterAmountMin) {
      const min = parseFloat(filterAmountMin);
      result = result.filter(p => parseFloat(p.amount) >= min);
    }

    if (filterAmountMax) {
      const max = parseFloat(filterAmountMax);
      result = result.filter(p => parseFloat(p.amount) <= max);
    }

    // Date filters
    if (filterDateCreatedFrom) {
      const from = new Date(filterDateCreatedFrom);
      result = result.filter(p => p.dateCreated && new Date(p.dateCreated) >= from);
    }

    if (filterDateCreatedTo) {
      const to = new Date(filterDateCreatedTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(p => p.dateCreated && new Date(p.dateCreated) <= to);
    }

    if (filterDateReceivedFrom) {
      const from = new Date(filterDateReceivedFrom);
      result = result.filter(p => p.dateReceived && new Date(p.dateReceived) >= from);
    }

    if (filterDateReceivedTo) {
      const to = new Date(filterDateReceivedTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(p => p.dateReceived && new Date(p.dateReceived) <= to);
    }

    if (filterDateClearedFrom) {
      const from = new Date(filterDateClearedFrom);
      result = result.filter(p => p.dateCleared && new Date(p.dateCleared) >= from);
    }

    if (filterDateClearedTo) {
      const to = new Date(filterDateClearedTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(p => p.dateCleared && new Date(p.dateCleared) <= to);
    }

    // Apply sorting
    result.sort((a, b) => {
      let aValue: number | null;
      let bValue: number | null;

      // Get values based on sort field
      if (sortField === "amount") {
        aValue = parseFloat(a.amount);
        bValue = parseFloat(b.amount);
      } else if (sortField === "dateCreated") {
        aValue = a.dateCreated ? new Date(a.dateCreated).getTime() : null;
        bValue = b.dateCreated ? new Date(b.dateCreated).getTime() : null;
      } else if (sortField === "dateReceived") {
        aValue = a.dateReceived ? new Date(a.dateReceived).getTime() : null;
        bValue = b.dateReceived ? new Date(b.dateReceived).getTime() : null;
      } else if (sortField === "dateCleared") {
        aValue = a.dateCleared ? new Date(a.dateCleared).getTime() : null;
        bValue = b.dateCleared ? new Date(b.dateCleared).getTime() : null;
      } else {
        return 0;
      }

      // Handle null values
      if (aValue !== null && bValue !== null) {
        // Both values are non-null, sort based on direction
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }
      
      // One or both values are null
      if (aValue === null && bValue === null) {
        // If both are null, fall back to multi-level date sorting for dateCleared
        if (sortField === "dateCleared") {
          const aReceivedTime = a.dateReceived ? new Date(a.dateReceived).getTime() : null;
          const bReceivedTime = b.dateReceived ? new Date(b.dateReceived).getTime() : null;
          
          if (aReceivedTime !== null && bReceivedTime !== null) {
            return sortDirection === "asc" ? aReceivedTime - bReceivedTime : bReceivedTime - aReceivedTime;
          }
          if (aReceivedTime === null && bReceivedTime === null) {
            const aCreatedTime = a.dateCreated ? new Date(a.dateCreated).getTime() : null;
            const bCreatedTime = b.dateCreated ? new Date(b.dateCreated).getTime() : null;
            
            if (aCreatedTime !== null && bCreatedTime !== null) {
              return sortDirection === "asc" ? aCreatedTime - bCreatedTime : bCreatedTime - aCreatedTime;
            }
            if (aCreatedTime === null && bCreatedTime === null) {
              return 0; // Both have no dates at all
            }
            if (aCreatedTime === null) return 1;
            if (bCreatedTime === null) return -1;
          }
          if (aReceivedTime === null) return 1;
          if (bReceivedTime === null) return -1;
        }
        return 0;
      }
      
      // Exactly one value is null - put nulls at the end
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      
      return 0;
    });

    return result;
  }, [
    payments,
    filterPaymentType,
    filterStatus,
    filterMerchant,
    filterAmountMin,
    filterAmountMax,
    filterDateCreatedFrom,
    filterDateCreatedTo,
    filterDateReceivedFrom,
    filterDateReceivedTo,
    filterDateClearedFrom,
    filterDateClearedTo,
    sortField,
    sortDirection,
  ]);

  // Clear all filters
  const clearFilters = () => {
    setFilterPaymentType("all");
    setFilterStatus("all");
    setFilterMerchant("");
    setFilterAmountMin("");
    setFilterAmountMax("");
    setFilterDateCreatedFrom("");
    setFilterDateCreatedTo("");
    setFilterDateReceivedFrom("");
    setFilterDateReceivedTo("");
    setFilterDateClearedFrom("");
    setFilterDateClearedTo("");
  };

  // Export to CSV
  const exportToCSV = () => {
    if (!filteredAndSortedPayments.length) {
      toast({
        title: "No data to export",
        description: "There are no payments to export.",
        variant: "destructive",
      });
      return;
    }

    const csvData = filteredAndSortedPayments.map(payment => {
      const paymentType = paymentTypes.find(t => t.id === payment.paymentType);
      const details = payment.details as any;
      
      return {
        Amount: formatAmount(parseFloat(payment.amount), currencyCode),
        "Payment Type": paymentType?.name || "",
        Status: payment.status,
        Merchant: details?.merchant || "",
        "Check/Transaction Number": details?.checkTransactionNumber || "",
        "Date Created": payment.dateCreated ? new Date(payment.dateCreated).toLocaleDateString() : "",
        "Date Received": payment.dateReceived ? new Date(payment.dateReceived).toLocaleDateString() : "",
        "Date Cleared": payment.dateCleared ? new Date(payment.dateCleared).toLocaleDateString() : "",
        Allocated: payment.allocated ? "Yes" : "No",
        Memo: payment.memo || "",
      };
    });

    const csv = stringify(csvData, {
      header: true,
      columns: [
        "Amount",
        "Payment Type",
        "Status",
        "Merchant",
        "Check/Transaction Number",
        "Date Created",
        "Date Received",
        "Date Cleared",
        "Allocated",
        "Memo",
      ],
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `payments-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Export successful",
      description: `Exported ${filteredAndSortedPayments.length} payment(s) to CSV.`,
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

  const openDialogWithPaymentType = (paymentTypeId: string) => {
    form.setValue("paymentType", paymentTypeId);
    setDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Payments</CardTitle>
            <CardDescription>
              Manage payments for this account entry
              {filteredAndSortedPayments.length !== payments?.length && (
                <span className="ml-2 text-sm">
                  ({filteredAndSortedPayments.length} of {payments?.length || 0} shown)
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              data-testid="button-toggle-filters"
            >
              <Filter className="h-4 w-4 mr-2" />
              {showFilters ? "Hide Filters" : "Show Filters"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportToCSV}
              disabled={!filteredAndSortedPayments.length}
              data-testid="button-export-csv"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button data-testid="button-add-payment">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Payment
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {paymentTypes.map((type) => (
                  <DropdownMenuItem
                    key={type.id}
                    onClick={() => openDialogWithPaymentType(type.id)}
                    data-testid={`menu-item-${type.id}`}
                  >
                    {type.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add {selectedPaymentType?.name || "Payment"}</DialogTitle>
                <DialogDescription>
                  Create a new {selectedPaymentType?.name?.toLowerCase() || "payment"} record for this account entry
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={onSubmit} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            data-testid="input-amount"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {category === "financial" ? (
                    <>
                      <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Status</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-payment-status">
                                  <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {paymentStatuses.map((status) => (
                                  <SelectItem key={status} value={status} data-testid={`option-${status}`}>
                                    {status.charAt(0).toUpperCase() + status.slice(1)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="dateReceived"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Date Received</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                data-testid="input-date-received"
                                value={field.value ? new Date(field.value).toISOString().split('T')[0] : ''}
                                onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div>
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          Merchant
                        </label>
                        <Input
                          placeholder="Enter merchant name..."
                          data-testid="input-merchant"
                          value={merchant}
                          onChange={(e) => setMerchant(e.target.value)}
                          className="mt-2"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          Check or Transaction Number
                        </label>
                        <Input
                          placeholder="Enter check or transaction number..."
                          data-testid="input-check-transaction-number"
                          value={checkTransactionNumber}
                          onChange={(e) => setCheckTransactionNumber(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="p-3 bg-muted rounded-md">
                        <p className="text-sm text-muted-foreground">
                          Status: <span className="font-medium text-foreground">Cleared</span> (adjustments are always cleared)
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          User Executing Adjustment
                        </label>
                        <Input
                          placeholder="Enter user name..."
                          data-testid="input-adjustment-user"
                          value={adjustmentUser}
                          onChange={(e) => setAdjustmentUser(e.target.value)}
                          className="mt-2"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          Date Entered
                        </label>
                        <Input
                          type="date"
                          data-testid="input-date-entered"
                          value={dateEntered}
                          onChange={(e) => setDateEntered(e.target.value)}
                          className="mt-2"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          Effective Date
                        </label>
                        <Input
                          type="date"
                          data-testid="input-effective-date"
                          value={effectiveDate}
                          onChange={(e) => setEffectiveDate(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                    </>
                  )}

                  <FormField
                    control={form.control}
                    name="memo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Memo</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Add notes or description for this payment..."
                            data-testid="input-memo"
                            value={field.value || ''}
                            onChange={field.onChange}
                            rows={3}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDialogOpen(false)}
                      data-testid="button-cancel"
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createPaymentMutation.isPending} data-testid="button-submit">
                      {createPaymentMutation.isPending ? "Creating..." : "Create Payment"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {showFilters && (
          <div className="mb-6 p-4 border rounded-lg bg-muted/50 space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Filters</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                data-testid="button-clear-filters"
              >
                <X className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Payment Type</label>
                <Select value={filterPaymentType} onValueChange={setFilterPaymentType}>
                  <SelectTrigger data-testid="filter-payment-type">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {paymentTypes.map(type => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Status</label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger data-testid="filter-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {paymentStatuses.map(status => (
                      <SelectItem key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Merchant</label>
                <Input
                  placeholder="Search merchant..."
                  value={filterMerchant}
                  onChange={e => setFilterMerchant(e.target.value)}
                  data-testid="filter-merchant"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Amount Min</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Min amount"
                  value={filterAmountMin}
                  onChange={e => setFilterAmountMin(e.target.value)}
                  data-testid="filter-amount-min"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Amount Max</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Max amount"
                  value={filterAmountMax}
                  onChange={e => setFilterAmountMax(e.target.value)}
                  data-testid="filter-amount-max"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Date Created From</label>
                <Input
                  type="date"
                  value={filterDateCreatedFrom}
                  onChange={e => setFilterDateCreatedFrom(e.target.value)}
                  data-testid="filter-date-created-from"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Date Created To</label>
                <Input
                  type="date"
                  value={filterDateCreatedTo}
                  onChange={e => setFilterDateCreatedTo(e.target.value)}
                  data-testid="filter-date-created-to"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Date Received From</label>
                <Input
                  type="date"
                  value={filterDateReceivedFrom}
                  onChange={e => setFilterDateReceivedFrom(e.target.value)}
                  data-testid="filter-date-received-from"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Date Received To</label>
                <Input
                  type="date"
                  value={filterDateReceivedTo}
                  onChange={e => setFilterDateReceivedTo(e.target.value)}
                  data-testid="filter-date-received-to"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Date Cleared From</label>
                <Input
                  type="date"
                  value={filterDateClearedFrom}
                  onChange={e => setFilterDateClearedFrom(e.target.value)}
                  data-testid="filter-date-cleared-from"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Date Cleared To</label>
                <Input
                  type="date"
                  value={filterDateClearedTo}
                  onChange={e => setFilterDateClearedTo(e.target.value)}
                  data-testid="filter-date-cleared-to"
                />
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8">
            <p className="text-muted-foreground">Loading payments...</p>
          </div>
        ) : !filteredAndSortedPayments || filteredAndSortedPayments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <DollarSign className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground" data-testid="text-no-payments">
              No payments found for this account entry
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Click the button above to add an offline payment or adjustment
            </p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3 h-8"
                      onClick={() => handleSort("amount")}
                      data-testid="sort-amount"
                    >
                      Amount
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>Payment Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3 h-8"
                      onClick={() => handleSort("dateCreated")}
                      data-testid="sort-date-created"
                    >
                      Date Created
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3 h-8"
                      onClick={() => handleSort("dateReceived")}
                      data-testid="sort-date-received"
                    >
                      Date Received
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3 h-8"
                      onClick={() => handleSort("dateCleared")}
                      data-testid="sort-date-cleared"
                    >
                      Date Cleared
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAndSortedPayments.map((payment) => {
                  const paymentType = paymentTypes.find(t => t.id === payment.paymentType);
                  const details = payment.details as any;
                  return (
                    <TableRow key={payment.id} data-testid={`row-payment-${payment.id}`}>
                      <TableCell className="font-mono" data-testid={`text-amount-${payment.id}`}>
                        {formatAmount(parseFloat(payment.amount), currencyCode)}
                      </TableCell>
                      <TableCell data-testid={`text-payment-type-${payment.id}`}>
                        {paymentType?.name || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(payment.status)} data-testid={`badge-status-${payment.id}`}>
                          {payment.status}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-merchant-${payment.id}`}>
                        {details?.merchant || "-"}
                      </TableCell>
                      <TableCell data-testid={`text-date-created-${payment.id}`}>
                        {payment.dateCreated ? new Date(payment.dateCreated).toLocaleDateString() : "-"}
                      </TableCell>
                      <TableCell data-testid={`text-date-received-${payment.id}`}>
                        {payment.dateReceived ? new Date(payment.dateReceived).toLocaleDateString() : "-"}
                      </TableCell>
                      <TableCell data-testid={`text-date-cleared-${payment.id}`}>
                        {payment.dateCleared ? new Date(payment.dateCleared).toLocaleDateString() : "-"}
                      </TableCell>
                      <TableCell>
                        <Link 
                          href={`/ledger/payment/${payment.id}`}
                          className="text-primary hover:underline"
                          data-testid={`link-view-${payment.id}`}
                        >
                          View
                        </Link>
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
  );
}

export default function EAPayments() {
  return (
    <EALayout activeTab="payments">
      <EAPaymentsContent />
    </EALayout>
  );
}
