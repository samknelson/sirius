import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLedgerPaymentSchema, type LedgerPayment, type LedgerPaymentType } from "@shared/schema";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useRef } from "react";
import type { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { type StatementSelection } from "@/components/ledger/StatementPicker";
import {
  ParticipantAllocationBox,
  type ParticipantBoxState,
  type ParticipantBoxUpdate,
} from "@/components/ledger/ParticipantAllocationBox";
import { isValidYmd, ymdToDateForPicker, dateToYmd } from "@shared/utils/date";
import { ImagePlus, Loader2, Plus, X } from "lucide-react";
import {
  EntityFileManager,
  ImageAttachmentPreview,
  uploadEntityFile,
} from "@/components/entity-files/EntityFileManager";

const EMPTY_PARTICIPANT_BOX: ParticipantBoxState = {
  eaId: "",
  amount: "",
  statementSelections: [],
  manualMonth: "",
  manualYear: "",
};

let nextParticipantBoxId = 1;

function withParticipantBoxId(box: ParticipantBoxState): ParticipantBoxState {
  return box._id ? box : { ...box, _id: nextParticipantBoxId++ };
}

type EAListItem = {
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  data: unknown;
};

const paymentStatuses = ["draft", "canceled", "cleared", "error"] as const;

export interface LedgerNotification {
  type: "created" | "updated" | "deleted";
  amount: string;
  description: string;
}

type PaymentCategory = "financial" | "adjustment";
type PaymentTypeWithDirection = LedgerPaymentType & { direction?: "charge" | "credit" };

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
  proposedAllocation?: Array<{ eaId: string; amount: string; statementYmd: string }>;
  [key: string]: unknown;
}

export interface PaymentFormSubmitResult {
  id: string;
  payment?: LedgerPayment;
  ledgerNotifications?: LedgerNotification[];
  [key: string]: unknown;
}

