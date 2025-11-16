import { EALayout } from "@/components/layouts/EALayout";
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
import { Plus, DollarSign } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { z } from "zod";

const paymentStatuses = ["draft", "canceled", "cleared", "error"] as const;

function EAPaymentsContent() {
  const { id } = useParams<{ id: string }>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [merchant, setMerchant] = useState("");
  const [checkTransactionNumber, setCheckTransactionNumber] = useState("");
  const { toast } = useToast();

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

  const createPaymentMutation = useMutation({
    mutationFn: async (data: z.infer<typeof insertLedgerPaymentSchema>) => {
      return await apiRequest("POST", "/api/ledger/payments", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/payments/ea", id] });
      setDialogOpen(false);
      setMerchant("");
      setCheckTransactionNumber("");
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
    
    createPaymentMutation.mutate({
      ...data,
      details: Object.keys(details).length > 0 ? details : null,
    });
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Payments</CardTitle>
            <CardDescription>Manage payments for this account entry</CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-payment">
                <Plus className="h-4 w-4 mr-2" />
                Add an Offline Payment or Adjustment
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add Offline Payment or Adjustment</DialogTitle>
                <DialogDescription>
                  Create a new payment record or adjustment for this account entry
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
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <p className="text-muted-foreground">Loading payments...</p>
          </div>
        ) : !payments || payments.length === 0 ? (
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
                  <TableHead>Payment ID</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Allocated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => {
                  const paymentType = paymentTypes.find(t => t.id === payment.paymentType);
                  return (
                    <TableRow key={payment.id} data-testid={`row-payment-${payment.id}`}>
                      <TableCell className="font-mono text-sm">
                        <Link href={`/ledger/payment/${payment.id}`}>
                          <a className="text-primary hover:underline" data-testid={`link-payment-${payment.id}`}>
                            {payment.id.slice(0, 8)}...
                          </a>
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono" data-testid={`text-amount-${payment.id}`}>
                        ${parseFloat(payment.amount).toFixed(2)}
                      </TableCell>
                      <TableCell data-testid={`text-payment-type-${payment.id}`}>
                        {paymentType?.name || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(payment.status)} data-testid={`badge-status-${payment.id}`}>
                          {payment.status}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-allocated-${payment.id}`}>
                        {payment.allocated ? "Yes" : "No"}
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
