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
import { insertLedgerPaymentSchema, type LedgerPayment, type LedgerPaymentType, type LedgerPaymentAllocation } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import type { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Trash2 } from "lucide-react";
import { formatAmount } from "@shared/currency";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type AllocationRow = {
  ledgerEaId: string;
  amount: string;
};

type EAListItem = {
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  data: unknown;
};

const paymentStatuses = ["draft", "canceled", "cleared", "error"] as const;

interface LedgerNotification {
  type: "created" | "updated" | "deleted";
  amount: string;
  description: string;
}

type PaymentCategory = "financial" | "adjustment";

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
  const [statementMonth, setStatementMonth] = useState<string>("");
  const [statementYear, setStatementYear] = useState<string>("");
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [allocationsLoaded, setAllocationsLoaded] = useState(false);

  const { data: payment, isLoading } = useQuery<LedgerPayment>({
    queryKey: ["/api/ledger/payments", id],
  });

  const { data: paymentTypes = [] } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

  const { data: allEAs = [] } = useQuery<EAListItem[]>({
    queryKey: ["/api/ledger/ea"],
  });

  const { data: existingAllocations } = useQuery<LedgerPaymentAllocation[]>({
    queryKey: [`/api/ledger/payments/${id}/allocations`],
    enabled: !!id,
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
      details: payment.details as any,
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
      const details = payment.details as any;
      if (details) {
        setMerchant(details.merchant || "");
        setCheckTransactionNumber(details.checkTransactionNumber || "");
        setAdjustmentUser(details.adjustmentUser || "");
        setDateEntered(details.dateEntered || "");
        setEffectiveDate(details.effectiveDate || "");
      }
      const p = payment as any;
      if (p.statementMonth) setStatementMonth(String(p.statementMonth));
      if (p.statementYear) setStatementYear(String(p.statementYear));
    }
  }, [payment]);

  useEffect(() => {
    if (existingAllocations && !allocationsLoaded) {
      setAllocations(existingAllocations.map(a => ({
        ledgerEaId: a.ledgerEaId,
        amount: a.amount,
      })));
      setAllocationsLoaded(true);
    }
  }, [existingAllocations, allocationsLoaded]);

  useEffect(() => {
    if (payment && category === "adjustment") {
      const details = payment.details as any || {};
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

  const updatePaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("PUT", `/api/ledger/payments/${id}`, data);
    },
    onSuccess: (data: any) => {
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
    onError: (error: any) => {
      const errorMessage = error?.error || error?.message || "Failed to update payment. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
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
    
    const submissionData: any = {
      ...data,
      details: Object.keys(details).length > 0 ? details : null,
      status: category === "adjustment" ? "cleared" as const : data.status,
    };

    if (statementMonth) {
      submissionData.statementMonth = parseInt(statementMonth, 10);
    } else {
      submissionData.statementMonth = null;
    }
    if (statementYear) {
      submissionData.statementYear = parseInt(statementYear, 10);
    } else {
      submissionData.statementYear = null;
    }

    submissionData.allocations = allocations.filter(a => a.ledgerEaId && a.amount);
    
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

            {category === "financial" ? (
              <>
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium leading-none">Statement Month</label>
                <Select value={statementMonth} onValueChange={setStatementMonth}>
                  <SelectTrigger className="mt-2" data-testid="select-statement-month">
                    <SelectValue placeholder="Select month" />
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
              <div>
                <label className="text-sm font-medium leading-none">Statement Year</label>
                <Input
                  type="number"
                  min="2000"
                  max="2099"
                  placeholder="e.g. 2026"
                  className="mt-2"
                  data-testid="input-statement-year"
                  value={statementYear}
                  onChange={(e) => setStatementYear(e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium leading-none">Payment Allocations</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAllocations([...allocations, { ledgerEaId: "", amount: "" }])}
                  data-testid="button-add-allocation"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>
              {allocations.length > 0 && (
                <div className="mt-2 space-y-2">
                  {allocations.map((alloc, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <Select
                        value={alloc.ledgerEaId}
                        onValueChange={(val) => {
                          const updated = [...allocations];
                          updated[idx] = { ...updated[idx], ledgerEaId: val };
                          setAllocations(updated);
                        }}
                      >
                        <SelectTrigger className="flex-1" data-testid={`select-allocation-ea-${idx}`}>
                          <SelectValue placeholder="Select EA" />
                        </SelectTrigger>
                        <SelectContent>
                          {allEAs.map((ea) => (
                            <SelectItem key={ea.id} value={ea.id}>
                              {ea.entityType}: {ea.entityId}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Amount"
                        className="w-28"
                        data-testid={`input-allocation-amount-${idx}`}
                        value={alloc.amount}
                        onChange={(e) => {
                          const updated = [...allocations];
                          updated[idx] = { ...updated[idx], amount: e.target.value };
                          setAllocations(updated);
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAllocations(allocations.filter((_, i) => i !== idx))}
                        data-testid={`button-remove-allocation-${idx}`}
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
                      <p className={`text-xs mt-1 ${Math.abs(diff) > 0.01 ? "text-destructive" : "text-muted-foreground"}`}>
                        Allocated: {formatAmount(total, currencyCode)} / {formatAmount(paymentAmount, currencyCode)}
                        {Math.abs(diff) > 0.01 && ` (${diff > 0 ? "under" : "over"} by ${formatAmount(Math.abs(diff), currencyCode)})`}
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>

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
