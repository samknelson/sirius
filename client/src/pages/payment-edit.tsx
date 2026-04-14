import { PaymentLayout } from "@/components/layouts/PaymentLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLedgerPaymentSchema, type LedgerPayment, type LedgerPaymentType } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import type { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { Plus } from "lucide-react";
import { type StatementSelection } from "@/components/ledger/StatementPicker";
import { ParticipantAllocationBox, type ParticipantBoxState } from "@/components/ledger/ParticipantAllocationBox";

const EMPTY_PARTICIPANT_BOX: ParticipantBoxState = {
  eaId: "",
  amount: "",
  statementSelections: [],
  manualMonth: "",
  manualYear: "",
};

type EAListItem = {
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  data: unknown;
};

const paymentStatuses = ["draft", "canceled", "cleared", "error"] as const;

interface LedgerNotification {
  type: "created" | "updated" | "deleted";
  amount: string;
  description: string;
}

type PaymentCategory = "financial" | "adjustment";

interface StatementAllocationEntry {
  month: number;
  year: number;
  amount?: string;
}

interface ParticipantStatementData {
  statementMonth?: number;
  statementYear?: number;
  statementAllocations?: StatementAllocationEntry[];
}

interface PaymentDetails {
  merchant?: string;
  checkTransactionNumber?: string;
  adjustmentUser?: string;
  dateEntered?: string;
  effectiveDate?: string;
  statementAllocations?: StatementAllocationEntry[];
  participantStatementAllocations?: Record<string, ParticipantStatementData>;
  [key: string]: unknown;
}

