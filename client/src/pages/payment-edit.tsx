import { PaymentLayout } from "@/components/layouts/PaymentLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
import type { z } from "zod";

const paymentStatuses = ["draft", "canceled", "cleared", "error"] as const;

function PaymentEditContent() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

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
      dateReceived: payment.dateReceived,
      dateCleared: payment.dateCleared,
    } : undefined,
  });

  const updatePaymentMutation = useMutation({
    mutationFn: async (data: z.infer<typeof insertLedgerPaymentSchema>) => {
      return await apiRequest("PUT", `/api/ledger/payments/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/payments", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/payments/ea", payment?.ledgerEaId] });
      toast({
        title: "Payment updated",
        description: "The payment has been updated successfully.",
      });
      setLocation(`/ledger/payment/${id}`);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update payment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    updatePaymentMutation.mutate(data);
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
