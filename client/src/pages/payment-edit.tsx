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

  const { data: payment, isLoading } = useQuery<LedgerPayment>({
    queryKey: ["/api/ledger/payments", id],
  });

  const { data: paymentTypes = [] } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

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
    if (payment?.details) {
      const details = payment.details as any;
      setMerchant(details.merchant || "");
      setCheckTransactionNumber(details.checkTransactionNumber || "");
      setAdjustmentUser(details.adjustmentUser || "");
      setDateEntered(details.dateEntered || "");
      setEffectiveDate(details.effectiveDate || "");
    }
  }, [payment]);

  const updatePaymentMutation = useMutation({
    mutationFn: async (data: z.infer<typeof insertLedgerPaymentSchema>) => {
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
    
    const submissionData = {
      ...data,
      details: Object.keys(details).length > 0 ? details : null,
      status: category === "adjustment" ? "cleared" as const : data.status,
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
