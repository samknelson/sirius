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
import { Plus } from "lucide-react";
import { type StatementSelection } from "@/components/ledger/StatementPicker";
import { ParticipantAllocationBox, type ParticipantBoxState } from "@/components/ledger/ParticipantAllocationBox";

type PaymentCategory = "financial" | "adjustment";

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
  type: string;
  amount: string;
  description: string;
}

function PaymentCreateContent() {
  const { accountId } = useParams<{ accountId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  const [merchant, setMerchant] = useState("");
  const [checkTransactionNumber, setCheckTransactionNumber] = useState("");
  const [adjustmentUser, setAdjustmentUser] = useState("");
  const [dateEntered, setDateEntered] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [participantBoxes, setParticipantBoxes] = useState<ParticipantBoxState[]>([
    { ...EMPTY_PARTICIPANT_BOX, amount: "0.00" },
  ]);

  const { data: accountData } = useQuery<{ id: string; currencyCode?: string }>({
    queryKey: ["/api/ledger/accounts", accountId],
  });
  const accountCurrencyCode = accountData?.currencyCode || "USD";

  const { data: paymentTypes = [] } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

  const { data: accountEAs = [] } = useQuery<EAListItem[]>({
    queryKey: ["/api/ledger/ea", { accountId }],
    queryFn: async () => {
      return await apiRequest("GET", `/api/ledger/ea?accountId=${accountId}`);
    },
    enabled: !!accountId,
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
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/accounts", accountId, "payments"] });
      toast({
        title: "Payment created",
        description: "The payment has been created successfully.",
      });
      showLedgerNotifications(data?.ledgerNotifications as LedgerNotification[] | undefined);
      const paymentId = (data as any)?.id;
      if (paymentId) {
        setLocation(`/ledger/payment/${paymentId}`);
      } else {
        setLocation(`/ledger/accounts/${accountId}/payments`);
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

  const onCreateSubmit = form.handleSubmit((data) => {
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

    const primaryBox = participantBoxes[0];
    const primaryEaId = primaryBox.eaId;
    const primaryStmt = getStatementInfoFromBox(primaryBox);

    const allocations = participantBoxes.map((b) => ({
      ledgerEaId: b.eaId,
      amount: b.amount,
    }));

    delete details.statementAllocations;
    delete details.participantStatementAllocations;

    if (participantBoxes.length > 1) {
      const participantStatements: Record<string, unknown> = {};
      for (const box of participantBoxes) {
        const stmtInfo = getStatementInfoFromBox(box);
        if (stmtInfo.month || stmtInfo.stmtAllocations) {
          participantStatements[box.eaId] = {
            statementMonth: stmtInfo.month,
            statementYear: stmtInfo.year,
            ...(stmtInfo.stmtAllocations
              ? { statementAllocations: stmtInfo.stmtAllocations }
              : {}),
          };
        }
      }
      if (Object.keys(participantStatements).length > 0) {
        details.participantStatementAllocations = participantStatements;
      }
    } else if (primaryStmt.stmtAllocations) {
      details.statementAllocations = primaryStmt.stmtAllocations;
    }

    const submissionData: Record<string, unknown> = {
      ...data,
      ledgerEaId: primaryEaId,
      details: Object.keys(details).length > 0 ? details : null,
      status: category === "adjustment" ? "cleared" : data.status,
      statementMonth: primaryStmt.month,
      statementYear: primaryStmt.year,
      allocations,
    };

    createPaymentMutation.mutate(submissionData);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record Payment</CardTitle>
        <CardDescription>Create a new payment for a participant in this account.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={onCreateSubmit} className="space-y-6">
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
              </>
            ) : (
              <>
                <div className="p-3 bg-muted rounded-md">
                  <p className="text-sm text-muted-foreground">
                    Status: <span className="font-medium text-foreground">Cleared</span> (adjustments are always cleared)
                  </p>
                </div>

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
                  currencyCode={accountCurrencyCode}
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

            <div className="flex gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/ledger/accounts/${accountId}/payments`)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createPaymentMutation.isPending || !participantBoxes.some((b) => b.eaId)}
              >
                {createPaymentMutation.isPending ? "Creating..." : "Create Payment"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function PaymentCreate() {
  return <PaymentCreateContent />;
}
