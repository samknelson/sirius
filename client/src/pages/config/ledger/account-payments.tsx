import { LedgerAccountLayout } from "@/components/layouts/LedgerAccountLayout";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import type { LedgerPaymentWithEntity, LedgerPaymentType } from "@shared/schema";
import { insertLedgerPaymentSchema } from "@shared/schema";
import { Download, ArrowUpDown, Filter, X, Plus, Trash2 } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { stringify } from "csv-stringify/browser/esm/sync";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";

type PaymentCategory = "financial" | "adjustment";

type AllocationRow = {
  ledgerEaId: string;
  amount: string;
};

interface AccountParticipant {
  eaId: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  totalBalance: number;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type EAListItem = {
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  data: unknown;
};

const paymentStatuses = ["draft", "canceled", "cleared", "error"] as const;
const ITEMS_PER_PAGE = 100;

type SortField = "amount" | "dateCreated" | "dateReceived" | "dateCleared" | "entityName";
type SortDirection = "asc" | "desc";

interface LedgerNotification {
  type: string;
  amount: string;
  description: string;
}

function AccountPaymentsContent() {
  usePageTitle("Account Payments");
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEaId, setSelectedEaId] = useState<string>("");
  const [merchant, setMerchant] = useState("");
  const [checkTransactionNumber, setCheckTransactionNumber] = useState("");
  const [adjustmentUser, setAdjustmentUser] = useState("");
  const [dateEntered, setDateEntered] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [statementMonth, setStatementMonth] = useState<string>("");
  const [statementYear, setStatementYear] = useState<string>("");
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  
  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterPaymentType, setFilterPaymentType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterMerchant, setFilterMerchant] = useState("");
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [filterEntityName, setFilterEntityName] = useState("");
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

  const { data: payments, isLoading } = useQuery<LedgerPaymentWithEntity[]>({
    queryKey: ["/api/ledger/accounts", id, "payments"],
  });

  const { data: paymentTypes = [] } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

  const { data: participantsData } = useQuery<{ data: AccountParticipant[]; total: number }>({
    queryKey: ["/api/ledger/accounts", id, "participants"],
    enabled: dialogOpen,
  });
  const participants = participantsData?.data ?? [];

  const { data: accountEAs = [] } = useQuery<EAListItem[]>({
    queryKey: ["/api/ledger/ea", { accountId: id }],
    queryFn: async () => {
      return await apiRequest("GET", `/api/ledger/ea?accountId=${id}`);
    },
    enabled: dialogOpen && !!id,
  });

  const getTodayString = () => new Date().toISOString().split("T")[0];
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
          notification.type === "deleted" ? "Ledger Entry Deleted" : "Ledger Entry";
      toast({
        title: typeLabel,
        description: `${notification.amount} - ${notification.description}`,
      });
    }
  };

  const form = useForm<z.infer<typeof insertLedgerPaymentSchema>>({
    resolver: zodResolver(insertLedgerPaymentSchema),
    defaultValues: {
      status: "draft",
      allocated: false,
      amount: "0.00",
      paymentType: paymentTypes[0]?.id || "",
      ledgerEaId: "",
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

  const resetCreateForm = () => {
    setSelectedEaId("");
    setMerchant("");
    setCheckTransactionNumber("");
    setAdjustmentUser("");
    setDateEntered("");
    setEffectiveDate("");
    setStatementMonth("");
    setStatementYear("");
    setAllocations([]);
    form.reset({
      status: "draft",
      allocated: false,
      amount: "0.00",
      paymentType: paymentTypes[0]?.id || "",
      ledgerEaId: "",
      details: null,
      dateReceived: null,
      dateCleared: null,
      memo: null,
    });
  };

  const createPaymentMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return await apiRequest("POST", "/api/ledger/payments", data);
    },
    onSuccess: (data: Record<string, unknown>) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/accounts", id, "payments"] });
      setDialogOpen(false);
      resetCreateForm();
      toast({
        title: "Payment created",
        description: "The payment has been created successfully.",
      });
      showLedgerNotifications(data?.ledgerNotifications as LedgerNotification[] | undefined);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create payment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onCreateSubmit = form.handleSubmit((data) => {
    if (!selectedEaId) {
      toast({
        title: "Participant required",
        description: "Please select a participant for this payment.",
        variant: "destructive",
      });
      return;
    }

    const existingDetails = (data.details || {}) as Record<string, unknown>;
    const details: Record<string, unknown> = { ...existingDetails };

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

    const filteredAllocations = allocations.filter(a => a.ledgerEaId && a.amount);
    const isMultiple = selectedEaId === "__multiple__";

    if (isMultiple) {
      if (filteredAllocations.length === 0) {
        toast({
          title: "No allocations",
          description: "Please add at least one allocation when using multiple participants.",
          variant: "destructive",
        });
        return;
      }
      const total = filteredAllocations.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
      const paymentAmount = parseFloat(data.amount) || 0;
      if (Math.abs(paymentAmount - total) > 0.01) {
        toast({
          title: "Allocation mismatch",
          description: "Allocation amounts must equal the payment amount.",
          variant: "destructive",
        });
        return;
      }
    } else if (filteredAllocations.length > 0) {
      const total = filteredAllocations.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
      const paymentAmount = parseFloat(data.amount) || 0;
      if (Math.abs(paymentAmount - total) > 0.01) {
        toast({
          title: "Allocation mismatch",
          description: "Allocation amounts must equal the payment amount.",
          variant: "destructive",
        });
        return;
      }
    }

    const primaryEaId = isMultiple ? filteredAllocations[0].ledgerEaId : selectedEaId;

    const submissionData: Record<string, unknown> = {
      ...data,
      ledgerEaId: primaryEaId,
      details: Object.keys(details).length > 0 ? details : null,
      status: category === "adjustment" ? "cleared" : data.status,
      statementMonth: statementMonth ? parseInt(statementMonth, 10) : undefined,
      statementYear: statementYear ? parseInt(statementYear, 10) : undefined,
      allocations: filteredAllocations.length > 0 ? filteredAllocations : undefined,
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

    if (filterEntityType !== "all") {
      result = result.filter(p => p.entityType === filterEntityType);
    }

    if (filterEntityName) {
      result = result.filter(p => {
        return p.entityName?.toLowerCase().includes(filterEntityName.toLowerCase());
      });
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
      let aValue: number | string | null;
      let bValue: number | string | null;

      // Get values based on sort field
      if (sortField === "amount") {
        aValue = parseFloat(a.amount);
        bValue = parseFloat(b.amount);
      } else if (sortField === "entityName") {
        aValue = a.entityName || "";
        bValue = b.entityName || "";
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

      // Handle string sorting (entity name)
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
              return 0;
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
    filterEntityType,
    filterEntityName,
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

  // Reset to page 1 when filters or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [
    filterPaymentType,
    filterStatus,
    filterEntityType,
    filterEntityName,
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

  // Calculate pagination values based on filtered results
  const totalFilteredPayments = filteredAndSortedPayments.length;
  const totalPages = Math.ceil(totalFilteredPayments / ITEMS_PER_PAGE);
  
  // Clamp currentPage when totalPages shrinks (e.g., due to filtering or data refresh)
  useEffect(() => {
    const normalizedPage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1;
    if (currentPage !== normalizedPage) {
      setCurrentPage(normalizedPage);
    }
  }, [totalPages, currentPage, payments?.length]);
  
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedPayments = filteredAndSortedPayments.slice(offset, offset + ITEMS_PER_PAGE);

  // Get unique entity types
  const entityTypes = useMemo(() => {
    if (!payments) return [];
    const types = new Set(payments.map(p => p.entityType));
    return Array.from(types).sort();
  }, [payments]);

  // Clear all filters
  const clearFilters = () => {
    setFilterPaymentType("all");
    setFilterStatus("all");
    setFilterEntityType("all");
    setFilterEntityName("");
    setFilterMerchant("");
    setFilterAmountMin("");
    setFilterAmountMax("");
    setCurrentPage(1);
    setFilterDateCreatedFrom("");
    setFilterDateCreatedTo("");
    setFilterDateReceivedFrom("");
    setFilterDateReceivedTo("");
    setFilterDateClearedFrom("");
    setFilterDateClearedTo("");
  };

  // Export to CSV
  const exportToCSV = () => {
    const dataToExport = filteredAndSortedPayments;
    if (!dataToExport.length) {
      toast({
        title: "No data to export",
        description: "There are no payments to export.",
        variant: "destructive",
      });
      return;
    }

    const csvData = dataToExport.map(payment => {
      const paymentType = paymentTypes.find(t => t.id === payment.paymentType);
      const details = payment.details as any;
      
      return {
        Amount: parseFloat(payment.amount).toFixed(2),
        "Payment Type": paymentType?.name || "",
        Status: payment.status,
        "Entity Type": payment.entityType,
        "Entity Name": payment.entityName || "",
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
        "Entity Type",
        "Entity Name",
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
    link.download = `account-payments-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Export successful",
      description: `Exported ${dataToExport.length} filtered payment(s) to CSV.`,
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Payments</CardTitle>
            <CardDescription>
              {payments && payments.length > 0 ? (
                <>
                  {filteredAndSortedPayments.length !== payments.length ? (
                    <>Showing {filteredAndSortedPayments.length} of {payments.length} payments (filtered)</>
                  ) : (
                    <>Showing {payments.length} payments</>
                  )}
                  {totalPages > 1 && (
                    <span className="ml-2">- Page {currentPage} of {totalPages}</span>
                  )}
                </>
              ) : (
                "No payments found for this ledger account"
              )}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetCreateForm(); }}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-record-payment">
                  <Plus className="h-4 w-4 mr-2" />
                  Record Payment
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Record Payment</DialogTitle>
                  <DialogDescription>
                    Create a new payment for a participant in this account.
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={onCreateSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Participant</label>
                      <Select value={selectedEaId} onValueChange={(val) => {
                        setSelectedEaId(val);
                        if (val === "__multiple__") {
                          form.setValue("ledgerEaId", "");
                          if (allocations.length === 0) {
                            setAllocations([{ ledgerEaId: "", amount: "" }]);
                          }
                        } else {
                          form.setValue("ledgerEaId", val);
                          setAllocations([]);
                        }
                      }}>
                        <SelectTrigger data-testid="select-participant">
                          <SelectValue placeholder="Select a participant..." />
                        </SelectTrigger>
                        <SelectContent>
                          {accountEAs.map((ea) => (
                            <SelectItem key={ea.id} value={ea.id}>
                              {ea.entityName || ea.entityId} ({ea.entityType})
                            </SelectItem>
                          ))}
                          {accountEAs.length > 1 && (
                            <SelectItem value="__multiple__">Multiple participants...</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      {selectedEaId === "__multiple__" && (
                        <div className="space-y-2 pl-4 border-l-2 border-muted mt-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                              Split this payment across multiple participant accounts. Totals must equal the payment amount.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setAllocations([...allocations, { ledgerEaId: "", amount: "" }])}
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              Add
                            </Button>
                          </div>
                          {allocations.map((alloc, idx) => (
                            <div key={idx} className="flex gap-2 items-end">
                              <div className="flex-1 space-y-1">
                                <label className="text-xs text-muted-foreground">Account</label>
                                <Select
                                  value={alloc.ledgerEaId}
                                  onValueChange={(val) => {
                                    const updated = [...allocations];
                                    updated[idx] = { ...updated[idx], ledgerEaId: val };
                                    setAllocations(updated);
                                  }}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select account..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {accountEAs.map((ea) => (
                                      <SelectItem key={ea.id} value={ea.id}>
                                        {ea.entityName || ea.entityId} ({ea.entityType})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="w-32 space-y-1">
                                <label className="text-xs text-muted-foreground">Amount</label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  value={alloc.amount}
                                  onChange={(e) => {
                                    const updated = [...allocations];
                                    updated[idx] = { ...updated[idx], amount: e.target.value };
                                    setAllocations(updated);
                                  }}
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setAllocations(allocations.filter((_, i) => i !== idx))}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          {allocations.length > 0 && (() => {
                            const total = allocations.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
                            const paymentAmount = parseFloat(form.getValues("amount")) || 0;
                            const diff = paymentAmount - total;
                            return (
                              <p className={`text-xs ${Math.abs(diff) > 0.01 ? "text-destructive" : "text-muted-foreground"}`}>
                                Allocated: {total.toFixed(2)} / {paymentAmount.toFixed(2)}
                                {Math.abs(diff) > 0.01 && ` (${diff > 0 ? "under" : "over"} by ${Math.abs(diff).toFixed(2)})`}
                              </p>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    <FormField
                      control={form.control}
                      name="paymentType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payment Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-payment-type">
                                <SelectValue placeholder="Select payment type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {paymentTypes.map((type) => (
                                <SelectItem key={type.id} value={type.id}>
                                  {type.name}
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
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
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
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Merchant</label>
                          <Input
                            value={merchant}
                            onChange={(e) => setMerchant(e.target.value)}
                            placeholder="Merchant name"
                            data-testid="input-merchant"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Check/Transaction Number</label>
                          <Input
                            value={checkTransactionNumber}
                            onChange={(e) => setCheckTransactionNumber(e.target.value)}
                            placeholder="Check or transaction number"
                            data-testid="input-check-number"
                          />
                        </div>
                        <FormField
                          control={form.control}
                          name="status"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Status</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {paymentStatuses.map((status) => (
                                    <SelectItem key={status} value={status}>
                                      {status.charAt(0).toUpperCase() + status.slice(1)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Adjustment User</label>
                          <Input
                            value={adjustmentUser}
                            onChange={(e) => setAdjustmentUser(e.target.value)}
                            placeholder="User making adjustment"
                            data-testid="input-adjustment-user"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Date Entered</label>
                            <Input
                              type="date"
                              value={dateEntered}
                              onChange={(e) => setDateEntered(e.target.value)}
                              data-testid="input-date-entered"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Effective Date</label>
                            <Input
                              type="date"
                              value={effectiveDate}
                              onChange={(e) => setEffectiveDate(e.target.value)}
                              data-testid="input-effective-date"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Statement Month</label>
                        <Select value={statementMonth} onValueChange={setStatementMonth}>
                          <SelectTrigger>
                            <SelectValue placeholder="Month (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            {MONTH_NAMES.map((name, idx) => (
                              <SelectItem key={idx + 1} value={String(idx + 1)}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Statement Year</label>
                        <Input
                          type="number"
                          min="2000"
                          max="2099"
                          placeholder="Year (optional)"
                          value={statementYear}
                          onChange={(e) => setStatementYear(e.target.value)}
                        />
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      name="dateReceived"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date Received</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              value={field.value ? new Date(field.value).toISOString().split("T")[0] : ""}
                              onChange={(e) => field.onChange(e.target.value || null)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="dateCleared"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date Cleared</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              value={field.value ? new Date(field.value).toISOString().split("T")[0] : ""}
                              onChange={(e) => field.onChange(e.target.value || null)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="memo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Memo</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Optional memo"
                              value={field.value || ""}
                              onChange={(e) => field.onChange(e.target.value || null)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />


                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); resetCreateForm(); }}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createPaymentMutation.isPending || !selectedEaId}>
                        {createPaymentMutation.isPending ? "Creating..." : "Create Payment"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
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
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {showFilters && (
          <div className="mb-6 p-4 bg-muted/50 rounded-lg space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Filters</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                data-testid="button-clear-filters"
              >
                <X className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Payment Type</label>
                <Select value={filterPaymentType} onValueChange={setFilterPaymentType}>
                  <SelectTrigger data-testid="select-filter-payment-type">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {paymentTypes.map(type => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger data-testid="select-filter-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {paymentStatuses.map(status => (
                      <SelectItem key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Entity Type</label>
                <Select value={filterEntityType} onValueChange={setFilterEntityType}>
                  <SelectTrigger data-testid="select-filter-entity-type">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Entity Types</SelectItem>
                    {entityTypes.map(type => (
                      <SelectItem key={type} value={type}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Entity Name</label>
                <Input
                  placeholder="Filter by entity name..."
                  value={filterEntityName}
                  onChange={(e) => setFilterEntityName(e.target.value)}
                  data-testid="input-filter-entity-name"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Merchant</label>
                <Input
                  placeholder="Filter by merchant..."
                  value={filterMerchant}
                  onChange={(e) => setFilterMerchant(e.target.value)}
                  data-testid="input-filter-merchant"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Amount Range</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Min"
                    value={filterAmountMin}
                    onChange={(e) => setFilterAmountMin(e.target.value)}
                    data-testid="input-filter-amount-min"
                  />
                  <Input
                    type="number"
                    placeholder="Max"
                    value={filterAmountMax}
                    onChange={(e) => setFilterAmountMax(e.target.value)}
                    data-testid="input-filter-amount-max"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Date Created</label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={filterDateCreatedFrom}
                    onChange={(e) => setFilterDateCreatedFrom(e.target.value)}
                    data-testid="input-filter-date-created-from"
                  />
                  <Input
                    type="date"
                    value={filterDateCreatedTo}
                    onChange={(e) => setFilterDateCreatedTo(e.target.value)}
                    data-testid="input-filter-date-created-to"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Date Received</label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={filterDateReceivedFrom}
                    onChange={(e) => setFilterDateReceivedFrom(e.target.value)}
                    data-testid="input-filter-date-received-from"
                  />
                  <Input
                    type="date"
                    value={filterDateReceivedTo}
                    onChange={(e) => setFilterDateReceivedTo(e.target.value)}
                    data-testid="input-filter-date-received-to"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Date Cleared</label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={filterDateClearedFrom}
                    onChange={(e) => setFilterDateClearedFrom(e.target.value)}
                    data-testid="input-filter-date-cleared-from"
                  />
                  <Input
                    type="date"
                    value={filterDateClearedTo}
                    onChange={(e) => setFilterDateClearedTo(e.target.value)}
                    data-testid="input-filter-date-cleared-to"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading payments...
          </div>
        ) : filteredAndSortedPayments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {payments?.length === 0 ? "No payments found for this account." : "No payments match the current filters."}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer" onClick={() => handleSort("entityName")}>
                    <div className="flex items-center gap-1">
                      Entity
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort("dateCreated")}>
                    <div className="flex items-center gap-1">
                      Created
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort("dateReceived")}>
                    <div className="flex items-center gap-1">
                      Received
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort("dateCleared")}>
                    <div className="flex items-center gap-1">
                      Cleared
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Links</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedPayments.map((payment) => {
                  const paymentType = paymentTypes.find(t => t.id === payment.paymentType);
                  const details = payment.details as any;
                  
                  return (
                    <TableRow key={payment.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="text-sm font-medium">{payment.entityName || "-"}</div>
                          <div className="text-xs text-muted-foreground capitalize">{payment.entityType}</div>
                        </div>
                      </TableCell>
                      <TableCell>{paymentType?.name || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(payment.status)}>
                          {payment.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {payment.dateCreated
                          ? new Date(payment.dateCreated).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {payment.dateReceived
                          ? new Date(payment.dateReceived).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {payment.dateCleared
                          ? new Date(payment.dateCleared).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {details?.merchant || "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {payment.entityType === 'employer' && payment.entityId && (
                            <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild data-testid={`link-entity-${payment.id}`}>
                              <Link href={`/employers/${payment.entityId}`}>
                                Entity
                              </Link>
                            </Button>
                          )}
                          <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild data-testid={`link-ea-${payment.id}`}>
                            <Link href={`/ea/${payment.ledgerEaId}/payments`}>
                              EA
                            </Link>
                          </Button>
                          <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild data-testid={`link-payment-${payment.id}`}>
                            <Link href={`/ledger/payment/${payment.id}`}>
                              Payment
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center">
            <Pagination data-testid="pagination-controls">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    data-testid="pagination-previous"
                  />
                </PaginationItem>
                
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  
                  return (
                    <PaginationItem key={pageNum}>
                      <PaginationLink
                        onClick={() => setCurrentPage(pageNum)}
                        isActive={currentPage === pageNum}
                        className="cursor-pointer"
                        data-testid={`pagination-page-${pageNum}`}
                      >
                        {pageNum}
                      </PaginationLink>
                    </PaginationItem>
                  );
                })}
                
                {totalPages > 5 && currentPage < totalPages - 2 && (
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                )}
                
                <PaginationItem>
                  <PaginationNext 
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    data-testid="pagination-next"
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}

        <div className="mt-4 text-sm text-muted-foreground text-center">
          Showing {paginatedPayments.length > 0 ? offset + 1 : 0} - {offset + paginatedPayments.length} of {totalFilteredPayments} {filteredAndSortedPayments.length !== (payments?.length || 0) ? 'filtered ' : ''}payments
        </div>
      </CardContent>
    </Card>
  );
}

export default function AccountPayments() {
  return (
    <LedgerAccountLayout activeTab="payments">
      <AccountPaymentsContent />
    </LedgerAccountLayout>
  );
}