export interface PaymentFormProps {
  mode: "create" | "edit";
  /** Required for `create` mode (drives EA list + currency). Ignored in edit mode (derived from payment). */
  accountId?: string;
  /** Required for `edit` mode. */
  paymentId?: string;
  /** When provided in `create` mode, POST goes to /api/ledger-payment-batches/:batchId/payments and assigns the new payment to the batch atomically. */
  batchId?: string;
  /** Hide the surrounding Card chrome (useful when embedded in a pane that already has its own card). */
  hideCardWrapper?: boolean;
  /** Override the card title (only used when card wrapper is shown). */
  title?: string;
  /** Override the card description. */
  description?: string;
  /** Called after a successful create or update with the saved payment id. */
  onSuccess?: (result: PaymentFormSubmitResult) => void;
  /** Called when the user clicks Cancel. */
  onCancel?: () => void;
  /** Override label for the submit button. */
  submitLabel?: string;
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

export function PaymentForm({
  mode,
  accountId: accountIdProp,
  paymentId,
  batchId,
  hideCardWrapper = false,
  title,
  description,
  onSuccess,
  onCancel,
  submitLabel,
}: PaymentFormProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  const getTodayString = () => new Date().toISOString().split("T")[0];
  const getEffectiveUserName = () => {
    if (!user) return "";
    const parts = [user.firstName, user.lastName].filter(Boolean);
    return parts.join(" ") || user.email || "";
  };

  const showLedgerNotifications = (notifications: LedgerNotification[] | undefined) => {
    if (!notifications || notifications.length === 0) return;
    for (const notification of notifications) {
      const typeLabel =
        notification.type === "created"
          ? "Ledger Entry Created"
          : notification.type === "updated"
            ? "Ledger Entry Updated"
            : "Ledger Entry Deleted";
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
    withParticipantBoxId({
      ...EMPTY_PARTICIPANT_BOX,
      amount: mode === "create" ? "0.00" : "",
    }),
  ]);
  const hydratedEditSessionRef = useRef<string | null>(null);
  const [hydratedEditSession, setHydratedEditSession] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const [savedCreateResult, setSavedCreateResult] = useState<PaymentFormSubmitResult | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  // ---- Edit mode: load payment + derive accountId ----
  const { data: payment, isLoading: isPaymentLoading } = useQuery<LedgerPayment>({
    queryKey: ["/api/ledger/payments", paymentId],
    enabled: mode === "edit" && !!paymentId,
  });

  const { data: paymentTypes = [] } = useQuery<PaymentTypeWithDirection[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

  const { data: primaryEA } = useQuery<EAListItem | undefined>({
    queryKey: ["/api/ledger/ea", payment?.ledgerEaId],
    queryFn: async () => {
      const allEAs: EAListItem[] = await apiRequest("GET", `/api/ledger/ea`);
      return allEAs.find((ea) => ea.id === payment?.ledgerEaId);
    },
    enabled: mode === "edit" && !!payment?.ledgerEaId,
  });

  const accountId = mode === "edit" ? primaryEA?.accountId : accountIdProp;

  const { data: accountData } = useQuery<{ id: string; currencyCode?: string }>({
    queryKey: ["/api/ledger/accounts", accountId],
    enabled: !!accountId,
  });

  const { data: accountEAs = [] } = useQuery<EAListItem[]>({
    queryKey: ["/api/ledger/ea", { accountId }],
    queryFn: async () => {
      return await apiRequest("GET", `/api/ledger/ea?accountId=${accountId}`);
    },
    enabled: !!accountId,
  });

  const currencyCode =
    (mode === "edit"
      ? paymentTypes.find((pt) => pt.id === payment?.paymentType)?.currencyCode
      : accountData?.currencyCode) || "USD";

  const form = useForm<z.infer<typeof insertLedgerPaymentSchema>>({
    resolver: zodResolver(insertLedgerPaymentSchema),
    defaultValues: {
      status: "draft",
      allocated: false,
      amount: mode === "create" ? "0.00" : "",
      paymentType: "",
      ledgerEaId: "",
      details: null,
      dateReceived: mode === "create" ? new Date() : null,
      dateCleared: null,
      memo: null,
    },
  });

  // Default the paymentType in create mode once types load
  useEffect(() => {
    if (mode === "create" && !form.getValues("paymentType") && paymentTypes.length > 0) {
      form.setValue("paymentType", paymentTypes[0].id);
    }
  }, [mode, paymentTypes, form]);

  const watchedPaymentType = form.watch("paymentType");
  const selectedPaymentType = paymentTypes.find((pt) => pt.id === watchedPaymentType);
  const category: PaymentCategory = (selectedPaymentType?.category as PaymentCategory) || "financial";
  const direction = selectedPaymentType?.direction || "credit";

  const editSessionKey =
    mode === "edit" && payment
      ? [mode, paymentId || "", accountIdProp || "", batchId || ""].join(":")
      : null;

  // Hydrate once per explicit edit session. Background query refreshes and the
  // post-save cache write must not replace fields the user is still editing.
  useEffect(() => {
    if (!payment || !editSessionKey || hydratedEditSessionRef.current === editSessionKey) return;
    const details = payment.details as PaymentDetails | null;
    const detailsRecord = details as Record<string, unknown> | null;
    const proposedAllocation =
      detailsRecord?.proposedAllocation && Array.isArray(detailsRecord.proposedAllocation)
        ? (detailsRecord.proposedAllocation as Array<{ eaId: string; amount: string; statementYmd: string }>)
        : undefined;
    const stmtAllocations = details?.statementAllocations;

    if (proposedAllocation && proposedAllocation.length > 0) {
      const primaryEaId = payment.ledgerEaId;
      const grouped = new Map<string, { eaId: string; totalAmount: number; selections: StatementSelection[] }>();
      for (const alloc of proposedAllocation) {
        const existing = grouped.get(alloc.eaId);
        const sel: StatementSelection | null = (() => {
          if (!alloc.statementYmd || !isValidYmd(alloc.statementYmd)) return null;
          const d = ymdToDateForPicker(alloc.statementYmd);
          return { month: d.getMonth() + 1, year: d.getFullYear(), amount: alloc.amount };
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
      const boxes: ParticipantBoxState[] = sortedGroups.map((group) => withParticipantBoxId({
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
      setParticipantBoxes([
        withParticipantBoxId({
          eaId: payment.ledgerEaId,
          amount: payment.amount,
          statementSelections,
          manualMonth: "",
          manualYear: "",
        }),
      ]);
    }
    form.reset({
      status: payment.status,
      allocated: payment.allocated,
      amount: payment.amount,
      paymentType: payment.paymentType,
      ledgerEaId: payment.ledgerEaId,
      details: payment.details as PaymentDetails,
      dateReceived: payment.dateReceived ? new Date(payment.dateReceived) : null,
      dateCleared: payment.dateCleared ? new Date(payment.dateCleared) : null,
      memo: payment.memo,
    });
    setMerchant(details?.merchant || "");
    setCheckTransactionNumber(details?.checkTransactionNumber || "");
    setAdjustmentUser(details?.adjustmentUser || "");
    setDateEntered(details?.dateEntered || "");
    setEffectiveDate(details?.effectiveDate || "");
    hydratedEditSessionRef.current = editSessionKey;
    setHydratedEditSession(editSessionKey);
  }, [editSessionKey, form, payment]);

  // Default adjustment fields
  useEffect(() => {
    if (category !== "adjustment") return;
    if (mode === "edit" && !payment) return;
    if (!adjustmentUser) setAdjustmentUser(getEffectiveUserName());
    if (!dateEntered) setDateEntered(getTodayString());
    if (!effectiveDate) setEffectiveDate(getTodayString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, payment, user]);

  const updateParticipantBox = (rowId: number, update: ParticipantBoxUpdate) => {
    setParticipantBoxes((prev) =>
      prev.map((box) => {
        if (box._id !== rowId) return box;
        const patch = typeof update === "function" ? update(box) : update;
        return patch === box ? box : { ...box, ...patch, _id: box._id };
      }),
    );
  };
  const removeParticipantBox = (rowId: number) => {
    setParticipantBoxes((prev) => prev.filter((box) => box._id !== rowId));
  };
  const addParticipantBox = () => {
    setParticipantBoxes((prev) => [...prev, withParticipantBoxId({ ...EMPTY_PARTICIPANT_BOX })]);
  };

  const submitMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>): Promise<PaymentFormSubmitResult> => {
      if (mode === "edit") {
        return await apiRequest("PUT", `/api/ledger/payments/${paymentId}`, data);
      }
      if (batchId) {
        const res = await apiRequest("POST", `/api/ledger-payment-batches/${batchId}/payments`, {
          payment: data,
        });
        return {
          ...res.payment,
          id: res.paymentId,
          payment: res.payment,
          ledgerNotifications: res.ledgerNotifications,
        };
      }
      return await apiRequest("POST", "/api/ledger/payments", data);
    },
    onSuccess: async (data) => {
      const savedPayment = data.payment ?? data;
      const savedPaymentData = { ...savedPayment } as Record<string, unknown>;
      delete savedPaymentData.ledgerNotifications;
      delete savedPaymentData.payment;
      // The edit response is the authoritative saved payment. Replace its
      // cache synchronously so reopening it cannot first hydrate allocations
      // from the pre-save value, even if its query became inactive meanwhile.
      if (mode === "edit" && paymentId) {
        queryClient.setQueryData(
          ["/api/ledger/payments", paymentId],
          savedPaymentData as unknown as LedgerPayment,
        );
      }

      const refreshes: Array<Promise<unknown>> = [];
      const savedPaymentId = data.id || paymentId;
      if (savedPaymentId) {
        queryClient.setQueryData(
          ["/api/ledger/payments", savedPaymentId],
          savedPaymentData as unknown as LedgerPayment,
        );
        refreshes.push(queryClient.refetchQueries({
          queryKey: [`/api/ledger/payments/${savedPaymentId}/transactions`],
          type: "all",
        }, { throwOnError: true }));
      }
      if (accountId) {
        refreshes.push(queryClient.refetchQueries({
          queryKey: ["/api/ledger/accounts", accountId, "payments"],
          type: "all",
        }, { throwOnError: true }));
      }
      if (batchId) {
        refreshes.push(
          queryClient.refetchQueries({
            queryKey: [`/api/ledger-payment-batches/${batchId}`],
            type: "all",
          }, { throwOnError: true }),
          queryClient.refetchQueries({
            queryKey: [`/api/ledger-payment-batches/${batchId}/payments`],
            type: "all",
          }, { throwOnError: true }),
        );
      }
      const affectedEaIds = new Set<string>();
      if (payment?.ledgerEaId) affectedEaIds.add(payment.ledgerEaId);
      if (savedPaymentData.ledgerEaId) affectedEaIds.add(String(savedPaymentData.ledgerEaId));
      for (const eaId of affectedEaIds) {
        refreshes.push(queryClient.refetchQueries({
          queryKey: ["/api/ledger/payments/ea", eaId],
          type: "all",
        }, { throwOnError: true }));
      }
      const refreshResults = await Promise.allSettled(refreshes);
      const refreshFailed = refreshResults.some((result) => result.status === "rejected");

      if (mode === "create" && pendingAttachment && savedPaymentId) {
        setSavedCreateResult(data);
        setIsUploadingAttachment(true);
        try {
          await uploadEntityFile({
            context: "ledger_payment",
            entityId: savedPaymentId,
            file: pendingAttachment,
          });
          setPendingAttachment(null);
          setSavedCreateResult(null);
          queryClient.invalidateQueries({
            queryKey: ["/api/entity-files", "ledger_payment", savedPaymentId],
          });
        } catch (error) {
          toast({
            title: "Payment saved, attachment not uploaded",
            description: `${getApiErrorMessage(error, "The attachment could not be uploaded.")} Retry below; the payment will not be created again.`,
            variant: "destructive",
          });
          showLedgerNotifications(data?.ledgerNotifications);
          return;
        } finally {
          setIsUploadingAttachment(false);
        }
      }
      if (refreshFailed) {
        toast({
          title: "Payment saved",
          description: "The payment was saved, but one or more payment views could not be refreshed.",
          variant: "destructive",
        });
      } else {
        const successTitle = mode === "edit" ? "Payment updated" : "Payment created";
        toast({
          title: successTitle,
          description:
            mode === "edit"
              ? "The payment has been updated successfully."
              : "The payment has been created successfully.",
        });
      }
      showLedgerNotifications(data?.ledgerNotifications);
      onSuccess?.(data);
    },
    onError: (error: Error & { error?: string }) => {
      const errorMessage = error?.error || error?.message ||
        (mode === "edit" ? "Failed to update payment. Please try again." : "Failed to create payment. Please try again.");
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
    },
  });

  // Upload-source payments (BAO withholding) carry `details.baoUploadSource`
  // instead of participant allocations; the selection is preserved read-only
  // in edit mode and per-participant validation does not apply.
  const isUploadSourcePayment = Boolean(
    (payment?.details as Record<string, unknown> | null)?.baoUploadSource,
  );

  const onSubmit = form.handleSubmit((data) => {
    if (savedCreateResult && pendingAttachment) {
      const savedPaymentId = savedCreateResult.id;
      setIsUploadingAttachment(true);
      uploadEntityFile({
        context: "ledger_payment",
        entityId: savedPaymentId,
        file: pendingAttachment,
      })
        .then(() => {
          queryClient.invalidateQueries({
            queryKey: ["/api/entity-files", "ledger_payment", savedPaymentId],
          });
          setPendingAttachment(null);
          setSavedCreateResult(null);
          toast({
            title: "Attachment uploaded",
            description: "The image has been attached to the saved payment.",
          });
          onSuccess?.(savedCreateResult);
        })
        .catch((error) => {
          toast({
            title: "Attachment still not uploaded",
            description: getApiErrorMessage(error, "The attachment could not be uploaded. Please try again."),
            variant: "destructive",
          });
        })
        .finally(() => setIsUploadingAttachment(false));
      return;
    }

    if (isUploadSourcePayment) {
      const existingDetails = { ...((payment?.details || {}) as Record<string, unknown>) };
      if (category === "financial") {
        if (merchant) existingDetails.merchant = merchant;
        else delete existingDetails.merchant;
        if (checkTransactionNumber) existingDetails.checkTransactionNumber = checkTransactionNumber;
        else delete existingDetails.checkTransactionNumber;
      } else {
        if (adjustmentUser) existingDetails.adjustmentUser = adjustmentUser;
        else delete existingDetails.adjustmentUser;
        if (dateEntered) existingDetails.dateEntered = dateEntered;
        else delete existingDetails.dateEntered;
        if (effectiveDate) existingDetails.effectiveDate = effectiveDate;
        else delete existingDetails.effectiveDate;
      }
      submitMutation.mutate({
        ...data,
        ledgerEaId: payment?.ledgerEaId,
        details: existingDetails,
        status: category === "adjustment" ? "cleared" : data.status,
      });
      return;
    }

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
          (s) => !s.amount || isNaN(parseFloat(s.amount)) || parseFloat(s.amount) <= 0,
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
          0,
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
    const totalAllocated = participantBoxes.reduce((sum, b) => sum + (parseFloat(b.amount) || 0), 0);
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
      if (merchant) details.merchant = merchant;
      else delete details.merchant;
      if (checkTransactionNumber) details.checkTransactionNumber = checkTransactionNumber;
      else delete details.checkTransactionNumber;
      delete details.adjustmentUser;
      delete details.dateEntered;
      delete details.effectiveDate;
    } else {
      if (adjustmentUser) details.adjustmentUser = adjustmentUser;
      else delete details.adjustmentUser;
      if (dateEntered) details.dateEntered = dateEntered;
      else delete details.dateEntered;
      if (effectiveDate) details.effectiveDate = effectiveDate;
      else delete details.effectiveDate;
      delete details.merchant;
      delete details.checkTransactionNumber;
    }

    // Pick the primary participant box for the top-level ledgerEaId
    const originalPrimaryEaId = payment?.ledgerEaId;
    const primaryBox =
      mode === "edit"
        ? participantBoxes.find((b) => b.eaId === originalPrimaryEaId) || participantBoxes[0]
        : participantBoxes[0];
    const primaryEaId = primaryBox.eaId;

    delete details.statementAllocations;
    delete details.participantStatementAllocations;

    const proposedAllocation: Array<{ eaId: string; amount: string; statementYmd: string }> = [];
    for (const b of participantBoxes) {
      if (b.statementSelections.length > 1) {
        for (const sel of b.statementSelections) {
          const ymd = dateToYmd(new Date(sel.year, sel.month - 1, 1));
          proposedAllocation.push({
            eaId: b.eaId,
            amount: sel.amount ? String(parseFloat(sel.amount).toFixed(2)) : b.amount,
            statementYmd: ymd,
          });
        }
      } else {
        let month: number | undefined;
        let year: number | undefined;
        if (b.statementSelections.length === 1) {
          month = b.statementSelections[0].month;
          year = b.statementSelections[0].year;
        } else if (b.manualMonth) {
          month = parseInt(b.manualMonth, 10);
          year = b.manualYear ? parseInt(b.manualYear, 10) : undefined;
        }
        const ymd = month && year ? dateToYmd(new Date(year, month - 1, 1)) : "";
        proposedAllocation.push({ eaId: b.eaId, amount: b.amount, statementYmd: ymd });
      }
    }
    details.proposedAllocation = proposedAllocation;

    const submissionData: Record<string, unknown> = {
      ...data,
      ledgerEaId: primaryEaId,
      details: Object.keys(details).length > 0 ? details : null,
      status: category === "adjustment" ? "cleared" : data.status,
    };

    submitMutation.mutate(submissionData);
  });

  if (
    mode === "edit" &&
    (isPaymentLoading || (!!payment && (!editSessionKey || hydratedEditSession !== editSessionKey)))
  ) {
    const inner = (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
    if (hideCardWrapper) return inner;
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>{inner}</CardContent>
      </Card>
    );
  }

  if (mode === "edit" && !payment) {
    const inner = <p className="text-muted-foreground text-center">Payment not found</p>;
    if (hideCardWrapper) return inner;
    return (
      <Card>
        <CardContent className="py-8">{inner}</CardContent>
      </Card>
    );
  }

  const formBody = (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6">
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
                    {paymentTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id} data-testid={`option-${type.id}`}>
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
                    onChange={(e) => {
                      field.onChange(e);
                      if (participantBoxes.length === 1) {
                        updateParticipantBox(participantBoxes[0]._id!, { amount: e.target.value });
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
                        value={field.value ? new Date(field.value).toISOString().split("T")[0] : ""}
                        onChange={(e) =>
                          field.onChange(e.target.value ? new Date(e.target.value) : null)
                        }
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
                        onChange={(e) =>
                          field.onChange(e.target.value ? new Date(e.target.value) : null)
                        }
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
                        value={field.value ? new Date(field.value).toISOString().split("T")[0] : ""}
                        onChange={(e) =>
                          field.onChange(e.target.value ? new Date(e.target.value) : null)
                        }
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
                        onChange={(e) =>
                          field.onChange(e.target.value ? new Date(e.target.value) : null)
                        }
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
                  value={field.value || ""}
                  onChange={(e) => field.onChange(e.target.value || null)}
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

        {mode === "create" && !batchId && (
          <div className="space-y-2 rounded-md border p-4" data-testid="payment-attachment-picker">
            <div>
              <label className="text-sm font-medium">Payment image (optional)</label>
              <p className="text-xs text-muted-foreground">
                The image stays on this device until the payment saves, then uploads through Entity Files.
              </p>
            </div>
            <input
              ref={attachmentInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff,image/jpeg,image/png,image/gif,image/webp,image/bmp,image/tiff"
              className="hidden"
              data-testid="input-payment-attachment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setPendingAttachment(file);
                event.target.value = "";
              }}
            />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitMutation.isPending || isUploadingAttachment || !!savedCreateResult}
                  onClick={() => attachmentInputRef.current?.click()}
                  data-testid="button-select-payment-attachment"
                >
                  <ImagePlus className="mr-2 h-4 w-4" />
                  {pendingAttachment ? "Replace image" : "Select image"}
                </Button>
                {pendingAttachment && (
                  <>
                  <span className="max-w-sm truncate text-sm" data-testid="text-payment-attachment-name">
                    {pendingAttachment.name}
                  </span>
                  {!savedCreateResult && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setPendingAttachment(null)}
                      data-testid="button-remove-payment-attachment"
                    >
                      <X className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  )}
                  </>
                )}
              </div>
              {pendingAttachment && (
                <ImageAttachmentPreview
                  file={pendingAttachment}
                  alt={`Preview of ${pendingAttachment.name}`}
                  testId="payment-attachment-preview"
                />
              )}
            </div>
            {savedCreateResult && (
              <p className="text-sm text-destructive" data-testid="text-payment-attachment-retry">
                The payment was saved. Retry the attachment or continue to the saved payment.
              </p>
            )}
          </div>
        )}

        {isUploadSourcePayment ? (
          <div className="rounded-md border p-4 space-y-1" data-testid="text-upload-source-info">
            <p className="text-sm font-medium">Upload source allocation</p>
            <p className="text-sm text-muted-foreground">
              This payment is allocated from BAO hours upload withholding
              ({(((payment?.details as Record<string, unknown>)?.baoUploadSource as { wizardIds?: string[] })?.wizardIds || []).length} upload(s)).
              Worker credits are created when the payment clears and reversed when it is voided.
              The upload selection cannot be changed here.
            </p>
          </div>
        ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Participant Allocation</label>
            {participantBoxes.length > 1 &&
              (() => {
                const totalAllocated = participantBoxes.reduce(
                  (sum, b) => sum + (parseFloat(b.amount) || 0),
                  0,
                );
                const paymentAmount = parseFloat(form.watch("amount")) || 0;
                const diff = paymentAmount - totalAllocated;
                return (
                  <span
                    className={`text-xs ${
                      Math.abs(diff) > 0.01 ? "text-destructive font-medium" : "text-muted-foreground"
                    }`}
                  >
                    {Math.abs(diff) < 0.01
                      ? "Fully allocated"
                      : `${diff > 0 ? "Under" : "Over"} by ${Math.abs(diff).toFixed(2)}`}
                  </span>
                );
              })()}
          </div>

          {participantBoxes.map((box, idx) => (
            <ParticipantAllocationBox
              key={box._id}
              state={box}
              onChange={(update) => updateParticipantBox(box._id!, update)}
              onRemove={participantBoxes.length > 1 ? () => removeParticipantBox(box._id!) : undefined}
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
        )}

        <div className="flex gap-2">
          {onCancel && !savedCreateResult && (
            <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel">
              Cancel
            </Button>
          )}
          {savedCreateResult && (
            <Button
              type="button"
              variant="outline"
              disabled={isUploadingAttachment}
              onClick={() => onSuccess?.(savedCreateResult)}
              data-testid="button-continue-saved-payment"
            >
              Continue without image
            </Button>
          )}
          <Button
            type="submit"
            disabled={submitMutation.isPending || isUploadingAttachment}
            data-testid="button-save"
          >
            {isUploadingAttachment
              ? "Uploading image..."
              : submitMutation.isPending
              ? mode === "edit"
                ? "Saving..."
                : "Creating..."
              : savedCreateResult
                ? "Retry attachment"
                : submitLabel || (mode === "edit" ? "Save Changes" : "Create Payment")}
          </Button>
        </div>
      </form>
    </Form>
  );

  const entityFiles = mode === "edit" && paymentId ? (
    <EntityFileManager context="ledger_payment" entityId={paymentId} />
  ) : null;

  if (hideCardWrapper) {
    return (
      <div className="space-y-6">
        {formBody}
        {entityFiles}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title || (mode === "edit" ? "Edit Payment" : "Record Payment")}</CardTitle>
        <CardDescription>
          {description ||
            (mode === "edit"
              ? "Update payment information"
              : "Create a new payment for a participant in this account.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {formBody}
        {entityFiles}
      </CardContent>
    </Card>
  );
}