interface PaymentUpdateResponse {
  id: string;
  [key: string]: unknown;
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

function PaymentEditContent() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

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
        description: `${formatCurrency(notification.amount)} - ${notification.description}`,
      });
    }
  };

  const [merchant, setMerchant] = useState("");
  const [checkTransactionNumber, setCheckTransactionNumber] = useState("");
  const [adjustmentUser, setAdjustmentUser] = useState("");
  const [dateEntered, setDateEntered] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [participantBoxes, setParticipantBoxes] = useState<ParticipantBoxState[]>([
    { ...EMPTY_PARTICIPANT_BOX },
  ]);
  const [boxesLoaded, setBoxesLoaded] = useState(false);

  const { data: payment, isLoading } = useQuery<LedgerPayment>({
    queryKey: ["/api/ledger/payments", id],
  });

  const { data: paymentTypes = [] } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

  const { data: primaryEA } = useQuery<EAListItem | undefined>({
    queryKey: ["/api/ledger/ea", payment?.ledgerEaId],
    queryFn: async () => {
      const allEAs: EAListItem[] = await apiRequest("GET", `/api/ledger/ea`);
      return allEAs.find(ea => ea.id === payment?.ledgerEaId);
    },
    enabled: !!payment?.ledgerEaId,
  });

  const accountId = primaryEA?.accountId;

  const { data: accountEAs = [] } = useQuery<EAListItem[]>({
    queryKey: ["/api/ledger/ea", { accountId }],
    queryFn: async () => {
      return await apiRequest("GET", `/api/ledger/ea?accountId=${accountId}`);
    },
    enabled: !!accountId,
  });


  const currencyCode = paymentTypes.find(pt => pt.id === payment?.paymentType)?.currencyCode || "USD";

  const form = useForm<z.infer<typeof insertLedgerPaymentSchema>>({
    resolver: zodResolver(insertLedgerPaymentSchema),
    values: payment ? {
      status: payment.status,
      allocated: payment.allocated,
      amount: payment.amount,
      paymentType: payment.paymentType,
      ledgerEaId: payment.ledgerEaId,
      details: payment.details as PaymentDetails,
      dateReceived: payment.dateReceived ? new Date(payment.dateReceived) : undefined,
      dateCleared: payment.dateCleared ? new Date(payment.dateCleared) : undefined,
      memo: payment.memo,
    } : undefined,
  });

  const watchedPaymentType = form.watch("paymentType");
  const selectedPaymentType = paymentTypes.find(pt => pt.id === watchedPaymentType);
  const category: PaymentCategory = (selectedPaymentType?.category as PaymentCategory) || "financial";

  useEffect(() => {
    if (payment) {
      const details = payment.details as PaymentDetails | null;
      if (details) {
        setMerchant(details.merchant || "");
        setCheckTransactionNumber(details.checkTransactionNumber || "");
        setAdjustmentUser(details.adjustmentUser || "");
        setDateEntered(details.dateEntered || "");
        setEffectiveDate(details.effectiveDate || "");
      }
    }
  }, [payment]);

  useEffect(() => {
    if (payment && !boxesLoaded) {
      const details = payment.details as PaymentDetails | null;
      const detailsRecord = details as Record<string, unknown> | null;
      const proposedAllocation = (detailsRecord?.proposedAllocation && Array.isArray(detailsRecord.proposedAllocation))
        ? (detailsRecord.proposedAllocation as Array<{ eaId: string; amount: string; statementYmd: string }>)
        : undefined;
      const participantStmtData = details?.participantStatementAllocations || {};
      const stmtAllocations = details?.statementAllocations;

      if (proposedAllocation && proposedAllocation.length > 0) {
        const primaryEaId = payment.ledgerEaId;
        const grouped = new Map<string, { eaId: string; totalAmount: number; selections: StatementSelection[] }>();
        for (const alloc of proposedAllocation) {
          const existing = grouped.get(alloc.eaId);
          const sel: StatementSelection | null = (() => {
            if (!alloc.statementYmd) return null;
            const [y, m] = alloc.statementYmd.split("-").map(Number);
            if (!y || !m) return null;
            return { month: m, year: y, amount: alloc.amount };
          })();
          if (existing) {
            existing.totalAmount += parseFloat(alloc.amount);
            if (sel) existing.selections.push(sel);
          } else {
            grouped.set(alloc.eaId, {
              eaId: alloc.eaId,
              totalAmount: parseFloat(alloc.amount),
              selections: sel ? [sel] : [],
            });
          }
        }
        const sortedGroups = Array.from(grouped.values()).sort((a, b) => {
          if (a.eaId === primaryEaId && b.eaId !== primaryEaId) return -1;
          if (b.eaId === primaryEaId && a.eaId !== primaryEaId) return 1;
          return 0;
        });
        const boxes: ParticipantBoxState[] = sortedGroups.map((group) => ({
          eaId: group.eaId,
          amount: group.totalAmount.toFixed(2),
          statementSelections: group.selections,
          manualMonth: "",
          manualYear: "",
        }));
        setParticipantBoxes(boxes);
      } else {
        let statementSelections: StatementSelection[] = [];
        if (stmtAllocations) {
          statementSelections = stmtAllocations.map((sa: StatementAllocationEntry) => ({
            month: sa.month,
            year: sa.year,
            amount: sa.amount,
          }));
        }

        setParticipantBoxes([{
          eaId: payment.ledgerEaId,
          amount: payment.amount,
          statementSelections,
          manualMonth: "",
          manualYear: "",
        }]);
      }
      setBoxesLoaded(true);
    }
  }, [payment, boxesLoaded]);

  useEffect(() => {
    if (payment && category === "adjustment") {
      const details = (payment.details as PaymentDetails) || {};
      if (!details.adjustmentUser && !adjustmentUser) {
        setAdjustmentUser(getEffectiveUserName());
      }
      if (!details.dateEntered && !dateEntered) {
        setDateEntered(getTodayString());
      }
      if (!details.effectiveDate && !effectiveDate) {
        setEffectiveDate(getTodayString());
      }
    }
  }, [payment, category, user]);

  const updateParticipantBox = (index: number, updated: ParticipantBoxState) => {
    setParticipantBoxes((prev) => prev.map((b, i) => (i === index ? updated : b)));
  };

  const removeParticipantBox = (index: number) => {
    setParticipantBoxes((prev) => prev.filter((_, i) => i !== index));
  };

  const addParticipantBox = () => {
    setParticipantBoxes((prev) => [...prev, { ...EMPTY_PARTICIPANT_BOX }]);
  };

  const getStatementInfoFromBox = (box: ParticipantBoxState) => {
    let month: number | undefined;
    let year: number | undefined;
    let stmtAllocations: StatementSelection[] | undefined;

    if (box.statementSelections.length > 1) {
      const sorted = [...box.statementSelections].sort(
        (a, b) => a.year - b.year || a.month - b.month
      );
      month = sorted[0].month;
      year = sorted[0].year;
      stmtAllocations = sorted.map((s) => ({
        month: s.month,
        year: s.year,
        amount: s.amount ? String(parseFloat(s.amount).toFixed(2)) : undefined,
      }));
    } else if (box.statementSelections.length === 1) {
      month = box.statementSelections[0].month;
      year = box.statementSelections[0].year;
    } else if (box.manualMonth) {
      month = parseInt(box.manualMonth, 10);
      year = box.manualYear ? parseInt(box.manualYear, 10) : undefined;
    }

    return { month, year, stmtAllocations };
  };

  const updatePaymentMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return await apiRequest("PUT", `/api/ledger/payments/${id}`, data);
    },
    onSuccess: (data: PaymentUpdateResponse & { ledgerNotifications?: LedgerNotification[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/payments", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/payments/ea", payment?.ledgerEaId] });
      queryClient.invalidateQueries({ queryKey: [`/api/ledger/payments/${id}/transactions`] });
      toast({
        title: "Payment updated",
        description: "The payment has been updated successfully.",
      });
      showLedgerNotifications(data?.ledgerNotifications);
      setLocation(`/ledger/payment/${id}`);
    },
    onError: (error: Error & { error?: string }) => {
      const errorMessage = error?.error || error?.message || "Failed to update payment. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    for (let i = 0; i < participantBoxes.length; i++) {
      const box = participantBoxes[i];
      if (!box.eaId) {
        toast({
          title: "Participant required",
          description: `Please select a participant for box ${i + 1}.`,
          variant: "destructive",
        });
        return;
      }
      const amt = parseFloat(box.amount) || 0;
      if (amt <= 0) {
        toast({
          title: "Amount required",
          description: `Please enter a valid amount for participant ${i + 1}.`,
          variant: "destructive",
        });
        return;
      }

      if (box.statementSelections.length > 1) {
        const missingAmounts = box.statementSelections.some(
          (s) => !s.amount || isNaN(parseFloat(s.amount)) || parseFloat(s.amount) <= 0
        );
        if (missingAmounts) {
          toast({
            title: "Statement allocation required",
            description: `Please enter a valid amount for every selected statement period (participant ${i + 1}).`,
            variant: "destructive",
          });
          return;
        }
        const stmtTotal = box.statementSelections.reduce(
          (sum, s) => sum + parseFloat(s.amount || "0"),
          0
        );
        if (Math.abs(amt - stmtTotal) > 0.01) {
          toast({
            title: "Statement allocation mismatch",
            description: `Statement amounts must equal the allocation amount for participant ${i + 1}.`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    const paymentAmount = parseFloat(data.amount) || 0;
    const totalAllocated = participantBoxes.reduce(
      (sum, b) => sum + (parseFloat(b.amount) || 0),
      0
    );
    if (Math.abs(paymentAmount - totalAllocated) > 0.01) {
      toast({
        title: "Allocation mismatch",
        description: "Participant allocation amounts must equal the payment amount.",
        variant: "destructive",
      });
      return;
    }

    const existingDetails = (data.details || {}) as PaymentDetails;
    const details: PaymentDetails = { ...existingDetails };

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

    const originalPrimaryEaId = payment?.ledgerEaId;
    const primaryBox = participantBoxes.find(b => b.eaId === originalPrimaryEaId) || participantBoxes[0];
    const primaryEaId = primaryBox.eaId;

    delete details.statementAllocations;
    delete details.participantStatementAllocations;

    const proposedAllocation: Array<{ eaId: string; amount: string; statementYmd: string }> = [];
    for (const b of participantBoxes) {
      if (b.statementSelections.length > 1) {
        for (const sel of b.statementSelections) {
          const ymd = `${sel.year}-${String(sel.month).padStart(2, "0")}-01`;
          proposedAllocation.push({
            eaId: b.eaId,
            amount: sel.amount ? String(parseFloat(sel.amount).toFixed(2)) : b.amount,
            statementYmd: ymd,
          });
        }
      } else {
        const stmtInfo = getStatementInfoFromBox(b);
        const ymd = stmtInfo.month && stmtInfo.year
          ? `${stmtInfo.year}-${String(stmtInfo.month).padStart(2, "0")}-01`
          : "";
        proposedAllocation.push({
          eaId: b.eaId,
          amount: b.amount,
          statementYmd: ymd,
        });
      }
    }
    details.proposedAllocation = proposedAllocation;

    const submissionData: Record<string, unknown> = {
      ...data,
      ledgerEaId: primaryEaId,
      details: Object.keys(details).length > 0 ? details : null,
      status: category === "adjustment" ? "cleared" : data.status,
    };

    updatePaymentMutation.mutate(submissionData);
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!payment) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-center">Payment not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit Payment</CardTitle>
        <CardDescription>Update payment information</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="paymentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-payment-type">
                          <SelectValue placeholder="Select payment type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {paymentTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id} data-testid={`option-${type.id}`}>
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
                        placeholder="0.00"
                        data-testid="input-amount"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          if (participantBoxes.length === 1) {
                            updateParticipantBox(0, {
                              ...participantBoxes[0],
                              amount: e.target.value,
                            });
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {category === "financial" ? (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
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
              ) : (
                <div className="flex items-end">
                  <div className="p-3 bg-muted rounded-md w-full">
                    <p className="text-sm text-muted-foreground">
                      Status: <span className="font-medium text-foreground">Cleared</span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {category === "financial" ? (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Check/Transaction #</label>
                    <Input
                      placeholder="Enter check or transaction number..."
                      data-testid="input-check-transaction-number"
                      value={checkTransactionNumber}
                      onChange={(e) => setCheckTransactionNumber(e.target.value)}
                    />
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
                            data-testid="input-date-received"
                            value={field.value ? new Date(field.value).toISOString().split('T')[0] : ''}
                            onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)}
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
                            data-testid="input-date-cleared"
                            value={field.value ? new Date(field.value).toISOString().split('T')[0] : ''}
                            onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Merchant</label>
                  <Input
                    placeholder="Enter merchant name..."
                    data-testid="input-merchant"
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Adjustment User</label>
                    <Input
                      placeholder="Enter user name..."
                      data-testid="input-adjustment-user"
                      value={adjustmentUser}
                      onChange={(e) => setAdjustmentUser(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Date Entered</label>
                    <Input
                      type="date"
                      data-testid="input-date-entered"
                      value={dateEntered}
                      onChange={(e) => setDateEntered(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Effective Date</label>
                    <Input
                      type="date"
                      data-testid="input-effective-date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div />
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
                  <FormField
                    control={form.control}
                    name="dateCleared"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date Cleared</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            data-testid="input-date-cleared"
                            value={field.value ? new Date(field.value).toISOString().split('T')[0] : ''}
                            onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
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

            <FormField
              control={form.control}
              name="allocated"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-allocated"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Allocated</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Participant Allocation</label>
                {participantBoxes.length > 1 && (() => {
                  const totalAllocated = participantBoxes.reduce(
                    (sum, b) => sum + (parseFloat(b.amount) || 0),
                    0
                  );
                  const paymentAmount = parseFloat(form.watch("amount")) || 0;
                  const diff = paymentAmount - totalAllocated;
                  return (
                    <span className={`text-xs ${Math.abs(diff) > 0.01 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {Math.abs(diff) < 0.01
                        ? "Fully allocated"
                        : `${diff > 0 ? "Under" : "Over"} by ${Math.abs(diff).toFixed(2)}`}
                    </span>
                  );
                })()}
              </div>

              {participantBoxes.map((box, idx) => (
                <ParticipantAllocationBox
                  key={idx}
                  state={box}
                  onChange={(updated) => updateParticipantBox(idx, updated)}
                  onRemove={participantBoxes.length > 1 ? () => removeParticipantBox(idx) : undefined}
                  eaOptions={accountEAs}
                  currencyCode={currencyCode}
                  index={idx}
                  usedEaIds={participantBoxes
                    .filter((_, i) => i !== idx)
                    .map((b) => b.eaId)
                    .filter(Boolean)}
                />
              ))}

              {accountEAs.length > 1 && participantBoxes.length < accountEAs.length && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addParticipantBox}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Another Participant
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/ledger/payment/${id}`)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updatePaymentMutation.isPending} data-testid="button-save">
                {updatePaymentMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function PaymentEdit() {
  return (
    <PaymentLayout activeTab="edit">
      <PaymentEditContent />
    </PaymentLayout>
  );
}
