import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLedgerPaymentSchema, type LedgerPaymentType } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import type { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { StatementPicker, type StatementSelection } from "@/components/ledger/StatementPicker";

type PaymentCategory = "financial" | "adjustment";

const paymentStatuses = ["draft", "canceled", "cleared", "error"] as const;

interface LedgerNotification {
  type: string;
  amount: string;
  description: string;
}

function EAPaymentCreateContent() {
  const { id: eaId, paymentTypeId } = useParams<{ id: string; paymentTypeId?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, hasPermission } = useAuth();
  const isStaff = hasPermission('staff');

  const [merchant, setMerchant] = useState("");
  const [checkTransactionNumber, setCheckTransactionNumber] = useState("");
  const [adjustmentUser, setAdjustmentUser] = useState("");
  const [dateEntered, setDateEntered] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [statementMonth, setStatementMonth] = useState<string>("");
  const [statementYear, setStatementYear] = useState<string>("");
  const [statementSelections, setStatementSelections] = useState<StatementSelection[]>([]);

  const { data: eaData } = useQuery<{ id: string; accountId: string; entityName?: string; entityType?: string }>({
    queryKey: ["/api/ledger/ea", eaId],
  });

  const { data: accountData } = useQuery<{ id: string; currencyCode?: string }>({
    queryKey: ["/api/ledger/accounts", eaData?.accountId],
    enabled: !!eaData?.accountId,
  });
  const currencyCode = accountData?.currencyCode || "USD";

  const { data: paymentTypes = [] } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

  const filteredPaymentTypes = paymentTypes.filter(pt => pt.currencyCode === currencyCode);

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
      paymentType: "",
      ledgerEaId: eaId || "",
      details: null,
      dateReceived: null,
      dateCleared: null,
      memo: null,
    },
  });

  useEffect(() => {
    if (paymentTypeId && paymentTypes.length > 0) {
      const match = paymentTypes.find(pt => pt.id === paymentTypeId);
      if (match) {
        form.setValue("paymentType", match.id);
      }
    } else if (!form.getValues("paymentType") && filteredPaymentTypes.length > 0) {
      form.setValue("paymentType", filteredPaymentTypes[0].id);
    }
  }, [paymentTypeId, paymentTypes, filteredPaymentTypes]);

  const watchedPaymentType = form.watch("paymentType");
  const selectedPaymentType = paymentTypes.find(pt => pt.id === watchedPaymentType);
  const category: PaymentCategory = (selectedPaymentType?.category as PaymentCategory) || "financial";

  useEffect(() => {
    if (category === "adjustment") {
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
  }, [category, user]);

  const createPaymentMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return await apiRequest("POST", "/api/ledger/payments", data);
    },
    onSuccess: (data: Record<string, unknown>) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/payments/ea", eaId] });
      toast({
        title: "Payment created",
        description: "The payment has been created successfully.",
      });
      showLedgerNotifications(data?.ledgerNotifications as LedgerNotification[] | undefined);
      const paymentId = (data as Record<string, unknown>)?.id;
      if (paymentId) {
        setLocation(`/ledger/payment/${paymentId}`);
      } else {
        setLocation(`/ea/${eaId}/payments`);
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create payment. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!isStaff) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-muted-foreground">You do not have permission to create payments.</p>
        </CardContent>
      </Card>
    );
  }

  const getStatementInfo = () => {
    let month: number | undefined;
    let year: number | undefined;
    let stmtAllocations: { month: number; year: number; amount: string }[] | undefined;

    if (statementSelections.length > 1) {
      const sorted = [...statementSelections].sort(
        (a, b) => a.year - b.year || a.month - b.month
      );
      month = sorted[0].month;
      year = sorted[0].year;
      stmtAllocations = sorted.map((s) => ({
        month: s.month,
        year: s.year,
        amount: String(parseFloat(s.amount || "0").toFixed(2)),
      }));
    } else if (statementSelections.length === 1) {
      month = statementSelections[0].month;
      year = statementSelections[0].year;
    } else if (statementMonth) {
      month = parseInt(statementMonth, 10);
      year = statementYear ? parseInt(statementYear, 10) : undefined;
    }

    return { month, year, stmtAllocations };
  };

  const onCreateSubmit = form.handleSubmit((data) => {
    if (statementSelections.length > 1) {
      const missingAmounts = statementSelections.some(
        (s) => !s.amount || isNaN(parseFloat(s.amount)) || parseFloat(s.amount) <= 0
      );
      if (missingAmounts) {
        toast({
          title: "Statement allocation required",
          description: "Please enter a valid amount for every selected statement period.",
          variant: "destructive",
        });
        return;
      }
      const stmtTotal = statementSelections.reduce(
        (sum, s) => sum + parseFloat(s.amount || "0"),
        0
      );
      const paymentAmount = parseFloat(data.amount) || 0;
      if (Math.abs(paymentAmount - stmtTotal) > 0.01) {
        toast({
          title: "Statement allocation mismatch",
          description: "Statement allocation amounts must equal the payment amount.",
          variant: "destructive",
        });
        return;
      }
    }

    const details: Record<string, unknown> = {};

    if (category === "financial") {
      if (merchant) details.merchant = merchant;
      if (checkTransactionNumber) details.checkTransactionNumber = checkTransactionNumber;
    } else {
      if (adjustmentUser) details.adjustmentUser = adjustmentUser;
      if (dateEntered) details.dateEntered = dateEntered;
      if (effectiveDate) details.effectiveDate = effectiveDate;
    }

    const proposedAllocation: Array<{ eaId: string; amount: string; statementYmd: string }> = [];
    if (statementSelections.length > 1) {
      for (const sel of statementSelections) {
        const ymd = `${sel.year}-${String(sel.month).padStart(2, "0")}-01`;
        proposedAllocation.push({
          eaId: eaId,
          amount: sel.amount ? String(parseFloat(sel.amount).toFixed(2)) : data.amount,
          statementYmd: ymd,
        });
      }
    } else {
      const stmtInfo = getStatementInfo();
      const ymd = stmtInfo.month && stmtInfo.year
        ? `${stmtInfo.year}-${String(stmtInfo.month).padStart(2, "0")}-01`
        : "";
      proposedAllocation.push({
        eaId: eaId,
        amount: data.amount,
        statementYmd: ymd,
      });
    }
    details.proposedAllocation = proposedAllocation;

    const submissionData: Record<string, unknown> = {
      ...data,
      ledgerEaId: eaId,
      details: Object.keys(details).length > 0 ? details : null,
      status: category === "adjustment" ? "cleared" : data.status,
    };

    createPaymentMutation.mutate(submissionData);
  });

  const entityLabel = eaData?.entityName || eaData?.entityType || "Entity";

  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>Add {selectedPaymentType?.name || "Payment"}</CardTitle>
        <CardDescription>
          Create a new payment for {entityLabel}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={onCreateSubmit} className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
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
                        {filteredPaymentTypes.map((type) => (
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
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-payment-status">
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
                      value={checkTransactionNumber}
                      onChange={(e) => setCheckTransactionNumber(e.target.value)}
                      placeholder="Check or transaction number"
                      data-testid="input-check-number"
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
                            value={field.value ? new Date(field.value).toISOString().split("T")[0] : ""}
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
                            value={field.value ? new Date(field.value).toISOString().split("T")[0] : ""}
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
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    placeholder="Merchant name"
                    data-testid="input-merchant"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Adjustment User</label>
                    <Input
                      value={adjustmentUser}
                      onChange={(e) => setAdjustmentUser(e.target.value)}
                      placeholder="User making adjustment"
                      data-testid="input-adjustment-user"
                    />
                  </div>
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
                            value={field.value ? new Date(field.value).toISOString().split("T")[0] : ""}
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
                            value={field.value ? new Date(field.value).toISOString().split("T")[0] : ""}
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
                      placeholder="Optional memo"
                      value={field.value || ""}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <StatementPicker
              eaId={eaId || null}
              currencyCode={currencyCode}
              paymentAmount={form.watch("amount") || "0"}
              selections={statementSelections}
              onSelectionsChange={setStatementSelections}
              manualMonth={statementMonth}
              manualYear={statementYear}
              onManualMonthChange={setStatementMonth}
              onManualYearChange={setStatementYear}
            />

            <div className="flex gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/ea/${eaId}/payments`)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createPaymentMutation.isPending} data-testid="button-submit">
                {createPaymentMutation.isPending ? "Creating..." : "Create Payment"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function EAPaymentCreate() {
  return (
    <EALayout>
      <EAPaymentCreateContent />
    </EALayout>
  );
}
