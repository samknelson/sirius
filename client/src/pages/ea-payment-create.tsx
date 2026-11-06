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
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef, useMemo } from "react";
import type { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { StatementPicker, type StatementSelection } from "@/components/ledger/StatementPicker";
import { dateToYmd } from "@shared/utils/date";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PaymentAttachmentPicker } from "@/components/ledger/PaymentAttachmentPicker";
import { uploadEntityFile } from "@/components/entity-files/EntityFileManager";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface WithholdingUpload {
  wizardId: string;
  year: number;
  month: number;
  totalAmount: string;
  allocationCount: number;
  consumedByPaymentId: string | null;
}

type PaymentCategory = "financial" | "adjustment";
type PaymentTypeWithDirection = LedgerPaymentType & { direction?: "charge" | "credit" };

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
  const [allocationMethod, setAllocationMethod] = useState<"statement" | "uploadSource">("statement");
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([]);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const [savedPaymentId, setSavedPaymentId] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  // React state alone cannot guard two submissions in the same render.
  const submissionLocked = useRef(false);
  const savedPaymentIdRef = useRef<string | null>(null);
  const uploadLocked = useRef(false);

  const { data: eaData } = useQuery<{ id: string; accountId: string; entityName?: string; entityType?: string }>({
    queryKey: ["/api/ledger/ea", eaId],
  });

  const { data: accountData } = useQuery<{ id: string; currencyCode?: string }>({
    queryKey: ["/api/ledger/accounts", eaData?.accountId],
    enabled: !!eaData?.accountId,
  });
  const currencyCode = accountData?.currencyCode || "USD";

  const { data: paymentTypes = [] } = useQuery<PaymentTypeWithDirection[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

  // BAO withholding uploads eligible as a payment's allocation source
  // (employer EAs only; empty/error hides the "Upload source" method).
  const { data: withholdingUploads = [] } = useQuery<WithholdingUpload[]>({
    queryKey: ["/api/sitespecific/bao/withholding-uploads", { eaId }],
    queryFn: async () => {
      const res = await fetch(`/api/sitespecific/bao/withholding-uploads?eaId=${encodeURIComponent(eaId || "")}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!eaId && eaData?.entityType === "employer",
    retry: false,
  });

  const selectedUploads = withholdingUploads.filter((u) => selectedUploadIds.includes(u.wizardId));
  const selectedUploadsTotal = selectedUploads
    .reduce((sum, u) => sum + parseFloat(u.totalAmount), 0)
    .toFixed(2);

  const filteredPaymentTypes = useMemo(
    () => paymentTypes.filter(pt => pt.currencyCode === currencyCode),
    [paymentTypes, currencyCode],
  );

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
      dateReceived: new Date(),
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
  const direction = selectedPaymentType?.direction || "credit";

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

  const attachToSavedPayment = async (paymentId: string, file: File) => {
    if (uploadLocked.current) return;
    uploadLocked.current = true;
    setIsUploadingAttachment(true);
    setAttachmentError(null);
    try {
      await uploadEntityFile({ context: "ledger_payment", entityId: paymentId, file });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-files", "ledger_payment", paymentId] });
      setLocation(`/ledger/payment/${paymentId}`);
    } catch (error) {
      setAttachmentError(getApiErrorMessage(error, "The attachment could not be uploaded. Please try again."));
    } finally {
      uploadLocked.current = false;
      setIsUploadingAttachment(false);
    }
  };

  const createPaymentMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return await apiRequest("POST", "/api/ledger/payments", data);
    },
    onSuccess: async (data: Record<string, unknown>) => {
      const paymentId = typeof data.id === "string" ? data.id : null;
      // Once creation succeeds, financial submission stays locked even if the
      // attachment fails. Recovery may only upload to this returned ID.
      savedPaymentIdRef.current = paymentId;
      setSavedPaymentId(paymentId);
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/payments/ea", eaId] });
      toast({
        title: "Payment created",
        description: "The payment has been created successfully.",
      });
      showLedgerNotifications(data?.ledgerNotifications as LedgerNotification[] | undefined);
      if (pendingAttachment && paymentId) {
        await attachToSavedPayment(paymentId, pendingAttachment);
        return;
      }
      if (paymentId) {
        setLocation(`/ledger/payment/${paymentId}`);
      } else {
        setLocation(`/ea/${eaId}/payments`);
      }
    },
    onError: (error) => {
      submissionLocked.current = false;
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to create payment. Please try again."),
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
    if (submissionLocked.current || savedPaymentIdRef.current || uploadLocked.current) return;
    if (allocationMethod === "uploadSource") {
      if (selectedUploadIds.length === 0) {
        toast({
          title: "Upload selection required",
          description: "Select at least one upload as the payment's allocation source.",
          variant: "destructive",
        });
        return;
      }
      const paymentAmount = parseFloat(data.amount) || 0;
      if (Math.abs(paymentAmount - parseFloat(selectedUploadsTotal)) > 0.005) {
        toast({
          title: "Amount mismatch",
          description: `Payment amount must exactly equal the selected uploads' total withholding of $${selectedUploadsTotal}.`,
          variant: "destructive",
        });
        return;
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
      details.baoUploadSource = { wizardIds: selectedUploadIds };

      submissionLocked.current = true;
      createPaymentMutation.mutate({
        ...data,
        ledgerEaId: eaId,
        details,
        status: category === "adjustment" ? "cleared" : data.status,
      });
      return;
    }

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
        const ymd = dateToYmd(new Date(sel.year, sel.month - 1, 1));
        proposedAllocation.push({
          eaId: eaId,
          amount: sel.amount ? String(parseFloat(sel.amount).toFixed(2)) : data.amount,
          statementYmd: ymd,
        });
      }
    } else {
      const stmtInfo = getStatementInfo();
      const ymd = stmtInfo.month && stmtInfo.year
        ? dateToYmd(new Date(stmtInfo.year, stmtInfo.month - 1, 1))
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

    submissionLocked.current = true;
    createPaymentMutation.mutate(submissionData);
  });

  const entityLabel = eaData?.entityName || eaData?.entityType || "Entity";
  const busy = createPaymentMutation.isPending || isUploadingAttachment;
  const formLocked = busy || !!savedPaymentId;

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
            <fieldset disabled={formLocked} {...(formLocked ? { inert: "" } : {})} className="space-y-6">
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
                    <p className="text-xs text-muted-foreground" data-testid="text-payment-direction">
                      Effect: <span className="font-medium text-foreground">{direction === "charge" ? "Charge" : "Credit"}</span>
                    </p>
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

            {withholdingUploads.length > 0 && (
              <div className="space-y-2">
                <Label>Allocation Method</Label>
                <RadioGroup
                  value={allocationMethod}
                  onValueChange={(v) => setAllocationMethod(v as "statement" | "uploadSource")}
                  className="flex gap-6"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="statement" id="alloc-statement" data-testid="radio-alloc-statement" />
                    <Label htmlFor="alloc-statement" className="font-normal">Statement</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="uploadSource" id="alloc-upload-source" data-testid="radio-alloc-upload-source" />
                    <Label htmlFor="alloc-upload-source" className="font-normal">Upload source</Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {allocationMethod === "uploadSource" ? (
              <div className="space-y-2 rounded-md border p-4">
                <Label>Hours Uploads (employee withholding)</Label>
                <p className="text-sm text-muted-foreground">
                  Select the upload(s) this payment covers. The payment amount must exactly
                  equal the selected uploads' total withholding; each worker's share is
                  credited to their ledger when the payment clears.
                </p>
                <div className="space-y-2">
                  {withholdingUploads.map((upload) => (
                    <div key={upload.wizardId} className="flex items-center gap-3">
                      <Checkbox
                        id={`upload-${upload.wizardId}`}
                        data-testid={`checkbox-upload-${upload.wizardId}`}
                        checked={selectedUploadIds.includes(upload.wizardId)}
                        onCheckedChange={(checked) => {
                          setSelectedUploadIds((prev) =>
                            checked
                              ? [...prev, upload.wizardId]
                              : prev.filter((id) => id !== upload.wizardId),
                          );
                        }}
                      />
                      <Label htmlFor={`upload-${upload.wizardId}`} className="font-normal">
                        {MONTH_NAMES[upload.month - 1]} {upload.year} — ${upload.totalAmount}
                        {" "}({upload.allocationCount} worker{upload.allocationCount === 1 ? "" : "s"})
                      </Label>
                    </div>
                  ))}
                </div>
                {selectedUploadIds.length > 0 && (
                  <p className="text-sm font-medium" data-testid="text-uploads-total">
                    Selected total: ${selectedUploadsTotal}
                  </p>
                )}
              </div>
            ) : (
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
            )}

            <PaymentAttachmentPicker file={pendingAttachment} onChange={setPendingAttachment} disabled={formLocked} />
            </fieldset>

            {savedPaymentId && (
              <div role={attachmentError ? "alert" : "status"} className="space-y-2 rounded-md border p-4" data-testid="text-payment-attachment-retry">
                <p>The payment was saved. {isUploadingAttachment ? "Uploading attachment…" : "The attachment was not uploaded."}</p>
                {attachmentError && <p className="text-sm text-destructive">{attachmentError}</p>}
                {!isUploadingAttachment && <p className="text-sm">Retry the attachment or continue to the saved payment and manage its Files there. If configuration is missing, ask an administrator to configure Payments under Config → Entity Files. Do not create the payment again.</p>}
              </div>
            )}
            <div className="flex gap-2 pt-4">
              {savedPaymentId ? (
                <>
                  <Button type="button" variant="outline" disabled={busy}
                    onClick={() => setLocation(`/ledger/payment/${savedPaymentId}`)} data-testid="button-continue-saved-payment">
                    Continue to saved payment
                  </Button>
                  <Button type="button" disabled={busy || !pendingAttachment}
                    onClick={() => {
                      if (pendingAttachment) void attachToSavedPayment(savedPaymentId, pendingAttachment);
                    }} data-testid="button-retry-attachment">
                    {isUploadingAttachment ? "Uploading…" : "Retry attachment"}
                  </Button>
                </>
              ) : (
                <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/ea/${eaId}/payments`)}
                disabled={busy}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy} data-testid="button-submit">
                {createPaymentMutation.isPending ? "Creating..." : "Create Payment"}
              </Button>
                </>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function EAPaymentCreate() {
  return (
    <EALayout activeTab="payments">
      <EAPaymentCreateContent />
    </EALayout>
  );
}
