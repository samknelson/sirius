import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DcDocumentsCard } from "@/components/sitespecific/bao/DcDocumentsCard";
import { DcNotesCard } from "@/components/sitespecific/bao/DcNotesCard";
import { DcStatusBadge, formatYmd } from "@/components/sitespecific/bao/dc-shared";
import type {
  BaoDcAttestations,
  BaoDcCase,
  BaoDcCaseMonth,
  BaoDcCaseNote,
} from "@shared/schema";
import type { DcMonthOption } from "@shared/sitespecific/bao/dc-workflow";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-03-01" → "March 2026" (deterministic, no timezone parsing). */
function formatMonthLabel(monthYmd: string): string {
  const [y, m] = monthYmd.split("-").map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1] ?? "?"} ${y}`;
}

type ChecklistItem = { key: string; label: string; satisfied: boolean; detail?: string };

type Bundle = {
  case: BaoDcCase;
  months: BaoDcCaseMonth[];
  monthOptions: DcMonthOption[];
  notes: BaoDcCaseNote[];
  readiness: {
    checklist: { items: ChecklistItem[]; passing: boolean };
    ready: boolean;
    missing: string[];
  };
  yearUsage: Record<string, { used: number; limit: number }>;
  denialLetters: Array<{ id: string; letterYmd: string; expiresYmd: string }>;
  isStaff: boolean;
};

type SelectionValidation = {
  ok: boolean;
  errors: Array<{ code: string; message: string }>;
  gapMonths: string[];
  perYear: Record<string, { used: number; selected: number; limit: number; remaining: number }>;
};

export default function BaoDcCaseDetailPage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { toast } = useToast();
  const caseKey = ["/api/sitespecific/bao/dc/cases", caseId];

  const { data, isLoading, error } = useQuery<Bundle>({ queryKey: caseKey });

  const [monthsDraft, setMonthsDraft] = useState<string[] | null>(null);
  const [actionReason, setActionReason] = useState("");

  const activeMonths = useMemo(
    () => (data?.months ?? []).filter((m) => m.status !== "removed"),
    [data],
  );
  const selectedMonths = useMemo(
    () =>
      monthsDraft ?? activeMonths.map((m) => m.workMonthYmd).slice().sort(),
    [monthsDraft, activeMonths],
  );

  const toggleMonth = (monthYmd: string, checked: boolean) => {
    const next = new Set(selectedMonths);
    if (checked) next.add(monthYmd);
    else next.delete(monthYmd);
    setMonthsDraft(Array.from(next).sort());
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: caseKey });

  const preview = useQuery<SelectionValidation>({
    queryKey: [
      "/api/sitespecific/bao/dc/cases",
      caseId,
      "months-preview",
      selectedMonths.join(","),
    ],
    queryFn: async () =>
      apiRequest("POST", `/api/sitespecific/bao/dc/cases/${caseId}/months/validate`, {
        months: selectedMonths,
      }),
    enabled: Boolean(data && data.case.status === "draft" && selectedMonths.length > 0),
  });

  const saveMonths = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/sitespecific/bao/dc/cases/${caseId}/months`, {
        months: selectedMonths,
      }),
    onSuccess: () => {
      setMonthsDraft(null);
      toast({ title: "Months saved" });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not save months",
        description: getApiErrorMessage(err, "Selection is not valid."),
        variant: "destructive",
      }),
  });

  const saveAttestations = useMutation({
    mutationFn: (attestations: BaoDcAttestations) =>
      apiRequest("PUT", `/api/sitespecific/bao/dc/cases/${caseId}/attestations`, attestations),
    onSuccess: (result: { bounced?: boolean }) => {
      if (result?.bounced) {
        toast({
          title: "Case returned to draft",
          description: "Readiness no longer passes after this change.",
        });
      }
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not save attestations",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  const act = useMutation({
    mutationFn: (action: string) =>
      apiRequest("POST", `/api/sitespecific/bao/dc/cases/${caseId}/actions`, {
        action,
        reason: actionReason || undefined,
        expectedStatus: data?.case.status,
      }),
    onSuccess: () => {
      setActionReason("");
      toast({ title: "Case updated" });
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/bao/dc/queue"] });
    },
    onError: (err) =>
      toast({
        title: "Action failed",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  if (isLoading) return <Skeleton className="h-96 w-full m-6" />;
  if (error || !data) {
    return (
      <p className="p-6 text-sm text-destructive" data-testid="text-dc-case-error">
        {getApiErrorMessage(error, "Could not load the case.")}
      </p>
    );
  }

  const c = data.case;
  const att = (c.attestations ?? {}) as BaoDcAttestations;
  const setAtt = (patch: Partial<BaoDcAttestations>) =>
    saveAttestations.mutate({
      signed: att.signed,
      restrictionsNoted: att.restrictionsNoted,
      fields: att.fields,
      ...patch,
    });

  const isDraft = c.status === "draft";
  const terminal = ["denied", "withdrawn", "void"].includes(c.status);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/workers/${c.workerId}/sitespecific/bao/disability-credit`}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Worker
            </Link>
          </Button>
          <h1 className="text-xl font-semibold" data-testid="text-dc-case-title">
            Disability Credit case — opened {formatYmd(c.openedYmd)}
          </h1>
          <DcStatusBadge status={c.status} />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {Object.entries(data.yearUsage)
            .sort()
            .map(([year, usage]) => (
              <Badge key={year} variant="outline" data-testid={`badge-dc-case-usage-${year}`}>
                {year}: {usage.used} of {usage.limit} used
              </Badge>
            ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Qualifying basis (at open)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(c.qualifyingBasis?.conditions ?? []).map((cond: string) => (
            <Badge key={cond} variant="secondary" data-testid={`badge-dc-basis-${cond}`}>
              {cond === "fmla_months"
                ? `FMLA months: ${((c.qualifyingBasis as any)?.fmlaMonths ?? [])
                    .map((m: string) => m.slice(0, 7))
                    .join(", ")}`
                : "Active denial letter"}
            </Badge>
          ))}
          {data.denialLetters.map((l) => (
            <Badge key={l.id} variant="outline">
              Letter {formatYmd(l.letterYmd)} — expires {formatYmd(l.expiresYmd)}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Readiness checklist</CardTitle>
          <CardDescription>
            {data.readiness.ready
              ? "All checklist items pass."
              : `Missing: ${data.readiness.missing.join("; ")}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.readiness.checklist.items.map((item) => (
            <div key={item.key} className="flex items-center gap-2" data-testid={`checklist-${item.key}`}>
              {item.satisfied ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600" />
              )}
              <span className="text-sm">{item.label}</span>
              {item.detail && (
                <span className="text-xs text-muted-foreground">({item.detail})</span>
              )}
            </div>
          ))}
          {!terminal && c.status !== "approved" && (
            <div className="pt-3 border-t mt-3 grid gap-2 sm:grid-cols-2">
              {[
                { key: "signed", label: "Form is doctor-signed", value: att.signed === true },
                {
                  key: "restrictionsNoted",
                  label: "Restrictions noted (requires employer letter)",
                  value: att.restrictionsNoted === true,
                },
              ].map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={f.value}
                    onCheckedChange={(v) => setAtt({ [f.key]: v === true } as any)}
                    data-testid={`checkbox-dc-att-${f.key}`}
                  />
                  {f.label}
                </label>
              ))}
              {(
                [
                  ["doctorAddress", "Doctor address present"],
                  ["doctorPhone", "Doctor phone present"],
                  ["dates", "Dates present"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={att.fields?.[key] === true}
                    onCheckedChange={(v) =>
                      setAtt({ fields: { ...att.fields, [key]: v === true } })
                    }
                    data-testid={`checkbox-dc-att-field-${key}`}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Months</CardTitle>
          <CardDescription>
            {isDraft
              ? "Check the months to credit. Continuity gaps and annual capacity are checked before save; unavailable months explain why."
              : "Months can only be changed while the case is in draft."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            role="group"
            aria-label="Disability Credit months"
            className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3"
          >
            {(data.monthOptions ?? []).map((opt) => {
              const checked = selectedMonths.includes(opt.monthYmd);
              const disabled = !isDraft || (!opt.selectable && !checked);
              return (
                <label
                  key={opt.monthYmd}
                  className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                    disabled ? "opacity-60" : "hover-elevate cursor-pointer"
                  }`}
                  data-testid={`option-dc-month-${opt.monthYmd.slice(0, 7)}`}
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(v) => toggleMonth(opt.monthYmd, v === true)}
                    aria-label={formatMonthLabel(opt.monthYmd)}
                    data-testid={`checkbox-dc-month-${opt.monthYmd.slice(0, 7)}`}
                  />
                  <span className="space-y-0.5">
                    <span className="block leading-none">{formatMonthLabel(opt.monthYmd)}</span>
                    {opt.reason && (
                      <span className="block text-xs text-muted-foreground">{opt.reason}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <Button
            onClick={() => saveMonths.mutate()}
            disabled={!isDraft || saveMonths.isPending || monthsDraft === null}
            data-testid="button-dc-save-months"
          >
            Save months
          </Button>
          {isDraft && preview.data && (
            <div className="text-sm space-y-1" data-testid="text-dc-months-preview">
              {preview.data.ok ? (
                <p className="text-green-700 dark:text-green-400">Selection is valid.</p>
              ) : (
                preview.data.errors.map((e, i) => (
                  <p key={i} className="text-red-700 dark:text-red-400">
                    {e.message}
                  </p>
                ))
              )}
              {Object.entries(preview.data.perYear).map(([year, u]) => (
                <p key={year} className="text-muted-foreground">
                  {year}: {u.used} used + {u.selected} selected of {u.limit} ({u.remaining}{" "}
                  remaining)
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!terminal && c.status !== "approved" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="Reason (required for deny/withdraw, recorded for bounce)…"
              data-testid="input-dc-action-reason"
            />
            <div className="flex flex-wrap gap-2">
              {c.status === "draft" && (
                <Button
                  onClick={() => act.mutate("mark_ready")}
                  disabled={act.isPending || !data.readiness.ready}
                  data-testid="button-dc-mark-ready"
                >
                  Mark ready
                </Button>
              )}
              {c.status === "ready_for_review" && (
                <>
                  <Button onClick={() => act.mutate("queue")} disabled={act.isPending} data-testid="button-dc-queue">
                    Send to queue
                  </Button>
                  <Button variant="outline" onClick={() => act.mutate("bounce")} disabled={act.isPending} data-testid="button-dc-bounce">
                    Return to draft
                  </Button>
                </>
              )}
              {c.status === "in_queue" && (
                <>
                  <Button onClick={() => act.mutate("approve")} disabled={act.isPending} data-testid="button-dc-approve">
                    Approve
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => act.mutate("deny")}
                    disabled={act.isPending || !actionReason.trim()}
                    data-testid="button-dc-deny"
                  >
                    Deny
                  </Button>
                  <Button variant="outline" onClick={() => act.mutate("bounce")} disabled={act.isPending} data-testid="button-dc-bounce">
                    Bounce to draft
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                onClick={() => act.mutate("withdraw")}
                disabled={act.isPending || !actionReason.trim()}
                data-testid="button-dc-withdraw"
              >
                Withdraw
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <DcDocumentsCard caseId={caseId} canSupersede canSetType onEvidenceChange={invalidate} />
      <DcNotesCard caseId={caseId} notes={data.notes} />
    </div>
  );
}
